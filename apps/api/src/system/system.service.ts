import { Injectable } from '@nestjs/common';
import type {
  ProviderStatus,
  ProviderStatusResponse,
  SystemComponentId,
  SystemStatusResponse,
} from '@nexus-kb/contracts';
import { statfs } from 'node:fs/promises';

import { AclPolicy } from '../auth/acl-policy';
import type { Identity } from '../auth/identity';
import { AppConfig, type Environment } from '../config/app-config';
import { HealthService } from '../health/health.service';
import { IngestionQueue } from '../ingestion/ingestion.queue';
import { ChromaVectorStore } from '../vector-store/chroma-vector-store';

type LlmProviderId = Exclude<Environment['LLM_PROVIDER'], 'none'>;
type HealthReason = 'unavailable' | 'unhealthy' | 'configuration_mismatch';

@Injectable()
export class SystemService {
  constructor(
    private readonly config: AppConfig,
    private readonly health: HealthService,
    private readonly queue: IngestionQueue,
    private readonly vectorStore: ChromaVectorStore,
    private readonly acl: AclPolicy,
  ) {}

  providers(identity: Identity): ProviderStatusResponse {
    this.acl.assertCapability(identity, 'system:read');
    const environment = this.config.values;
    const embeddingEnabled = environment.EMBEDDING_PROVIDER !== 'none';
    const rerankEnabled = environment.RERANK_PROVIDER !== 'none';
    const embeddingEndpoint =
      environment.EMBEDDING_PROVIDER === 'ollama'
        ? environment.OLLAMA_BASE_URL
        : environment.ALIBABA_BASE_URL;
    return {
      providers: [
        {
          kind: 'embedding',
          provider: embeddingEnabled ? environment.EMBEDDING_PROVIDER : null,
          model: embeddingEnabled ? environment.EMBEDDING_MODEL : null,
          configurationStatus: embeddingEnabled ? 'configured' : 'disabled',
          endpointHost: embeddingEnabled ? this.endpointHost(embeddingEndpoint) : null,
          region: embeddingEnabled ? environment.EMBEDDING_REGION : null,
          dimensions: embeddingEnabled ? environment.EMBEDDING_DIMENSIONS : null,
          credentialConfigured:
            embeddingEnabled &&
            (environment.EMBEDDING_PROVIDER === 'ollama' || Boolean(environment.DASHSCOPE_API_KEY)),
          fingerprint: embeddingEnabled ? this.vectorStore.info().fingerprint : null,
        },
        this.llmStatus('llm', environment.LLM_PROVIDER, environment.LLM_MODEL),
        this.llmStatus(
          'llm_fallback',
          environment.LLM_FALLBACK_PROVIDER,
          environment.LLM_FALLBACK_MODEL,
        ),
        {
          kind: 'rerank',
          provider: rerankEnabled ? environment.RERANK_PROVIDER : null,
          model: rerankEnabled ? environment.RERANK_MODEL : null,
          configurationStatus: rerankEnabled ? 'configured' : 'disabled',
          endpointHost: rerankEnabled
            ? this.endpointHost(
                environment.RERANK_PROVIDER === 'local_bge'
                  ? environment.LOCAL_RERANK_BASE_URL
                  : environment.RERANK_BASE_URL,
              )
            : null,
          region: rerankEnabled
            ? environment.RERANK_PROVIDER === 'local_bge'
              ? 'local'
              : environment.RERANK_REGION
            : null,
          dimensions: null,
          credentialConfigured:
            rerankEnabled &&
            Boolean(
              environment.RERANK_PROVIDER === 'local_bge'
                ? environment.RERANK_INTERNAL_TOKEN
                : environment.DASHSCOPE_API_KEY,
            ),
          fingerprint: null,
        },
      ],
      syntheticCheck: { status: 'not_configured', checkedAt: null },
    };
  }

  async status(identity: Identity): Promise<SystemStatusResponse> {
    this.acl.assertCapability(identity, 'system:read');
    const [readiness, queue, disk] = await Promise.all([
      this.health.readiness().catch(() => null),
      this.queue.metricsSnapshot().catch(() => null),
      this.diskUsage().catch(() => null),
    ]);
    const componentIds: SystemComponentId[] = [
      'api',
      'postgres',
      'redis',
      'chroma',
      'parserWorker',
      'rawDocs',
    ];
    const components = componentIds.map((id) => {
      if (id === 'api') return { id, status: 'up' as const, reason: null };
      const check = readiness?.checks[id];
      return {
        id,
        status: check?.status ?? ('down' as const),
        reason: check?.status === 'up' ? null : this.healthReason(check?.reason),
      };
    });
    const isReady =
      readiness?.status === 'ready' &&
      queue !== null &&
      disk !== null &&
      components.every((component) => component.status === 'up');
    return {
      status: isReady ? 'ready' : 'degraded',
      checkedAt: new Date().toISOString(),
      components,
      ingestionQueue: queue
        ? {
            status: 'up',
            waiting: queue.counts.waiting ?? 0,
            active: queue.counts.active ?? 0,
            delayed: queue.counts.delayed ?? 0,
            failed: queue.counts.failed ?? 0,
            oldestWaitSeconds: queue.oldestWaitSeconds,
          }
        : {
            status: 'down',
            waiting: null,
            active: null,
            delayed: null,
            failed: null,
            oldestWaitSeconds: null,
          },
      rawDocsDiskUsageRatio: disk,
    };
  }

  private llmStatus(
    kind: 'llm' | 'llm_fallback',
    provider: Environment['LLM_PROVIDER'],
    model: string,
  ): ProviderStatus {
    if (provider === 'none') {
      return {
        kind,
        provider: null,
        model: null,
        configurationStatus: 'disabled',
        endpointHost: null,
        region: null,
        dimensions: null,
        credentialConfigured: false,
        fingerprint: null,
      };
    }
    const connection = this.llmConnection(provider);
    return {
      kind,
      provider,
      model,
      configurationStatus: 'configured',
      endpointHost: this.endpointHost(connection.baseUrl),
      region: connection.region,
      dimensions: null,
      credentialConfigured: Boolean(connection.apiKey),
      fingerprint: null,
    };
  }

  private llmConnection(provider: LlmProviderId): {
    apiKey: string;
    baseUrl: string;
    region: string;
  } {
    const environment = this.config.values;
    if (provider === 'openai') {
      return {
        apiKey: environment.OPENAI_API_KEY,
        baseUrl: environment.OPENAI_BASE_URL,
        region: environment.OPENAI_REGION,
      };
    }
    if (provider === 'google') {
      return {
        apiKey: environment.GEMINI_API_KEY,
        baseUrl: environment.GEMINI_BASE_URL,
        region: environment.GEMINI_REGION,
      };
    }
    if (provider === 'deepseek') {
      return {
        apiKey: environment.DEEPSEEK_API_KEY,
        baseUrl: environment.DEEPSEEK_BASE_URL,
        region: environment.DEEPSEEK_REGION,
      };
    }
    if (provider === 'alibaba') {
      return {
        apiKey: environment.DASHSCOPE_API_KEY,
        baseUrl: environment.ALIBABA_BASE_URL,
        region: environment.ALIBABA_REGION,
      };
    }
    return {
      apiKey: environment.CUSTOM_API_KEY,
      baseUrl: environment.CUSTOM_BASE_URL,
      region: environment.CUSTOM_REGION,
    };
  }

  private endpointHost(value: string): string {
    return new URL(value).host;
  }

  private async diskUsage(): Promise<number> {
    const stats = await statfs(this.config.values.RAW_DOCS_PATH);
    const blocks = Number(stats.blocks);
    const available = Number(stats.bavail);
    return blocks > 0 ? Math.min(1, Math.max(0, 1 - available / blocks)) : 0;
  }

  private healthReason(reason: string | undefined): HealthReason {
    if (reason === 'unhealthy' || reason === 'configuration_mismatch') return reason;
    return 'unavailable';
  }
}
