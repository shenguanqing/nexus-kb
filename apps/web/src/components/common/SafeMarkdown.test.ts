import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SafeMarkdown from './SafeMarkdown.vue';

describe('SafeMarkdown', () => {
  it('renders supported Markdown and inline citations', () => {
    const wrapper = mount(SafeMarkdown, {
      props: {
        content:
          '## 结论\n\n**Vue 3** 支持：\n\n- Composition API\n- Proxy [来源1]\n\n`setup()`',
      },
    });

    expect(wrapper.get('h2').text()).toBe('结论');
    expect(wrapper.get('strong').text()).toBe('Vue 3');
    expect(wrapper.findAll('li').map((item) => item.text())).toEqual([
      'Composition API',
      'Proxy [来源1]',
    ]);
    expect(wrapper.get('code').text()).toBe('setup()');
    expect(wrapper.get('.answer-citation').text()).toBe('[来源1]');
  });

  it('escapes raw HTML and rejects active content and dangerous links', () => {
    const wrapper = mount(SafeMarkdown, {
      props: {
        content:
          '<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n![跟踪图片](https://example.com/tracker.png)\n\n[危险链接](javascript:alert(1))\n\n[安全链接](https://example.com)',
      },
    });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
    expect(wrapper.text()).toContain('<script>alert(1)</script>');
    expect(wrapper.findAll('a')).toHaveLength(1);
    expect(wrapper.get('a').attributes()).toMatchObject({
      href: 'https://example.com',
      rel: 'noopener noreferrer',
      target: '_blank',
    });
  });
});
