import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  DepartmentPolicyListResponse,
  DepartmentPolicyUpdateRequest,
  DepartmentPolicyUpdateResponse,
  UserDirectoryEntry,
  UserDirectoryQueryRequest,
  UserDirectoryQueryResponse,
  UserRoleUpdateRequest,
  UserRoleUpdateResponse,
} from '@nexus-kb/contracts';
import { randomUUID } from 'node:crypto';

import { AclPolicy } from '../auth/acl-policy';
import type { Identity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UserDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acl: AclPolicy,
  ) {}

  async observe(identity: Identity): Promise<void> {
    const now = new Date();
    await this.prisma.userDirectoryEntry.upsert({
      where: { tenantId_userId: { tenantId: identity.tenantId, userId: identity.userId } },
      create: {
        tenantId: identity.tenantId,
        userId: identity.userId,
        department: identity.department,
        roles: this.normalizedRoles(identity.roles),
        lastAuthenticatedAt: now,
      },
      update: {
        department: identity.department,
        roles: this.normalizedRoles(identity.roles),
        lastAuthenticatedAt: now,
      },
    });
  }

  async resolve(identity: Identity): Promise<Identity> {
    const [entry, policy] = await Promise.all([
      this.prisma.userDirectoryEntry.findUnique({
        where: { tenantId_userId: { tenantId: identity.tenantId, userId: identity.userId } },
        select: { managedRoles: true },
      }),
      this.prisma.departmentPolicy.findUnique({
        where: {
          tenantId_department: {
            tenantId: identity.tenantId,
            department: identity.department,
          },
        },
        select: { allowedSensitivities: true },
      }),
    ]);
    const policySensitivities = policy
      ? this.sensitivityArray(policy.allowedSensitivities)
      : identity.allowedSensitivities;
    const allowedSensitivities = identity.allowedSensitivities.filter((item) =>
      policySensitivities.includes(item),
    );
    if (allowedSensitivities.length === 0) {
      throw new ApiException('DEPARTMENT_POLICY_INVALID', '部门权限策略无有效敏感度', 503);
    }
    return {
      ...identity,
      roles: entry?.managedRoles ? this.stringArray(entry.managedRoles) : identity.roles,
      allowedSensitivities,
      defaultSensitivity: allowedSensitivities.includes(identity.defaultSensitivity)
        ? identity.defaultSensitivity
        : allowedSensitivities[0]!,
    };
  }

  async query(
    request: UserDirectoryQueryRequest,
    identity: Identity,
  ): Promise<UserDirectoryQueryResponse> {
    this.acl.assertCapability(identity, 'access:read');
    const tenantWide = identity.roles.includes('platform_admin');
    if (!tenantWide && request.department && request.department !== identity.department) {
      throw new ApiException('ACCESS_SCOPE_FORBIDDEN', '不能查看其他部门的用户', 403);
    }
    const where: Prisma.UserDirectoryEntryWhereInput = {
      tenantId: identity.tenantId,
      department: tenantWide ? request.department : identity.department,
      ...(request.query
        ? { userId: { contains: request.query, mode: 'insensitive' as const } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.userDirectoryEntry.findMany({
        where,
        orderBy: [{ lastAuthenticatedAt: 'desc' }, { userId: 'asc' }],
        skip: request.offset,
        take: request.limit,
      }),
      this.prisma.userDirectoryEntry.count({ where }),
    ]);
    return {
      users: rows.map((row): UserDirectoryEntry => ({
        userId: row.userId,
        department: row.department,
        roles: this.stringArray(row.managedRoles ?? row.roles),
        roleSource: row.managedRoles ? 'managed' : 'identity',
        status: 'observed',
        lastAuthenticatedAt: row.lastAuthenticatedAt.toISOString(),
      })),
      total,
      offset: request.offset,
      limit: request.limit,
      scope: tenantWide ? 'tenant' : 'department',
    };
  }

  async updateRoles(
    userId: string,
    request: UserRoleUpdateRequest,
    identity: Identity,
    traceId: string,
  ): Promise<UserRoleUpdateResponse> {
    this.assertPlatformWrite(identity);
    const roles = [...new Set(request.roles)].sort();
    const updated = await this.prisma.$transaction(
      async (transaction) => {
        const entries = await transaction.userDirectoryEntry.findMany({
          where: { tenantId: identity.tenantId },
        });
        const target = entries.find((entry) => entry.userId === userId);
        if (!target) throw new ApiException('USER_DIRECTORY_NOT_FOUND', '用户不存在', 404);
        const before = this.stringArray(target.managedRoles ?? target.roles);
        const platformAdmins = entries.filter((entry) =>
          this.stringArray(entry.managedRoles ?? entry.roles).includes('platform_admin'),
        ).length;
        if (
          before.includes('platform_admin') &&
          !roles.includes('platform_admin') &&
          platformAdmins <= 1
        ) {
          throw new ApiException('LAST_PLATFORM_ADMIN_REQUIRED', '不能移除最后一个平台管理员', 409);
        }
        const row = await transaction.userDirectoryEntry.update({
          where: { tenantId_userId: { tenantId: identity.tenantId, userId } },
          data: { managedRoles: roles },
        });
        await transaction.accessAudit.create({
          data: {
            id: randomUUID(),
            tenantId: identity.tenantId,
            actorUserId: identity.userId,
            targetType: 'user',
            targetId: userId,
            eventType: 'roles_updated',
            before,
            after: roles,
            traceId,
          },
        });
        return row;
      },
      { isolationLevel: 'Serializable' },
    );
    return {
      user: this.entry(updated),
      traceId,
    };
  }

  async listDepartments(identity: Identity): Promise<DepartmentPolicyListResponse> {
    this.acl.assertCapability(identity, 'access:read');
    const tenantWide = identity.roles.includes('platform_admin');
    const departmentWhere = tenantWide ? {} : { department: identity.department };
    const [users, documents, policies] = await Promise.all([
      this.prisma.userDirectoryEntry.groupBy({
        by: ['department'],
        where: { tenantId: identity.tenantId, ...departmentWhere },
        _count: { _all: true },
      }),
      this.prisma.document.groupBy({
        by: ['department'],
        where: { tenantId: identity.tenantId, deletedAt: null, ...departmentWhere },
        _count: { _all: true },
      }),
      this.prisma.departmentPolicy.findMany({
        where: { tenantId: identity.tenantId, ...departmentWhere },
      }),
    ]);
    const names = new Set([
      ...users.map((row) => row.department),
      ...documents.map((row) => row.department),
      ...policies.map((row) => row.department),
      ...(!tenantWide ? [identity.department] : []),
    ]);
    return {
      departments: [...names].sort().map((department) => {
        const policy = policies.find((row) => row.department === department);
        return {
          department,
          allowedSensitivities: policy
            ? this.sensitivityArray(policy.allowedSensitivities)
            : ['public', 'internal', 'confidential'],
          userCount: users.find((row) => row.department === department)?._count._all ?? 0,
          documentCount: documents.find((row) => row.department === department)?._count._all ?? 0,
          managed: Boolean(policy),
          updatedAt: policy?.updatedAt.toISOString() ?? null,
        };
      }),
      scope: tenantWide ? 'tenant' : 'department',
    };
  }

  async updateDepartment(
    department: string,
    request: DepartmentPolicyUpdateRequest,
    identity: Identity,
    traceId: string,
  ): Promise<DepartmentPolicyUpdateResponse> {
    this.assertPlatformWrite(identity);
    const allowedSensitivities = [...new Set(request.allowedSensitivities)];
    const existing = await this.prisma.departmentPolicy.findUnique({
      where: { tenantId_department: { tenantId: identity.tenantId, department } },
    });
    const row = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.departmentPolicy.upsert({
        where: { tenantId_department: { tenantId: identity.tenantId, department } },
        create: {
          tenantId: identity.tenantId,
          department,
          allowedSensitivities,
          updatedBy: identity.userId,
        },
        update: { allowedSensitivities, updatedBy: identity.userId },
      });
      await transaction.accessAudit.create({
        data: {
          id: randomUUID(),
          tenantId: identity.tenantId,
          actorUserId: identity.userId,
          targetType: 'department',
          targetId: department,
          eventType: 'department_policy_updated',
          before: existing ? this.sensitivityArray(existing.allowedSensitivities) : [],
          after: allowedSensitivities,
          traceId,
        },
      });
      return updated;
    });
    const listing = await this.listDepartments(identity);
    const result = listing.departments.find((item) => item.department === row.department);
    if (!result) throw new ApiException('DEPARTMENT_NOT_FOUND', '部门不存在', 404);
    return { department: result, traceId };
  }

  private normalizedRoles(roles: string[]): string[] {
    return [...new Set(roles)].sort();
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
  }

  private sensitivityArray(value: unknown): Identity['allowedSensitivities'] {
    return Array.isArray(value)
      ? value.filter(
          (item): item is Identity['allowedSensitivities'][number] =>
            item === 'public' || item === 'internal' || item === 'confidential',
        )
      : [];
  }

  private entry(row: {
    userId: string;
    department: string;
    roles: unknown;
    managedRoles: unknown;
    lastAuthenticatedAt: Date;
  }): UserDirectoryEntry {
    return {
      userId: row.userId,
      department: row.department,
      roles: this.stringArray(row.managedRoles ?? row.roles),
      roleSource: row.managedRoles ? 'managed' : 'identity',
      status: 'observed',
      lastAuthenticatedAt: row.lastAuthenticatedAt.toISOString(),
    };
  }

  private assertPlatformWrite(identity: Identity): void {
    this.acl.assertCapability(identity, 'access:write');
    if (!identity.roles.includes('platform_admin')) {
      throw new ApiException('PLATFORM_ADMIN_REQUIRED', '需要平台管理员权限', 403);
    }
  }
}
