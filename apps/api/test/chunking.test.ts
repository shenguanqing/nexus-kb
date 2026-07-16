import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../src/config/app-config';
import { ChunkingService, countTokens } from '../src/ingestion/chunking';

function config(maxTokens = 12, overlapTokens = 3): AppConfig {
  return {
    values: {
      CHUNK_MAX_TOKENS: maxTokens,
      CHUNK_OVERLAP_TOKENS: overlapTokens,
    },
  } as unknown as AppConfig;
}

describe('ChunkingService', () => {
  it('generates stable linked chunks while preserving source structure and table headers', () => {
    const service = new ChunkingService(config());
    const elements = [
      {
        text: '付款制度',
        elementType: 'heading',
        page: 1,
        sheet: null,
        sectionPath: ['付款制度'],
        bbox: null,
        metadata: {},
      },
      {
        text: '验收完成后付款。',
        elementType: 'paragraph',
        page: 1,
        sheet: null,
        sectionPath: ['付款制度'],
        bbox: null,
        metadata: {},
      },
      {
        text: '30天\t银行转账',
        elementType: 'table_row',
        page: 2,
        sheet: '付款表',
        sectionPath: ['付款制度'],
        bbox: null,
        metadata: { headers: ['周期', '方式'] },
      },
    ];

    const first = service.createChunks('6769af9a-a4d0-4dc2-a97d-942584a9c826', 1, elements);
    const second = service.createChunks('6769af9a-a4d0-4dc2-a97d-942584a9c826', 1, elements);

    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(1);
    expect(first.at(-1)?.originalText).toContain('表头：周期 | 方式');
    expect(first.at(-1)).toMatchObject({ page: 2, sheet: '付款表' });
    expect(first[0]?.nextChunkId).toBe(first[1]?.id);
    expect(first[1]?.previousChunkId).toBe(first[0]?.id);
    expect(first.every((chunk) => chunk.tokenCount <= 12)).toBe(true);
  });

  it('splits oversized elements by token budget with configured overlap', () => {
    const service = new ChunkingService(config(8, 2));
    const text = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳';
    const chunks = service.createChunks('6769af9a-a4d0-4dc2-a97d-942584a9c826', 1, [
      {
        text,
        elementType: 'paragraph',
        page: 3,
        sheet: null,
        sectionPath: ['长段落'],
        bbox: null,
        metadata: {},
      },
    ]);

    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => countTokens(chunk.originalText) <= 8)).toBe(true);
    expect(chunks[0]?.originalText.slice(-2)).toBe(chunks[1]?.originalText.slice(0, 2));
  });
});
