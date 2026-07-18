import { afterEach, describe, expect, it, vi } from 'vitest';

import { listIngestionJobs, retryIngestionJob } from './ingestion';

afterEach(() => vi.restoreAllMocks());

describe('ingestion API', () => {
  it('lists tasks without accepting client identity fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await listIngestionJobs({ status: 'failed' });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('status=failed');
    expect(url).not.toContain('tenant');
  });

  it('uses the dedicated retry mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobId: 'a5427e4a-b9db-4750-8dfd-02d601a41473',
          status: 'queued',
          traceId: 'd26720b3-1f78-40df-868d-8ca8510dca26',
        }),
        { status: 202 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await retryIngestionJob('a5427e4a-b9db-4750-8dfd-02d601a41473');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
  });
});
