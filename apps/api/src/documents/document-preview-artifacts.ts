import { lstat, rm, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { ApiException } from '../common/api-exception';

const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function invalidPreviewStorage(): ApiException {
  return new ApiException('PREVIEW_STORAGE_INVALID', '预览产物引用不合法', 500);
}

async function missingAsNull(path: string) {
  return lstat(path).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
}

export function assertDocumentPreviewStorageKey(documentId: string, storageKey: string): void {
  const allowed = new Set([`${documentId}.pdf`, `${documentId}.svg`, `${documentId}.cad`]);
  if (storageKey !== basename(storageKey) || !allowed.has(storageKey)) {
    throw invalidPreviewStorage();
  }
}

export async function removeDocumentPreviewArtifacts(
  previewRoot: string,
  documentId: string,
): Promise<void> {
  if (!DOCUMENT_ID_PATTERN.test(documentId)) throw invalidPreviewStorage();

  for (const extension of ['pdf', 'svg'] as const) {
    const path = join(previewRoot, `${documentId}.${extension}`);
    const metadata = await missingAsNull(path);
    if (metadata && (!metadata.isFile() || metadata.isSymbolicLink())) {
      throw invalidPreviewStorage();
    }
    await unlink(path).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    });
  }

  const cadPath = join(previewRoot, `${documentId}.cad`);
  const cadMetadata = await missingAsNull(cadPath);
  if (cadMetadata && (!cadMetadata.isDirectory() || cadMetadata.isSymbolicLink())) {
    throw invalidPreviewStorage();
  }
  await rm(cadPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

  const lockPath = join(previewRoot, `.${documentId}.cad.lock`);
  const lockMetadata = await missingAsNull(lockPath);
  if (lockMetadata && (!lockMetadata.isFile() || lockMetadata.isSymbolicLink())) {
    throw invalidPreviewStorage();
  }
  await unlink(lockPath).catch((error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  });
}
