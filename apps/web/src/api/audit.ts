import {
  auditQueryRequestSchema,
  auditQueryResponseSchema,
  type AuditQueryRequest,
  type AuditQueryResponse,
} from '@nexus-kb/contracts';

import { apiRequest } from './client';

export function listAuditEvents(
  request: Partial<AuditQueryRequest>,
): Promise<AuditQueryResponse> {
  const query = auditQueryRequestSchema.parse(request);
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  return apiRequest(`/v1/audit/events?${parameters.toString()}`, auditQueryResponseSchema);
}
