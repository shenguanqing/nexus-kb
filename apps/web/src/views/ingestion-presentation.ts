import type { IngestionJob, IngestionJobListRequest, IngestionStatus } from '@nexus-kb/contracts';

const INGESTION_STATUS_LABELS: Record<IngestionStatus, string> = {
  queued: '排队',
  converting: 'CAD 格式转换与解析',
  parsing: '解析',
  chunking: '分块与脱敏',
  policy_check: '出网策略检查',
  embedding: 'Embedding',
  indexing: '建立索引',
  policy_blocked: '策略阻止',
  completed: '完成',
  failed: '失败',
  deleted: '已删除',
};

const FILTERABLE_INGESTION_STATUSES: Array<NonNullable<IngestionJobListRequest['status']>> = [
  'queued',
  'converting',
  'parsing',
  'chunking',
  'policy_check',
  'embedding',
  'indexing',
  'completed',
  'failed',
  'policy_blocked',
];

export const INGESTION_STATUS_OPTIONS = FILTERABLE_INGESTION_STATUSES.map((value) => ({
  value,
  label: INGESTION_STATUS_LABELS[value],
}));

const INGESTION_KIND_LABELS: Record<IngestionJob['kind'], string> = {
  ingestion: '文档入库',
  reindex: '重建索引',
  index_migration: '索引迁移',
};

export function ingestionStatusLabel(status: IngestionStatus): string {
  return INGESTION_STATUS_LABELS[status];
}

export function ingestionKindLabel(kind: IngestionJob['kind']): string {
  return INGESTION_KIND_LABELS[kind];
}

const RUNNING_STATUSES = new Set<IngestionStatus>([
  'queued',
  'converting',
  'parsing',
  'chunking',
  'policy_check',
  'embedding',
  'indexing',
]);

export function isRunningIngestionStatus(status: IngestionStatus): boolean {
  return RUNNING_STATUSES.has(status);
}

export function formatIngestionElapsed(job: IngestionJob, nowMs: number): string {
  const start = Date.parse(job.startedAt ?? job.createdAt);
  const end = job.completedAt
    ? Date.parse(job.completedAt)
    : isRunningIngestionStatus(job.status)
      ? nowMs
      : Date.parse(job.updatedAt);
  const milliseconds = Math.max(0, end - start);
  return milliseconds < 1000 ? '< 1 秒' : `${Math.round(milliseconds / 1000)} 秒`;
}

const INGESTION_ERROR_MESSAGES: Record<string, string> = {
  DWG_CONVERSION_DISABLED: 'CAD 转换服务暂不可用，请联系管理员或稍后重试',
  FILE_SIGNATURE_MISMATCH: '文件无效或版本不受支持',
  CAD_ENTITY_LIMIT_EXCEEDED: 'CAD 图纸复杂度超过服务器安全上限，请联系管理员调整解析容量或精简图纸',
  PARSER_ELEMENT_LIMIT_EXCEEDED:
    '图纸中可入库内容数量超过服务器安全上限，请联系管理员调整解析容量或精简图纸',
  DWG_VERSION_UNSUPPORTED: 'DWG 文件无效或版本不受支持',
  DWG_CONVERTED_SIZE_LIMIT_EXCEEDED: 'DWG 转换结果超过服务器允许的大小',
};

export function ingestionErrorMessage(errorCode: string): string {
  return INGESTION_ERROR_MESSAGES[errorCode] ?? '任务处理失败，请查看技术详情';
}
