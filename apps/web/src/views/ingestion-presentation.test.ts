import type { IngestionJob } from '@nexus-kb/contracts';
import { describe, expect, it } from 'vitest';
import {
  formatIngestionElapsed,
  ingestionErrorMessage,
  ingestionKindLabel,
  ingestionStatusLabel,
  ingestionWarningPresentation,
  INGESTION_STATUS_OPTIONS,
  isRunningIngestionStatus,
} from './ingestion-presentation';

function job(overrides: Partial<IngestionJob> = {}): IngestionJob {
  return {
    id: '0be06fbb-f1aa-4688-9852-b587feb0212b',
    documentId: 'f5497cc7-5ee4-4e60-9ad8-46b031b3cab6',
    sourceName: 'drawing.dwg',
    mimeType: 'image/vnd.dwg',
    version: 1,
    kind: 'ingestion',
    status: 'parsing',
    step: 'parsing',
    checkpoint: 'queued',
    attempts: 1,
    retryable: false,
    errorCode: null,
    errorCategory: null,
    warnings: [],
    parserVersion: null,
    embeddingFingerprint: null,
    embeddingCompletedChunks: 0,
    embeddingTotalChunks: null,
    embeddingBatchSize: null,
    createdAt: '2026-07-26T03:00:00.000Z',
    startedAt: '2026-07-26T03:00:02.000Z',
    completedAt: null,
    updatedAt: '2026-07-26T03:00:05.000Z',
    traceId: '50d3104f-93da-4173-b42a-2f6bf87917c7',
    ...overrides,
  };
}

describe('formatIngestionElapsed', () => {
  it('uses the current clock for a running task', () => {
    const running = job();
    expect(formatIngestionElapsed(running, Date.parse('2026-07-26T03:00:12.000Z'))).toBe('10 秒');
    expect(formatIngestionElapsed(running, Date.parse('2026-07-26T03:00:13.000Z'))).toBe('11 秒');
  });

  it('freezes a terminal task at its completion time', () => {
    const failed = job({
      status: 'failed',
      step: 'failed',
      completedAt: '2026-07-26T03:00:40.000Z',
    });
    expect(formatIngestionElapsed(failed, Date.parse('2026-07-26T04:00:00.000Z'))).toBe('38 秒');
  });
});

describe('ingestion labels', () => {
  it('builds filter options from the shared status dictionary', () => {
    expect(INGESTION_STATUS_OPTIONS).toContainEqual({
      value: 'converting',
      label: 'CAD 格式转换与解析',
    });
    expect(INGESTION_STATUS_OPTIONS).toContainEqual({ value: 'policy_blocked', label: '策略阻止' });
  });

  it('renders terminal statuses and job kinds in Chinese', () => {
    expect(ingestionStatusLabel('completed')).toBe('完成');
    expect(ingestionKindLabel('ingestion')).toBe('文档入库');
    expect(ingestionKindLabel('reindex')).toBe('重建索引');
    expect(ingestionKindLabel('index_migration')).toBe('索引迁移');
  });

  it('keeps the shared running-status set available to polling and elapsed-time formatting', () => {
    expect(isRunningIngestionStatus('parsing')).toBe(true);
    expect(isRunningIngestionStatus('completed')).toBe(false);
  });
});

describe('ingestionErrorMessage', () => {
  it('explains a CAD entity safety limit without exposing internals', () => {
    expect(ingestionErrorMessage('CAD_ENTITY_LIMIT_EXCEEDED')).toBe(
      'CAD 图纸复杂度超过服务器安全上限，请联系管理员调整解析容量或精简图纸',
    );
    expect(ingestionErrorMessage('UNKNOWN_ERROR')).toBe('任务处理失败，请查看技术详情');
  });
});

describe('ingestionWarningPresentation', () => {
  it('renders stable CAD warning codes as Chinese title and description', () => {
    expect(ingestionWarningPresentation('DXF_REPEATED_BLOCK_DEFINITIONS_REUSED')).toEqual({
      code: 'DXF_REPEATED_BLOCK_DEFINITIONS_REUSED',
      title: '重复块优化',
      message: '检测到重复使用的 CAD 块定义，解析时已安全复用，避免重复遍历相同结构。',
    });
    expect(ingestionWarningPresentation('CAD_PREVIEW_PROGRESSIVE_GEOMETRY')).toEqual({
      code: 'CAD_PREVIEW_PROGRESSIVE_GEOMETRY',
      title: '渐进式 CAD 预览',
      message: '图纸较复杂，已先生成快速总览；查看细节时会按需建立完整几何。',
    });
  });

  it('formats parameterized warnings and keeps an actionable Chinese fallback', () => {
    expect(ingestionWarningPresentation('OCR_LOW_CONFIDENCE_ELEMENTS:3')).toMatchObject({
      title: 'OCR 低置信度提示',
      message: '有 3 个文字元素的识别置信度较低，建议对照原图复核。',
    });
    expect(ingestionWarningPresentation('NEW_WARNING')).toEqual({
      code: 'NEW_WARNING',
      title: '处理说明',
      message: '解析器返回了尚未识别的技术提示：NEW_WARNING',
    });
  });
});
