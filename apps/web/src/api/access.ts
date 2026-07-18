import {
  userDirectoryQueryRequestSchema,
  userDirectoryQueryResponseSchema,
  type UserDirectoryQueryRequest,
  type UserDirectoryQueryResponse,
} from '@nexus-kb/contracts';

import { apiRequest } from './client';

export function listUsers(
  request: Partial<UserDirectoryQueryRequest>,
): Promise<UserDirectoryQueryResponse> {
  const query = userDirectoryQueryRequestSchema.parse(request);
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  return apiRequest(`/v1/access/users?${parameters.toString()}`, userDirectoryQueryResponseSchema);
}
