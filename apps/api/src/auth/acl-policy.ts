import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { ApiException } from '../common/api-exception';
import type { VectorAclFilter } from '../vector-store/vector-store';
import { isAdmin } from './app-role';
import type { Capability, Identity, Sensitivity } from './identity';

@Injectable()
export class AclPolicy {
  assertCapability(identity: Identity, capability: Capability): void {
    if (!identity.capabilities.includes(capability)) {
      throw new ApiException('CAPABILITY_REQUIRED', '没有执行此操作的权限', 403);
    }
  }

  documentWhere(identity: Identity): Prisma.DocumentWhereInput {
    const where: Prisma.DocumentWhereInput = {
      tenantId: identity.tenantId,
      sensitivity: { in: identity.allowedSensitivities },
    };
    if (this.hasTenantWideAccess(identity)) return where;
    return {
      ...where,
      OR: [
        { sensitivity: 'public' },
        { department: identity.department },
        { ownerId: identity.userId },
      ],
    };
  }

  vectorFilter(identity: Identity): VectorAclFilter {
    return {
      tenantId: identity.tenantId,
      departments: [identity.department],
      allowedSensitivities: identity.allowedSensitivities,
      userId: identity.userId,
      tenantWideAccess: this.hasTenantWideAccess(identity),
    };
  }

  canAccessChunk(
    identity: Identity,
    metadata: {
      tenantId: string;
      department: string;
      sensitivity: Sensitivity;
      ownerId: string;
    },
  ): boolean {
    if (
      metadata.tenantId !== identity.tenantId ||
      !identity.allowedSensitivities.includes(metadata.sensitivity)
    ) {
      return false;
    }
    return (
      this.hasTenantWideAccess(identity) ||
      metadata.sensitivity === 'public' ||
      metadata.department === identity.department ||
      metadata.ownerId === identity.userId
    );
  }

  private hasTenantWideAccess(identity: Identity): boolean {
    return isAdmin(identity.roles);
  }
}
