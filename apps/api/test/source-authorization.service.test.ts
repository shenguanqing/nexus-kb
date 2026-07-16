import { describe, expect, it, vi } from 'vitest';

import { AclPolicy } from '../src/auth/acl-policy';
import type { Identity } from '../src/auth/identity';
import type { PrismaService } from '../src/database/prisma.service';
import type { RetrievedChunk } from '../src/knowledge/retrieved-chunk';
import { SourceAuthorizationService } from '../src/knowledge/source-authorization.service';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  department: 'finance',
  roles: [],
  allowedSensitivities: ['public', 'internal'],
  capabilities: ['documents:read'],
  defaultSensitivity: 'internal',
};

function chunk(documentId: string, version: number, tenantId = 'tenant-a'): RetrievedChunk {
  return {
    id: `${documentId}-${version}`,
    text: 'text',
    distance: 0.1,
    metadata: {
      tenantId,
      documentId,
      documentVersion: version,
      chunkId: `${documentId}-${version}`,
      sourceName: 'source.md',
      department: 'finance',
      sensitivity: 'internal',
      ownerId: 'owner-a',
    },
  };
}

describe('SourceAuthorizationService', () => {
  it('retains only the current active version and rechecks tenant ACL', async () => {
    const findMany = vi
      .fn<
        (input: {
          where: { tenantId?: string; status?: string };
        }) => Promise<Array<{ id: string; activeVersion: number | null }>>
      >()
      .mockResolvedValue([{ id: 'document-a', activeVersion: 2 }]);
    const prisma = { document: { findMany } } as unknown as PrismaService;
    const service = new SourceAuthorizationService(prisma, new AclPolicy());
    const result = await service.retainActiveAuthorizedSources(identity, [
      chunk('document-a', 1),
      chunk('document-a', 2),
      chunk('document-b', 1, 'tenant-b'),
    ]);

    expect(result).toEqual([chunk('document-a', 2)]);
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      tenantId: 'tenant-a',
      status: 'active',
    });
  });
});
