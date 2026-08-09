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
    await wrapper.get('[aria-label="放大 CAD 预览"]').trigger('click');
    expect(wrapper.get('.preview-image').attributes('style')).toContain('width: 125%');
    expect(wrapper.get('.preview-security-badge').attributes('title')).toBe(
      '每次读取都会重新校验租户、部门与敏感度权限。',
    );
    expect(wrapper.get('.preview-toolbar').text()).not.toContain(
      '每次读取都会重新校验租户、部门与敏感度权限。',
    );
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
