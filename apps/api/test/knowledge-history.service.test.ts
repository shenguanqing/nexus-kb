import { describe, expect, it, vi } from 'vitest';
import { KnowledgeHistoryService } from '../src/history/knowledge-history.service';
import type { Identity } from '../src/auth/identity';
import type { PrismaService } from '../src/database/prisma.service';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  department: 'finance',
  roles: [],
  allowedSensitivities: ['public', 'internal'],
  capabilities: ['documents:read'],
  defaultSensitivity: 'internal',
};

describe('KnowledgeHistoryService', () => {
  it('lists only conversations owned by the authenticated tenant user', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        {
          id: '11111111-1111-4111-8111-111111111111',
          title: '付款周期',
          createdAt: new Date('2026-07-20T00:00:00Z'),
          updatedAt: new Date('2026-07-20T01:00:00Z'),
          _count: { turns: 2 },
        },
      ]);
    const count = vi.fn().mockResolvedValue(1);
    const service = new KnowledgeHistoryService({
      knowledgeConversation: { findMany, count },
    } as unknown as PrismaService);
    const result = await service.list({ offset: 0, limit: 20 }, identity);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a', userId: 'user-a' } }),
    );
    expect(result.conversations[0]?.messageCount).toBe(4);
  });

  it('fails closed when another user requests conversation detail', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new KnowledgeHistoryService({
      knowledgeConversation: { findFirst },
    } as unknown as PrismaService);
    await expect(
      service.detail('11111111-1111-4111-8111-111111111111', identity),
    ).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
    const [input] = findFirst.mock.calls[0] as [{ where: { tenantId: string; userId: string } }];
    expect(input.where).toMatchObject({ tenantId: 'tenant-a', userId: 'user-a' });
  });

  it('deletes with tenant and user ownership filters', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const service = new KnowledgeHistoryService({
      knowledgeConversation: { deleteMany },
    } as unknown as PrismaService);
    await service.delete('11111111-1111-4111-8111-111111111111', identity);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: '11111111-1111-4111-8111-111111111111', tenantId: 'tenant-a', userId: 'user-a' },
    });
  });
});
