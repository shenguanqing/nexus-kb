import { describe, expect, it } from 'vitest';
import { documentDetailReturn, ingestionJobsReturn } from './return-navigation';

describe('return navigation', () => {
  it('preserves an ingestion task list as the document detail origin', () => {
    expect(documentDetailReturn('/ingestion-jobs?status=failed&page=2')).toEqual({
      to: '/ingestion-jobs?status=failed&page=2',
      label: '返回入库任务',
    });
  });

  it('falls back to the document list for an untrusted detail origin', () => {
    expect(documentDetailReturn('https://example.com')).toEqual({
      to: '/documents',
      label: '返回文档列表',
    });
    expect(documentDetailReturn('//example.com/ingestion-jobs')).toEqual({
      to: '/documents',
      label: '返回文档列表',
    });
  });

  it('only accepts a UUID document detail as the task list return target', () => {
    expect(ingestionJobsReturn('/documents/75a56423-7ba0-486d-a568-92690087ac83')).toEqual({
      to: '/documents/75a56423-7ba0-486d-a568-92690087ac83',
      label: '返回文档详情',
    });
    expect(ingestionJobsReturn('/documents')).toBeNull();
  });
});
