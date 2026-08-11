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
  '.doc': {
    canonicalMime: 'application/msword',
    acceptedMimes: new Set(['application/msword', 'application/x-msword']),
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
  '.pdf': {
    canonicalMime: 'application/pdf',
    acceptedMimes: new Set(['application/pdf']),
  },
  '.png': {
    canonicalMime: 'image/png',
    acceptedMimes: new Set(['image/png']),
  },
  '.jpg': {
    canonicalMime: 'image/jpeg',
    acceptedMimes: new Set(['image/jpeg']),
  },
  '.jpeg': {
    canonicalMime: 'image/jpeg',
    acceptedMimes: new Set(['image/jpeg']),
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
  '.dwg': {
    canonicalMime: 'image/vnd.dwg',
    acceptedMimes: new Set([
      'image/vnd.dwg',
      'application/acad',
      'application/dwg',
      'application/x-dwg',
      'application/octet-stream',
    ]),
  },
} as const;

export async function validateUploadedFile(
  path: string,
  sourceName: string,
  suppliedMime: string,
  allowDwg = false,
): Promise<{ extension: string; mimeType: string }> {
  const extension = extname(sourceName).toLowerCase() as keyof typeof types;
  const expected = types[extension];
  if (!expected) throw new ApiException('FILE_TYPE_NOT_ALLOWED', '不支持此文件类型', 415);
  if (extension === '.dwg' && !allowDwg) {
    throw new ApiException('DWG_CONVERSION_DISABLED', 'DWG 格式转换未启用', 503);
  }
  if (!(expected.acceptedMimes as ReadonlySet<string>).has(suppliedMime.toLowerCase())) {
    throw new ApiException('MIME_MISMATCH', '文件扩展名与 MIME 不匹配', 415);
  }

  if (extension === '.txt' || extension === '.md') {
    const handle = await open(path, 'r');
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const sample = Buffer.alloc(8192);
      let position = 0;
      while (true) {
        const { bytesRead } = await handle.read(sample, 0, sample.length, position);
        if (bytesRead === 0) break;
        const bytes = sample.subarray(0, bytesRead);
        if (bytes.includes(0)) throw new Error('binary');
        decoder.decode(bytes, { stream: true });
        position += bytesRead;
      }
      decoder.decode();
    } catch {
      throw new ApiException('INVALID_TEXT_ENCODING', '文本文件必须使用 UTF-8 编码', 415);
    } finally {
      await handle.close();
    }
  } else if (extension === '.doc') {
    await validateCompoundDocumentSignature(path);
  } else if (extension === '.dxf') {
    await validateDxfSignature(path);
  } else if (extension === '.dwg') {
    await validateDwgSignature(path);
  } else {
    const detected = await fileTypeFromFile(path);
    const detectedExtension = detected?.ext === 'jpg' ? '.jpg' : `.${detected?.ext ?? ''}`;
    const extensionMatches =
      detectedExtension === extension ||
      (detectedExtension === '.jpg' && (extension === '.jpg' || extension === '.jpeg'));
    if (!extensionMatches || detected?.mime !== expected.canonicalMime) {
      throw new ApiException('FILE_SIGNATURE_MISMATCH', '文件签名与扩展名不匹配', 415);
    }
  }
  return { extension, mimeType: expected.canonicalMime };
}

async function validateCompoundDocumentSignature(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    const signature = Buffer.alloc(8);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    if (
      bytesRead === signature.length &&
      signature.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    ) {
      return;
    }
  } finally {
    await handle.close();
  }
  throw new ApiException('FILE_SIGNATURE_MISMATCH', '文件签名与扩展名不匹配', 415);
}

const supportedDwgVersions = new Set([
  'AC1009',
  'AC1012',
  'AC1014',
  'AC1015',
  'AC1018',
  'AC1021',
  'AC1024',
  'AC1027',
  'AC1032',
]);

async function validateDwgSignature(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    const signature = Buffer.alloc(6);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    if (bytesRead === signature.length && supportedDwgVersions.has(signature.toString('ascii'))) {
      return;
    }
  } finally {
    await handle.close();
  }
  throw new ApiException('FILE_SIGNATURE_MISMATCH', '文件签名与扩展名不匹配', 415);
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
