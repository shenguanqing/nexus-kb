import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileTypeFromFile } from 'file-type';

import { ApiException } from '../common/api-exception';

const types = {
  '.txt': { canonicalMime: 'text/plain', acceptedMimes: new Set(['text/plain']) },
  '.md': {
    canonicalMime: 'text/markdown',
    acceptedMimes: new Set(['text/markdown', 'text/plain']),
  },
  '.docx': {
    canonicalMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    acceptedMimes: new Set([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]),
  },
  '.xlsx': {
    canonicalMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    acceptedMimes: new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  },
  '.dxf': {
    canonicalMime: 'image/vnd.dxf',
    acceptedMimes: new Set([
      'image/vnd.dxf',
      'application/dxf',
      'application/x-dxf',
      'application/octet-stream',
      'drawing/x-dxf',
    ]),
  },
} as const;

export async function validateUploadedFile(
  path: string,
  sourceName: string,
  suppliedMime: string,
): Promise<{ extension: string; mimeType: string }> {
  const extension = extname(sourceName).toLowerCase() as keyof typeof types;
  const expected = types[extension];
  if (!expected) throw new ApiException('FILE_TYPE_NOT_ALLOWED', '不支持此文件类型', 415);
  if (!(expected.acceptedMimes as ReadonlySet<string>).has(suppliedMime.toLowerCase())) {
    throw new ApiException('MIME_MISMATCH', '文件扩展名与 MIME 不匹配', 415);
  }

  if (extension === '.txt' || extension === '.md') {
    const handle = await open(path, 'r');
    try {
      const sample = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
      const bytes = sample.subarray(0, bytesRead);
      if (bytes.includes(0)) throw new Error('binary');
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new ApiException('INVALID_TEXT_ENCODING', '文本文件必须使用 UTF-8 编码', 415);
    } finally {
      await handle.close();
    }
  } else if (extension === '.dxf') {
    await validateDxfSignature(path);
  } else {
    const detected = await fileTypeFromFile(path);
    if (detected?.ext !== extension.slice(1) || detected.mime !== expected.canonicalMime) {
      throw new ApiException('FILE_SIGNATURE_MISMATCH', '文件签名与扩展名不匹配', 415);
    }
  }
  return { extension, mimeType: expected.canonicalMime };
}

async function validateDxfSignature(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    const sample = Buffer.alloc(65_536);
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    const bytes = sample.subarray(0, bytesRead);
    const binaryHeader = Buffer.from('AutoCAD Binary DXF\r\n\x1a\0', 'latin1');
    if (bytes.subarray(0, binaryHeader.length).equals(binaryHeader)) return;

    const lines = bytes
      .toString('latin1')
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .split('\n')
      .map((line) => line.trim());
    for (let index = 0; index + 3 < lines.length; index += 2) {
      if (
        lines[index] === '0' &&
        lines[index + 1]?.toUpperCase() === 'SECTION' &&
        lines[index + 2] === '2' &&
        ['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES'].includes(
          lines[index + 3]?.toUpperCase() ?? '',
        )
      ) {
        return;
      }
    }
  } finally {
    await handle.close();
  }
  throw new ApiException('FILE_SIGNATURE_MISMATCH', '文件签名与扩展名不匹配', 415);
}
