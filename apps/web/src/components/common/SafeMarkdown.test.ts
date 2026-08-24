import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SafeMarkdown from './SafeMarkdown.vue';

describe('SafeMarkdown', () => {
  it('renders supported Markdown and inline citations', () => {
    const wrapper = mount(SafeMarkdown, {
      props: {
        content: '## 结论\n\n**Vue 3** 支持：\n\n- Composition API\n- Proxy [来源1]\n\n`setup()`',
      },
    });

    expect(wrapper.get('[role="heading"][aria-level="2"]').text()).toBe('结论');
    expect(wrapper.get('strong').text()).toBe('Vue 3');
    expect(wrapper.findAll('.markdown-list-item').map((item) => item.text())).toEqual([
      'Composition API',
      'Proxy [来源1]',
    ]);
    expect(wrapper.get('code').text()).toBe('setup()');
    expect(wrapper.get('.kb-answer-citation').text()).toBe('[来源1]');
    expect(wrapper.get('.kb-answer-citation').element.tagName).toBe('SMALL');
  });

  it('emits only generated interactive citation indexes', async () => {
    const wrapper = mount(SafeMarkdown, {
      props: { content: '付款周期为 30 天。[来源2]', interactiveCitations: true },
    });

    const citation = wrapper.get('.kb-answer-citation--interactive');
    expect(citation.attributes()).toMatchObject({
      'aria-label': '查看来源 2',
      'data-source-index': '2',
      type: 'button',
    });
    await citation.trigger('click');
    expect(wrapper.emitted('selectCitation')).toEqual([[2]]);
  });

  it('renders the supported block and inline Markdown set with semantic classes', () => {
    const wrapper = mount(SafeMarkdown, {
      props: {
        content:
          '#### 四级标题\n\n> 引用\n\n3. 第三项\n4. 第四项\n\n`inline`\n\n```ts\nconst value = 1;\n```\n\n**粗体** *斜体* ~~删除~~  \n换行\n\n[链接](https://example.com)\n\n---\n\n| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| A | B | C |',
      },
    });

    expect(wrapper.get('.markdown-heading--h4').attributes()).toMatchObject({
      'aria-level': '4',
      role: 'heading',
    });
    expect(wrapper.get('.markdown-quote').element.tagName).toBe('BLOCKQUOTE');
    expect(wrapper.get('.markdown-list').attributes('role')).toBe('list');
    expect(
      wrapper.findAll('.markdown-list-item--ordered').map((item) => ({
        marker: item.attributes('data-list-marker'),
        role: item.attributes('role'),
      })),
    ).toEqual([
      { marker: '3.', role: 'listitem' },
      { marker: '4.', role: 'listitem' },
    ]);
    expect(wrapper.get('.markdown-code--inline').element.tagName).toBe('CODE');
    expect(wrapper.get('.markdown-code-block').element.tagName).toBe('PRE');
    expect(wrapper.get('.markdown-code--block').element.tagName).toBe('CODE');
    expect(wrapper.get('.markdown-strong').element.tagName).toBe('STRONG');
    expect(wrapper.get('.markdown-emphasis').element.tagName).toBe('EM');
    expect(wrapper.get('.markdown-strikethrough').element.tagName).toBe('S');
    expect(wrapper.get('.markdown-break').element.tagName).toBe('BR');
    expect(wrapper.get('.markdown-divider').element.tagName).toBe('HR');
    expect(wrapper.get('.markdown-link').element.tagName).toBe('A');
    expect(wrapper.get('.markdown-table-scroll').attributes()).toMatchObject({
      'aria-label': 'Markdown 表格',
      role: 'region',
      tabindex: '0',
    });
    expect(wrapper.get('.markdown-table').element.tagName).toBe('TABLE');
    expect(wrapper.get('.markdown-table-heading').element.tagName).toBe('TH');
    expect(wrapper.get('.markdown-table-cell').element.tagName).toBe('TD');
    expect(wrapper.get('.markdown-table-align--center').text()).toBe('中');
    expect(wrapper.findAll('.markdown-table-align--right').map((cell) => cell.text())).toEqual([
      '右',
      'C',
    ]);
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
