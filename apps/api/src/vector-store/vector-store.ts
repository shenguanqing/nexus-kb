export type VectorSensitivity = 'public' | 'internal' | 'confidential';

export interface VectorChunk {
  id: string;
  tenantId: string;
  documentId: string;
  documentVersion: number;
  ordinal: number;
  redactedText: string;
  sourceName: string;
  page: number | null;
  sheet: string | null;
  sectionPath: string[];
  department: string;
  sensitivity: VectorSensitivity;
  ownerId: string;
  previousChunkId: string | null;
  nextChunkId: string | null;
}

export interface VectorAclFilter {
  tenantId: string;
  departments: string[];
  allowedSensitivities: VectorSensitivity[];
  userId: string;
  tenantWideAccess: boolean;
}

export interface VectorQueryInput {
  vector: number[];
  filter: VectorAclFilter;
  topK: number;
}

export interface RetrievedVectorChunk {
  id: string;
  text: string;
  distance: number;
  metadata: Record<string, boolean | number | string>;
}

export interface VectorStoreInfo {
  enabled: boolean;
  collectionName: string | null;
  fingerprint: string | null;
}

export interface VectorStore {
  info(): VectorStoreInfo;
  upsert(chunks: VectorChunk[], vectors: number[][]): Promise<void>;
  query(input: VectorQueryInput): Promise<RetrievedVectorChunk[]>;
  deleteDocument(tenantId: string, documentId: string): Promise<void>;
  healthCheck(): Promise<void>;
}
