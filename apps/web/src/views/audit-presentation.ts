import type { AuditEvent, AuditEventType } from '@nexus-kb/contracts';

export const auditTypeLabels: Record<AuditEventType, string> = {
  query: '知识问答',
  document_lifecycle: '文档生命周期',
  cloud_policy: '云端策略',
  access_change: '权限变更',
};

const eventLabels: Record<string, string> = {
  knowledge_query: '知识问答查询',
  cloud_egress_policy: '云端数据出网检查',
  document_reindex_requested: '请求重建索引',
  document_version_activated: '文档版本已激活',
  document_deleted: '文档已永久删除',
  ingestion_retry_requested: '请求重试入库任务',
};

const outcomeLabels: Record<string, string> = {
  answered: '已回答',
  no_answer: '无答案',
  allowed: '已允许',
  blocked: '已阻止',
  queued: '已排队',
  completed: '已完成',
  failed: '失败',
  deleted: '已删除',
};

export function auditEventLabel(event: AuditEvent): string {
  return eventLabels[event.event] ?? event.event.replaceAll('_', ' ');
}

export function auditResource(event: AuditEvent): string {
  if (event.documentId) return `文档 ${event.documentId}`;
  if (event.ingestionJobId) return `任务 ${event.ingestionJobId}`;
  return '知识问答';
}

export function auditProvider(event: AuditEvent): string {
  const provider =
    stringAttribute(event, 'llmProvider') ??
    stringAttribute(event, 'embeddingProvider') ??
    stringAttribute(event, 'providerId');
  const model = stringAttribute(event, 'llmModel') ?? stringAttribute(event, 'embeddingModel');
  return provider ? `${provider}${model ? ` / ${model}` : ''}` : '—';
}

export function cloudEgressLabel(event: AuditEvent): string {
  if (event.type !== 'cloud_policy') return '未记录';
  return event.outcome === 'blocked' ? '已阻止' : '已允许';
}

export function auditOutcomeLabel(outcome: string): string {
  return outcomeLabels[outcome] ?? outcome.replaceAll('_', ' ');
}

export function outcomeTagType(outcome: string): 'success' | 'warning' | 'danger' | 'info' {
  if (['completed', 'answered', 'allowed', 'success'].includes(outcome)) return 'success';
  if (['blocked', 'policy_blocked', 'no_answer'].includes(outcome)) return 'warning';
  if (['failed', 'error', 'deleted'].includes(outcome)) return 'danger';
  return 'info';
}

export function visibleAuditAttributes(event: AuditEvent): Array<{ label: string; value: string }> {
  const definitions = [
    ['documentVersion', '文档版本'],
    ['queryLength', '问题长度'],
    ['resultCount', '结果数量'],
    ['durationMs', '耗时（毫秒）'],
    ['reasonCode', '策略原因'],
    ['sensitivity', '敏感度'],
    ['region', 'Provider 区域'],
    ['errorCode', '错误码'],
  ] as const;
  return definitions.flatMap(([key, label]) => {
    const value = event.attributes[key];
    return value === null || value === undefined || Array.isArray(value)
      ? []
      : [{ label, value: String(value) }];
  });
}

function stringAttribute(event: AuditEvent, key: string): string | null {
  const value = event.attributes[key];
  return typeof value === 'string' && value ? value : null;
}
