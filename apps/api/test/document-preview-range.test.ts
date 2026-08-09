import { describe, expect, it } from 'vitest';

import { parseSingleByteRange } from '../src/documents/documents.controller';

describe('document preview byte ranges', () => {
  it('accepts bounded, open-ended, and suffix ranges', () => {
    expect(parseSingleByteRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseSingleByteRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseSingleByteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseSingleByteRange('bytes=0-9999', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('rejects multiple, reversed, and unsatisfiable ranges', () => {
    expect(parseSingleByteRange('bytes=0-1,4-5', 1000)).toBeUndefined();
    expect(parseSingleByteRange('bytes=99-2', 1000)).toBeUndefined();
    expect(parseSingleByteRange('bytes=1000-', 1000)).toBeUndefined();
    expect(parseSingleByteRange('items=0-1', 1000)).toBeUndefined();
  });
});
