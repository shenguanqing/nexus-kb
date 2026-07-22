import {
  documentListRequestSchema,
  documentListResponseSchema,
  documentDeleteResponseSchema,
  documentChunkListRequestSchema,
  documentChunkListResponseSchema,
  documentDetailSchema,
  documentReindexAcceptedSchema,
  documentUploadAcceptedSchema,
  documentUploadOptionsSchema,
  documentMetadataUpdateAcceptedSchema,
  documentMetadataUpdateRequestSchema,
  type DocumentListRequest,
  type DocumentListResponse,
  type DocumentChunkListRequest,
  type DocumentChunkListResponse,
  type DocumentUploadAccepted,
  type DocumentUploadOptions,
  type DocumentDeleteResponse,
  type DocumentDetail,
  type DocumentReindexAccepted,
  type DocumentMetadataUpdateAccepted,
  type Sensitivity,
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

export function fetchDocument(documentId: string): Promise<DocumentDetail> {
  return apiRequest(`/v1/documents/${encodeURIComponent(documentId)}`, documentDetailSchema);
}

export function listDocumentChunks(
  documentId: string,
  request: Partial<DocumentChunkListRequest>,
): Promise<DocumentChunkListResponse> {
  const query = documentChunkListRequestSchema.parse(request);
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  return apiRequest(
    `/v1/documents/${encodeURIComponent(documentId)}/chunks?${parameters.toString()}`,
    documentChunkListResponseSchema,
  );
}

export function reindexDocument(documentId: string): Promise<DocumentReindexAccepted> {
  return apiRequest(
    `/v1/documents/${encodeURIComponent(documentId)}/reindex`,
    documentReindexAcceptedSchema,
    { method: 'POST' },
  );
}

export function deleteDocument(documentId: string): Promise<DocumentDeleteResponse> {
  return apiRequest(
    `/v1/documents/${encodeURIComponent(documentId)}`,
    documentDeleteResponseSchema,
    { method: 'DELETE' },
    120_000,
  );
}

export function updateDocumentMetadata(
  documentId: string,
  department: string,
  sensitivity: Sensitivity,
): Promise<DocumentMetadataUpdateAccepted> {
  const body = documentMetadataUpdateRequestSchema.parse({ department, sensitivity });
  return apiRequest(
    `/v1/documents/${encodeURIComponent(documentId)}/metadata`,
    documentMetadataUpdateAcceptedSchema,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}
