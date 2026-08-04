import type { IngestionPayload } from '@nexus-kb/contracts';
import { describe, expect, it, vi } from 'vitest';

import { IngestionQueue } from '../src/ingestion/ingestion.queue';

describe('IngestionQueue retry recovery', () => {
  it('recreates a queue job when the original enqueue failed before BullMQ persisted it', async () => {
    const payload: IngestionPayload = {
      ingestionJobId: 'a5427e4a-b9db-4750-8dfd-02d601a41473',
      documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
      storageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.pdf',
    };
    const ingestionQueue = Object.create(IngestionQueue.prototype) as IngestionQueue;
    Object.defineProperty(ingestionQueue, 'queue', {
      value: { getJob: vi.fn().mockResolvedValue(undefined) },
    });
    const enqueue = vi.spyOn(ingestionQueue, 'enqueue').mockResolvedValue(undefined);

    await expect(ingestionQueue.retry(payload.ingestionJobId, payload)).resolves.toBeUndefined();

    expect(enqueue).toHaveBeenCalledWith(payload);
  });
});
