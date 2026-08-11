import { Injectable } from '@nestjs/common';
import type { KnowledgeSource } from '@nexus-kb/contracts';

import { AclPolicy } from '../auth/acl-policy';
import type { Identity } from '../auth/identity';
import { PrismaService } from '../database/prisma.service';
import type { RetrievedChunk } from './retrieved-chunk';

@Injectable()
export class SourceAuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acl: AclPolicy,
  ) {}

  async retainActiveAuthorizedSources(
    identity: Identity,
    chunks: RetrievedChunk[],
  ): Promise<RetrievedChunk[]> {
    if (chunks.length === 0) return [];
    const documentIds = [...new Set(chunks.map((chunk) => chunk.metadata.documentId))];
    const activeVersions = await this.activeAuthorizedVersions(identity, documentIds);
    return chunks.filter(
      (chunk) =>
        this.acl.canAccessChunk(identity, chunk.metadata) &&
        activeVersions.get(chunk.metadata.documentId) === chunk.metadata.documentVersion,
    );
  }

  async retainActiveAuthorizedKnowledgeSources(
    identity: Identity,
    sources: KnowledgeSource[],
  ): Promise<KnowledgeSource[]> {
    if (sources.length === 0) return [];
    const documentIds = [...new Set(sources.map((source) => source.documentId))];
    const activeVersions = await this.activeAuthorizedVersions(identity, documentIds);
    return sources.filter(
      (source) => activeVersions.get(source.documentId) === source.documentVersion,
    );
  }

  private async activeAuthorizedVersions(
    identity: Identity,
    documentIds: string[],
  ): Promise<Map<string, number>> {
    const documents = await this.prisma.document.findMany({
      where: {
        ...this.acl.documentWhere(identity),
        id: { in: documentIds },
        status: 'active',
      },
      select: { id: true, activeVersion: true },
    });
    return new Map(
      documents
        .filter(
          (document): document is { id: string; activeVersion: number } =>
            document.activeVersion !== null,
        )
        .map((document) => [document.id, document.activeVersion]),
    );
  }
}
