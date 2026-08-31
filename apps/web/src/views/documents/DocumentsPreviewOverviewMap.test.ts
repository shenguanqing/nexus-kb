import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DocumentsPreviewOverviewMap from './DocumentsPreviewOverviewMap.vue';

function dispatchPointerEvent(
  element: Element,
  type: string,
  init: { pointerId: number; clientX: number; clientY: number; button?: number },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [name, value] of Object.entries({ button: 0, ...init })) {
    Object.defineProperty(event, name, { value });
  }
  element.dispatchEvent(event);
}

describe('DocumentsPreviewOverviewMap', () => {
  it('shows the current viewport and navigates by pointer or keyboard', async () => {
    const wrapper = mount(DocumentsPreviewOverviewMap, {
      props: {
        source: '/v1/documents/document-id/preview/overview',
        sourceName: '消控室大样图.dwg',
        viewport: { x: 0.25, y: 0.2, width: 0.5, height: 0.4 },
        aspectRatio: 2,
      },
    });
    const surface = wrapper.get('.documents-overview-map__surface');
    Object.assign(surface.element, {
      getBoundingClientRect: () => ({ height: 100, left: 10, top: 20, width: 200 }),
      setPointerCapture: () => undefined,
    });

    expect(wrapper.text()).not.toContain('鸟瞰图');
    expect(wrapper.text()).toContain('拖动定位');
    expect(wrapper.attributes('aria-label')).toContain('消控室大样图.dwg CAD 鸟瞰图');
    expect(wrapper.get('.documents-overview-map__viewport').attributes('style')).toContain(
      'width: 50%',
    );

    dispatchPointerEvent(surface.element, 'pointerdown', {
      pointerId: 7,
      clientX: 160,
      clientY: 45,
    });
    await surface.trigger('keydown', { key: 'ArrowLeft' });

    expect(wrapper.emitted('navigate')?.[0]).toEqual([{ x: 0.75, y: 0.25 }]);
    expect(wrapper.emitted('navigate')?.[1]).toEqual([{ x: 0.25, y: 0.4 }]);
  });

  it('keeps an enlarged draggable frame centered on a tiny real viewport', () => {
    const wrapper = mount(DocumentsPreviewOverviewMap, {
      props: {
        source: '/overview',
        sourceName: '高倍率图纸.dwg',
        viewport: { x: 0.7, y: 0.4, width: 0.001, height: 0.002 },
      },
    });

    const style = wrapper.get('.documents-overview-map__viewport').attributes('style');
    expect(style).toContain('width: 12%');
    expect(style).toContain('height: 16%');
    expect(wrapper.get('.documents-overview-map__center').element.tagName).toBe('SPAN');
    expect(wrapper.text()).toContain('拖动定位');
  });

  it('shows a readable focus overview and maps its navigation back to full bounds', async () => {
    const wrapper = mount(DocumentsPreviewOverviewMap, {
      props: {
        source: '/full-overview',
        focusSource: '/focus-overview',
        sourceName: 'AGV.dwg',
        viewport: { x: 0.1, y: 0.7, width: 0.02, height: 0.04 },
        focusRegion: { x: 0.1, y: 0.7, width: 0.2, height: 0.1 },
        aspectRatio: 0.5,
        focusAspectRatio: 1.2,
      },
    });
    const surface = wrapper.get('.documents-overview-map__surface');
    Object.assign(surface.element, {
      getBoundingClientRect: () => ({ height: 100, left: 10, top: 20, width: 200 }),
      setPointerCapture: () => undefined,
    });

    expect(wrapper.get('img').attributes('src')).toBe('/focus-overview');
    expect(wrapper.text()).toContain('拖动定位');
    dispatchPointerEvent(surface.element, 'pointerdown', {
      pointerId: 8,
      clientX: 110,
      clientY: 70,
    });
    expect(wrapper.emitted('navigate')?.[0]).toEqual([{ x: 0.2, y: 0.75 }]);

    await wrapper.get('.documents-overview-map__mode:nth-child(2)').trigger('click');
    expect(wrapper.get('img').attributes('src')).toBe('/full-overview');
    expect(wrapper.find('.documents-overview-map__focus').exists()).toBe(true);
  });
});
