import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DocumentPreviewView from './DocumentPreviewView.vue';

const api = vi.hoisted(() => ({
  documentPreviewContentUrl: vi.fn(() => '/v1/documents/document-id/preview/content'),
  fetchDocumentPreview: vi.fn(),
  fetchDocumentPreviewText: vi.fn(),
  listDocumentChunks: vi.fn(),
}));
const route = vi.hoisted(() => ({
  params: { id: 'document-id' },
  query: { page: '7' },
}));

vi.mock('@/api/documents', () => api);
vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ replace: vi.fn() }),
}));

function mountView() {
  return mount(DocumentPreviewView, {
    global: {
      directives: { loading: () => undefined },
      stubs: { ElButton: true, ElEmpty: true, ElPagination: true },
    },
  });
}

function dispatchPointerEvent(
  element: Element,
  type: string,
  init: {
    pointerId: number;
    pointerType?: string;
    button?: number;
    clientX?: number;
    clientY?: number;
  },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const values = {
    pointerType: 'mouse',
    button: 0,
    clientX: 0,
    clientY: 0,
    ...init,
  };
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(event, name, { value });
  }
  element.dispatchEvent(event);
}

describe('DocumentPreviewView', () => {
  beforeEach(() => {
    api.fetchDocumentPreview.mockReset();
    api.fetchDocumentPreviewText.mockReset();
    api.listDocumentChunks.mockReset();
    route.query = { page: '7' };
  });

  it('opens a native PDF at the cited page', async () => {
    api.fetchDocumentPreview.mockResolvedValue({
      documentId: 'document-id',
      sourceName: '制度.pdf',
      sourceMimeType: 'application/pdf',
      status: 'ready',
      kind: 'pdf',
      contentType: 'application/pdf',
      renderer: 'browser-native',
      rendererVersion: null,
      generatedAt: null,
      fallbackVersion: null,
    });

    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.get('.preview-pdf').attributes('src')).toBe(
      '/v1/documents/document-id/preview/content#page=7',
    );
    expect(api.listDocumentChunks).not.toHaveBeenCalled();
  });

  it('falls back to ACL-authorized extracted text', async () => {
    api.fetchDocumentPreview.mockResolvedValue({
      documentId: 'document-id',
      sourceName: '制度.docx',
      sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      status: 'fallback',
      kind: 'extracted',
      contentType: null,
      renderer: null,
      rendererVersion: null,
      generatedAt: null,
      fallbackVersion: 2,
    });
    api.listDocumentChunks.mockResolvedValue({
      documentId: 'document-id',
      sourceName: '制度.docx',
      documentVersion: 2,
      page: 1,
      pageSize: 20,
      total: 1,
      items: [
        {
          id: 'a'.repeat(64),
          documentVersion: 2,
          ordinal: 0,
          originalText: '付款周期为 30 天',
          redactedText: '付款周期为 30 天',
          tokenCount: 8,
          page: 7,
          sheet: null,
          sectionPath: ['付款制度'],
          elementTypes: ['paragraph'],
          previousChunkId: null,
          nextChunkId: null,
          redactionPolicyVersion: 'v1',
          redactionSummary: {},
          createdAt: '2026-08-09T08:00:00.000Z',
        },
      ],
    });

    const wrapper = mountView();
    await flushPromises();

    expect(api.listDocumentChunks).toHaveBeenCalledWith('document-id', {
      version: 2,
      page: 1,
      pageSize: 20,
    });
    expect(wrapper.get('.preview-chunk').classes()).toContain('is-referenced');
    expect(wrapper.text()).toContain('付款周期为 30 天');
  });

  it('zooms a CAD preview and keeps the security explanation in a compact badge', async () => {
    api.fetchDocumentPreview.mockResolvedValue({
      documentId: 'document-id',
      sourceName: '园区平面图.dxf',
      sourceMimeType: 'image/vnd.dxf',
      status: 'ready',
      kind: 'svg',
      contentType: 'image/svg+xml',
      renderer: 'ezdxf-svg',
      rendererVersion: '1.4.4',
      generatedAt: '2026-08-09T08:00:00.000Z',
      fallbackVersion: null,
    });

    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.get('.preview-image').attributes('style')).toContain('width: 100%');
    const zoomInButton = wrapper.get('[aria-label="放大 CAD 预览"]');
    await zoomInButton.trigger('click');
    expect(wrapper.get('.preview-image').attributes('style')).toContain('width: 125%');
    for (let step = 0; step < 123; step += 1) {
      await zoomInButton.trigger('click');
    }
    expect(wrapper.get('.preview-image').attributes('style')).toContain('width: 3200%');
    expect(zoomInButton.attributes()).toHaveProperty('disabled');
    expect(wrapper.get('.preview-security-badge').attributes('title')).toBe(
      '每次读取都会重新校验租户、部门与敏感度权限。',
    );
    expect(wrapper.get('.preview-toolbar').text()).not.toContain(
      '每次读取都会重新校验租户、部门与敏感度权限。',
    );
  });

  it('pans a zoomed CAD preview by dragging with the primary mouse button', async () => {
    api.fetchDocumentPreview.mockResolvedValue({
      documentId: 'document-id',
      sourceName: '园区平面图.dxf',
      sourceMimeType: 'image/vnd.dxf',
      status: 'ready',
      kind: 'svg',
      contentType: 'image/svg+xml',
      renderer: 'ezdxf-svg',
      rendererVersion: '1.4.4',
      generatedAt: '2026-08-09T08:00:00.000Z',
      fallbackVersion: null,
    });

    const wrapper = mountView();
    await flushPromises();
    await wrapper.get('[aria-label="放大 CAD 预览"]').trigger('click');
    const viewport = wrapper.get('.preview-image-viewport');
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.assign(viewport.element, {
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture,
      setPointerCapture,
      scrollLeft: 400,
      scrollTop: 300,
    });

    dispatchPointerEvent(viewport.element, 'pointerdown', {
      pointerType: 'mouse',
      button: 0,
      pointerId: 7,
      clientX: 100,
      clientY: 100,
    });
    dispatchPointerEvent(viewport.element, 'pointermove', {
      pointerType: 'mouse',
      pointerId: 7,
      clientX: 75,
      clientY: 60,
    });
    await wrapper.vm.$nextTick();

    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(viewport.classes()).toContain('is-dragging');
    expect(viewport.element.scrollLeft).toBe(425);
    expect(viewport.element.scrollTop).toBe(340);

    dispatchPointerEvent(viewport.element, 'pointerup', {
      pointerType: 'mouse',
      pointerId: 7,
    });
    await wrapper.vm.$nextTick();
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(viewport.classes()).not.toContain('is-dragging');
  });

  it('offers fullscreen for every ready preview', async () => {
    api.fetchDocumentPreview.mockResolvedValue({
      documentId: 'document-id',
      sourceName: '制度.pdf',
      sourceMimeType: 'application/pdf',
      status: 'ready',
      kind: 'pdf',
      contentType: 'application/pdf',
      renderer: 'browser-native',
      rendererVersion: null,
      generatedAt: null,
      fallbackVersion: null,
    });

    const wrapper = mountView();
    await flushPromises();
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(wrapper.element, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });

    await wrapper.get('[aria-label="全屏预览"]').trigger('click');

    expect(requestFullscreen).toHaveBeenCalledOnce();
  });
});
