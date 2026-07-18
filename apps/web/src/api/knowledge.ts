import {
  knowledgeQueryRequestSchema,
  knowledgeQueryResponseSchema,
  type KnowledgeQueryResponse,
} from '@nexus-kb/contracts';
import { apiRequest } from './client';

export function queryKnowledge(question: string): Promise<KnowledgeQueryResponse> {
  const body = knowledgeQueryRequestSchema.parse({ question });
  return apiRequest(
    '/v1/knowledge/query',
    knowledgeQueryResponseSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    120_000,
  );
}
