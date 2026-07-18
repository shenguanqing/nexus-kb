import {
  documentListRequestSchema,
  documentListResponseSchema,
  documentUploadAcceptedSchema,
  documentUploadOptionsSchema,
  type DocumentListRequest,
  type DocumentListResponse,
  type DocumentUploadAccepted,
  type DocumentUploadOptions,
} from '@nexus-kb/contracts';
import { apiRequest } from './client';

export function listDocuments(
  request: Partial<DocumentListRequest>,
): Promise<DocumentListResponse> {
  const query = documentListRequestSchema.parse(request);
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') parameters.set(key, String(value));
  }
  return apiRequest(`/v1/documents?${parameters.toString()}`, documentListResponseSchema);
}

export function fetchDocumentUploadOptions(): Promise<DocumentUploadOptions> {
  return apiRequest('/v1/documents/upload-options', documentUploadOptionsSchema);
}

export function uploadDocument(file: File): Promise<DocumentUploadAccepted> {
  const body = new FormData();
  body.set('file', file);
  return apiRequest(
    '/v1/documents',
    documentUploadAcceptedSchema,
    { method: 'POST', body },
    120_000,
  );
}
