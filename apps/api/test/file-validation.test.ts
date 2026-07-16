import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ApiException } from '../src/common/api-exception';
import { validateUploadedFile } from '../src/documents/file-validation';

describe('validateUploadedFile', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
  });

  it('accepts valid UTF-8 text and canonicalizes its MIME', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexus-upload-'));
    directories.push(directory);
    const path = join(directory, 'upload');
    await writeFile(path, '安全的测试内容', 'utf8');

    await expect(validateUploadedFile(path, 'policy.txt', 'text/plain')).resolves.toEqual({
      extension: '.txt',
      mimeType: 'text/plain',
    });
  });

  it('rejects forged MIME and binary text', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexus-upload-'));
    directories.push(directory);
    const path = join(directory, 'upload');
    await writeFile(path, Buffer.from([0, 1, 2, 3]));

    await expect(
      validateUploadedFile(path, 'policy.txt', 'application/octet-stream'),
    ).rejects.toMatchObject({
      code: 'MIME_MISMATCH',
    } satisfies Partial<ApiException>);
    await expect(validateUploadedFile(path, 'policy.txt', 'text/plain')).rejects.toMatchObject({
      code: 'INVALID_TEXT_ENCODING',
    } satisfies Partial<ApiException>);
  });
});
