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

    expect(wrapper.get('[aria-label="厂区平面图.dxf CAD 鸟瞰图"]').text()).toContain('拖动定位');
    expect(wrapper.get('[aria-label="厂区平面图.dxf CAD 鸟瞰图"]').text()).not.toContain(
      '鸟瞰图',
    );
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

  it('refreshes a progressive overview once after detailed tiles become available', async () => {
    const overviewRequests: string[] = [];
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ close: vi.fn(), height: 800, width: 1600 }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes('/preview/overview')) {
          overviewRequests.push(url);
        }
        return Promise.resolve({
          blob: () => Promise.resolve(new Blob(['image'])),
          ok: true,
        } as Response);
      }),
    );

    const wrapper = mount(CadTileViewer, {
      props: {
        documentId: 'document-id',
        manifest,
        refreshOverviewOnDetail: true,
        sourceName: '复杂图纸.dwg',
      },
    });
    await flushPromises();

    (wrapper.vm as unknown as { zoomIn: () => void }).zoomIn();
    (wrapper.vm as unknown as { zoomIn: () => void }).zoomIn();
    vi.advanceTimersByTime(140);
    await flushPromises();
    await flushPromises();

    expect(overviewRequests).toEqual([
      '/v1/documents/document-id/preview/overview',
      '/v1/documents/document-id/preview/overview?detail=1',
    ]);
    expect(wrapper.get('[aria-label="复杂图纸.dwg CAD 鸟瞰图"] img').attributes('src')).toContain(
      '?detail=1',
    );
    wrapper.unmount();
  });

  it('uses one progressive initialization request and stops automatic prefetch after failure', async () => {
    const tileRequests: string[] = [];
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ close: vi.fn(), height: 800, width: 1600 }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.endsWith('/overview')) {
          return Promise.resolve({
            blob: () => Promise.resolve(new Blob(['overview'])),
            ok: true,
          } as Response);
        }
        tileRequests.push(url);
        return Promise.resolve(new Response(null, { status: 503 }));
      }),
    );

    const wrapper = mount(CadTileViewer, {
      props: {
        documentId: 'document-id',
        manifest,
        refreshOverviewOnDetail: true,
        sourceName: '复杂图纸.dwg',
      },
    });
    await flushPromises();
    (wrapper.vm as unknown as { zoomIn: () => void }).zoomIn();
    (wrapper.vm as unknown as { zoomIn: () => void }).zoomIn();
    vi.advanceTimersByTime(140);
    await flushPromises();

    expect(tileRequests).toHaveLength(1);
    expect(wrapper.get('.cad-tile-status').text()).toContain('仍可继续平移或缩放重试');
    await flushPromises();
    expect(tileRequests).toHaveLength(1);
    wrapper.unmount();
  });

  it('uses focus bounds for the initial camera while keeping full-bounds tile coordinates', async () => {
    const tileRequests: string[] = [];
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ close: vi.fn(), height: 800, width: 1600 }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.endsWith('/overview')) {
          return Promise.resolve({
            blob: () => Promise.resolve(new Blob(['overview'])),
            ok: true,
          } as Response);
        }
        tileRequests.push(url);
        return new Promise<Response>(() => undefined);
      }),
    );

    const wrapper = mount(CadTileViewer, {
      props: {
        documentId: 'document-id',
        manifest: {
          ...manifest,
          maxZoom: 15,
          baseWidth: 512,
          baseHeight: 512,
          overviewWidth: 1600,
          overviewHeight: 1600,
          bounds: { minX: 0, minY: 0, maxX: 1_000_000, maxY: 1_000_000 },
          focusBounds: { minX: 100, minY: 100, maxX: 150, maxY: 150 },
          worldToPixel: [0.000512, 0, 0, -0.000512, 0, 512],
        },
        sourceName: '离群对象图纸.dwg',
      },
    });
    await flushPromises();
    vi.advanceTimersByTime(140);
    await flushPromises();

    expect(tileRequests.some((url) => url.includes('/preview/tiles/15/'))).toBe(true);
    expect(
      wrapper.get('[aria-label="离群对象图纸.dwg CAD 鸟瞰图"] img').attributes('src'),
    ).toContain('/preview/focus-overview');
    expect(wrapper.emitted('zoomChange')?.[0]?.[0]).toMatchObject({ percent: 100 });
    wrapper.unmount();
  });

  it('stops zooming when z15 reaches the device pixel density', async () => {
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ close: vi.fn(), height: 1600, width: 866 }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.endsWith('/overview')) {
          return Promise.resolve({
            blob: () => Promise.resolve(new Blob(['overview'])),
            ok: true,
          } as Response);
        }
        return new Promise<Response>(() => undefined);
      }),
    );
    const wrapper = mount(CadTileViewer, {
      props: {
        documentId: 'document-id',
        manifest: {
          ...manifest,
          maxZoom: 15,
          baseWidth: 277,
          baseHeight: 512,
          overviewWidth: 866,
          overviewHeight: 1600,
          bounds: { minX: 503312, minY: 537729, maxX: 842924, maxY: 1165561 },
          focusBounds: { minX: 509663, minY: 543914, maxX: 509732, maxY: 543990 },
          worldToPixel: [0.0008155, 0, 0, -0.0008155, -410, 950],
        },
        sourceName: 'AGV.dwg',
      },
    });
    await flushPromises();

    (wrapper.vm as unknown as { zoomIn: () => void }).zoomIn();
    const state = wrapper.emitted('zoomChange')?.at(-1)?.[0] as
      { percent: number; canZoomIn: boolean } | undefined;
    expect(state?.percent).toBeGreaterThan(100);
    expect(state?.percent).toBeLessThan(150);
    expect(state?.canZoomIn).toBe(false);
    wrapper.unmount();
  });
});
