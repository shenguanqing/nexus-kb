import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CadTileViewer from './CadTileViewer.vue';

const manifest = {
  strategy: 'tiles' as const,
  tileSize: 512,
  minZoom: 0,
  maxZoom: 8,
  baseWidth: 512,
  baseHeight: 256,
  overviewWidth: 1600,
  overviewHeight: 800,
  bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 500 },
  worldToPixel: [0.512, 0, 0, -0.512, 0, 256],
  entityCount: 120000,
  renderCostScore: 480000,
};

class TestResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe('CadTileViewer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 768,
      height: 768,
      left: 0,
      right: 1024,
      top: 0,
      width: 1024,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('cancels stale viewport tiles, bounds concurrency, and releases image bitmaps', async () => {
    const overviewClose = vi.fn();
    const tileRequests: Array<{ url: string; signal: AbortSignal }> = [];
    const createBitmap = vi
      .fn()
      .mockResolvedValue({ close: overviewClose, height: 800, width: 1600 });
    vi.stubGlobal('createImageBitmap', createBitmap);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.endsWith('/overview')) {
          return Promise.resolve({
            blob: () => Promise.resolve(new Blob(['overview'])),
            ok: true,
          } as Response);
        }
        tileRequests.push({ url, signal: init?.signal as AbortSignal });
        return new Promise<Response>(() => undefined);
      }),
    );

    const wrapper = mount(CadTileViewer, {
      props: { documentId: 'document-id', manifest, sourceName: '厂区平面图.dxf' },
    });
    await flushPromises();

    expect(tileRequests).toHaveLength(0);
    (wrapper.vm as unknown as { zoomIn: () => void }).zoomIn();
    (wrapper.vm as unknown as { zoomIn: () => void }).zoomIn();
    vi.advanceTimersByTime(140);
    await flushPromises();

    expect(tileRequests[0]?.url).toContain('/preview/tiles/3/');
    expect(tileRequests[0]?.url).toContain('/preview/tiles/3/3/1');
    expect(tileRequests[0]?.signal.aborted).toBe(false);
    (wrapper.vm as unknown as { zoomIn: () => void }).zoomIn();
    (wrapper.vm as unknown as { zoomIn: () => void }).zoomIn();
    expect(tileRequests).toHaveLength(2);
    vi.advanceTimersByTime(140);
    await flushPromises();

    expect(tileRequests[0]?.signal.aborted).toBe(true);
    expect(tileRequests.some((request) => request.url.includes('/preview/tiles/4/'))).toBe(true);
    expect(tileRequests.filter((request) => !request.signal.aborted).length).toBeLessThanOrEqual(2);
    expect(createBitmap).toHaveBeenCalledOnce();

    wrapper.unmount();
    expect(tileRequests.every((request) => request.signal.aborted)).toBe(true);
    expect(overviewClose).toHaveBeenCalledOnce();
  });

  it('reports an overview failure without leaving the viewer permanently loading', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn());
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        return url.endsWith('/overview')
          ? Promise.resolve(new Response(null, { status: 503 }))
          : new Promise<Response>(() => undefined);
      }),
    );

    const wrapper = mount(CadTileViewer, {
      props: { documentId: 'document-id', manifest, sourceName: '厂区平面图.dxf' },
    });
    await flushPromises();

    expect(wrapper.classes()).not.toContain('is-loading');
    expect(wrapper.get('.cad-tile-status').text()).toContain('CAD 总览加载失败');
    expect(wrapper.emitted('error')?.[0]?.[0]).toContain('该图纸可能过于复杂');
    wrapper.unmount();
  });
});
