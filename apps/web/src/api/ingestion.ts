import {
  ingestionJobListRequestSchema,
  ingestionJobListResponseSchema,
  ingestionJobSchema,
  ingestionRetryAcceptedSchema,
  type IngestionJob,
  type IngestionJobListRequest,
  type IngestionJobListResponse,
  type IngestionRetryAccepted,
} from '@nexus-kb/contracts';
import { apiRequest } from './client';

export function listIngestionJobs(
  request: Partial<IngestionJobListRequest>,
): Promise<IngestionJobListResponse> {
  const query = ingestionJobListRequestSchema.parse(request);
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  return apiRequest(`/v1/ingestion-jobs?${parameters.toString()}`, ingestionJobListResponseSchema);
}

export function fetchIngestionJob(jobId: string): Promise<IngestionJob> {
  return apiRequest(`/v1/ingestion-jobs/${encodeURIComponent(jobId)}`, ingestionJobSchema);
}

export function retryIngestionJob(jobId: string): Promise<IngestionRetryAccepted> {
  return apiRequest(
    `/v1/ingestion-jobs/${encodeURIComponent(jobId)}/retry`,
    ingestionRetryAcceptedSchema,
    { method: 'POST' },
  );
}
