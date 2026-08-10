import {
  conversationDeleteResponseSchema,
  conversationDetailSchema,
  conversationListRequestSchema,
  conversationListResponseSchema,
  type ConversationDeleteResponse,
  type ConversationDetail,
  type ConversationListRequest,
  type ConversationListResponse,
} from '@nexus-kb/contracts';
import { apiRequest } from './client';

export function listConversations(
  request: Partial<ConversationListRequest>,
): Promise<ConversationListResponse> {
  const query = conversationListRequestSchema.parse(request);
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) parameters.set(key, String(value));
  return apiRequest(
    `/v1/history/conversations?${parameters.toString()}`,
    conversationListResponseSchema,
  );
}

export function fetchConversation(id: string): Promise<ConversationDetail> {
  return apiRequest(
    `/v1/history/conversations/${encodeURIComponent(id)}`,
    conversationDetailSchema,
  );
}

export function deleteConversation(id: string): Promise<ConversationDeleteResponse> {
  return apiRequest(
    `/v1/history/conversations/${encodeURIComponent(id)}`,
    conversationDeleteResponseSchema,
    {
      method: 'DELETE',
    },
  );
}
