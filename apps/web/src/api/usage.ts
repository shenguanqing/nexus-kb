import {
  usageQueryRequestSchema,
  usageResponseSchema,
  type UsageResponse,
} from '@nexus-kb/contracts';
import { apiRequest } from './client';

export function fetchUsage(from: string, to: string): Promise<UsageResponse> {
  const query = usageQueryRequestSchema.parse({ from, to });
  const parameters = new URLSearchParams(query);
  return apiRequest(`/v1/system/usage?${parameters.toString()}`, usageResponseSchema);
}
