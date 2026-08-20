import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const session = (
  capabilities = [
    'documents:read',
    'documents:write',
    'documents:delete',
    'access:read',
    'access:write',
    'system:read',
  ],
  role: 'user' | 'admin' = 'admin',
) => ({
  authenticated: true,
  mode: 'development',
  identity: {
    tenantId: 'tenant-fixture',
    userId: 'admin.fixture',
    department: 'platform',
    roles: [role],
    allowedSensitivities: ['public', 'internal', 'confidential'],
    capabilities,
    defaultSensitivity: 'internal',
  },
});

async function mockSession(
  page: Page,
  capabilities?: string[],
  role: 'user' | 'admin' = 'admin',
): Promise<void> {
  await page.route('**/v1/auth/session', (route) =>
    route.fulfill({ json: session(capabilities, role) }),
  );
}

async function expectAdjacentButtonsUseParentGap(page: Page, rootSelector: string): Promise<void> {
  const metrics = await page.locator(rootSelector).evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('.el-button + .el-button'))
      .filter((button) => button.getClientRects().length > 0)
      .map((button) => {
        const previous = button.previousElementSibling as HTMLElement | null;
        const buttonBounds = button.getBoundingClientRect();
        const previousBounds = previous?.getBoundingClientRect();
        const parentStyle = getComputedStyle(button.parentElement!);
        return {
          label: button.textContent?.trim() ?? button.getAttribute('aria-label') ?? '未命名按钮',
          marginLeft: Number.parseFloat(getComputedStyle(button).marginLeft),
          parentGap: Number.parseFloat(parentStyle.columnGap),
          visualGap:
            previousBounds && Math.abs(previousBounds.top - buttonBounds.top) <= 1
              ? buttonBounds.left - previousBounds.right
              : null,
        };
      }),
  );

  expect(metrics.length).toBeGreaterThan(0);
  for (const metric of metrics) {
    expect(metric.marginLeft, `${metric.label} 不应保留相邻按钮左外边距`).toBe(0);
    expect(metric.parentGap, `${metric.label} 应由父容器提供按钮间距`).toBeGreaterThanOrEqual(4);
    if (metric.visualGap !== null) {
      expect(
        metric.visualGap,
        `${metric.label} 的可见间距应与父容器 gap 一致`,
      ).toBeGreaterThanOrEqual(metric.parentGap - 1);
    }
  }
}

async function expectInputAndButtonHeightsMatch(
  page: Page,
  rootSelector: string,
  expectedHeight: number,
): Promise<void> {
  const metrics = await page.locator(rootSelector).evaluate((root) => {
    const visible = (element: Element): element is HTMLElement =>
      element instanceof HTMLElement && element.getClientRects().length > 0;
    const input = Array.from(root.querySelectorAll('.el-input__wrapper')).find(visible);
    const button = Array.from(root.querySelectorAll('.el-button')).find(visible);

    return {
      input: input ? Math.round(input.getBoundingClientRect().height) : null,
      button: button ? Math.round(button.getBoundingClientRect().height) : null,
      inputRadius: input ? Number.parseFloat(getComputedStyle(input).borderRadius) : null,
      buttonRadius: button ? Number.parseFloat(getComputedStyle(button).borderRadius) : null,
      rootRadius: Number.parseFloat(getComputedStyle(root).borderRadius),
      controlRadiusToken: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--kb-radius-md'),
      ),
    };
  });

  expect(metrics.input).toBe(expectedHeight);
  expect(metrics.button).toBe(expectedHeight);
  expect(metrics.inputRadius).toBe(metrics.controlRadiusToken);
  expect(metrics.buttonRadius).toBe(metrics.controlRadiusToken);
  expect(metrics.rootRadius).toBe(0);
}

async function expectPrimaryButtonHasBorder(page: Page, selector: string): Promise<void> {
  const appearance = await page.locator(selector).evaluate((button) => {
    const style = getComputedStyle(button);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderStyle: style.borderStyle,
      borderWidth: Number.parseFloat(style.borderWidth),
    };
  });

  expect(appearance.borderStyle).toBe('solid');
  expect(appearance.borderWidth).toBeGreaterThan(0);
}

async function expectDangerButtonHoverUsesHighlightToken(page: Page): Promise<void> {
  const colors = await page.evaluate(() => {
    const button = document.createElement('button');
    button.className = 'el-button el-button--danger el-button--default';
    button.textContent = '危险操作';
    document.body.append(button);

    const highlightProbe = document.createElement('span');
    highlightProbe.style.backgroundColor = 'var(--kb-color-danger-highlight)';
    document.body.append(highlightProbe);

    const hoverProbe = document.createElement('span');
    hoverProbe.style.backgroundColor = 'var(--el-button-hover-bg-color)';
    button.append(hoverProbe);

    const result = {
      highlight: getComputedStyle(highlightProbe).backgroundColor,
      hover: getComputedStyle(hoverProbe).backgroundColor,
      hoverText: getComputedStyle(button).getPropertyValue('--el-button-hover-text-color').trim(),
      onPrimary: getComputedStyle(document.documentElement)
        .getPropertyValue('--kb-color-on-primary')
        .trim(),
    };
    button.remove();
    highlightProbe.remove();
    return result;
  });

  expect(colors.hover).toBe(colors.highlight);
  expect(colors.hoverText).toBe(colors.onPrimary);
}

async function expectOverlayCloseHasSharedBorder(page: Page, selector: string): Promise<void> {
  const button = page.locator(selector);
  const appearance = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: Math.round(element.getBoundingClientRect().width),
      height: Math.round(element.getBoundingClientRect().height),
      borderColor: style.borderColor,
      borderStyle: style.borderStyle,
      borderWidth: Number.parseFloat(style.borderWidth),
      borderRadius: Number.parseFloat(style.borderRadius),
      controlHeight: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--kb-control-height'),
      ),
    };
  });

  await button.hover();
  await page.waitForTimeout(200);
  const hoverAppearance = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    const backgroundProbe = document.createElement('span');
    backgroundProbe.style.backgroundColor = 'var(--kb-color-primary-soft)';
    document.body.append(backgroundProbe);
    const expectedBackground = getComputedStyle(backgroundProbe).backgroundColor;
    backgroundProbe.remove();
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      expectedBackground,
    };
  });

  const bounds = await button.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200);
  const activeAppearance = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    const backgroundProbe = document.createElement('span');
    backgroundProbe.style.backgroundColor = 'var(--kb-color-nav-accent)';
    document.body.append(backgroundProbe);
    const expectedBackground = getComputedStyle(backgroundProbe).backgroundColor;
    backgroundProbe.remove();
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      expectedBackground,
    };
  });
  await page.mouse.move(0, 0);
  await page.mouse.up();

  expect(appearance.width).toBe(appearance.controlHeight);
  expect(appearance.height).toBe(appearance.controlHeight);
  expect(appearance.borderStyle).toBe('solid');
  expect(appearance.borderWidth).toBeGreaterThan(0);
  expect(appearance.borderRadius).toBeGreaterThanOrEqual(appearance.controlHeight / 2);
  expect(hoverAppearance.borderColor).toBe(appearance.borderColor);
  expect(hoverAppearance.backgroundColor).toBe(hoverAppearance.expectedBackground);
  expect(activeAppearance.borderColor).toBe(appearance.borderColor);
  expect(activeAppearance.backgroundColor).toBe(activeAppearance.expectedBackground);
}

test('asks a grounded question and renders an authorized source', async ({ page }) => {
  await mockSession(page);
  await page.route('**/v1/knowledge/query', (route) => {
    const requestBody: unknown = route.request().postDataJSON();
    const question =
      typeof requestBody === 'object' &&
      requestBody !== null &&
      'question' in requestBody &&
      typeof requestBody.question === 'string'
        ? requestBody.question
        : '';
    return route.fulfill({
      json: {
        conversationId: '11111111-1111-4111-8111-111111111111',
        answer:
          question === '付款周期是多久？'
            ? '付款周期为 30 天。[来源1]'
            : '报销需提交对应材料。[来源1]',
        noAnswer: false,
        reason: null,
        answerMode: 'grounded',
        traceId:
          question === '付款周期是多久？'
            ? '21111111-1111-4111-8111-111111111111'
            : '21111111-1111-4111-8111-111111111112',
        sources: [
          {
            index: 1,
            documentId: '31111111-1111-4111-8111-111111111111',
            documentVersion: 1,
            chunkIds: ['a'.repeat(64)],
            sourceName: '付款制度.md',
            page: 2,
            sheet: null,
            sectionPath: ['付款'],
          },
        ],
        model: { provider: 'fixture', model: 'fixture-model', fallbackUsed: false },
        rerankDegraded: false,
      },
    });
  });
  await page.goto('/ask');
  await page.getByLabel('输入问题').fill('付款周期是多久？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('付款周期为 30 天。')).toBeVisible();
  await expect(page.getByText('付款制度.md')).toBeVisible();
  await page.route('**/v1/history/conversations?**', (route) =>
    route.fulfill({ json: { conversations: [], total: 0, offset: 0, limit: 20 } }),
  );
  await page.locator('.sidebar-navigation').getByRole('link', { name: '问答历史' }).click();
  await expect(page).toHaveURL(/\/history$/);
  const historyLayout = await page.evaluate(() => {
    const page = document.querySelector<HTMLElement>('.app-main > section.page');
    const layout = document.querySelector<HTMLElement>('.history-layout');
    return {
      pageBottom: page?.getBoundingClientRect().bottom ?? Number.NEGATIVE_INFINITY,
      layoutBottom: layout?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
    };
  });
  expect(Math.abs(historyLayout.pageBottom - historyLayout.layoutBottom)).toBeLessThanOrEqual(1);
  await page.locator('.sidebar-navigation').getByRole('link', { name: '知识问答' }).click();
  await expect(page.getByText('付款周期是多久？')).toBeVisible();
  await expect(page.getByText('付款周期为 30 天。')).toBeVisible();
  await page.getByLabel('输入问题').fill('报销需要准备哪些材料？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('报销需要准备哪些材料？')).toBeVisible();
  await expect(page.getByText('报销需提交对应材料。')).toBeVisible();
  await expect(page.getByText('付款周期是多久？')).toBeVisible();
  await expect(page.getByText('付款周期为 30 天。')).toBeVisible();
  await page.getByRole('button', { name: '新建问答' }).click();
  await expect(page.getByText('今天想从知识库了解什么？')).toBeVisible();
  await expect(page.getByText('付款周期是多久？', { exact: true })).not.toBeVisible();
});

test('renders the ask page header with Element Plus', async ({ page }) => {
  await mockSession(page);
  await page.goto('/ask');

  await expect(page.locator('.page-header')).toHaveClass(/el-page-header/);
  await expect(page.getByRole('heading', { name: '从资料中找到答案' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建问答' })).toBeVisible();
});

test('renders the complete safe Markdown set with applied component styles', async ({ page }) => {
  await mockSession(page, ['documents:read'], 'user');
  await page.route('**/v1/knowledge/query', (route) =>
    route.fulfill({
      json: {
        conversationId: '11111111-1111-4111-8111-111111111111',
        answer:
          '#### 格式检查\n\n> 引用内容\n\n3. 第三项\n4. 第四项\n\n**粗体** *斜体* ~~删除~~ `代码`\n\n---\n\n| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| A | B | C |',
        noAnswer: false,
        reason: null,
        answerMode: 'general',
        traceId: '21111111-1111-4111-8111-111111111111',
        sources: [],
        model: { provider: 'fixture', model: 'fixture-model', fallbackUsed: false },
        rerankDegraded: false,
      },
    }),
  );

  await page.goto('/ask');
  await page.getByLabel('输入问题').fill('检查 Markdown 格式');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('heading', { name: '格式检查', level: 4 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Markdown 表格' })).toBeVisible();

  const styles = await page.locator('.answer-text.markdown-content').evaluate((root) => {
    const style = (selector: string) => getComputedStyle(root.querySelector(selector)!);
    const orderedItem = root.querySelector('.markdown-list-item--ordered')!;
    const tableScroll = root.querySelector<HTMLElement>('.markdown-table-scroll')!;
    return {
      codeBackground: style('.markdown-code--inline').backgroundColor,
      headingWeight: style('.markdown-heading--h4').fontWeight,
      marker: getComputedStyle(orderedItem, '::before').content,
      quoteBorder: style('.markdown-quote').borderLeftStyle,
      tableDisplay: style('.markdown-table').display,
      tableHeadingBackground: style('.markdown-table-heading').backgroundColor,
      tableScrollOverflow: getComputedStyle(tableScroll).overflowX,
      tableTabIndex: tableScroll.tabIndex,
      textAlignCenter: style('.markdown-table-align--center').textAlign,
      textAlignRight: style('.markdown-table-align--right').textAlign,
    };
  });

  expect(styles).toMatchObject({
    headingWeight: '700',
    marker: '"3."',
    quoteBorder: 'solid',
    tableDisplay: 'table',
    tableScrollOverflow: 'auto',
    tableTabIndex: 0,
    textAlignCenter: 'center',
    textAlignRight: 'right',
  });
  expect(styles.codeBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(styles.tableHeadingBackground).not.toBe('rgba(0, 0, 0, 0)');
});

test('loads more history and keeps compact toolbars without date controls', async ({ page }) => {
  await mockSession(page);
  const conversations = Array.from({ length: 21 }, (_, index) => ({
    id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    title: `会话 ${index + 1}`,
    messageCount: 1,
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  }));
  await page.route('**/v1/history/conversations?**', (route) => {
    const requestUrl = new URL(route.request().url());
    const offset = Number(requestUrl.searchParams.get('offset') ?? 0);
    return route.fulfill({
      json: {
        conversations: conversations.slice(offset, offset + 20),
        total: 21,
        offset,
        limit: 20,
      },
    });
  });

  await page.goto('/history');

  await expect(page.locator('.history-head')).toHaveCount(0);
  await expect(page.locator('.history-list-card .history-list')).toBeVisible();
  await expect(page.locator('.history-list-row')).toHaveCount(20);
  await expect(page.locator('.history-list-panel .el-pagination')).toHaveCount(0);
  await page.locator('.history-list-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('.history-list-row')).toHaveCount(21);
  await expect(page.getByText('已加载全部')).toBeVisible();

  await page.setViewportSize({ width: 768, height: 887 });
  await page.goto('/history');
  await expect(page.locator('.history-toolbar .el-date-editor')).toHaveCount(0);
  const padToolbar = await page.locator('.history-toolbar').evaluate((toolbar) => {
    const controls = Array.from(
      toolbar.querySelectorAll<HTMLElement>('.el-input, .filter-actions'),
    ).map((control) => Math.round(control.getBoundingClientRect().top));
    return { controls };
  });
  expect(new Set(padToolbar.controls).size).toBe(1);

  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/history');
  const mobileToolbar = page.locator('.history-toolbar--mobile');
  await expect(mobileToolbar.getByRole('button', { name: '筛选', exact: true })).toHaveCount(0);
  await expect(mobileToolbar.getByRole('button', { name: '重置', exact: true })).toBeVisible();
  await expect(mobileToolbar.locator('.el-date-editor')).toHaveCount(0);
  await expect(page.locator('.mobile-filter-drawer')).toHaveCount(0);
  const mobileToolbarBounds = await mobileToolbar.evaluate((toolbar) => ({
    clientWidth: toolbar.clientWidth,
    scrollWidth: toolbar.scrollWidth,
  }));
  expect(mobileToolbarBounds.scrollWidth).toBeLessThanOrEqual(mobileToolbarBounds.clientWidth);
});

test('omits unavailable source location metadata', async ({ page }) => {
  await mockSession(page, ['documents:read'], 'user');
  await page.route('**/v1/knowledge/query', (route) =>
    route.fulfill({
      json: {
        conversationId: '11111111-1111-4111-8111-111111111111',
        answer: 'Vue 的响应式原理。[来源1]',
        noAnswer: false,
        reason: null,
        answerMode: 'grounded',
        traceId: '21111111-1111-4111-8111-111111111111',
        sources: [
          {
            index: 1,
            documentId: '31111111-1111-4111-8111-111111111111',
            documentVersion: 1,
            chunkIds: ['a'.repeat(64)],
            sourceName: 'vue.md',
            page: null,
            sheet: null,
            sectionPath: [],
          },
        ],
        model: { provider: 'fixture', model: 'fixture-model', fallbackUsed: false },
        rerankDegraded: false,
      },
    }),
  );

  await page.goto('/ask');
  await page.getByLabel('输入问题').fill('Vue 的响应式原理是什么？');
  await page.getByRole('button', { name: '发送' }).click();
  await page.getByRole('button', { name: /来源 1 vue\.md/ }).click();

  await expect(page.getByRole('heading', { name: 'vue.md', level: 2 })).toBeVisible();
  await expect(page.locator('.source-reference')).toHaveCount(0);
  await expect(page.getByText('位置未标注')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '预览文档' })).toBeVisible();
});

test('renders explicit no-answer and blocks unauthorized management routes', async ({ page }) => {
  await mockSession(page, ['documents:read'], 'user');
  await page.route('**/v1/knowledge/query', (route) =>
    route.fulfill({
      json: {
        conversationId: '11111111-1111-4111-8111-111111111111',
        answer: '当前知识库中没有找到足够可靠且有权限访问的依据。',
        noAnswer: true,
        reason: 'insufficient_relevance',
        answerMode: null,
        traceId: '21111111-1111-4111-8111-111111111111',
        sources: [],
        model: null,
        rerankDegraded: false,
      },
    }),
  );
  await page.goto('/ask');
  const sidebar = page.locator('.sidebar-navigation');
  await expect(sidebar.getByRole('link', { name: '知识问答' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: '问答历史' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: '文档管理' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: '入库任务' })).toHaveCount(0);
  await expect(page.getByText('管理', { exact: true })).toHaveCount(0);
  await page.getByLabel('输入问题').fill('不存在的制度？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('暂时没有找到足够依据')).toBeVisible();
  await page.goto('/documents');
  await expect(page).toHaveURL(/\/403$/);
});

test('labels a hybrid general-knowledge answer without knowledge-base sources', async ({
  page,
}) => {
  await mockSession(page, ['documents:read']);
  await page.route('**/v1/knowledge/query', (route) =>
    route.fulfill({
      json: {
        conversationId: '11111111-1111-4111-8111-111111111111',
        answer: 'Vue 3 使用 Proxy 实现响应式，并提供 Composition API。',
        noAnswer: false,
        reason: null,
        answerMode: 'general',
        traceId: '21111111-1111-4111-8111-111111111111',
        sources: [],
        model: { provider: 'fixture', model: 'fixture-model', fallbackUsed: false },
        rerankDegraded: false,
      },
    }),
  );

  await page.goto('/ask');
  await page.getByLabel('输入问题').fill('Vue 2 和 Vue 3 的区别？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('通用知识补充', { exact: true })).toBeVisible();
  await expect(page.getByText('不是知识库资料', { exact: false })).toBeVisible();
  await expect(page.getByText('Vue 3 使用 Proxy', { exact: false })).toBeVisible();
  await expect(page.locator('.answer-sources')).toHaveCount(0);
});

test('opens access navigation and displays ACL-authorized document chunks', async ({ page }) => {
  const documentId = '6769af9a-a4d0-4dc2-a97d-942584a9c826';
  await mockSession(page);
  await page.route('**/v1/access/users**', (route) =>
    route.fulfill({
      json: { users: [], total: 0, offset: 0, limit: 25, scope: 'tenant' },
    }),
  );
  await page.route('**/v1/access/departments', (route) =>
    route.fulfill({ json: { departments: [] } }),
  );
  await page.route('**/v1/ingestion-jobs**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  await page.route('**/v1/documents/**', (route) => {
    if (route.request().url().includes('/chunks?')) {
      return route.fulfill({
        json: {
          documentId,
          sourceName: 'Drawing1.dwg',
          documentVersion: 2,
          items: [
            {
              id: 'a'.repeat(64),
              documentVersion: 2,
              ordinal: 0,
              originalText: '这是原始分块内容。',
              redactedText: '这是脱敏后分块内容。',
              tokenCount: 10,
              page: 1,
              sheet: null,
              sectionPath: ['第一章'],
              elementTypes: ['paragraph'],
              previousChunkId: null,
              nextChunkId: null,
              redactionPolicyVersion: 'v1',
              redactionSummary: {},
              createdAt: '2026-07-22T09:00:00.000Z',
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        },
      });
    }
    return route.fulfill({
      json: {
        id: documentId,
        sourceName: 'Drawing1.dwg',
        mimeType: 'image/vnd.dwg',
        department: 'finance',
        sensitivity: 'internal',
        ownerId: 'admin.fixture',
        activeVersion: 2,
        status: 'active',
        versions: [
          {
            version: 2,
            status: 'active',
            parser: 'oda-file-converter+ezdxf',
            parserVersion: 'ODA 26.8 / ezdxf 1.4.4',
            warnings: ['DWG_CONVERTED_TO_DXF', 'DWG_SOURCE_VERSION:AC1021'],
            chunkCount: 1,
            vectorCollection: 'nexus_ollama_bge_m3_1024_12345678',
            embeddingFingerprint: 'a'.repeat(64),
            indexedAt: '2026-07-22T09:00:00.000Z',
            activatedAt: '2026-07-22T09:00:00.000Z',
            supersededAt: null,
            createdAt: '2026-07-22T09:00:00.000Z',
          },
          {
            version: 1,
            status: 'superseded',
            parser: 'oda-file-converter+ezdxf',
            parserVersion: 'ODA 26.8 / ezdxf 1.4.4',
            warnings: [],
            chunkCount: 1,
            vectorCollection: 'nexus_ollama_bge_m3_1024_12345678_old',
            embeddingFingerprint: 'b'.repeat(64),
            indexedAt: '2026-07-21T09:00:00.000Z',
            activatedAt: '2026-07-21T09:00:00.000Z',
            supersededAt: '2026-07-22T09:00:00.000Z',
            createdAt: '2026-07-21T09:00:00.000Z',
          },
        ],
        createdAt: '2026-07-22T09:00:00.000Z',
        updatedAt: '2026-07-22T09:00:00.000Z',
      },
    });
  });

  await page.goto('/ask');
  await page.locator('.sidebar-navigation').getByRole('link', { name: '用户与角色' }).click();
  await expect(page).toHaveURL(/\/access\/users$/);
  await expect(page.getByRole('heading', { name: '用户与角色' })).toBeVisible();
  await page.locator('.sidebar-navigation').getByRole('link', { name: '部门权限' }).click();
  await expect(page).toHaveURL(/\/access\/departments$/);
  await expect(page.getByRole('heading', { name: '部门权限' })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/documents/${documentId}`);
  await expect(page.getByRole('heading', { name: 'Drawing1.dwg' })).toBeVisible();
  await expect(page.getByText('原始 DWG（版本 AC1021） 已自动转换为 DXF 后解析入库')).toBeVisible();
  await expect(page.getByText('已被替代')).toBeVisible();
  const desktopDetailLayout = await page.evaluate(() => {
    const summary = document.querySelector<HTMLElement>('.detail-actions > div:first-child');
    const actionButtons = document.querySelector<HTMLElement>('.detail-action-buttons');
    const cards = document.querySelectorAll<HTMLElement>('.detail-grid > .kb-block');
    return {
      actionsWrapped:
        (actionButtons?.getBoundingClientRect().top ?? 0) >=
        (summary?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY),
      cardsStacked:
        (cards[1]?.getBoundingClientRect().top ?? 0) > (cards[0]?.getBoundingClientRect().top ?? 0),
    };
  });
  expect(desktopDetailLayout).toEqual({ actionsWrapped: false, cardsStacked: false });

  await page.setViewportSize({ width: 1102, height: 900 });
  const resizedMetrics = await page.evaluate(() => {
    const appMain = document.querySelector<HTMLElement>('.app-main');
    const detailPage = document.querySelector<HTMLElement>('.document-detail-page');
    const detailGrid = document.querySelector<HTMLElement>('.detail-grid');
    const actionButtons = document.querySelector<HTMLElement>('.detail-action-buttons');
    return {
      viewport: document.documentElement.clientWidth,
      appMain: appMain?.getBoundingClientRect().width ?? 0,
      detailPage: detailPage?.getBoundingClientRect().width ?? 0,
      detailGrid: detailGrid?.getBoundingClientRect().width ?? 0,
      actionButtons: actionButtons?.getBoundingClientRect().width ?? 0,
      gridColumns: detailGrid ? getComputedStyle(detailGrid).gridTemplateColumns : '',
    };
  });
  expect(resizedMetrics.detailGrid).toBeLessThanOrEqual(resizedMetrics.detailPage);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const summary = document.querySelector<HTMLElement>('.detail-actions > div:first-child');
        const actionButtons = document.querySelector<HTMLElement>('.detail-action-buttons');
        const cards = document.querySelectorAll<HTMLElement>('.detail-grid > .kb-block');
        return {
          actionsWrapped:
            (actionButtons?.getBoundingClientRect().top ?? 0) >=
            (summary?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY),
          cardsStacked:
            (cards[1]?.getBoundingClientRect().top ?? 0) >
            (cards[0]?.getBoundingClientRect().top ?? 0),
        };
      }),
    )
    .toEqual({ actionsWrapped: false, cardsStacked: false });
  const detailLayout = await page.evaluate(() => {
    const pageContent = document.querySelector<HTMLElement>(
      '.document-detail-page > .page-content',
    );
    const actions = document.querySelector<HTMLElement>('.detail-actions');
    const actionButtons = document.querySelector<HTMLElement>('.detail-action-buttons');
    const detailGrid = document.querySelector<HTMLElement>('.detail-grid');
    const history = document.querySelector<HTMLElement>(
      '.document-detail-page > .page-content > .detail-grid + .kb-block',
    );
    const actionsBounds = actions?.getBoundingClientRect();
    const gridBounds = detailGrid?.getBoundingClientRect();
    const historyBounds = history?.getBoundingClientRect();
    return {
      actionButtonsScrollWidth: actionButtons?.scrollWidth ?? 0,
      actionButtonsClientWidth: actionButtons?.clientWidth ?? 0,
      actionsDirection: actions ? getComputedStyle(actions).flexDirection : '',
      pageGap: pageContent ? Number.parseFloat(getComputedStyle(pageContent).rowGap) : 0,
      actionsToGridGap: actionsBounds && gridBounds ? gridBounds.top - actionsBounds.bottom : 0,
      gridToHistoryGap: gridBounds && historyBounds ? historyBounds.top - gridBounds.bottom : 0,
    };
  });
  expect(detailLayout.actionsDirection).toBe('row');
  expect(detailLayout.actionButtonsScrollWidth).toBeLessThanOrEqual(
    detailLayout.actionButtonsClientWidth,
  );
  expect(Math.round(detailLayout.actionsToGridGap)).toBe(Math.round(detailLayout.pageGap));
  expect(Math.round(detailLayout.gridToHistoryGap)).toBe(Math.round(detailLayout.pageGap));
  await page.getByRole('button', { name: '修改权限', exact: true }).click();
  const metadataDialog = page.locator('.metadata-dialog');
  await expect(metadataDialog).toBeVisible();
  await expect(metadataDialog).not.toHaveClass(/el-drawer/);
  const metadataBounds = await metadataDialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { width: Math.round(bounds.width), left: Math.round(bounds.left) };
  });
  expect(metadataBounds.width).toBe(480);
  expect(metadataBounds.left).toBeGreaterThan(0);
  await metadataDialog.getByText('内部', { exact: true }).click();
  const metadataPopper = page.locator('.el-select__popper').filter({ visible: true });
  await expect(metadataPopper).toBeVisible();
  const metadataOverlay = page.locator('.el-overlay').filter({ has: metadataDialog });
  const metadataZIndexes = await Promise.all([
    metadataOverlay.evaluate((element) => Number(getComputedStyle(element).zIndex)),
    metadataPopper.evaluate((element) => Number(getComputedStyle(element).zIndex)),
  ]);
  expect(metadataZIndexes[1]).toBeGreaterThan(metadataZIndexes[0]);
  await page.keyboard.press('Escape');
  await metadataDialog.getByRole('button', { name: '取消' }).click();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('.detail-action-buttons')).toHaveCount(0);
  await page.getByRole('button', { name: '打开文档操作面板' }).click();
  const mobileActionDrawer = page.locator('.mobile-action-drawer');
  await expect(mobileActionDrawer).toBeVisible();
  await expect(mobileActionDrawer.getByRole('menuitem')).toHaveCount(4);
  await expect(mobileActionDrawer.getByRole('menuitem', { name: '删除文档' })).toHaveClass(
    /mobile-action-item--danger/,
  );
  const mobileCardsStacked = await page.evaluate(() => {
    const cards = document.querySelectorAll<HTMLElement>('.detail-grid > .kb-block');
    return (
      (cards[1]?.getBoundingClientRect().top ?? 0) > (cards[0]?.getBoundingClientRect().top ?? 0)
    );
  });
  expect(mobileCardsStacked).toBe(true);
  await page.keyboard.press('Escape');
  await expect(mobileActionDrawer).toBeHidden();
  await page.getByRole('link', { name: '查看全部分块' }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${documentId}/chunks\\?version=2$`));
  await expect(page.getByRole('main').getByRole('heading', { name: 'Drawing1.dwg' })).toBeVisible();
  await expect(page.getByText('这是原始分块内容。')).toBeVisible();
  await expect(page.getByText('这是脱敏后分块内容。')).toHaveCount(0);
  await page.getByRole('tab', { name: '脱敏后内容' }).click();
  await expect(page.getByText('这是脱敏后分块内容。')).toBeVisible();
  await expect(page.getByText('这是原始分块内容。')).toHaveCount(0);
});

test('signs in with an enabled account-password session without storing credentials in the page', async ({
  page,
}) => {
  await page.route('**/v1/auth/session', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'AUTHENTICATION_REQUIRED', message: '需要登录' } },
    }),
  );
  await page.route('**/v1/auth/login-options', (route) =>
    route.fulfill({ json: { mode: 'password', passwordEnabled: true } }),
  );
  await page.route('**/v1/auth/password/login', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      username: 'admin.fixture',
      password: 'safe-password',
    });
    return route.fulfill({ json: { ...session(), mode: 'password' } });
  });

  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill('admin.fixture');
  await page.locator('input[autocomplete="current-password"]').fill('safe-password');
  await page.getByRole('button', { name: '登录' }).click();

  await expect(page).toHaveURL(/\/ask$/);
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  await expect(page.locator('input[autocomplete="current-password"]')).toHaveCount(0);
});

test('keeps the core shell within a 768px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await mockSession(page);
  await page.route('**/v1/history/conversations**', (route) =>
    route.fulfill({ json: { conversations: [], total: 0, offset: 0, limit: 20 } }),
  );
  await page.goto('/history');
  const widths = await page.evaluate(() => ({
    scroll: document.body.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(768);
  await expect(page.locator('.page-header')).toHaveClass(/el-page-header/);
  await expect(page.getByRole('heading', { name: '问答历史' })).toBeVisible();
  await expect(page.getByText('知识服务', { exact: true })).toBeVisible();
  await expect(page.getByLabel('当前位置')).toContainText('知识工作台');
  await expect(page.getByLabel('当前位置')).toContainText('问答历史');
});

test('renders the Pad shell breadcrumb with Element Plus', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await mockSession(page);
  await page.route('**/v1/history/conversations**', (route) =>
    route.fulfill({ json: { conversations: [], total: 0, offset: 0, limit: 20 } }),
  );
  await page.goto('/history');

  const breadcrumb = page.getByLabel('当前位置');
  await expect(breadcrumb).toHaveClass(/el-breadcrumb/);
  await expect(breadcrumb.locator('.el-breadcrumb__item')).toHaveCount(2);
  await expect(breadcrumb.locator('.el-breadcrumb__separator').first()).toHaveText('/');
  await expect(breadcrumb).toContainText('知识工作台');
  await expect(breadcrumb).toContainText('问答历史');
});

test('hides the shell heading copy on mobile while preserving return navigation', async ({
  page,
}) => {
  const documentId = '6769af9a-a4d0-4dc2-a97d-942584a9c826';
  await page.setViewportSize({ width: 375, height: 900 });
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/auth/session') return route.fulfill({ json: session() });
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: '未找到' } },
    });
  });

  await page.goto('/documents');
  await expect(page.locator('.page-header')).toHaveCount(0);

  await page.goto(`/documents/${documentId}`);
  await expect(page.locator('.page-header')).toBeVisible();
  await expect(page.locator('.page-return-link')).toHaveAttribute('href', '/documents');

  await page.getByRole('button', { name: '打开导航菜单' }).click();
  const mobileDocumentsLink = page
    .locator('.mobile-sidebar-navigation')
    .getByRole('link', { name: '文档管理', exact: true });
  await expect(mobileDocumentsLink).toHaveClass(/is-active/);
  await expect(mobileDocumentsLink).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 768, height: 900 });
  const tabletDocumentsLink = page
    .locator('.tablet-group-navigation')
    .getByRole('link', { name: '文档管理', exact: true });
  await expect(tabletDocumentsLink).toHaveClass(/is-active/);
  await expect(tabletDocumentsLink).toHaveAttribute('aria-current', 'page');

  await page.setViewportSize({ width: 1280, height: 900 });
  const desktopDocumentsLink = page
    .locator('.sidebar-navigation')
    .getByRole('link', { name: '文档管理', exact: true });
  await expect(desktopDocumentsLink).toHaveClass(/is-active/);
  await expect(desktopDocumentsLink).toHaveAttribute('aria-current', 'page');
  await page.goto('/documents');
});

test('adapts history filters, navigation, deletion, and pagination across pad and mobile', async ({
  page,
}) => {
  const conversationId = '11111111-1111-4111-8111-111111111111';
  const longTitle = '信息机房有哪些设备以及日常巡检与应急处置要求';
  const summary = {
    id: conversationId,
    title: longTitle,
    messageCount: 2,
    createdAt: '2026-08-11T15:57:00.000Z',
    updatedAt: '2026-08-11T15:57:00.000Z',
  };
  await mockSession(page);
  await page.route(`**/v1/history/conversations/${conversationId}`, (route) =>
    route.fulfill({
      json: {
        ...summary,
        turns: [
          {
            id: '21111111-1111-4111-8111-111111111111',
            question: '信息机房有哪些设备？',
            answer: '包括安防监控、门禁、供配电与 UPS。',
            noAnswer: false,
            reason: null,
            answerMode: 'general',
            traceId: '31111111-1111-4111-8111-111111111111',
            sources: [],
            sourceCount: 0,
            createdAt: '2026-08-11T15:57:00.000Z',
          },
        ],
      },
    }),
  );
  await page.route('**/v1/history/conversations?**', (route) => {
    return route.fulfill({
      json: { conversations: [summary], total: 100, offset: 0, limit: 20 },
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/history');
  await expect(page.locator('.history-toolbar')).toBeVisible();
  await expect(
    page.locator('.history-toolbar').getByRole('button', { name: '重置' }),
  ).toBeVisible();
  await expect(page.locator('.history-toolbar .el-date-editor')).toHaveCount(0);
  const desktopControls = await page.locator('.history-toolbar').evaluate((toolbar) => {
    const controls = Array.from(
      toolbar.querySelectorAll<HTMLElement>('.el-input, .filter-actions'),
    ).map((control) => control.getBoundingClientRect());
    const wrapper = toolbar.querySelector<HTMLElement>('.el-input__wrapper');
    return {
      tops: controls.map((control) => Math.round(control.top)),
      controlHeight: wrapper?.getBoundingClientRect().height ?? 0,
      toolbarHeight: toolbar.getBoundingClientRect().height,
    };
  });
  expect(new Set(desktopControls.tops).size).toBe(1);
  expect(desktopControls.controlHeight).toBe(40);
  expect(desktopControls.toolbarHeight).toBe(40);
  await page.locator('.history-list-item').click();
  await expect(page.locator('.history-detail-body')).toBeVisible();
  await page.getByPlaceholder('搜索会话标题').fill('巡检');
  await page.getByPlaceholder('搜索会话标题').press('Enter');
  await expect(page.locator('.history-detail-body')).toHaveCount(0);
  await expect(page.getByText('选择一个会话查看内容')).toBeVisible();

  await page.setViewportSize({ width: 768, height: 887 });
  await page.goto('/history');
  await expect(page.locator('.history-toolbar')).toBeVisible();
  await expect(page.locator('.history-list-item')).toBeVisible();
  const padLayout = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>('.history-toolbar');
    const search = toolbar?.querySelector<HTMLElement>('.el-input');
    const list = document.querySelector<HTMLElement>('.history-list-panel');
    const detail = document.querySelector<HTMLElement>('.history-detail');
    const actions = toolbar?.querySelector<HTMLElement>('.filter-actions');
    const wrapper = search?.querySelector<HTMLElement>('.el-input__wrapper');
    const toolbarBounds = toolbar?.getBoundingClientRect();
    const searchBounds = search?.getBoundingClientRect();
    const actionsBounds = actions?.getBoundingClientRect();
    return {
      controlTops: [searchBounds?.top ?? 0, actionsBounds?.top ?? 1],
      controlHeight: wrapper?.getBoundingClientRect().height ?? 0,
      toolbarHeight: toolbarBounds?.height ?? 0,
      dateCount: toolbar?.querySelectorAll('.el-date-editor').length ?? -1,
      listWidth: list?.getBoundingClientRect().width ?? 0,
      detailWidth: detail?.getBoundingClientRect().width ?? 0,
      layoutWidth:
        (list?.getBoundingClientRect().width ?? 0) + (detail?.getBoundingClientRect().width ?? 0),
    };
  });
  expect(new Set(padLayout.controlTops.map(Math.round)).size).toBe(1);
  expect(padLayout.controlHeight).toBe(40);
  expect(padLayout.toolbarHeight).toBeLessThan(80);
  expect(padLayout.dateCount).toBe(0);
  expect(padLayout.listWidth).toBeLessThan(padLayout.detailWidth);
  expect(padLayout.listWidth / padLayout.layoutWidth).toBeGreaterThanOrEqual(0.31);
  expect(padLayout.listWidth / padLayout.layoutWidth).toBeLessThanOrEqual(0.33);
  const deleteButton = page.getByRole('button', { name: `删除会话：${longTitle}` });
  await expect(deleteButton).toHaveCSS('opacity', '0');
  await page.locator('.history-list-row').hover();
  await expect(deleteButton).toHaveCSS('opacity', '1');

  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/history');
  await expect(page.getByPlaceholder('搜索会话标题')).toBeVisible();
  await expect(page.getByRole('button', { name: '重置', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '筛选', exact: true })).toHaveCount(0);
  await expect(page.locator('.history-toolbar .el-date-editor')).toHaveCount(0);
  await expect(page.locator('.mobile-filter-drawer')).toHaveCount(0);
  await expect(page.locator('.history-detail')).toHaveCount(0);

  await expect(page.getByRole('button', { name: `删除会话：${longTitle}` })).toBeVisible();

  await page.reload();
  await page.locator('.history-list-item').click();
  await expect(page.locator('.history-list-panel')).toHaveCount(0);
  const historyBackButton = page.getByRole('link', { name: '返回会话列表' });
  await expect(historyBackButton).toBeVisible();
  await expect(page.locator('.page-header-actions .page-return-link')).toHaveCount(1);
  await expect(page.locator('.mobile-tabbar')).toHaveCount(0);
  await expect(page.locator('.page-header')).toBeVisible();
  await expect(page.locator('.history-question')).toContainText('信息机房有哪些设备？');
  await expect(page).toHaveURL(new RegExp(`conversationId=${conversationId}`));
  await historyBackButton.click();
  await expect(page.locator('.history-list-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: '筛选', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重置', exact: true })).toBeVisible();
});

test('keeps the Provider long form scrollable inside the application shell', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await mockSession(page, ['system:read']);
  await page.route('**/v1/system/**', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'SERVICE_UNAVAILABLE', message: '测试状态不可用' } },
    }),
  );

  await page.goto('/settings/providers');
  await expect(page.getByRole('heading', { name: '模型 Provider' }).first()).toBeVisible();
  await expect(page.locator('.kb-error-state')).toBeVisible();

  const providerScroll = await page.locator('.page > .page-content').evaluate((content) => {
    const spacer = document.createElement('div');
    spacer.style.flex = '0 0 1600px';
    spacer.setAttribute('aria-hidden', 'true');
    content.append(spacer);
    content.scrollTop = 320;
    return {
      pageDisplay: getComputedStyle(content.parentElement!).display,
      overflowY: getComputedStyle(content).overflowY,
      canScroll: content.scrollHeight > content.clientHeight,
      scrollTop: content.scrollTop,
    };
  });
  expect(providerScroll).toMatchObject({
    pageDisplay: 'flex',
    overflowY: 'auto',
    canScroll: true,
  });
  expect(providerScroll.scrollTop).toBeGreaterThan(0);
});

test('uses one error-state surface and title weight across page containers', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 887 });
  await mockSession(page, ['documents:read', 'system:read']);
  const failure = {
    status: 503,
    json: {
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: '测试服务不可用',
        traceId: '21111111-1111-4111-8111-111111111111',
      },
    },
  };
  await page.route('**/v1/documents?**', (route) => route.fulfill(failure));
  await page.route('**/v1/ingestion-jobs?**', (route) => route.fulfill(failure));
  await page.route('**/v1/system/usage**', (route) => route.fulfill(failure));

  const appearanceFor = async (path: string) => {
    await page.goto(path);
    const errorState = page.locator('.kb-error-state');
    await expect(errorState).toBeVisible();
    return errorState.evaluate((element) => {
      const style = getComputedStyle(element);
      const title = element.querySelector<HTMLElement>('.kb-text--danger');
      const backgroundProbe = document.createElement('span');
      backgroundProbe.style.backgroundColor = 'var(--kb-color-danger-soft)';
      document.body.append(backgroundProbe);
      const dangerSoft = getComputedStyle(backgroundProbe).backgroundColor;
      backgroundProbe.remove();
      return {
        backgroundColor: style.backgroundColor,
        borderStyle: style.borderStyle,
        borderWidth: Number.parseFloat(style.borderWidth),
        borderRadius: Number.parseFloat(style.borderRadius),
        titleWeight: title ? Number.parseInt(getComputedStyle(title).fontWeight, 10) : 0,
        dangerSoft,
        insideBlock: element.closest('.kb-block') !== null,
      };
    });
  };

  const documentsError = await appearanceFor('/documents');
  const ingestionError = await appearanceFor('/ingestion-jobs');
  const usageError = await appearanceFor('/system/usage');

  expect(documentsError.insideBlock).toBe(false);
  expect(ingestionError.insideBlock).toBe(false);
  expect(usageError.insideBlock).toBe(false);
  for (const appearance of [documentsError, ingestionError, usageError]) {
    expect(appearance.backgroundColor).toBe(appearance.dangerSoft);
    expect(appearance.borderStyle).toBe('solid');
    expect(appearance.borderWidth).toBeGreaterThan(0);
    expect(appearance.borderRadius).toBe(documentsError.borderRadius);
    expect(appearance.titleWeight).toBe(600);
  }
});

test('keeps every authorized page within a 375px mobile viewport', async ({ page }) => {
  const documentId = '6769af9a-a4d0-4dc2-a97d-942584a9c826';
  await page.setViewportSize({ width: 375, height: 900 });
  await mockSession(page, [
    'documents:read',
    'documents:write',
    'audit:read',
    'access:read',
    'access:write',
    'system:read',
  ]);
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/auth/session')
      return route.fulfill({
        json: session([
          'documents:read',
          'documents:write',
          'documents:delete',
          'audit:read',
          'access:read',
          'access:write',
          'system:read',
        ]),
      });
    if (path === '/v1/history/conversations')
      return route.fulfill({ json: { conversations: [], total: 0, offset: 0, limit: 20 } });
    if (path === '/v1/documents')
      return route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } });
    if (path.endsWith('/chunks'))
      return route.fulfill({
        json: {
          documentId,
          sourceName: '制度.md',
          documentVersion: 1,
          items: [],
          page: 1,
          pageSize: 20,
          total: 120,
        },
      });
    if (path === `/v1/documents/${documentId}`)
      return route.fulfill({
        json: {
          id: documentId,
          sourceName: '制度.md',
          mimeType: 'text/markdown',
          department: 'finance',
          sensitivity: 'internal',
          ownerId: 'admin.fixture',
          activeVersion: 1,
          status: 'active',
          versions: [],
          createdAt: '2026-07-22T09:00:00.000Z',
          updatedAt: '2026-07-22T09:00:00.000Z',
        },
      });
    if (path === '/v1/ingestion-jobs')
      return route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } });
    if (path === '/v1/audit/events')
      return route.fulfill({ json: { events: [], nextBefore: null, total: 0 } });
    if (path === '/v1/access/users')
      return route.fulfill({
        json: { users: [], total: 0, offset: 0, limit: 25, scope: 'tenant' },
      });
    if (path === '/v1/access/departments')
      return route.fulfill({ json: { scope: 'tenant', departments: [] } });
    if (path === '/v1/system/providers') return route.fulfill({ json: { providers: [] } });
    if (path === '/v1/system/status')
      return route.fulfill({
        json: {
          status: 'ready',
          checkedAt: '2026-07-22T09:00:00.000Z',
          rawDocsDiskUsageRatio: 0,
          components: [],
          ingestionQueue: { status: 'up' },
        },
      });
    if (path === '/v1/system/usage')
      return route.fulfill({
        json: {
          from: '2026-06-22T00:00:00.000Z',
          to: '2026-07-22T00:00:00.000Z',
          totalQueries: 0,
          failureRate: null,
          queryP95Ms: null,
          providers: [],
          departments: [],
          usageCompleteness: 'request_only',
        },
      });
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: '未找到' } },
    });
  });

  await page.goto('/ask');
  await page.getByRole('button', { name: '打开导航菜单' }).click();
  const mobileNavigation = page.locator('.mobile-navigation-drawer');
  await expect(mobileNavigation.getByRole('link', { name: '模型 Provider' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: '用量与成本' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: '系统状态' })).toBeVisible();
  await page.keyboard.press('Escape');

  const pages = [
    '/ask',
    '/history',
    '/documents',
    `/documents/${documentId}`,
    `/documents/${documentId}/chunks`,
    '/ingestion-jobs',
    '/audit',
    '/access/users',
    '/access/departments',
    '/settings/providers',
    '/system/status',
    '/system/usage',
  ] as const;

  for (const path of pages) {
    await page.goto(path);
    await expect(page.locator('.app-main > section')).toBeVisible();
    const bounds = await page.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      mainScrollWidth: document.querySelector<HTMLElement>('.app-main')?.scrollWidth ?? 0,
      mainClientWidth: document.querySelector<HTMLElement>('.app-main')?.clientWidth ?? 0,
    }));
    expect(bounds.bodyScrollWidth).toBeLessThanOrEqual(375);
    expect(bounds.mainScrollWidth).toBeLessThanOrEqual(bounds.mainClientWidth);
  }

  await page.goto('/ask');
  await expect(page.locator('.ask-composer .el-textarea__inner')).toHaveCSS('font-size', '16px');

  for (const [path, toolbar] of [
    ['/documents', '.documents-toolbar'],
    ['/ingestion-jobs', '.task-toolbar'],
    ['/access/users', '.access-toolbar'],
    ['/system/usage', '.usage-toolbar'],
  ] as const) {
    await page.goto(path);
    await expect(page.locator(toolbar).getByRole('button', { name: '筛选' })).toHaveClass(
      /filter-trigger/,
    );
  }
  await page.goto('/history');
  await expect(page.locator('.history-toolbar').getByRole('button', { name: '筛选' })).toHaveCount(
    0,
  );
  await expect(
    page.locator('.history-toolbar').getByRole('button', { name: '重置' }),
  ).toBeVisible();
  await expect(page.locator('.history-list-empty')).toHaveCSS('justify-content', 'center');
  await expect(page.locator('.history-list-empty')).toHaveCSS('align-items', 'center');

  await page.goto('/access/users');
  await expect(page.locator('.access-table-wrap')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await page.goto('/access/departments');
  await expect(page.locator('.department-layout')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );

  await page.goto('/audit');
  await expect(page.locator('.audit-toolbar .audit-type-filter')).toContainText('全部事件类型');
  await expect(page.locator('.audit-toolbar').getByRole('button', { name: '重置' })).toBeVisible();
  await expect(page.locator('.mobile-filter-drawer')).toHaveCount(0);

  for (const [path, toolbar] of [
    ['/ingestion-jobs', '.task-toolbar'],
    ['/settings/providers', '.provider-toolbar'],
    ['/system/status', '.system-status-toolbar'],
    ['/system/usage', '.usage-toolbar'],
  ] as const) {
    await page.goto(path);
    await expect(page.locator(toolbar)).toHaveCSS('flex-direction', 'row');
  }

  await page.goto(`/documents/${documentId}/chunks`);
  await expect(
    page.locator('.document-chunks-page .kb-pagination .el-pagination__total'),
  ).toHaveCount(0);
  await expect(page.locator('.document-chunks-page .kb-pagination .el-pager')).toBeVisible();
  const chunksPagination = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(
      '.document-chunks-page > .kb-block-content',
    );
    const pagination = document.querySelector<HTMLElement>('.document-chunks-page .kb-pagination');
    return {
      contentBottom: content?.getBoundingClientRect().bottom ?? Number.NEGATIVE_INFINITY,
      paginationBottom: pagination?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
      paginationBackground: pagination ? getComputedStyle(pagination).backgroundColor : '',
    };
  });
  expect(chunksPagination.paginationBottom).toBeLessThanOrEqual(chunksPagination.contentBottom);
  expect(chunksPagination.paginationBackground).toBe('rgba(0, 0, 0, 0)');

  await page.goto('/system/usage');
  await expect(page.locator('.usage-filter-form')).toHaveCount(0);
  await page.locator('.usage-toolbar').getByRole('button', { name: '筛选' }).click();
  await expect(page.locator('.usage-filter-drawer')).toBeVisible();
  await expect(page.locator('.usage-filter-drawer').getByPlaceholder('开始时间')).toBeVisible();
  await expect(page.locator('.usage-filter-drawer').getByPlaceholder('结束时间')).toBeVisible();
  await expect(page.locator('.usage-filter-drawer').getByPlaceholder('开始时间')).toHaveCSS(
    'font-size',
    '16px',
  );
  await page.locator('.usage-filter-drawer').getByPlaceholder('开始时间').click();
  const usageDatePopper = page.locator('.usage-date-picker-popper:visible');
  await expect(usageDatePopper).toBeVisible();
  await expect(usageDatePopper).toHaveCSS('border-radius', '10px');
  const usageDatePresentation = await usageDatePopper.evaluate((popper) => {
    const drawer = document.querySelector<HTMLElement>('.usage-filter-drawer');
    const panel = popper.querySelector<HTMLElement>('.el-picker-panel');
    const content = popper.querySelector<HTMLElement>('.el-picker-panel__content');
    const bounds = popper.getBoundingClientRect();
    const panelBounds = panel?.getBoundingClientRect();
    const contentBounds = content?.getBoundingClientRect();
    const style = getComputedStyle(popper);
    return {
      isInsideDrawer: drawer?.contains(popper) ?? true,
      left: bounds.left,
      right: bounds.right,
      panelWidth: panelBounds?.width ?? 0,
      popperWidth: bounds.width,
      contentLeftGap: contentBounds && panelBounds ? contentBounds.left - panelBounds.left : -1,
      contentRightGap: contentBounds && panelBounds ? panelBounds.right - contentBounds.right : -1,
      background: style.backgroundColor,
      boxShadow: style.boxShadow,
    };
  });
  expect(usageDatePresentation.isInsideDrawer).toBe(false);
  expect(usageDatePresentation.left).toBeGreaterThanOrEqual(0);
  expect(usageDatePresentation.right).toBeLessThanOrEqual(375);
  expect(usageDatePresentation.popperWidth - usageDatePresentation.panelWidth).toBeLessThanOrEqual(
    2,
  );
  expect(usageDatePresentation.contentLeftGap).toBeCloseTo(
    usageDatePresentation.contentRightGap,
    0,
  );
  expect(usageDatePresentation.contentRightGap).toBeLessThanOrEqual(17);
  expect(usageDatePresentation.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(usageDatePresentation.boxShadow).not.toBe('none');
  await expect(usageDatePopper).toContainText('2026 年');
  await expect(usageDatePopper).toContainText('7 月');
  await expect(usageDatePopper.getByText('日', { exact: true })).toBeVisible();
  await expect(usageDatePopper.getByRole('button', { name: '此刻' })).toBeVisible();
  await expect(usageDatePopper.getByRole('button', { name: '确定' })).toBeVisible();

  await page.goto('/documents');
  await expect(page.locator('.documents-toolbar--mobile .el-input__inner')).toHaveCSS(
    'font-size',
    '16px',
  );
  await expect(page.locator('.kb-empty-state')).toHaveCSS('justify-content', 'center');
  await expect(page.locator('.kb-empty-state')).toHaveCSS('align-items', 'center');

  for (const path of ['/history', '/ingestion-jobs'] as const) {
    await page.goto(path);
    await expect(page.locator('.el-input__prefix')).toHaveCount(0);
  }

  await page.goto('/settings/providers');
  await expect(page.locator('.provider-toolbar')).toHaveCSS('flex-direction', 'row');
  await expect(
    page.locator('.provider-toolbar').getByRole('button', { name: '刷新状态' }),
  ).toBeVisible();
  expect(
    await page.locator('.provider-toolbar').evaluate((element) => element.clientHeight),
  ).toBeLessThanOrEqual(64);

  await page.goto('/system/status');
  await expect(page.locator('.system-status-toolbar')).toHaveCSS('flex-direction', 'row');
  await expect(
    page.locator('.system-status-toolbar').getByRole('button', { name: '重新检查' }),
  ).toBeVisible();
  expect(
    await page.locator('.system-status-toolbar').evaluate((element) => element.clientHeight),
  ).toBeLessThanOrEqual(64);

  await page.setViewportSize({ width: 620, height: 985 });
  await page.goto(`/documents/${documentId}`);
  await expect(page.locator('.app-main > section')).toBeVisible();
  await expect(page.getByText(documentId, { exact: true })).toBeVisible();
  const documentIdCopy = page.getByLabel(`复制文档 ID ${documentId}`);
  await expect(documentIdCopy).toHaveText(documentId);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await documentIdCopy.click();
  await expect(page.getByText('文档 ID 已复制')).toBeVisible();

  await page.goto('/settings/providers');
  await expect(page.locator('.provider-toolbar')).toBeVisible();
  await expect(page.locator('.provider-toolbar')).toHaveCSS('flex-direction', 'row');

  await page.setViewportSize({ width: 852, height: 393 });
  for (const path of pages) {
    await page.goto(path);
    await expect(page.locator('.app-main > section')).toBeVisible();
    const bounds = await page.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      mainScrollWidth: document.querySelector<HTMLElement>('.app-main')?.scrollWidth ?? 0,
      mainClientWidth: document.querySelector<HTMLElement>('.app-main')?.clientWidth ?? 0,
      headerHeight: document.querySelector<HTMLElement>('.app-header')?.clientHeight ?? 0,
    }));
    expect(bounds.bodyScrollWidth).toBeLessThanOrEqual(852);
    expect(bounds.mainScrollWidth).toBeLessThanOrEqual(bounds.mainClientWidth);
    expect(bounds.headerHeight).toBeGreaterThanOrEqual(44);
    expect(bounds.headerHeight).toBeLessThanOrEqual(56);
  }
});

test('fills and localizes the Mobile usage date picker popper', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await mockSession(page, ['system:read']);
  await page.route('**/v1/system/usage**', (route) =>
    route.fulfill({
      json: {
        from: '2026-06-22T00:00:00.000Z',
        to: '2026-07-22T00:00:00.000Z',
        totalQueries: 0,
        failureRate: null,
        queryP95Ms: null,
        providers: [],
        departments: [],
        usageCompleteness: 'request_only',
      },
    }),
  );

  await page.goto('/system/usage');
  await page.locator('.usage-toolbar').getByRole('button', { name: '筛选' }).click();
  await page.locator('.usage-filter-drawer').getByPlaceholder('开始时间').click();

  const popper = page.locator('.usage-date-picker-popper:visible');
  await expect(popper).toBeVisible();
  const layout = await popper.evaluate((root) => {
    const panel = root.querySelector<HTMLElement>('.el-picker-panel');
    const content = root.querySelector<HTMLElement>('.el-picker-panel__content');
    const rootBounds = root.getBoundingClientRect();
    const panelBounds = panel?.getBoundingClientRect();
    const contentBounds = content?.getBoundingClientRect();
    return {
      rootLeft: rootBounds.left,
      rootRight: rootBounds.right,
      rootWidth: rootBounds.width,
      panelWidth: panelBounds?.width ?? 0,
      contentLeftGap: contentBounds && panelBounds ? contentBounds.left - panelBounds.left : -1,
      contentRightGap: contentBounds && panelBounds ? panelBounds.right - contentBounds.right : -1,
    };
  });

  expect(layout.rootLeft).toBeGreaterThanOrEqual(0);
  expect(layout.rootRight).toBeLessThanOrEqual(375);
  expect(layout.rootWidth - layout.panelWidth).toBeLessThanOrEqual(2);
  expect(layout.contentLeftGap).toBeCloseTo(layout.contentRightGap, 0);
  expect(layout.contentRightGap).toBeLessThanOrEqual(17);
  await expect(popper.locator('.el-date-picker__header-label').first()).toContainText('年');
  await expect(popper.locator('.el-date-picker__header-label').nth(1)).toContainText('月');
  await expect(popper.getByText('日', { exact: true })).toBeVisible();
  await expect(popper.getByRole('button', { name: '此刻' })).toBeVisible();
  await expect(popper.getByRole('button', { name: '确定' })).toBeVisible();
  await expect(popper).not.toContainText('July');
  await expect(popper).not.toContainText('Sun');
});

test('keeps phone task steps compact and department cards grouped', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await mockSession(page, ['documents:read', 'access:read', 'access:write']);
  const baseJob = {
    id: '11111111-1111-4111-8111-111111111111',
    documentId: '22222222-2222-4222-8222-222222222222',
    sourceName: '移动端超长文档名称-智能化平面图20201203.dwg',
    mimeType: 'text/markdown',
    version: 1,
    kind: 'ingestion',
    status: 'completed',
    step: 'completed',
    checkpoint: 'completed',
    attempts: 1,
    traceId: '33333333-3333-4333-8333-333333333333',
    parserVersion: '1.0',
    embeddingFingerprint: null,
    embeddingCompletedChunks: 1,
    embeddingTotalChunks: 1,
    embeddingBatchSize: 16,
    warnings: [],
    errorCode: null,
    errorCategory: null,
    retryable: false,
    startedAt: '2026-07-22T09:00:00.000Z',
    completedAt: '2026-07-22T09:01:00.000Z',
    createdAt: '2026-07-22T09:00:00.000Z',
    updatedAt: '2026-07-22T09:01:00.000Z',
  };
  await page.route('**/v1/ingestion-jobs**', (route) =>
    route.fulfill({
      json: {
        items: [
          baseJob,
          {
            ...baseJob,
            id: '41111111-1111-4111-8111-111111111111',
            documentId: '42222222-2222-4222-8222-222222222222',
            sourceName: '进行中任务.docx',
            status: 'embedding',
            step: 'embedding',
            checkpoint: 'policy_check',
            embeddingCompletedChunks: 8,
            embeddingTotalChunks: 20,
            completedAt: null,
          },
          {
            ...baseJob,
            id: '51111111-1111-4111-8111-111111111111',
            documentId: '52222222-2222-4222-8222-222222222222',
            sourceName: '失败任务.pdf',
            status: 'failed',
            step: 'parsing',
            checkpoint: 'queued',
            embeddingCompletedChunks: 0,
            embeddingTotalChunks: null,
            errorCode: 'PARSER_FAILED',
            errorCategory: 'parser',
            retryable: true,
            completedAt: '2026-07-22T09:00:30.000Z',
          },
        ],
        page: 1,
        pageSize: 20,
        total: 28,
      },
    }),
  );
  await page.route('**/v1/access/departments', (route) =>
    route.fulfill({
      json: {
        scope: 'tenant',
        departments: ['finance', 'general', 'platform'].map((department, index) => ({
          department,
          allowedSensitivities: ['public', 'internal'],
          userCount: index + 1,
          documentCount: index + 2,
          managed: true,
          updatedAt: '2026-07-22T09:00:00.000Z',
        })),
      },
    }),
  );

  await page.goto('/ingestion-jobs');
  const completedCard = page.locator('.task-card').filter({ hasText: '移动端超长文档名称' });
  const runningCard = page.locator('.task-card').filter({ hasText: '进行中任务.docx' });
  const failedCard = page.locator('.task-card').filter({ hasText: '失败任务.pdf' });
  await expect(completedCard.locator('.task-summary')).toHaveAttribute('aria-expanded', 'false');
  await expect(completedCard.locator('.task-progress-dot')).toHaveCount(7);
  await expect(completedCard.locator('.task-details')).toHaveCount(0);
  await expect(runningCard.locator('.task-summary')).toHaveAttribute('aria-expanded', 'true');
  await expect(runningCard.locator('.task-steps')).toBeVisible();
  await expect(failedCard.locator('.task-summary')).toHaveAttribute('aria-expanded', 'true');
  await expect(failedCard.locator('.task-error')).toBeVisible();
  const mobileWidths = await page.evaluate(() => {
    return ['.page > .kb-block-content', '.task-list', '.task-summary'].map((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      return {
        selector,
        clientWidth: element?.clientWidth ?? 0,
        scrollWidth: element?.scrollWidth ?? Number.POSITIVE_INFINITY,
      };
    });
  });
  expect(mobileWidths.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth)).toBe(
    true,
  );

  await completedCard.locator('.task-summary').press('Space');
  await expect(completedCard.locator('.task-steps')).toBeVisible();
  const taskStepsHeight = await completedCard
    .locator('.task-steps')
    .evaluate((element) => Math.round(element.getBoundingClientRect().height));
  expect(taskStepsHeight).toBeLessThan(360);

  await page.setViewportSize({ width: 768, height: 887 });
  const padStepScroll = await runningCard.locator('.task-steps-scroll').evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    clientWidth: element.clientWidth,
    firstStepLeft:
      element.querySelector<HTMLElement>('.el-step')?.getBoundingClientRect().left ??
      Number.NEGATIVE_INFINITY,
    left: element.getBoundingClientRect().left,
    scrollLeft: element.scrollLeft,
    scrollWidth: element.scrollWidth,
  }));
  expect(padStepScroll.scrollWidth).toBeGreaterThanOrEqual(padStepScroll.clientWidth);
  expect(padStepScroll.scrollLeft).toBe(0);
  expect(padStepScroll.firstStepLeft).toBeGreaterThanOrEqual(padStepScroll.left);
  expect(padStepScroll.background).not.toBe('rgba(0, 0, 0, 0)');

  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto('/access/departments');
  await expect(page.locator('.kb-collapse-list .el-collapse-item')).toHaveCount(3);
  await page.getByText('finance', { exact: true }).click();
  await expect(page.getByRole('button', { name: '保存权限' })).toBeVisible();
  await expect(page.locator('.el-drawer').filter({ hasText: '部门权限' })).toHaveCount(0);
  const departmentHeaders = await page.evaluate(() => {
    return Array.from(
      document.querySelectorAll<HTMLElement>('.kb-collapse-list .el-collapse-item__header'),
    ).map((header) => Math.round(header.getBoundingClientRect().height));
  });
  expect(departmentHeaders.every((height) => height < 110)).toBe(true);
});

test('keeps landscape mobile controls aligned and management content scrollable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 667, height: 393 });
  await mockSession(page, ['access:read', 'access:write', 'audit:read', 'system:read']);
  const departments = Array.from({ length: 12 }, (_, index) => ({
    department: `department-${index + 1}`,
    allowedSensitivities: ['public', 'internal'],
    userCount: index + 1,
    documentCount: index + 2,
    managed: true,
    updatedAt: '2026-07-22T09:00:00.000Z',
  }));
  await page.route('**/v1/access/users**', (route) =>
    route.fulfill({
      json: {
        users: Array.from({ length: 12 }, (_, index) => ({
          userId: `user-${index + 1}`,
          username: null,
          department: `department-${index + 1}`,
          roles: ['user'],
          roleSource: 'managed',
          status: 'observed',
          lastAuthenticatedAt: '2026-07-22T09:00:00.000Z',
        })),
        total: 12,
        offset: 0,
        limit: 25,
        scope: 'tenant',
      },
    }),
  );
  await page.route('**/v1/access/departments', (route) =>
    route.fulfill({ json: { scope: 'tenant', departments } }),
  );
  await page.route('**/v1/history/conversations**', (route) =>
    route.fulfill({ json: { conversations: [], total: 0, offset: 0, limit: 20 } }),
  );
  await page.route('**/v1/system/usage**', (route) =>
    route.fulfill({
      json: {
        from: '2026-06-22T00:00:00.000Z',
        to: '2026-07-22T00:00:00.000Z',
        totalQueries: 138,
        failureRate: 0.13,
        queryP95Ms: 5388,
        providers: [
          {
            kind: 'embedding',
            provider: 'ollama',
            model: 'bge-m3:latest',
            requests: 123,
            failures: 0,
            inputTokens: null,
            outputTokens: null,
            estimatedCostUsd: null,
          },
          {
            kind: 'llm',
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            requests: 2,
            failures: 0,
            inputTokens: null,
            outputTokens: null,
            estimatedCostUsd: null,
          },
        ],
        departments: departments.map((department) => ({
          department: department.department,
          requests: department.userCount,
        })),
        usageCompleteness: 'request_only',
      },
    }),
  );
  await page.route('**/v1/system/providers', (route) =>
    route.fulfill({
      json: {
        providers: [],
        syntheticCheck: { status: 'not_configured', checkedAt: null },
      },
    }),
  );
  await page.route('**/v1/system/status', (route) =>
    route.fulfill({
      json: {
        status: 'ready',
        checkedAt: '2026-07-22T09:00:00.000Z',
        rawDocsDiskUsageRatio: 0,
        components: [],
        ingestionQueue: {
          status: 'up',
          waiting: null,
          active: null,
          delayed: null,
          failed: null,
          oldestWaitSeconds: null,
        },
      },
    }),
  );
  await page.route('**/v1/audit/events', (route) =>
    route.fulfill({ json: { events: [], nextBefore: null, total: 0 } }),
  );

  await page.goto('/access/users');
  await expect(page.getByText('user-1', { exact: true })).toBeVisible();
  const userScroll = await page.locator('.page > .kb-block-content--gap').evaluate((element) => {
    const candidates = [
      element.querySelector<HTMLElement>('.access-table-wrap'),
      ...element.querySelectorAll<HTMLElement>('.access-table-wrap .el-scrollbar__wrap'),
    ].filter((candidate): candidate is HTMLElement => candidate !== null);
    const scrollTarget = candidates.find(
      (candidate) => candidate.scrollHeight > candidate.clientHeight,
    );
    if (scrollTarget) scrollTarget.scrollTop = 160;
    return {
      canScroll: scrollTarget !== undefined,
      scrollTop: scrollTarget?.scrollTop ?? 0,
      outerOverflowY: getComputedStyle(element).overflowY,
    };
  });
  expect(userScroll).toMatchObject({
    canScroll: true,
    outerOverflowY: 'hidden',
  });
  expect(userScroll.scrollTop).toBeGreaterThan(0);

  await page.goto('/access/departments');
  await expect(page.getByText('department-1', { exact: true })).toBeVisible();
  const departmentScroll = await page.locator('.department-layout').evaluate((element) => {
    const scrollTarget = element;
    const canScroll = scrollTarget.scrollHeight > scrollTarget.clientHeight;
    if (scrollTarget) scrollTarget.scrollTop = 160;
    return { canScroll, scrollTop: scrollTarget?.scrollTop ?? 0 };
  });
  expect(departmentScroll.canScroll).toBe(true);
  expect(departmentScroll.scrollTop).toBeGreaterThan(0);

  await page.goto('/history');
  const historyResetPosition = await page.locator('.history-toolbar').evaluate((element) => {
    const button = element.querySelector<HTMLElement>('.filter-actions .el-button:last-child');
    const toolbarBounds = element.getBoundingClientRect();
    const buttonBounds = button?.getBoundingClientRect();
    return {
      toolbarRight: toolbarBounds.right,
      buttonRight: buttonBounds?.right ?? Number.NEGATIVE_INFINITY,
      buttonTop: buttonBounds?.top ?? Number.NEGATIVE_INFINITY,
      toolbarTop: toolbarBounds.top,
    };
  });
  expect(historyResetPosition.buttonRight).toBeGreaterThan(historyResetPosition.toolbarRight - 20);
  expect(historyResetPosition.buttonTop).toBeGreaterThanOrEqual(historyResetPosition.toolbarTop);

  await page.getByRole('button', { name: '打开导航菜单' }).click();
  await expect(page.getByRole('navigation', { name: '移动端主导航' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/system/usage');
  await expect(page.getByText('ollama / bge-m3:latest')).toBeVisible();
  const usageLayout = await page.evaluate(() => {
    const intro = document.querySelector<HTMLElement>('.usage-toolbar');
    const filter = intro?.querySelector<HTMLElement>('.filter-trigger');
    const content = document.querySelector<HTMLElement>('.page > .page-content');
    const introBounds = intro?.getBoundingClientRect();
    const filterBounds = filter?.getBoundingClientRect();
    if (content) {
      const spacer = document.createElement('div');
      spacer.style.height = '800px';
      spacer.style.flex = '0 0 800px';
      spacer.setAttribute('aria-hidden', 'true');
      content.append(spacer);
      content.scrollTop = 160;
    }
    return {
      introHeight: introBounds?.height ?? Number.POSITIVE_INFINITY,
      filterRight: filterBounds?.right ?? Number.NEGATIVE_INFINITY,
      introRight: introBounds?.right ?? Number.POSITIVE_INFINITY,
      canScroll: (content?.scrollHeight ?? 0) > (content?.clientHeight ?? 0),
      scrollTop: content?.scrollTop ?? 0,
    };
  });
  expect(usageLayout.introHeight).toBeLessThanOrEqual(56);
  expect(usageLayout.filterRight).toBeGreaterThan(usageLayout.introRight - 20);
  expect(usageLayout.canScroll).toBe(true);
  expect(usageLayout.scrollTop).toBeGreaterThan(0);

  for (const [path, intro, actionName] of [
    ['/settings/providers', '.provider-toolbar', '刷新状态'],
    ['/system/status', '.system-status-toolbar', '重新检查'],
  ] as const) {
    await page.goto(path);
    const introLayout = await page.locator(intro).evaluate((element, name) => {
      const action = Array.from(element.querySelectorAll<HTMLElement>('button')).find(
        (button) => button.textContent?.trim() === name,
      );
      const introBounds = element.getBoundingClientRect();
      const actionBounds = action?.getBoundingClientRect();
      return {
        height: introBounds.height,
        actionRight: actionBounds?.right ?? Number.NEGATIVE_INFINITY,
        introRight: introBounds.right,
      };
    }, actionName);
    expect(introLayout.height).toBeLessThanOrEqual(60);
    expect(introLayout.actionRight).toBeGreaterThan(introLayout.introRight - 20);
  }

  await page.goto('/audit');
  const auditToolbar = page.locator('.audit-toolbar');
  await expect(auditToolbar.locator('.audit-type-filter')).toContainText('全部事件类型');
  await expect(auditToolbar.getByRole('button', { name: '重置' })).toBeVisible();
  await expect(page.locator('.mobile-filter-drawer')).toHaveCount(0);
});

test('keeps Mobile access and department surface blocks independently scrollable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 667, height: 393 });
  await mockSession(page, ['access:read', 'access:write']);
  const departments = Array.from({ length: 12 }, (_, index) => ({
    department: `department-${index + 1}`,
    allowedSensitivities: ['public', 'internal'],
    userCount: index + 1,
    documentCount: index + 2,
    managed: true,
    updatedAt: '2026-07-22T09:00:00.000Z',
  }));
  await page.route('**/v1/access/users**', (route) =>
    route.fulfill({
      json: {
        users: departments.map((department, index) => ({
          userId: `user-${index + 1}`,
          username: null,
          department: department.department,
          roles: ['user'],
          roleSource: 'managed',
          status: 'observed',
          lastAuthenticatedAt: '2026-07-22T09:00:00.000Z',
        })),
        total: departments.length,
        offset: 0,
        limit: 25,
        scope: 'tenant',
      },
    }),
  );
  await page.route('**/v1/access/departments', (route) =>
    route.fulfill({ json: { scope: 'tenant', departments } }),
  );

  const scrollBlock = async (selector: string) =>
    page.locator(selector).evaluate((element) => {
      const canScroll = element.scrollHeight > element.clientHeight;
      element.scrollTop = 160;
      return {
        canScroll,
        overflowY: getComputedStyle(element).overflowY,
        scrollTop: element.scrollTop,
      };
    });

  await page.goto('/access/users');
  const userScroll = await scrollBlock('.access-table-wrap');
  expect(userScroll).toMatchObject({ canScroll: true, overflowY: 'auto' });
  expect(userScroll.scrollTop).toBeGreaterThan(0);

  await page.goto('/access/departments');
  const departmentScroll = await scrollBlock('.department-layout');
  expect(departmentScroll).toMatchObject({ canScroll: true, overflowY: 'auto' });
  expect(departmentScroll.scrollTop).toBeGreaterThan(0);
});

test('uses a department select and shared collapse list in user management', async ({ page }) => {
  const departments = ['finance', 'engineering'].map((department, index) => ({
    department,
    allowedSensitivities: ['public', 'internal'],
    userCount: index + 1,
    documentCount: index + 2,
    managed: true,
    updatedAt: '2026-07-22T09:00:00.000Z',
  }));
  await mockSession(page, ['access:read', 'access:write']);
  await page.route('**/v1/access/users**', (route) =>
    route.fulfill({
      json: {
        users: Array.from({ length: 24 }, (_, index) => ({
          userId: `user-finance-${index + 1}`,
          username: `finance.user.${index + 1}`,
          department: 'finance',
          roles: ['user'],
          roleSource: 'managed',
          status: 'active',
          lastAuthenticatedAt: '2026-07-22T09:00:00.000Z',
        })),
        total: 24,
        offset: 0,
        limit: 25,
        scope: 'tenant',
      },
    }),
  );
  await page.route('**/v1/access/departments', (route) =>
    route.fulfill({ json: { scope: 'tenant', departments } }),
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/access/users');
  await expect(page.locator('.access-toolbar .el-select')).toBeVisible();

  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto('/access/users');
  await expect(page.locator('.desktop-data-table')).toHaveCount(0);
  await expect(page.locator('.kb-collapse-list .el-collapse-item')).toHaveCount(24);
  await expect(page.locator('.access-table-wrap')).toHaveClass(/kb-block/);
  await expect(page.locator('.access-table-wrap')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await expect(page.locator('.access-table-wrap')).toHaveCSS('border-top-width', '1px');
  await expect(page.locator('.access-table-wrap > .kb-collapse-list')).toHaveCSS(
    'border-top-width',
    '0px',
  );
  const mobileListMetrics = await page.locator('.access-table-wrap').evaluate((element) => {
    element.scrollTop = 160;
    return {
      clientHeight: element.clientHeight,
      flexGrow: getComputedStyle(element).flexGrow,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    };
  });
  expect(mobileListMetrics.flexGrow).toBe('1');
  expect(mobileListMetrics.overflowY).toBe('auto');
  expect(mobileListMetrics.scrollHeight).toBeGreaterThanOrEqual(mobileListMetrics.clientHeight);
  expect(mobileListMetrics.scrollTop).toBeGreaterThan(0);
  await page.getByPlaceholder('搜索用户 ID').fill('admin');
  await page.getByRole('button', { name: '筛选' }).click();
  const userFilterDrawer = page
    .locator('.mobile-filter-drawer')
    .filter({ hasText: '筛选用户目录' });
  await expect(userFilterDrawer.locator('.el-select')).toBeVisible();
  await userFilterDrawer.locator('.el-select').click();
  await expect(page.getByText('finance', { exact: true }).last()).toBeVisible();
  await page.getByText('finance', { exact: true }).last().click();
  const userFilterTrigger = page.locator('.access-toolbar--mobile .filter-trigger');
  await expect(userFilterTrigger).toHaveClass(/is-active/);
  expect(
    await userFilterTrigger.evaluate((button) => getComputedStyle(button, '::after').content),
  ).toBe('""');
  await userFilterDrawer.getByRole('button', { name: '重置', exact: true }).click();
  await expect(userFilterDrawer).toBeHidden();
  await expect(page.getByPlaceholder('搜索用户 ID')).toHaveValue('');

  await page.goto('/access/departments');
  await expect(page.locator('.kb-collapse-list .el-collapse-item')).toHaveCount(2);
  await expect(page.locator('.department-layout')).toHaveClass(/kb-block/);
  await expect(page.locator('.department-layout')).toHaveCSS('border-top-width', '1px');
  await expect(page.locator('.department-layout > .kb-collapse-list')).toHaveCSS(
    'border-top-width',
    '0px',
  );
  await expect(page.locator('.department-layout')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
});

test('renders document rows as touch-friendly cards at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await mockSession(page, ['documents:read', 'documents:write']);
  await page.route('**/v1/documents?**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
            sourceName: '移动端验收制度.md',
            mimeType: 'text/markdown',
            department: 'finance',
            sensitivity: 'internal',
            ownerId: 'admin.fixture',
            status: 'active',
            activeVersion: 2,
            latestJob: null,
            createdAt: '2026-07-22T09:00:00.000Z',
            updatedAt: '2026-07-22T09:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: 20,
        total: 28,
      },
    }),
  );
  await page.route('**/v1/documents/upload-options', (route) =>
    route.fulfill({
      json: {
        maxUploadBytes: 50 * 1024 * 1024,
        acceptedExtensions: ['txt', 'md', 'docx', 'xlsx', 'dxf', 'dwg'],
        department: 'platform',
        allowedSensitivities: ['public', 'internal'],
        defaultSensitivity: 'internal',
        dwgConversionEnabled: true,
      },
    }),
  );
  await page.goto('/documents');
  await expect(page.getByRole('article')).toContainText('移动端验收制度.md');
  await expect(page.locator('.kb-block-list > .kb-block')).toBeVisible();
  await expect(page.locator('.desktop-data-table')).toHaveCount(0);
  await expect(page.locator('.kb-pagination')).toBeVisible();
  const filterButton = page.getByRole('button', { name: '筛选' });
  expect(await filterButton.count()).toBe(1);
  await page.setViewportSize({ width: 425, height: 877 });
  await page.getByRole('button', { name: '上传文档' }).click();
  const uploadDrawer = page.locator('.upload-drawer.el-drawer');
  await expect(uploadDrawer).toBeVisible();
  const filePicker = uploadDrawer.getByRole('button', { name: '选择文件', exact: true });
  await expect(filePicker).toBeVisible();
  await expect(uploadDrawer.getByText('选择或拖入文件', { exact: true })).toHaveCount(0);
  const pickerLayout = await uploadDrawer.evaluate((drawer) => {
    const picker = drawer.querySelector<HTMLElement>('.upload-picker .el-upload');
    const tip = drawer.querySelector<HTMLElement>('.upload-picker .el-upload__tip');
    const pickerBounds = picker?.getBoundingClientRect();
    const body = drawer.querySelector<HTMLElement>('.el-drawer__body');
    const footer = drawer.querySelector<HTMLElement>('.el-drawer__footer');
    return {
      pickerText: picker?.textContent?.trim() ?? '',
      drawerWidth: drawer.getBoundingClientRect().width,
      pickerWidth: pickerBounds?.width ?? 0,
      pickerHeight: Math.round(pickerBounds?.height ?? 0),
      pickerBackground: picker ? getComputedStyle(picker).backgroundColor : '',
      tipCount: tip ? 1 : 0,
      bodyOverflowY: body ? getComputedStyle(body).overflowY : '',
      footerBottomDelta: footer
        ? Math.abs(footer.getBoundingClientRect().bottom - drawer.getBoundingClientRect().bottom)
        : Infinity,
    };
  });
  expect(pickerLayout.pickerText).toBe('选择文件');
  expect(pickerLayout.pickerWidth).toBeGreaterThanOrEqual(100);
  expect(pickerLayout.pickerWidth).toBeLessThan(pickerLayout.drawerWidth);
  expect(pickerLayout.pickerHeight).toBe(44);
  expect(pickerLayout.pickerBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(pickerLayout.tipCount).toBe(0);
  expect(pickerLayout.bodyOverflowY).toBe('auto');
  expect(pickerLayout.footerBottomDelta).toBeLessThanOrEqual(1);
  const uploadBounds = await uploadDrawer.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { width: Math.round(bounds.width), height: Math.round(bounds.height) };
  });
  expect(uploadBounds.width).toBe(425);
  expect(uploadBounds.height).toBe(789);
  await expectAdjacentButtonsUseParentGap(page, '.upload-drawer .el-drawer__footer');
  await uploadDrawer.locator('input[type="file"]').setInputFiles({
    name: '项目排期表.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('safe mobile fixture'),
  });
  await expect(uploadDrawer.locator('.upload-file-list .is-pending')).toContainText(
    '项目排期表.xlsx',
  );
  await expect(uploadDrawer.locator('.upload-file-list .is-pending')).toContainText('待上传');
  await expect(uploadDrawer.getByRole('button', { name: '开始上传' })).toBeVisible();
  await uploadDrawer.getByRole('button', { name: '取消' }).click();
  await page.setViewportSize({ width: 375, height: 900 });
  await filterButton.click();
  const filterDrawer = page.locator('.el-drawer').filter({ hasText: '筛选文档' });
  await expect(filterDrawer).toBeVisible();
  const filterDrawerHeight = await filterDrawer.evaluate((drawer) =>
    Math.round(drawer.getBoundingClientRect().height),
  );
  expect(filterDrawerHeight).toBeGreaterThanOrEqual(300);
  expect(filterDrawerHeight).toBeLessThan(648);
  await filterDrawer.getByText('状态', { exact: true }).click();
  const filterPopper = page.locator('.el-select__popper').filter({ visible: true });
  await expect(filterPopper).toBeVisible();
  const filterOverlay = page.locator('.el-overlay').filter({ has: filterDrawer });
  const zIndexes = await Promise.all([
    filterOverlay.evaluate((element) => Number(getComputedStyle(element).zIndex)),
    filterPopper.evaluate((element) => Number(getComputedStyle(element).zIndex)),
  ]);
  expect(zIndexes[1]).toBeGreaterThan(zIndexes[0]);
});

test('uses explicit page and inner-panel scroll models across management pages', async ({
  page,
}) => {
  const documentId = '6769af9a-a4d0-4dc2-a97d-942584a9c826';
  await page.setViewportSize({ width: 375, height: 900 });
  await mockSession(page, ['documents:read', 'audit:read', 'access:read', 'system:read']);
  await page.route('**/v1/documents?**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  await page.route(`**/v1/documents/${documentId}/chunks?**`, (route) =>
    route.fulfill({
      json: {
        documentId,
        sourceName: '制度.md',
        documentVersion: 1,
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      },
    }),
  );
  await page.route(`**/v1/documents/${documentId}`, (route) =>
    route.fulfill({
      json: {
        id: documentId,
        sourceName: '制度.md',
        mimeType: 'text/markdown',
        department: 'platform',
        sensitivity: 'internal',
        ownerId: 'admin.fixture',
        activeVersion: 1,
        status: 'active',
        versions: [],
        createdAt: '2026-07-22T09:00:00.000Z',
        updatedAt: '2026-07-22T09:00:00.000Z',
      },
    }),
  );
  await page.route('**/v1/audit/events**', (route) =>
    route.fulfill({ json: { events: [], nextBefore: null, total: 0 } }),
  );
  await page.route('**/v1/ingestion-jobs**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  await page.route('**/v1/access/users**', (route) =>
    route.fulfill({
      json: { users: [], total: 0, offset: 0, limit: 25, scope: 'tenant' },
    }),
  );
  await page.route('**/v1/system/status', (route) =>
    route.fulfill({
      json: {
        status: 'ready',
        checkedAt: '2026-07-22T09:00:00.000Z',
        rawDocsDiskUsageRatio: 0,
        components: [],
        ingestionQueue: {
          status: 'up',
          waiting: 0,
          active: 0,
          delayed: 0,
          failed: 0,
          oldestWaitSeconds: null,
        },
      },
    }),
  );

  async function contentPanelMetrics(panelSelector: string, scrollSelector: string) {
    return page.locator(panelSelector).evaluate((panel, innerSelector) => {
      const scroll = panel.querySelector<HTMLElement>(innerSelector);
      const empty = panel.querySelector<HTMLElement>('.kb-empty-state');
      const panelStyle = getComputedStyle(panel);
      const scrollStyle = scroll ? getComputedStyle(scroll) : null;
      return {
        background: panelStyle.backgroundColor,
        borderRadius: panelStyle.borderRadius,
        borderWidth: panelStyle.borderTopWidth,
        flexGrow: panelStyle.flexGrow,
        overflow: panelStyle.overflow,
        padding: panelStyle.padding,
        scrollFlexGrow: scrollStyle?.flexGrow ?? '',
        scrollOverflowY: scrollStyle?.overflowY ?? '',
        scrollPadding: scrollStyle?.padding ?? '',
        emptyFlexGrow: empty ? getComputedStyle(empty).flexGrow : '',
      };
    }, scrollSelector);
  }

  await page.goto('/documents');
  const documentsPanel = page.locator('.kb-block-content--mobile-inset');
  await expect(documentsPanel).toHaveClass(/kb-block-content/);
  await expect(documentsPanel).toHaveClass(/kb-block-content--mobile-inset/);
  await expect(documentsPanel).not.toHaveClass(/(^|\s)kb-block(\s|$)/);
  await expect(documentsPanel.locator(':scope > .kb-block-scroll')).toHaveClass(/kb-block--flush/);
  const documentsMetrics = await contentPanelMetrics(
    '.kb-block-content--mobile-inset',
    '.kb-block-scroll',
  );

  await page.goto('/audit');
  const auditPanel = page.locator('.kb-block-content--mobile-inset');
  await expect(auditPanel).toHaveClass(/kb-block-content/);
  await expect(auditPanel).toHaveClass(/kb-block-content--mobile-inset/);
  await expect(auditPanel).not.toHaveClass(/(^|\s)kb-block(\s|$)/);
  await expect(auditPanel.locator(':scope > .kb-block-scroll')).toHaveClass(/kb-block--flush/);
  const auditMetrics = await contentPanelMetrics(
    '.kb-block-content--mobile-inset',
    '.kb-block-scroll',
  );

  expect(auditMetrics).toEqual(documentsMetrics);
  expect(auditMetrics).toMatchObject({
    flexGrow: '1',
    overflow: 'hidden',
    padding: '0px',
    scrollFlexGrow: '1',
    scrollOverflowY: 'auto',
    emptyFlexGrow: '1',
  });

  for (const [path, contentSelector, scrollSelector] of [
    ['/ingestion-jobs', '.page > .kb-block-content', '.task-list'],
    [
      `/documents/${documentId}/chunks`,
      '.document-chunks-page > .kb-block-content',
      '.document-chunks-page > .kb-block-content > .kb-block-scroll',
    ],
    ['/access/users', '.page > .kb-block-content--gap', '.access-table-wrap'],
  ] as const) {
    await page.goto(path);
    await expect(page.locator(contentSelector)).toHaveClass(/kb-block-content/);
    await expect(page.locator(scrollSelector)).toHaveClass(/kb-block-scroll/);
    await expect(page.locator(contentSelector)).not.toHaveClass(/kb-block-content--mobile-inset/);
    await expect(page.locator(scrollSelector)).toHaveCSS('overflow-y', 'auto');
    await expect(page.locator(scrollSelector)).toHaveCSS('padding', '0px');
  }

  await page.goto('/system/status');
  const systemContent = page.locator('.system-status-toolbar + .page-content');
  await expect(systemContent).not.toHaveClass(/kb-block-content/);
  await expect(systemContent).toHaveCSS('overflow-y', 'auto');
});

test('keeps every grouped entry reachable in the collapsible mobile sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await mockSession(page, ['documents:read', 'audit:read', 'access:read', 'system:read']);
  await page.goto('/ask');
  await expect(page.locator('.app-sidebar')).toBeHidden();
  await expect(page.locator('.mobile-tabbar')).toHaveCount(0);
  await expect(page.locator('.app-main')).toHaveCSS('bottom', '0px');
  await page.getByRole('button', { name: '打开导航菜单' }).click();
  const mobileNavigation = page.getByRole('navigation', { name: '移动端主导航' });
  await expect(mobileNavigation).toBeVisible();
  await expect(mobileNavigation.locator('.navigation-label')).toHaveText([
    '问答',
    '知识库',
    '安全与权限',
    '系统',
  ]);
  const mobileIdentity = page.locator('.mobile-sidebar-identity');
  await expect(mobileIdentity.locator('.mobile-sidebar-identity__user')).toHaveText(
    'admin.fixture',
  );
  await expect(mobileIdentity.locator('.mobile-sidebar-identity__context')).toHaveText('platform');
  await expect(page.getByRole('button', { name: '关闭导航菜单' })).toBeVisible();
  await expectOverlayCloseHasSharedBorder(page, '.mobile-sidebar-close');
  await expect(mobileNavigation.getByRole('link', { name: '知识问答' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: '问答历史' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: '文档管理' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: '入库任务' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: '审计中心' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: '用户与角色' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: '部门权限' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: '模型 Provider' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: '用量与成本' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: '系统状态' })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.mobile-navigation-drawer')
        .evaluate((element) => Math.round(element.getBoundingClientRect().left)),
    )
    .toBe(0);
  const drawerPresentation = await page.evaluate(() => {
    const drawer = document.querySelector<HTMLElement>('.mobile-navigation-drawer');
    const firstEntry = document.querySelector<HTMLElement>('.mobile-sidebar-navigation a');
    return {
      drawerBackground: drawer ? getComputedStyle(drawer).backgroundColor : '',
      drawerLeft: drawer?.getBoundingClientRect().left ?? Number.NEGATIVE_INFINITY,
      drawerWidth: drawer?.getBoundingClientRect().width ?? 0,
      entryBackground: firstEntry ? getComputedStyle(firstEntry).backgroundColor : '',
      entryRadius: firstEntry ? getComputedStyle(firstEntry).borderRadius : '',
    };
  });
  expect(drawerPresentation.drawerLeft).toBe(0);
  expect(drawerPresentation.drawerWidth).toBeLessThanOrEqual(280);
  expect(drawerPresentation.drawerWidth).toBeGreaterThan(240);
  expect(drawerPresentation.drawerBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(drawerPresentation.entryBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(Number.parseFloat(drawerPresentation.entryRadius)).toBeGreaterThanOrEqual(8);
  const identityPresentation = await page.evaluate(() => {
    const brand = document.querySelector<HTMLElement>('.mobile-sidebar-brand');
    const identity = document.querySelector<HTMLElement>('.mobile-sidebar-identity');
    const user = document.querySelector<HTMLElement>('.mobile-sidebar-identity__user');
    return {
      brandBottom: brand?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
      identityTop: identity?.getBoundingClientRect().top ?? Number.NEGATIVE_INFINITY,
      userFits: user ? user.scrollWidth <= user.clientWidth : false,
    };
  });
  expect(identityPresentation.identityTop).toBeGreaterThan(identityPresentation.brandBottom);
  expect(identityPresentation.userFits).toBe(true);
  await page.getByRole('button', { name: '关闭导航菜单' }).click();
  await expect(mobileNavigation).toBeHidden();
});

test('uses title-free Pad navigation tooltips and keeps the sidebar vertically scrollable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 933 });
  await mockSession(page, ['documents:read', 'audit:read', 'access:read', 'system:read']);
  await page.goto('/ask');
  await expect(page.locator('.app-sidebar')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航分组' })).toBeVisible();
  await expect(page.locator('.tablet-group-navigation > .tablet-navigation-group')).toHaveCount(4);
  await expect(
    page.locator('.tablet-group-navigation > .tablet-navigation-group > .tablet-navigation-link'),
  ).toHaveCount(10);
  const closedRail = await page.locator('.tablet-group-navigation').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollLeft: element.scrollLeft,
    scrollWidth: element.scrollWidth,
  }));
  expect(closedRail.scrollLeft).toBe(0);
  expect(closedRail.scrollWidth).toBeLessThanOrEqual(closedRail.clientWidth);
  await page.locator('.tablet-navigation-link[aria-label="系统状态"]').hover();
  await expect(page.getByRole('tooltip')).toHaveText('系统状态');
  await expect(page.locator('.tablet-group-title')).toHaveCount(0);
  await expect(page.locator('.tablet-group-flyout')).toHaveCount(0);

  await page.locator('.tablet-navigation-link[aria-label="系统状态"]').click();
  await expect(page).toHaveURL(/\/system\/status$/);
  await expect(page.locator('.tablet-group-flyout')).toHaveCount(0);

  await page.setViewportSize({ width: 900, height: 360 });
  const sidebar = page.locator('.app-sidebar');
  const sidebarScroll = await sidebar.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  expect(sidebarScroll.overflowY).toBe('auto');
  expect(sidebarScroll.scrollHeight).toBeGreaterThan(sidebarScroll.clientHeight);
  await sidebar.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect.poll(() => sidebar.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test('keeps the complete desktop navigation and document table at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSession(page, ['documents:read']);
  await page.route('**/v1/documents?**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  await page.goto('/documents');
  await expect(page.locator('.app-sidebar')).toBeVisible();
  await expect(page.locator('.navigation-label')).toHaveText(['问答', '知识库']);
  await expect(page.getByRole('button', { name: '折叠侧栏' })).toHaveCount(0);
  await expect(page.locator('.kb-empty-state')).toBeVisible();
  await expect(page.locator('.desktop-data-table')).toHaveCount(0);
  await expect(page.locator('.document-card-list')).toHaveCount(0);
});

test('keeps document filters within the reduced desktop content width', async ({ page }) => {
  await page.setViewportSize({ width: 1326, height: 985 });
  await mockSession(page, ['documents:read', 'documents:write']);
  await page.route('**/v1/documents?**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  await page.goto('/documents');
  await expect(page.locator('.document-filters')).toBeVisible();
  const filterBounds = await page.locator('.document-filters').evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(filterBounds.scrollWidth).toBeLessThanOrEqual(filterBounds.clientWidth);
});

test('uses the history-style three-tier document toolbar', async ({ page }) => {
  await mockSession(page, ['documents:read', 'documents:write']);
  await page.route('**/v1/documents?**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/documents');
  await expect(page.locator('.kb-empty-state .el-empty__image')).toBeVisible();
  const desktop = await page.locator('.documents-toolbar').evaluate((toolbar) => {
    const controls = Array.from(
      toolbar.querySelectorAll<HTMLElement>(
        '.el-input, .el-select, .filter-actions, .documents-upload-action',
      ),
    ).map((control) => control.getBoundingClientRect());
    const inputWrapper = toolbar.querySelector<HTMLElement>('.el-input__wrapper');
    return {
      tops: controls.map((control) => Math.round(control.top)),
      controlHeight: inputWrapper?.getBoundingClientRect().height ?? 0,
      toolbarHeight: toolbar.getBoundingClientRect().height,
    };
  });
  expect(new Set(desktop.tops).size).toBe(1);
  expect(desktop.controlHeight).toBe(40);
  expect(desktop.toolbarHeight).toBe(40);
  await expectAdjacentButtonsUseParentGap(page, '.documents-toolbar .filter-actions');

  await page.setViewportSize({ width: 768, height: 887 });
  await page.goto('/documents');
  await expect(page.locator('.kb-empty-state .el-empty__image')).toBeVisible();
  const pad = await page.locator('.documents-toolbar').evaluate((toolbar) => {
    const search = toolbar.querySelector<HTMLElement>('.document-filter-search');
    const status = toolbar.querySelector<HTMLElement>('.document-filter-status');
    const actions = toolbar.querySelector<HTMLElement>('.filter-actions');
    const upload = toolbar.querySelector<HTMLElement>('.documents-upload-action');
    const searchBounds = search?.getBoundingClientRect();
    const statusBounds = status?.getBoundingClientRect();
    const actionsBounds = actions?.getBoundingClientRect();
    const uploadBounds = upload?.getBoundingClientRect();
    return {
      searchBottom: searchBounds?.bottom ?? Number.POSITIVE_INFINITY,
      filtersTop: statusBounds?.top ?? Number.NEGATIVE_INFINITY,
      leftDelta:
        searchBounds && statusBounds ? Math.abs(searchBounds.left - statusBounds.left) : Infinity,
      rightDelta:
        uploadBounds && actionsBounds
          ? Math.abs(uploadBounds.right - actionsBounds.right)
          : Infinity,
      toolbarHeight: toolbar.getBoundingClientRect().height,
    };
  });
  expect(pad.searchBottom).toBeLessThanOrEqual(pad.filtersTop);
  expect(pad.leftDelta).toBeLessThanOrEqual(1);
  expect(pad.rightDelta).toBeLessThanOrEqual(1);
  expect(pad.toolbarHeight).toBe(88);
  await expectAdjacentButtonsUseParentGap(page, '.documents-toolbar .filter-actions');

  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/documents');
  const mobileToolbar = page.locator('.documents-toolbar--mobile');
  await expect(mobileToolbar.getByPlaceholder('搜索文件名')).toBeVisible();
  await mobileToolbar.getByPlaceholder('搜索文件名').fill('制度');
  await expect(mobileToolbar.getByRole('button', { name: '上传文档', exact: true })).toBeVisible();
  await expect(mobileToolbar.getByRole('button', { name: '筛选', exact: true })).toBeVisible();
  await expect(page.locator('.document-filters')).toHaveCount(0);
  const mobile = await mobileToolbar.evaluate((toolbar) => ({
    tops: Array.from(toolbar.children).map((control) =>
      Math.round(control.getBoundingClientRect().top),
    ),
    toolbarHeight: toolbar.getBoundingClientRect().height,
  }));
  expect(new Set(mobile.tops).size).toBe(1);
  expect(mobile.toolbarHeight).toBe(40);
  await expectAdjacentButtonsUseParentGap(page, '.documents-toolbar--mobile');

  await mobileToolbar.getByRole('button', { name: '筛选', exact: true }).click();
  const drawer = page.locator('.el-drawer').filter({ hasText: '筛选文档' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByPlaceholder('搜索文件名')).toHaveCount(0);
  await drawer.locator('.el-select').first().click();
  await page.getByText('已生效', { exact: true }).last().click();
  const documentFilterTrigger = mobileToolbar.getByRole('button', {
    name: '筛选',
    exact: true,
  });
  await expect(documentFilterTrigger).toHaveClass(/is-active/);
  expect(
    await documentFilterTrigger.evaluate((button) => getComputedStyle(button, '::after').content),
  ).toBe('""');
  await expectAdjacentButtonsUseParentGap(page, '.mobile-filter-drawer .mobile-filter-actions');
  await drawer.getByRole('button', { name: '重置', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(mobileToolbar.getByPlaceholder('搜索文件名')).toHaveValue('');
});

test('uses parent gaps for adjacent Element buttons across desktop, pad, and mobile', async ({
  page,
}) => {
  await mockSession(page, ['documents:read', 'documents:write']);
  await page.route('**/v1/documents?**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  await page.route('**/v1/documents/upload-options', (route) =>
    route.fulfill({
      json: {
        maxUploadBytes: 50 * 1024 * 1024,
        acceptedExtensions: ['txt', 'md', 'docx', 'xlsx', 'pdf'],
        department: 'platform',
        allowedSensitivities: ['public', 'internal'],
        defaultSensitivity: 'internal',
        dwgConversionEnabled: false,
      },
    }),
  );

  for (const viewport of [
    { width: 1440, height: 900, toolbar: '.documents-toolbar .filter-actions' },
    { width: 768, height: 887, toolbar: '.documents-toolbar .filter-actions' },
    { width: 375, height: 900, toolbar: '.documents-toolbar--mobile' },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/documents');
    await expectAdjacentButtonsUseParentGap(page, viewport.toolbar);
    await expectInputAndButtonHeightsMatch(
      page,
      viewport.width < 768 ? '.documents-toolbar--mobile' : '.documents-toolbar',
      40,
    );
    await expectPrimaryButtonHasBorder(page, '.documents-upload-action');
    await expectDangerButtonHoverUsesHighlightToken(page);

    await page.getByRole('button', { name: '上传文档' }).click();
    const surface = page.locator(viewport.width < 768 ? '.upload-drawer' : '.upload-dialog');
    await expect(surface).toBeVisible();
    await expectOverlayCloseHasSharedBorder(
      page,
      viewport.width < 768
        ? '.upload-drawer .el-drawer__close-btn'
        : '.upload-dialog .el-dialog__headerbtn',
    );
    await expectAdjacentButtonsUseParentGap(
      page,
      viewport.width < 768
        ? '.upload-drawer .el-drawer__footer'
        : '.upload-dialog .el-dialog__footer',
    );
    await surface.getByRole('button', { name: '取消' }).click();
    await expect(surface).toBeHidden();
  }
});

test('keeps upload and account dialog bodies scrollable in a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 360 });
  await mockSession(page, ['documents:read', 'documents:write', 'access:read', 'access:write']);
  await page.route('**/v1/documents?**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  await page.route('**/v1/documents/upload-options', (route) =>
    route.fulfill({
      json: {
        maxUploadBytes: 50 * 1024 * 1024,
        acceptedExtensions: ['txt', 'md', 'docx', 'xlsx', 'pdf'],
        department: 'platform',
        allowedSensitivities: ['public', 'internal'],
        defaultSensitivity: 'internal',
        dwgConversionEnabled: false,
      },
    }),
  );
  await page.route('**/v1/access/users**', (route) =>
    route.fulfill({
      json: {
        users: [
          {
            userId: 'managed.user',
            username: 'managed.user',
            department: 'platform',
            roles: ['user'],
            roleSource: 'managed',
            status: 'active',
            lastAuthenticatedAt: '2026-08-19T08:00:00.000Z',
          },
        ],
        total: 1,
        offset: 0,
        limit: 25,
        scope: 'tenant',
      },
    }),
  );
  await page.route('**/v1/access/departments', (route) =>
    route.fulfill({ json: { scope: 'tenant', departments: [] } }),
  );

  async function expectScrollableDialog(title: string): Promise<void> {
    const dialog = page.locator('.el-dialog').filter({ hasText: title });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((surface) => surface.getBoundingClientRect().top))
      .toBeGreaterThanOrEqual(0);
    const metrics = await dialog.evaluate((surface) => {
      const body = surface.querySelector<HTMLElement>('.el-dialog__body');
      const header = surface.querySelector<HTMLElement>('.el-dialog__header');
      const footer = surface.querySelector<HTMLElement>('.el-dialog__footer');
      if (body) body.scrollTop = body.scrollHeight;
      const surfaceBounds = surface.getBoundingClientRect();
      return {
        bodyClientHeight: body?.clientHeight ?? 0,
        bodyOverflowY: body ? getComputedStyle(body).overflowY : '',
        bodyScrollHeight: body?.scrollHeight ?? 0,
        bodyScrollTop: body?.scrollTop ?? 0,
        dialogBottom: surfaceBounds.bottom,
        dialogDisplay: getComputedStyle(surface).display,
        dialogTop: surfaceBounds.top,
        footerBottom: footer?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
        headerTop: header?.getBoundingClientRect().top ?? Number.NEGATIVE_INFINITY,
        viewportHeight: window.innerHeight,
      };
    });
    expect(metrics.dialogDisplay).toBe('flex');
    expect(metrics.dialogTop).toBeGreaterThanOrEqual(0);
    expect(metrics.dialogBottom).toBeLessThanOrEqual(metrics.viewportHeight);
    expect(metrics.headerTop).toBeGreaterThanOrEqual(metrics.dialogTop);
    expect(metrics.footerBottom).toBeLessThanOrEqual(metrics.dialogBottom);
    expect(metrics.bodyOverflowY).toBe('auto');
    expect(metrics.bodyScrollHeight).toBeGreaterThan(metrics.bodyClientHeight);
    expect(metrics.bodyScrollTop).toBeGreaterThan(0);
  }

  await page.goto('/documents');
  await page.getByRole('button', { name: '上传文档' }).click();
  await expectScrollableDialog('上传文档');
  await page.locator('.upload-dialog').getByRole('button', { name: '取消' }).click();

  await page.goto('/access/users');
  await page.getByRole('button', { name: '新增账号' }).click();
  await expectScrollableDialog('新增账号');
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page
    .getByRole('button', { name: '编辑用户' })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expectScrollableDialog('管理后台账号');
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
});

test('uses the document-style three-tier usage and access toolbars', async ({ page }) => {
  await mockSession(page, ['access:read', 'access:write', 'system:read']);
  await page.route('**/v1/system/usage**', (route) =>
    route.fulfill({
      json: {
        from: '2026-07-15T00:00:00.000Z',
        to: '2026-08-14T00:00:00.000Z',
        totalQueries: 0,
        failureRate: null,
        queryP95Ms: null,
        providers: [],
        departments: [],
        usageCompleteness: 'request_only',
      },
    }),
  );
  await page.route('**/v1/access/users**', (route) =>
    route.fulfill({
      json: {
        users: [],
        total: 0,
        offset: 0,
        limit: 25,
        scope: 'tenant',
      },
    }),
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/system/usage');
  const usageDesktop = await page.locator('.usage-toolbar').evaluate((toolbar) => ({
    tops: Array.from(
      toolbar.querySelectorAll<HTMLElement>(
        '.usage-start-filter, .usage-end-filter, .filter-actions',
      ),
    ).map((control) => Math.round(control.getBoundingClientRect().top)),
    height: toolbar.getBoundingClientRect().height,
  }));
  expect(new Set(usageDesktop.tops).size).toBe(1);
  expect(usageDesktop.height).toBe(40);
  await expectAdjacentButtonsUseParentGap(page, '.filter-actions');
  await expect(page.locator('.usage-toolbar__title')).toHaveCount(0);
  await expect(page.locator('.usage-toolbar > .kb-text')).toHaveCount(0);

  await page.goto('/access/users');
  const accessDesktop = await page.locator('.access-toolbar').evaluate((toolbar) => ({
    tops: Array.from(
      toolbar.querySelectorAll<HTMLElement>(
        '.access-filter-search, .access-filter-department, .filter-actions, .access-create-action',
      ),
    ).map((control) => Math.round(control.getBoundingClientRect().top)),
    height: toolbar.getBoundingClientRect().height,
  }));
  expect(new Set(accessDesktop.tops).size).toBe(1);
  expect(accessDesktop.height).toBe(40);
  await expectAdjacentButtonsUseParentGap(page, '.filter-actions');
  await expect(page.locator('.access-toolbar__title')).toHaveCount(0);
  await expect(page.locator('.access-toolbar > .kb-text')).toHaveCount(0);

  await page.setViewportSize({ width: 768, height: 887 });
  await page.goto('/system/usage');
  const usagePad = await page.locator('.usage-toolbar').evaluate((toolbar) => {
    const start = toolbar
      .querySelector<HTMLElement>('.usage-start-filter')
      ?.getBoundingClientRect();
    const end = toolbar.querySelector<HTMLElement>('.usage-end-filter')?.getBoundingClientRect();
    const actions = toolbar.querySelector<HTMLElement>('.filter-actions')?.getBoundingClientRect();
    return {
      datesTop: start?.top ?? Infinity,
      datesTopDelta: start && end ? Math.abs(start.top - end.top) : Infinity,
      datesWidthDelta: start && end ? Math.abs(start.width - end.width) : Infinity,
      actionsTop: actions?.top ?? -Infinity,
      actionsRight: actions?.right ?? -Infinity,
      toolbarRight: toolbar.getBoundingClientRect().right,
      height: toolbar.getBoundingClientRect().height,
    };
  });
  expect(usagePad.datesTopDelta).toBeLessThanOrEqual(1);
  expect(usagePad.datesWidthDelta).toBeLessThanOrEqual(1);
  expect(Math.abs(usagePad.datesTop - usagePad.actionsTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(usagePad.toolbarRight - usagePad.actionsRight)).toBeLessThanOrEqual(1);
  expect(usagePad.height).toBe(40);
  await expectAdjacentButtonsUseParentGap(page, '.filter-actions');

  await page.goto('/access/users');
  const accessPad = await page.locator('.access-toolbar').evaluate((toolbar) => ({
    tops: Array.from(
      toolbar.querySelectorAll<HTMLElement>(
        '.access-filter-search, .access-filter-department, .filter-actions, .access-create-action',
      ),
    ).map((control) => Math.round(control.getBoundingClientRect().top)),
    height: toolbar.getBoundingClientRect().height,
    scrollWidth: toolbar.scrollWidth,
    clientWidth: toolbar.clientWidth,
  }));
  expect(new Set(accessPad.tops).size).toBe(1);
  expect(accessPad.scrollWidth).toBeLessThanOrEqual(accessPad.clientWidth);
  expect(accessPad.height).toBe(40);
  await expectAdjacentButtonsUseParentGap(page, '.filter-actions');

  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/system/usage');
  const usageMobile = page.locator('.usage-toolbar--mobile');
  await expect(usageMobile.getByRole('button', { name: '筛选' })).toBeVisible();
  await expect(page.locator('.usage-filter-form')).toHaveCount(0);
  expect(await usageMobile.evaluate((toolbar) => toolbar.getBoundingClientRect().height)).toBe(40);

  await page.goto('/access/users');
  const accessMobile = page.locator('.access-toolbar--mobile');
  await expect(accessMobile.getByPlaceholder('搜索用户 ID')).toBeVisible();
  await expect(accessMobile.getByRole('button', { name: '新增账号' })).toBeVisible();
  await expect(accessMobile.getByRole('button', { name: '筛选' })).toBeVisible();
  await expect(page.locator('.access-filter-form')).toHaveCount(0);
  const accessMobileLayout = await accessMobile.evaluate((toolbar) => ({
    tops: Array.from(toolbar.children).map((control) =>
      Math.round(control.getBoundingClientRect().top),
    ),
    height: toolbar.getBoundingClientRect().height,
    scrollWidth: toolbar.scrollWidth,
    clientWidth: toolbar.clientWidth,
  }));
  expect(new Set(accessMobileLayout.tops).size).toBe(1);
  expect(accessMobileLayout.height).toBe(40);
  expect(accessMobileLayout.scrollWidth).toBeLessThanOrEqual(accessMobileLayout.clientWidth);
  await expectAdjacentButtonsUseParentGap(page, '.access-toolbar--mobile');

  await accessMobile.getByRole('button', { name: '筛选' }).click();
  const drawer = page.locator('.el-drawer').filter({ hasText: '筛选用户目录' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByPlaceholder('搜索用户 ID')).toHaveCount(0);
  await expect(drawer.locator('.el-select')).toBeVisible();
  await expectAdjacentButtonsUseParentGap(page, '.mobile-filter-drawer .mobile-filter-actions');
});

test('keeps ingestion task controls on one row for desktop and Pad', async ({ page }) => {
  await mockSession(page, ['documents:read']);
  let listRequests = 0;
  await page.route('**/v1/ingestion-jobs**', (route) => {
    listRequests += 1;
    return route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 59 } });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/ingestion-jobs');
  const desktop = await page.locator('.task-toolbar').evaluate((toolbar) => {
    const controls = Array.from(
      toolbar.querySelectorAll<HTMLElement>(
        '.task-document-filter, .task-status-filter, .filter-actions',
      ),
    ).map((control) => control.getBoundingClientRect());
    const inputWrapper = toolbar.querySelector<HTMLElement>('.el-input__wrapper');
    return {
      tops: controls.map((control) => Math.round(control.top)),
      controlHeight: inputWrapper?.getBoundingClientRect().height ?? 0,
      toolbarHeight: toolbar.getBoundingClientRect().height,
    };
  });
  expect(new Set(desktop.tops).size).toBe(1);
  expect(desktop.controlHeight).toBe(40);
  expect(desktop.toolbarHeight).toBe(40);
  await expect(page.locator('.task-toolbar + .kb-block-content > .task-list')).toHaveCSS(
    'border-radius',
    '12px',
  );
  await expect(page.locator('.task-toolbar + .kb-block-content > .task-list')).toHaveCSS(
    'overflow-y',
    'auto',
  );

  await page.setViewportSize({ width: 768, height: 887 });
  await page.goto('/ingestion-jobs');
  const pad = await page.locator('.task-toolbar').evaluate((toolbar) => {
    const documentId = toolbar.querySelector<HTMLElement>('.task-document-filter');
    const status = toolbar.querySelector<HTMLElement>('.task-status-filter');
    const actions = toolbar.querySelector<HTMLElement>('.filter-actions');
    const documentBounds = documentId?.getBoundingClientRect();
    const statusBounds = status?.getBoundingClientRect();
    const actionsBounds = actions?.getBoundingClientRect();
    return {
      documentTop: documentBounds?.top ?? Number.POSITIVE_INFINITY,
      statusTop: statusBounds?.top ?? Number.NEGATIVE_INFINITY,
      actionsTop: actionsBounds?.top ?? Number.NEGATIVE_INFINITY,
      toolbarHeight: toolbar.getBoundingClientRect().height,
    };
  });
  expect(Math.abs(pad.documentTop - pad.statusTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(pad.documentTop - pad.actionsTop)).toBeLessThanOrEqual(1);
  expect(pad.toolbarHeight).toBe(40);

  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/ingestion-jobs');
  const mobileToolbar = page.locator('.task-toolbar--mobile');
  await expect(mobileToolbar.getByPlaceholder('文档 ID')).toBeVisible();
  await mobileToolbar.getByPlaceholder('文档 ID').fill('6769af9a-a4d0-4dc2-a97d-942584a9c826');
  await expect(mobileToolbar.getByRole('button', { name: '筛选', exact: true })).toBeVisible();
  await expect(page.locator('.task-status-filter')).toHaveCount(0);
  const mobile = await mobileToolbar.evaluate((toolbar) => ({
    tops: Array.from(toolbar.children).map((control) =>
      Math.round(control.getBoundingClientRect().top),
    ),
    toolbarHeight: toolbar.getBoundingClientRect().height,
  }));
  expect(new Set(mobile.tops).size).toBe(1);
  expect(mobile.toolbarHeight).toBe(40);

  await mobileToolbar.getByRole('button', { name: '筛选', exact: true }).click();
  const drawer = page.locator('.el-drawer').filter({ hasText: '筛选入库任务' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByPlaceholder('文档 ID')).toHaveCount(0);
  await expect(drawer.getByText('全部状态', { exact: true })).toBeVisible();
  await drawer.getByText('全部状态', { exact: true }).click();
  await page.getByText('失败', { exact: true }).last().click();
  const ingestionFilterTrigger = mobileToolbar.getByRole('button', {
    name: '筛选',
    exact: true,
  });
  await expect(ingestionFilterTrigger).toHaveClass(/is-active/);
  expect(
    await ingestionFilterTrigger.evaluate((button) => getComputedStyle(button, '::after').content),
  ).toBe('""');
  await drawer.getByRole('button', { name: '重置', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(mobileToolbar.getByPlaceholder('文档 ID')).toHaveValue('');

  const requestsBeforeInvalidSearch = listRequests;
  await mobileToolbar.getByPlaceholder('文档 ID').fill('213123');
  await mobileToolbar.getByPlaceholder('文档 ID').press('Enter');
  await expect(mobileToolbar.getByRole('alert')).toContainText('完整的文档 ID');
  await expect(page.locator('.kb-error-state')).toHaveCount(0);
  await expect(page.locator('.kb-pagination')).toHaveCount(0);
  expect(listRequests).toBe(requestsBeforeInvalidSearch);
});

test('keeps failed upload rows aligned in the pad dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 887 });
  await mockSession(page, ['documents:read', 'documents:write']);
  await page.route('**/v1/documents?**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  await page.route('**/v1/documents/upload-options', (route) =>
    route.fulfill({
      json: {
        maxUploadBytes: 50 * 1024 * 1024,
        acceptedExtensions: ['docx'],
        department: 'platform',
        allowedSensitivities: ['public', 'internal'],
        defaultSensitivity: 'internal',
        dwgConversionEnabled: false,
      },
    }),
  );
  await page.route('**/v1/documents', (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: {
          code: 'DOCUMENT_DUPLICATE',
          message: '相同权限范围内已存在内容相同的文档',
          traceId: '41111111-1111-4111-8111-111111111111',
        },
      },
    }),
  );

  await page.goto('/documents');
  await page.getByRole('button', { name: '上传文档' }).click();
  const dialog = page.locator('.upload-dialog.el-dialog');
  await expectAdjacentButtonsUseParentGap(page, '.upload-dialog .el-dialog__footer');
  await dialog.locator('input[type="file"]').setInputFiles({
    name: '动态表单 API.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('safe upload fixture'),
  });
  await dialog.getByRole('button', { name: '开始上传' }).click();
  await expect(dialog.locator('.upload-file-error')).toContainText('相同权限范围');
  await expect(dialog.getByRole('button', { name: '重试' })).toBeVisible();

  const rowLayout = await dialog.locator('.upload-file-item').evaluate((row) => {
    const bounds = (selector: string) =>
      row.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
    const name = bounds('.upload-file-heading strong');
    const status = bounds('.upload-file-heading .el-tag');
    const error = bounds('.upload-file-error');
    const retry = bounds('.upload-file-retry');
    const center = (rect: DOMRect | undefined) =>
      rect ? rect.top + rect.height / 2 : Number.POSITIVE_INFINITY;
    return {
      dialogWidth: row.closest<HTMLElement>('.el-dialog')?.getBoundingClientRect().width ?? 0,
      firstRowCenterDelta: Math.abs(center(name) - center(status)),
      secondRowCenterDelta: Math.abs(center(error) - center(retry)),
      errorBeforeRetry: error && retry ? error.right <= retry.left : false,
      height: row.getBoundingClientRect().height,
      scrollWidth: row.scrollWidth,
      clientWidth: row.clientWidth,
    };
  });
  expect(rowLayout.dialogWidth).toBe(400);
  expect(rowLayout.firstRowCenterDelta).toBeLessThanOrEqual(1);
  expect(rowLayout.secondRowCenterDelta).toBeLessThanOrEqual(1);
  expect(rowLayout.errorBeforeRetry).toBe(true);
  expect(rowLayout.height).toBeLessThanOrEqual(110);
  expect(rowLayout.scrollWidth).toBeLessThanOrEqual(rowLayout.clientWidth);
});

test('matches the structured desktop upload dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 933 });
  await mockSession(page, ['documents:read', 'documents:write']);
  await page.route('**/v1/documents?**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  await page.route('**/v1/documents/upload-options', (route) =>
    route.fulfill({
      json: {
        maxUploadBytes: 50 * 1024 * 1024,
        acceptedExtensions: ['txt', 'md', 'doc', 'docx', 'xlsx', 'pdf', 'png', 'jpg', 'dxf'],
        department: 'platform',
        allowedSensitivities: ['public', 'internal'],
        defaultSensitivity: 'internal',
        dwgConversionEnabled: false,
      },
    }),
  );

  await page.goto('/documents');
  await page.getByRole('button', { name: '上传文档' }).click();
  const dialog = page.locator('.upload-dialog.el-dialog');
  await expect(dialog.getByText('选择或拖入文件', { exact: true })).toBeVisible();
  await expect(dialog.getByText('文件只会在确认“开始上传”后发送到服务端。')).toBeVisible();
  await expect(dialog.locator('.upload-metadata')).toContainText('platform');
  await expect(dialog.locator('.upload-metadata')).toContainText('internal （由服务端身份确定）');
  const layout = await dialog.evaluate((surface) => {
    const dragger = surface.querySelector<HTMLElement>('.el-upload-dragger');
    const metadata = surface.querySelector<HTMLElement>('.upload-metadata');
    const footer = surface.querySelector<HTMLElement>('.el-dialog__footer');
    return {
      width: surface.getBoundingClientRect().width,
      draggerHeight: Math.round(dragger?.getBoundingClientRect().height ?? 0),
      metadataRadius: metadata ? Number.parseFloat(getComputedStyle(metadata).borderRadius) : 0,
      footerBorderTop: footer ? Number.parseFloat(getComputedStyle(footer).borderTopWidth) : 0,
    };
  });
  expect(layout.width).toBe(460);
  expect(layout.draggerHeight).toBeGreaterThanOrEqual(120);
  expect(layout.metadataRadius).toBeGreaterThanOrEqual(10);
  expect(layout.footerBorderTop).toBe(0);
  await expectAdjacentButtonsUseParentGap(page, '.upload-dialog .el-dialog__footer');
});

test('meets automated WCAG AA checks on the core ask page', async ({ page }) => {
  await mockSession(page);
  await page.goto('/ask');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('keeps shell chrome fixed and confines management-page scrolling below controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await mockSession(page, [
    'documents:read',
    'documents:write',
    'audit:read',
    'access:read',
    'access:write',
    'system:read',
  ]);
  await page.route('**/v1/ingestion-jobs**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  await page.route('**/v1/audit/events**', (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            type: 'query',
            event: 'knowledge_query',
            outcome: 'answered',
            traceId: '55555555-5555-4555-8555-555555555555',
            actorUserId: 'admin.fixture',
            documentId: null,
            ingestionJobId: null,
            attributes: {},
            createdAt: '2026-07-22T09:00:00.000Z',
          },
        ],
        nextBefore: '2026-07-22T08:59:59.999Z',
        total: 51,
      },
    }),
  );
  await page.route('**/v1/system/usage**', (route) =>
    route.fulfill({
      json: {
        from: '2026-06-22T00:00:00.000Z',
        to: '2026-07-22T00:00:00.000Z',
        totalQueries: 0,
        failureRate: null,
        queryP95Ms: null,
        providers: [],
        departments: [],
        usageCompleteness: 'request_only',
      },
    }),
  );
  await page.route('**/v1/documents?**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  await page.route('**/v1/access/users**', (route) =>
    route.fulfill({
      json: {
        users: [
          {
            userId: 'admin.fixture',
            username: null,
            department: 'platform',
            roles: ['admin'],
            roleSource: 'managed',
            status: 'observed',
            lastAuthenticatedAt: '2026-07-22T09:00:00.000Z',
          },
        ],
        total: 1,
        offset: 0,
        limit: 25,
        scope: 'tenant',
      },
    }),
  );

  await page.goto('/ingestion-jobs');
  await expect(page.getByRole('heading', { name: '入库任务' })).toBeVisible();
  await expect(page.getByRole('button', { name: '折叠侧栏' })).toHaveCount(0);
  const ingestionLayout = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.app-header');
    const sidebar = document.querySelector<HTMLElement>('.app-sidebar');
    const heading = document.querySelector<HTMLElement>('.page-header');
    const section = document.querySelector<HTMLElement>('.app-main > section');
    const toolbar = document.querySelector<HTMLElement>('.task-toolbar');
    return {
      headerPosition: header ? getComputedStyle(header).position : '',
      sidebarPosition: sidebar ? getComputedStyle(sidebar).position : '',
      mainOverflowY: document.querySelector<HTMLElement>('.app-main')
        ? getComputedStyle(document.querySelector<HTMLElement>('.app-main')!).overflowY
        : '',
      headingPosition: heading ? getComputedStyle(heading).position : '',
      headingLeft: heading?.getBoundingClientRect().left ?? 0,
      headingRight: heading?.getBoundingClientRect().right ?? 0,
      sectionLeft: section?.getBoundingClientRect().left ?? 0,
      sectionRight: section?.getBoundingClientRect().right ?? 0,
      sectionHeight: section?.getBoundingClientRect().height ?? 0,
      toolbarPosition: toolbar ? getComputedStyle(toolbar).position : '',
    };
  });
  expect(ingestionLayout).toMatchObject({
    headerPosition: 'fixed',
    sidebarPosition: 'fixed',
    mainOverflowY: 'hidden',
    headingPosition: 'static',
    toolbarPosition: 'static',
  });
  expect(ingestionLayout.sectionLeft).toBe(ingestionLayout.headingLeft);
  expect(ingestionLayout.sectionRight).toBe(ingestionLayout.headingRight);
  expect(ingestionLayout.sectionHeight).toBeGreaterThan(500);

  await page.goto('/audit');
  await expect(page.getByRole('heading', { name: '审计中心' })).toBeVisible();
  await expect(page.getByRole('button', { name: '折叠侧栏' })).toHaveCount(0);
  await expect(
    page.locator('.audit-toolbar + .kb-block-content > .kb-block-scroll .el-empty'),
  ).toHaveCount(0);
  await expect(
    page.locator('.audit-toolbar + .kb-block-content .el-pagination__total'),
  ).toContainText('51');
  await page.evaluate(() => {
    const table = document.querySelector<HTMLElement>(
      '.audit-toolbar + .kb-block-content > .kb-block-scroll',
    );
    if (!table) return;
    const spacer = document.createElement('div');
    spacer.style.height = '1400px';
    spacer.setAttribute('aria-hidden', 'true');
    table.append(spacer);
    table.scrollTo({ top: 700 });
  });
  const auditLayout = await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>('.page-header');
    const toolbar = document.querySelector<HTMLElement>('.audit-toolbar');
    const table = document.querySelector<HTMLElement>(
      '.audit-toolbar + .kb-block-content > .kb-block-scroll',
    );
    const pageSection = document.querySelector<HTMLElement>('.app-main > section');
    return {
      headingBottom: heading?.getBoundingClientRect().bottom ?? 0,
      toolbarTop: toolbar?.getBoundingClientRect().top ?? 0,
      toolbarPosition: toolbar ? getComputedStyle(toolbar).position : '',
      tableScrollTop: table?.scrollTop ?? 0,
      tableScrollHeight: table?.scrollHeight ?? 0,
      tableClientHeight: table?.clientHeight ?? 0,
      pageLeft: pageSection?.getBoundingClientRect().left ?? 0,
      pageRight: pageSection?.getBoundingClientRect().right ?? 0,
    };
  });
  expect(auditLayout.toolbarPosition).toBe('static');
  expect(auditLayout.toolbarTop).toBeGreaterThanOrEqual(auditLayout.headingBottom);
  expect(auditLayout.tableScrollTop).toBeGreaterThan(0);
  expect(auditLayout.tableScrollHeight).toBeGreaterThan(auditLayout.tableClientHeight);
  expect(auditLayout.pageLeft).toBe(ingestionLayout.headingLeft);
  expect(auditLayout.pageRight).toBe(ingestionLayout.headingRight);
  const auditBounds = await page.locator('.app-main > section').evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right };
  });
  expect(auditBounds.left).toBe(ingestionLayout.headingLeft);
  expect(auditBounds.right).toBe(ingestionLayout.headingRight);

  await page.goto('/system/usage');
  await expect(page.getByRole('heading', { name: '用量与成本' })).toBeVisible();
  const usageLayout = await page.evaluate(() => {
    const actions = document.querySelector<HTMLElement>('.usage-filter-form');
    const dateEditors = actions?.querySelectorAll<HTMLElement>('.el-date-editor');
    const toolbar = document.querySelector<HTMLElement>('.usage-toolbar');
    const section = document.querySelector<HTMLElement>('.app-main > section');
    const actionBounds = actions?.getBoundingClientRect();
    return {
      actionsGap: actions ? getComputedStyle(actions).columnGap : '',
      expectedActionsGap: actions
        ? getComputedStyle(actions).getPropertyValue('--kb-space-2').trim()
        : '',
      toolbarDirection: toolbar ? getComputedStyle(toolbar).flexDirection : '',
      toolbarPosition: toolbar ? getComputedStyle(toolbar).position : '',
      dateWidths: [...(dateEditors ?? [])].map((date) => date.getBoundingClientRect().width),
      dateRight: dateEditors?.[1]?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY,
      actionsRight: actionBounds?.right ?? Number.NEGATIVE_INFINITY,
      sectionLeft: section?.getBoundingClientRect().left ?? 0,
      sectionRight: section?.getBoundingClientRect().right ?? 0,
    };
  });
  expect(usageLayout.actionsGap).toBe(usageLayout.expectedActionsGap);
  expect(usageLayout.toolbarDirection).toBe('row');
  expect(usageLayout.toolbarPosition).toBe('static');
  expect(usageLayout.dateWidths).toHaveLength(2);
  expect(Math.abs(usageLayout.dateWidths[0]! - usageLayout.dateWidths[1]!)).toBeLessThanOrEqual(1);
  expect(usageLayout.dateWidths[0]).toBeGreaterThan(0);
  expect(usageLayout.dateRight).toBeLessThanOrEqual(usageLayout.actionsRight);
  expect(usageLayout.sectionLeft).toBe(ingestionLayout.headingLeft);
  expect(usageLayout.sectionRight).toBe(ingestionLayout.headingRight);

  await page.goto('/documents');
  await expect(page.getByRole('heading', { name: '文档管理' })).toBeVisible();
  await expect(page.locator('.documents-toolbar')).toBeVisible();
  await expect(page.locator('.page > .kb-block-content--mobile-inset')).toBeVisible();
  await expect(page.locator('.documents-toolbar')).toHaveCSS('position', 'static');
  const documentsLayout = await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>('.page-header');
    const section = document.querySelector<HTMLElement>('.app-main > section');
    const toolbar = document.querySelector<HTMLElement>('.documents-toolbar');
    const content = document.querySelector<HTMLElement>('.page > .kb-block-content--mobile-inset');
    return {
      headingLeft: heading?.getBoundingClientRect().left ?? 0,
      headingRight: heading?.getBoundingClientRect().right ?? 0,
      sectionLeft: section?.getBoundingClientRect().left ?? 0,
      sectionRight: section?.getBoundingClientRect().right ?? 0,
      toolbarBottom: toolbar?.getBoundingClientRect().bottom ?? 0,
      contentTop: content?.getBoundingClientRect().top ?? 0,
    };
  });
  expect(documentsLayout.sectionLeft).toBe(documentsLayout.headingLeft);
  expect(documentsLayout.sectionRight).toBe(documentsLayout.headingRight);
  expect(documentsLayout.contentTop).toBeGreaterThan(documentsLayout.toolbarBottom);

  await page.goto('/access/users');
  await expect(page.getByRole('heading', { name: '用户与角色' })).toBeVisible();
  await expect(page.locator('.access-toolbar')).toBeVisible();
  await expect(page.locator('.access-toolbar__title')).toHaveCount(0);
  await expect(page.locator('.access-toolbar > .kb-text')).toHaveCount(0);
  await expect(page.locator('.access-toolbar')).toHaveCSS('position', 'static');
  await expect(page.locator('.access-intro')).toHaveCount(0);
  await expect(page.locator('.access-filters')).toHaveCount(0);
  await expect(page.locator('.access-table-wrap .el-empty')).toHaveCount(0);
  const accessToolbarLayout = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>('.access-toolbar');
    const search = document.querySelector<HTMLElement>('.access-filter-search');
    const department = document.querySelector<HTMLElement>('.access-filter-department');
    const createAccount = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === '新增账号',
    );
    return {
      toolbarRight: toolbar?.getBoundingClientRect().right ?? 0,
      searchTop: search?.getBoundingClientRect().top ?? 0,
      departmentTop: department?.getBoundingClientRect().top ?? 0,
      createRight: createAccount?.getBoundingClientRect().right ?? 0,
      createTop: createAccount?.getBoundingClientRect().top ?? 0,
    };
  });
  expect(accessToolbarLayout.searchTop).toBe(accessToolbarLayout.departmentTop);
  expect(accessToolbarLayout.createTop).toBe(accessToolbarLayout.searchTop);
  expect(accessToolbarLayout.createRight).toBeLessThanOrEqual(accessToolbarLayout.toolbarRight);
  expect(accessToolbarLayout.createRight).toBeGreaterThan(accessToolbarLayout.toolbarRight - 180);
  await page.getByRole('button', { name: '编辑角色' }).click();
  const roleDialog = page.locator('.el-dialog').filter({ hasText: '编辑托管角色' });
  await expect(roleDialog).toBeVisible();
  await expect(roleDialog).not.toHaveClass(/el-drawer/);
});
