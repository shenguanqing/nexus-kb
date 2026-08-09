export interface ReturnNavigation {
  to: string;
  label: string;
}

const ingestionPath = /^\/ingestion-jobs(?:[?#]|$)/;
const documentPath =
  /^\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:[?#]|$)/i;
const knowledgePath = /^\/(?:ask|history)(?:[?#]|$)/;
const documentDetailPath =
  /^\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:[?#]|$)/i;

export function documentDetailReturn(value: unknown): ReturnNavigation {
  if (typeof value === 'string' && ingestionPath.test(value)) {
    return { to: value, label: '返回入库任务' };
  }
  return { to: '/documents', label: '返回文档列表' };
}

export function ingestionJobsReturn(value: unknown): ReturnNavigation | null {
  if (typeof value === 'string' && documentPath.test(value)) {
    return { to: value, label: '返回文档详情' };
  }
  return null;
}

export function documentPreviewReturn(value: unknown): ReturnNavigation {
  if (typeof value === 'string' && knowledgePath.test(value)) {
    return { to: value, label: value.startsWith('/history') ? '返回问答历史' : '返回知识问答' };
  }
  if (typeof value === 'string' && documentDetailPath.test(value)) {
    return { to: value, label: '返回文档详情' };
  }
  return { to: '/ask', label: '返回知识问答' };
}
