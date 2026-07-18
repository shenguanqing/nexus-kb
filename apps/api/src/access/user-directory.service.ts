import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  UserDirectoryEntry,
  UserDirectoryQueryRequest,
  UserDirectoryQueryResponse,
} from '@nexus-kb/contracts';

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
        roles: this.stringArray(row.roles),
        status: 'observed',
        lastAuthenticatedAt: row.lastAuthenticatedAt.toISOString(),
      })),
      total,
      offset: request.offset,
      limit: request.limit,
      scope: tenantWide ? 'tenant' : 'department',
    };
  }

  private normalizedRoles(roles: string[]): string[] {
    return [...new Set(roles)].sort();
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
  }
}
