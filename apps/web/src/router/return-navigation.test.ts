import { describe, expect, it } from 'vitest';
import {
  documentDetailReturn,
  documentPreviewReturn,
  historyDetailReturn,
  ingestionJobsReturn,
} from './return-navigation';

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

  it('removes only the authorized conversation id when returning to the history list', () => {
    expect(
      historyDetailReturn(
        '/history?query=%E6%9C%BA%E6%88%BF&page=2&conversationId=5b9fd225-a565-42cd-8d63-1fc3f19b745d',
      ),
    ).toEqual({
      to: '/history?query=%E6%9C%BA%E6%88%BF&page=2',
      label: '返回会话列表',
    });
    expect(historyDetailReturn('/history?conversationId=untrusted')).toBeNull();
    expect(
      historyDetailReturn(
        '//example.com/history?conversationId=5b9fd225-a565-42cd-8d63-1fc3f19b745d',
      ),
    ).toBeNull();
  });

  it('returns previews only to safe in-app knowledge or document routes', () => {
    expect(documentPreviewReturn('/history?page=2')).toEqual({
      to: '/history?page=2',
      label: '返回问答历史',
    });
    expect(
      documentPreviewReturn('/history?page=2&conversationId=5b9fd225-a565-42cd-8d63-1fc3f19b745d'),
    ).toEqual({
      to: '/history?page=2&conversationId=5b9fd225-a565-42cd-8d63-1fc3f19b745d',
      label: '返回问答历史',
    });
    expect(documentPreviewReturn('https://example.com')).toEqual({
      to: '/ask',
      label: '返回知识问答',
    });
  });
});
