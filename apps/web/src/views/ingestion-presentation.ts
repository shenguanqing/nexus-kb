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

export interface IngestionWarningPresentation {
  code: string;
  title: string;
  message: string;
}

const INGESTION_WARNING_MESSAGES: Record<string, Omit<IngestionWarningPresentation, 'code'>> = {
  DWG_CONVERTED_TO_DXF: {
    title: '格式转换说明',
    message: '原始 DWG 已自动转换为 DXF 后解析入库。',
  },
  DXF_REPEATED_BLOCK_DEFINITIONS_REUSED: {
    title: '重复块优化',
    message: '检测到重复使用的 CAD 块定义，解析时已安全复用，避免重复遍历相同结构。',
  },
  DXF_RECOVERED: {
    title: 'DXF 结构恢复',
    message: '原始 DXF 存在可恢复的结构问题，解析器已使用受控恢复流程继续处理。',
  },
  DXF_BLOCK_CYCLE_SKIPPED: {
    title: '循环块已跳过',
    message: '检测到循环引用的 CAD 块，已跳过该循环以保证解析安全。',
  },
  DXF_BLOCK_DEPTH_LIMIT_REACHED: {
    title: '块嵌套达到上限',
    message: 'CAD 块嵌套达到安全深度上限，更深层内容未继续展开。',
  },
  DXF_MISSING_BLOCK_SKIPPED: {
    title: '缺失块已跳过',
    message: '图纸引用了缺失的 CAD 块定义，已跳过该引用并继续处理其他内容。',
  },
  CAD_PREVIEW_GZIP_COMPRESSED: {
    title: 'CAD 预览已压缩',
    message: 'CAD SVG 预览体积较大，已使用 Gzip 压缩传输，图纸内容不受影响。',
  },
  CAD_PREVIEW_PROGRESSIVE_GEOMETRY: {
    title: '渐进式 CAD 预览',
    message: '图纸较复杂，已先生成快速总览；查看细节时会按需建立完整几何。',
  },
  CAD_PREVIEW_INITIALIZATION_TIMEOUT: {
    title: 'CAD 预览生成超时',
    message: 'CAD 预览未在安全时限内完成，知识入库不受影响，可使用解析文本查看内容。',
  },
  CAD_PREVIEW_RESOURCE_LIMIT_EXCEEDED: {
    title: 'CAD 预览达到资源上限',
    message: 'CAD 预览超过安全资源上限，知识入库不受影响，可使用解析文本查看内容。',
  },
  PREVIEW_GENERATION_FAILED: {
    title: '预览生成失败',
    message: '文档正文已继续处理，但预览产物生成失败，可使用解析文本查看内容。',
  },
  TIKA_FALLBACK_USED: {
    title: '已使用兼容解析',
    message: '默认解析方式未得到有效内容，已使用受控 Tika 兼容路径完成解析。',
  },
};

const PARAMETERIZED_WARNING_MESSAGES: Array<{
  prefix: string;
  present: (value: string) => Omit<IngestionWarningPresentation, 'code'>;
}> = [
  {
    prefix: 'DWG_SOURCE_VERSION:',
    present: (value) => ({ title: 'DWG 源文件版本', message: `检测到源文件版本 ${value}。` }),
  },
  {
    prefix: 'DXF_AUDIT_ERRORS:',
    present: (value) => ({
      title: 'DXF 结构检查',
      message: `结构检查发现 ${value} 个可恢复问题，解析器已进入受控恢复流程。`,
    }),
  },
  {
    prefix: 'DXF_AUDIT_FIXES:',
    present: (value) => ({
      title: 'DXF 结构修复',
      message: `解析器已完成 ${value} 项结构修复。`,
    }),
  },
  {
    prefix: 'OCR_LOW_CONFIDENCE_ELEMENTS:',
    present: (value) => ({
      title: 'OCR 低置信度提示',
      message: `有 ${value} 个文字元素的识别置信度较低，建议对照原图复核。`,
    }),
  },
];

export function ingestionWarningPresentation(warning: string): IngestionWarningPresentation {
  const exact = INGESTION_WARNING_MESSAGES[warning];
  if (exact) return { code: warning, ...exact };

  const parameterized = PARAMETERIZED_WARNING_MESSAGES.find(({ prefix }) =>
    warning.startsWith(prefix),
  );
  if (parameterized) {
    return {
      code: warning,
      ...parameterized.present(warning.slice(parameterized.prefix.length)),
    };
  }

  return {
    code: warning,
    title: '处理说明',
    message: `解析器返回了尚未识别的技术提示：${warning}`,
  };
}
