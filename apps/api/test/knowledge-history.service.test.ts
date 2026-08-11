import type { KnowledgeSource } from '@nexus-kb/contracts';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeHistoryService } from '../src/history/knowledge-history.service';
import type { Identity } from '../src/auth/identity';
import type { PrismaService } from '../src/database/prisma.service';
import type { SourceAuthorizationService } from '../src/knowledge/source-authorization.service';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  department: 'finance',
  roles: ['user'],
  allowedSensitivities: ['public', 'internal'],
  capabilities: ['documents:read'],
  defaultSensitivity: 'internal',
};

function createService(
  prisma: PrismaService,
  retainedSources?: KnowledgeSource[],
): KnowledgeHistoryService {
  const sourceAuthorization = {
    retainActiveAuthorizedKnowledgeSources: vi.fn(
      (_identity: Identity, sources: KnowledgeSource[]) =>
        Promise.resolve(retainedSources ?? sources),
    ),
  } as unknown as SourceAuthorizationService;
  return new KnowledgeHistoryService(prisma, sourceAuthorization);
}

describe('KnowledgeHistoryService', () => {
  it('loads only the owned conversation recent questions in chronological order', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      turns: [{ question: '它的限制是什么？' }, { question: '比较前两个方案。' }],
    });
    const service = createService({
      knowledgeConversation: { findFirst },
    } as unknown as PrismaService);

    await expect(
      service.recentQuestions('11111111-1111-4111-8111-111111111111', identity),
    ).resolves.toEqual(['比较前两个方案。', '它的限制是什么？']);
    const [input] = findFirst.mock.calls[0] as [
      {
        where: { id: string; tenantId: string; userId: string };
        select: { turns: { take: number; where: { questionSensitivity: string } } };
      },
    ];
    expect(input).toMatchObject({
      where: {
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: 'tenant-a',
        userId: 'user-a',
      },
      select: {
        turns: { take: 4, where: { questionSensitivity: 'internal' } },
      },
    });
  });

  it('fails before provider work when the requested conversation is not owned', async () => {
    const service = createService({
      knowledgeConversation: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService);

    await expect(
      service.recentQuestions('11111111-1111-4111-8111-111111111111', identity),
    ).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND', status: 404 });
  });

  it('persists the server-side question sensitivity for future safe context reuse', async () => {
    const createTurn = vi.fn().mockResolvedValue({});
    const transaction = {
      knowledgeConversation: {
        findFirst: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }),
        update: vi.fn().mockResolvedValue({}),
      },
      knowledgeTurn: { create: createTurn },
    };
    const service = createService({
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    } as unknown as PrismaService);

    await service.recordTurn(
      '11111111-1111-4111-8111-111111111111',
      '付款周期是多少？',
      {
        answer: '当前知识库中没有找到足够可靠且有权限访问的依据。',
        noAnswer: true,
        reason: 'insufficient_relevance',
        answerMode: null,
        traceId: '21111111-1111-4111-8111-111111111111',
        sources: [],
        model: null,
        rerankDegraded: false,
      },
      identity,
    );

    const [createInput] = createTurn.mock.calls[0] as [{ data: { questionSensitivity: string } }];
    expect(createInput.data.questionSensitivity).toBe('internal');
  });

  it('lists only conversations owned by the authenticated tenant user', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: '付款周期',
        createdAt: new Date('2026-07-20T00:00:00Z'),
        updatedAt: new Date('2026-07-20T01:00:00Z'),
        _count: { turns: 2 },
      },
    ]);
    const count = vi.fn().mockResolvedValue(1);
    const service = createService({
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
    const service = createService({
      knowledgeConversation: { findFirst },
    } as unknown as PrismaService);
    await expect(
      service.detail('11111111-1111-4111-8111-111111111111', identity),
    ).rejects.toMatchObject({
      code: 'CONVERSATION_NOT_FOUND',
    });
    const [input] = findFirst.mock.calls[0] as [{ where: { tenantId: string; userId: string } }];
    expect(input.where).toMatchObject({ tenantId: 'tenant-a', userId: 'user-a' });
  });

  it('returns the persisted answer mode for historical general answers', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Vue 版本区别',
      createdAt: new Date('2026-07-26T00:00:00Z'),
      updatedAt: new Date('2026-07-26T00:01:00Z'),
      turns: [
        {
          id: '21111111-1111-4111-8111-111111111111',
          question: 'Vue 2 和 Vue 3 的区别',
          answer: 'Vue 3 使用 Proxy。',
          noAnswer: false,
          reason: null,
          answerMode: 'general',
          traceId: '31111111-1111-4111-8111-111111111111',
          sources: [],
          createdAt: new Date('2026-07-26T00:01:00Z'),
        },
      ],
    });
    const service = createService({
      knowledgeConversation: { findFirst },
    } as unknown as PrismaService);

    await expect(
      service.detail('11111111-1111-4111-8111-111111111111', identity),
    ).resolves.toMatchObject({
      turns: [{ answerMode: 'general', sources: [], sourceCount: 0 }],
    });
  });

  it('returns reauthorized sources for historical grounded answers', async () => {
    const source: KnowledgeSource = {
      index: 1,
      documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
      documentVersion: 1,
      chunkIds: ['a'.repeat(64)],
      sourceName: 'policy.md',
      page: 2,
      sheet: null,
      sectionPath: ['付款'],
    };
    const findFirst = vi.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      title: '付款周期',
      createdAt: new Date('2026-08-11T00:00:00Z'),
      updatedAt: new Date('2026-08-11T00:01:00Z'),
      turns: [
        {
          id: '21111111-1111-4111-8111-111111111111',
          question: '付款周期是多少？',
          answer: '付款周期为 30 天。[来源1]',
          noAnswer: false,
          reason: null,
          answerMode: 'grounded',
          traceId: '31111111-1111-4111-8111-111111111111',
          sources: [source],
          createdAt: new Date('2026-08-11T00:01:00Z'),
        },
      ],
    });
    const service = createService(
      { knowledgeConversation: { findFirst } } as unknown as PrismaService,
      [source],
    );

    await expect(
      service.detail('11111111-1111-4111-8111-111111111111', identity),
    ).resolves.toMatchObject({
      turns: [{ answerMode: 'grounded', sources: [source], sourceCount: 1 }],
    });
  });

  it('hides a historical grounded answer when any source is no longer authorized', async () => {
    const source: KnowledgeSource = {
      index: 1,
      documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
      documentVersion: 1,
      chunkIds: ['a'.repeat(64)],
      sourceName: 'policy.md',
      page: 2,
      sheet: null,
      sectionPath: [],
    };
    const findFirst = vi.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      title: '付款周期',
      createdAt: new Date('2026-08-11T00:00:00Z'),
      updatedAt: new Date('2026-08-11T00:01:00Z'),
      turns: [
        {
          id: '21111111-1111-4111-8111-111111111111',
          question: '付款周期是多少？',
          answer: '付款周期为 30 天。[来源1]',
          noAnswer: false,
          reason: null,
          answerMode: 'grounded',
          traceId: '31111111-1111-4111-8111-111111111111',
          sources: [source],
          createdAt: new Date('2026-08-11T00:01:00Z'),
        },
      ],
    });
    const service = createService(
      { knowledgeConversation: { findFirst } } as unknown as PrismaService,
      [],
    );

    await expect(
      service.detail('11111111-1111-4111-8111-111111111111', identity),
    ).resolves.toMatchObject({
      turns: [
        {
          answer: '该历史回答的可用来源已发生变化，请重新提问。',
          noAnswer: true,
          reason: 'authorization_changed',
          answerMode: null,
          sources: [],
          sourceCount: 0,
        },
      ],
    });
  });

  it('deletes with tenant and user ownership filters', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const service = createService({
      knowledgeConversation: { deleteMany },
    } as unknown as PrismaService);
    await service.delete('11111111-1111-4111-8111-111111111111', identity);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: '11111111-1111-4111-8111-111111111111', tenantId: 'tenant-a', userId: 'user-a' },
    });
  });
});
