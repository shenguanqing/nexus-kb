import type { Sensitivity } from '../auth/identity';

export interface RetrievedChunkMetadata {
  tenantId: string;
  documentId: string;
  documentVersion: number;
  chunkId: string;
  sourceName: string;
  department: string;
  sensitivity: Sensitivity;
  ownerId: string;
  page?: number;
  sheet?: string;
  sectionPath?: string[];
}

export interface RetrievedChunk {
  id: string;
  text: string;
  distance: number;
  rerankScore?: number;
  metadata: RetrievedChunkMetadata;
}
