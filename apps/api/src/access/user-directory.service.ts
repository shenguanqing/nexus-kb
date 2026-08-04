import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AppRole } from '@nexus-kb/contracts';
import type {
  DepartmentPolicyListResponse,
  DepartmentPolicyUpdateRequest,
  DepartmentPolicyUpdateResponse,
  ManagedUserCreateRequest,
  ManagedUserDeleteResponse,
  ManagedUserMutationResponse,
  ManagedUserUpdateRequest,
  UserDirectoryEntry,
  UserDirectoryQueryRequest,
  UserDirectoryQueryResponse,
  UserRoleUpdateRequest,
  UserRoleUpdateResponse,
} from '@nexus-kb/contracts';
import { randomUUID } from 'node:crypto';

import { AclPolicy } from '../auth/acl-policy';
import { ADMIN_CAPABILITIES, isAdmin, normalizeAppRoles } from '../auth/app-role';
import { SENSITIVITIES, type Identity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { PrismaService } from '../database/prisma.service';
import { createPasswordDigest } from '../auth/password-digest';

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
        roles: normalizeAppRoles(identity.roles),
        lastAuthenticatedAt: now,
      },
      update: {
        department: identity.department,
        roles: normalizeAppRoles(identity.roles),
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
    const roles = entry?.managedRoles
      ? normalizeAppRoles(this.stringArray(entry.managedRoles))
      : normalizeAppRoles(identity.roles);
    const policySensitivities = policy
      ? this.sensitivityArray(policy.allowedSensitivities)
      : identity.allowedSensitivities;
    const allowedSensitivities = isAdmin(roles)
      ? [...SENSITIVITIES]
      : identity.allowedSensitivities.filter((item) => policySensitivities.includes(item));
    if (allowedSensitivities.length === 0) {
      throw new ApiException('DEPARTMENT_POLICY_INVALID', '部门权限策略无有效敏感度', 503);
    }
    return {
      ...identity,
      roles,
      allowedSensitivities,
      capabilities: isAdmin(roles) ? [...ADMIN_CAPABILITIES] : identity.capabilities,
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
    const tenantWide = isAdmin(identity.roles);
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
        username: row.username,
        department: row.department,
        roles: normalizeAppRoles(this.stringArray(row.managedRoles ?? row.roles)),
        roleSource: row.managedRoles ? 'managed' : 'identity',
        status: row.authSource === 'password' ? (row.enabled ? 'active' : 'disabled') : 'observed',
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
    this.assertAdminWrite(identity);
    const roles = normalizeAppRoles(request.roles);
    const updated = await this.prisma.$transaction(
      async (transaction) => {
        const entries = await transaction.userDirectoryEntry.findMany({
          where: { tenantId: identity.tenantId },
        });
        const target = entries.find((entry) => entry.userId === userId);
        if (!target) throw new ApiException('USER_DIRECTORY_NOT_FOUND', '用户不存在', 404);
        const before = normalizeAppRoles(this.stringArray(target.managedRoles ?? target.roles));
        const administrators = entries.filter((entry) =>
          isAdmin(normalizeAppRoles(this.stringArray(entry.managedRoles ?? entry.roles))),
        ).length;
        this.assertAdministratorCannotRemoveSelf(identity, userId, before, roles, false);
        if (isAdmin(before) && !isAdmin(roles) && administrators <= 1) {
          throw new ApiException('LAST_ADMIN_REQUIRED', '不能移除最后一个管理员', 409);
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

  async createManagedUser(
    request: ManagedUserCreateRequest,
    identity: Identity,
    traceId: string,
  ): Promise<ManagedUserMutationResponse> {
    this.assertAdminWrite(identity);
    const digest = await createPasswordDigest(request.password);
    const roles = normalizeAppRoles(request.roles);
    const row = await this.prisma.$transaction(async (transaction) => {
      const duplicate = await transaction.userDirectoryEntry.findFirst({
        where: {
          OR: [
            { username: request.username.toLowerCase() },
            { tenantId: identity.tenantId, userId: request.userId },
          ],
        },
      });
      if (duplicate) throw new ApiException('USER_ACCOUNT_CONFLICT', '账号或用户 ID 已存在', 409);
      const created = await transaction.userDirectoryEntry.create({
        data: {
          tenantId: identity.tenantId,
          userId: request.userId,
          username: request.username.toLowerCase(),
          department: request.department,
          roles,
          managedRoles: roles,
          allowedSensitivities: [...new Set(request.allowedSensitivities)],
          defaultSensitivity: request.defaultSensitivity,
          authSource: 'password',
          passwordSalt: Uint8Array.from(digest.salt),
          passwordDigest: Uint8Array.from(digest.digest),
          enabled: true,
          lastAuthenticatedAt: new Date(),
        },
      });
      await transaction.accessAudit.create({
        data: {
          id: randomUUID(),
          tenantId: identity.tenantId,
          actorUserId: identity.userId,
          targetType: 'user',
          targetId: created.userId,
          eventType: 'user_created',
          before: {},
          after: {
            userId: created.userId,
            username: created.username,
            roles,
            department: created.department,
          },
          traceId,
        },
      });
      return created;
    });
    return { user: this.entry(row), traceId };
  }

  async updateManagedUser(
    userId: string,
    request: ManagedUserUpdateRequest,
    identity: Identity,
    traceId: string,
  ): Promise<ManagedUserMutationResponse> {
    this.assertAdminWrite(identity);
    const password = request.password ? await createPasswordDigest(request.password) : undefined;
    const row = await this.prisma.$transaction(
      async (transaction) => {
        const entries = await transaction.userDirectoryEntry.findMany({
          where: { tenantId: identity.tenantId },
        });
        const target = entries.find((entry) => entry.userId === userId);
        if (!target) throw new ApiException('USER_DIRECTORY_NOT_FOUND', '用户不存在', 404);
        if (target.authSource !== 'password') {
          throw new ApiException('USER_ACCOUNT_NOT_MANAGED', '外部身份账号不能在此管理', 409);
        }
        const beforeRole = normalizeAppRoles(this.stringArray(target.managedRoles ?? target.roles));
        const roles = request.roles ? normalizeAppRoles(request.roles) : beforeRole;
        const disablesAccount = request.enabled === false;
        this.assertAdministratorCannotRemoveSelf(
          identity,
          userId,
          beforeRole,
          roles,
          disablesAccount,
        );
        this.assertAdministratorRemains(entries, beforeRole, roles, disablesAccount);
        const allowedSensitivities = request.allowedSensitivities
          ? [...new Set(request.allowedSensitivities)]
          : this.sensitivityArray(target.allowedSensitivities);
        const defaultSensitivity = request.defaultSensitivity ?? target.defaultSensitivity;
        if (!defaultSensitivity || !allowedSensitivities.includes(defaultSensitivity)) {
          throw new ApiException('USER_ACCOUNT_INVALID', '默认敏感度必须位于允许范围内', 400);
        }
        const updated = await transaction.userDirectoryEntry.update({
          where: { tenantId_userId: { tenantId: identity.tenantId, userId } },
          data: {
            department: request.department,
            managedRoles: request.roles ? roles : undefined,
            allowedSensitivities: request.allowedSensitivities ? allowedSensitivities : undefined,
            defaultSensitivity,
            enabled: request.enabled,
            passwordSalt: password ? Uint8Array.from(password.salt) : undefined,
            passwordDigest: password ? Uint8Array.from(password.digest) : undefined,
          },
        });
        if (request.enabled === false || password) {
          await transaction.passwordAuthSession.deleteMany({
            where: { tenantId: identity.tenantId, userId },
          });
        }
        await transaction.accessAudit.create({
          data: {
            id: randomUUID(),
            tenantId: identity.tenantId,
            actorUserId: identity.userId,
            targetType: 'user',
            targetId: userId,
            eventType: 'user_updated',
            before: this.userAuditSummary(target),
            after: this.userAuditSummary(updated),
            traceId,
          },
        });
        return updated;
      },
      { isolationLevel: 'Serializable' },
    );
    return { user: this.entry(row), traceId };
  }

  async deleteManagedUser(
    userId: string,
    identity: Identity,
    traceId: string,
  ): Promise<ManagedUserDeleteResponse> {
    this.assertAdminWrite(identity);
    await this.prisma.$transaction(
      async (transaction) => {
        const entries = await transaction.userDirectoryEntry.findMany({
          where: { tenantId: identity.tenantId },
        });
        const target = entries.find((entry) => entry.userId === userId);
        if (!target) throw new ApiException('USER_DIRECTORY_NOT_FOUND', '用户不存在', 404);
        if (target.authSource !== 'password') {
          throw new ApiException('USER_ACCOUNT_NOT_MANAGED', '外部身份账号不能在此管理', 409);
        }
        if (identity.userId === userId) {
          throw new ApiException(
            'SELF_ACCOUNT_DELETE_FORBIDDEN',
            '管理员不能删除自己的账号，请由另一位管理员操作',
            409,
          );
        }
        this.assertAdministratorRemains(
          entries,
          normalizeAppRoles(this.stringArray(target.managedRoles ?? target.roles)),
          ['user'],
          true,
        );
        await transaction.passwordAuthSession.deleteMany({
          where: { tenantId: identity.tenantId, userId },
        });
        await transaction.userDirectoryEntry.delete({
          where: { tenantId_userId: { tenantId: identity.tenantId, userId } },
        });
        await transaction.accessAudit.create({
          data: {
            id: randomUUID(),
            tenantId: identity.tenantId,
            actorUserId: identity.userId,
            targetType: 'user',
            targetId: userId,
            eventType: 'user_deleted',
            before: this.userAuditSummary(target),
            after: {},
            traceId,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    return { deleted: true, traceId };
  }

  async listDepartments(identity: Identity): Promise<DepartmentPolicyListResponse> {
    this.acl.assertCapability(identity, 'access:read');
    const tenantWide = isAdmin(identity.roles);
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
    this.assertAdminWrite(identity);
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
    username: string | null;
    department: string;
    roles: unknown;
    managedRoles: unknown;
    authSource: string;
    enabled: boolean;
    lastAuthenticatedAt: Date;
  }): UserDirectoryEntry {
    return {
      userId: row.userId,
      username: row.username,
      department: row.department,
      roles: normalizeAppRoles(this.stringArray(row.managedRoles ?? row.roles)),
      roleSource: row.managedRoles ? 'managed' : 'identity',
      status: row.authSource === 'password' ? (row.enabled ? 'active' : 'disabled') : 'observed',
      lastAuthenticatedAt: row.lastAuthenticatedAt.toISOString(),
    };
  }

  private assertAdministratorRemains(
    entries: Array<{ roles: unknown; managedRoles: unknown }>,
    before: readonly AppRole[],
    after: readonly AppRole[],
    removesAccount: boolean,
  ): void {
    const administrators = entries.filter((entry) =>
      isAdmin(normalizeAppRoles(this.stringArray(entry.managedRoles ?? entry.roles))),
    ).length;
    if (isAdmin(before) && (removesAccount || !isAdmin(after)) && administrators <= 1) {
      throw new ApiException('LAST_ADMIN_REQUIRED', '不能移除、禁用或降级最后一个管理员', 409);
    }
  }

  private assertAdministratorCannotRemoveSelf(
    identity: Identity,
    targetUserId: string,
    before: readonly AppRole[],
    after: readonly AppRole[],
    removesAccount: boolean,
  ): void {
    if (
      identity.userId === targetUserId &&
      isAdmin(before) &&
      (removesAccount || !isAdmin(after))
    ) {
      throw new ApiException(
        'SELF_ADMIN_MUTATION_FORBIDDEN',
        '管理员不能禁用自己或将自己降级，请由另一位管理员操作',
        409,
      );
    }
  }

  private userAuditSummary(row: {
    userId: string;
    username: string | null;
    department: string;
    roles: unknown;
    managedRoles: unknown;
    enabled: boolean;
  }): Prisma.InputJsonObject {
    return {
      userId: row.userId,
      username: row.username ?? '',
      department: row.department,
      roles: normalizeAppRoles(this.stringArray(row.managedRoles ?? row.roles)),
      enabled: row.enabled,
    };
  }

  private assertAdminWrite(identity: Identity): void {
    this.acl.assertCapability(identity, 'access:write');
    if (!isAdmin(identity.roles)) {
      throw new ApiException('ADMIN_REQUIRED', '需要管理员权限', 403);
    }
  }
}
