import type { ProviderStatus, SystemComponentId } from '@nexus-kb/contracts';

export const providerKindLabels: Record<ProviderStatus['kind'], string> = {
  embedding: 'Embedding',
  llm: '主 LLM',
  llm_fallback: '备用 LLM',
  rerank: 'Rerank',
};

export const systemComponentLabels: Record<SystemComponentId, string> = {
  api: 'API 主服务',
  postgres: 'PostgreSQL',
  redis: 'Redis',
  chroma: 'Chroma',
  parserWorker: 'Parser Worker',
  rawDocs: '原始文档存储',
};

export const healthReasonLabels = {
  unavailable: '暂不可用',
  unhealthy: '健康检查未通过',
  configuration_mismatch: '配置指纹不兼容',
} as const;

export function providerTitle(status: ProviderStatus): string {
  return status.configurationStatus === 'disabled'
    ? '未启用'
    : `${status.provider ?? '未知'} / ${status.model ?? '未指定模型'}`;
}

export function credentialLabel(provider: string | null, configured: boolean): string {
  if (provider === 'ollama' || provider === 'local_bge') return '本地无需凭据';
  return configured ? '已配置' : '未配置';
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '暂无数据';
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes} 分 ${remainingSeconds} 秒`;
}

export function formatDiskUsage(ratio: number | null): string {
  return ratio === null ? '暂无数据' : `${(ratio * 100).toFixed(1)}%`;
}
