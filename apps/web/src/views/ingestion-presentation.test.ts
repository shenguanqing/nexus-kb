import type { IngestionJob } from '@nexus-kb/contracts';
import { describe, expect, it } from 'vitest';
import { formatIngestionElapsed, ingestionErrorMessage } from './ingestion-presentation';

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

describe('ingestionErrorMessage', () => {
  it('explains a CAD entity safety limit without exposing internals', () => {
    expect(ingestionErrorMessage('CAD_ENTITY_LIMIT_EXCEEDED')).toBe(
      'CAD 图纸复杂度超过服务器安全上限，请联系管理员调整解析容量或精简图纸',
    );
    expect(ingestionErrorMessage('UNKNOWN_ERROR')).toBe('任务处理失败，请查看技术详情');
  });
});
