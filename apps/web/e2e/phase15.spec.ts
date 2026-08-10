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
  await page.getByLabel('输入知识库问题').fill('付款周期是多久？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('付款周期为 30 天。')).toBeVisible();
  await expect(page.getByText('付款制度.md')).toBeVisible();
  await page.route('**/v1/history/conversations?**', (route) =>
    route.fulfill({ json: { conversations: [], total: 0, offset: 0, limit: 20 } }),
  );
  await page.getByRole('link', { name: '问答历史' }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.locator('.history-pagination')).toHaveCount(0);
  const historyLayout = await page.evaluate(() => {
    const page = document.querySelector<HTMLElement>('.history-page');
    const layout = document.querySelector<HTMLElement>('.history-layout');
    return {
      pageBottom: page?.getBoundingClientRect().bottom ?? Number.NEGATIVE_INFINITY,
      layoutBottom: layout?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
    };
  });
  expect(Math.abs(historyLayout.pageBottom - historyLayout.layoutBottom)).toBeLessThanOrEqual(1);
  await page.getByRole('link', { name: '知识问答' }).click();
  await expect(page.getByText('付款周期是多久？')).toBeVisible();
  await expect(page.getByText('付款周期为 30 天。')).toBeVisible();
  await page.getByLabel('输入知识库问题').fill('报销需要准备哪些材料？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('报销需要准备哪些材料？')).toBeVisible();
  await expect(page.getByText('报销需提交对应材料。')).toBeVisible();
  await expect(page.getByText('付款周期是多久？')).toBeVisible();
  await expect(page.getByText('付款周期为 30 天。')).toBeVisible();
  await page.getByRole('button', { name: '新建问答' }).click();
  await expect(page.getByText('今天想从知识库了解什么？')).toBeVisible();
  await expect(page.getByText('付款周期是多久？', { exact: true })).not.toBeVisible();
});

test('separates history pagination from the conversation list card', async ({ page }) => {
  await mockSession(page);
  const conversations = Array.from({ length: 20 }, (_, index) => ({
    id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    title: `会话 ${index + 1}`,
    messageCount: 1,
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  }));
  await page.route('**/v1/history/conversations**', (route) =>
    route.fulfill({ json: { conversations, total: 21, offset: 0, limit: 20 } }),
  );

  await page.goto('/history');

  await expect(page.locator('.history-list-card .history-head')).toBeVisible();
  await expect(page.locator('.history-list-card .history-list')).toBeVisible();
  await expect(page.locator('.history-list-card + .history-pagination')).toBeVisible();
  const cardLayout = await page.evaluate(() => {
    const listCard = document.querySelector<HTMLElement>('.history-list-card');
    const pagination = document.querySelector<HTMLElement>('.history-pagination');
    return {
      listCardBackground: listCard ? getComputedStyle(listCard).backgroundColor : '',
      paginationBackground: pagination ? getComputedStyle(pagination).backgroundColor : '',
      listCardBottom: listCard?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
      paginationTop: pagination?.getBoundingClientRect().top ?? Number.NEGATIVE_INFINITY,
    };
  });
  expect(cardLayout.listCardBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(cardLayout.paginationBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(cardLayout.paginationTop).toBeGreaterThan(cardLayout.listCardBottom);
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
  await page.getByLabel('输入知识库问题').fill('Vue 的响应式原理是什么？');
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
  await expect(page.getByRole('link', { name: '知识问答' })).toBeVisible();
  await expect(page.getByRole('link', { name: '问答历史' })).toBeVisible();
  await expect(page.getByRole('link', { name: '文档管理' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '入库任务' })).toHaveCount(0);
  await expect(page.getByText('管理', { exact: true })).toHaveCount(0);
  await page.getByLabel('输入知识库问题').fill('不存在的制度？');
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
  await page.getByLabel('输入知识库问题').fill('Vue 2 和 Vue 3 的区别？');
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
          sourceName: '制度.md',
          documentVersion: 1,
          items: [
            {
              id: 'a'.repeat(64),
              documentVersion: 1,
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
        sourceName: '制度.md',
        mimeType: 'text/markdown',
        department: 'finance',
        sensitivity: 'internal',
        ownerId: 'admin.fixture',
        activeVersion: 1,
        status: 'active',
        versions: [
          {
            version: 1,
            status: 'active',
            parser: 'markdown',
            parserVersion: '1.0',
            warnings: [],
            chunkCount: 1,
            vectorCollection: 'nexus_ollama_bge_m3_1024_12345678',
            embeddingFingerprint: 'a'.repeat(64),
            indexedAt: '2026-07-22T09:00:00.000Z',
            activatedAt: '2026-07-22T09:00:00.000Z',
            supersededAt: null,
            createdAt: '2026-07-22T09:00:00.000Z',
          },
        ],
        createdAt: '2026-07-22T09:00:00.000Z',
        updatedAt: '2026-07-22T09:00:00.000Z',
      },
    });
  });

  await page.goto('/ask');
  await page.getByRole('link', { name: '用户与角色' }).click();
  await expect(page).toHaveURL(/\/access\/users$/);
  await expect(page.getByRole('heading', { name: '用户与角色' })).toBeVisible();
  await page.getByRole('link', { name: '部门权限' }).click();
  await expect(page).toHaveURL(/\/access\/departments$/);
  await expect(page.getByRole('heading', { name: '部门权限' })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/documents/${documentId}`);
  await expect(page.getByRole('heading', { name: '制度.md' })).toBeVisible();
  const desktopDetailLayout = await page.evaluate(() => {
    const summary = document.querySelector<HTMLElement>('.detail-actions > div:first-child');
    const actionButtons = document.querySelector<HTMLElement>('.detail-action-buttons');
    const cards = document.querySelectorAll<HTMLElement>('.detail-grid > .detail-card');
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
        const cards = document.querySelectorAll<HTMLElement>('.detail-grid > .detail-card');
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
    .toEqual({ actionsWrapped: true, cardsStacked: true });
  const detailLayout = await page.evaluate(() => {
    const pageContent = document.querySelector<HTMLElement>(
      '.document-detail-page > .page-content',
    );
    const actions = document.querySelector<HTMLElement>('.detail-actions');
    const actionButtons = document.querySelector<HTMLElement>('.detail-action-buttons');
    const detailGrid = document.querySelector<HTMLElement>('.detail-grid');
    const history = document.querySelector<HTMLElement>(
      '.document-detail-page > .page-content > .detail-card',
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
  await page.getByRole('button', { name: '修改权限 metadata' }).click();
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
  await page.getByRole('link', { name: '查看全部分块' }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${documentId}/chunks\\?version=1$`));
  await expect(page.getByRole('heading', { name: '文档分块' })).toBeVisible();
  await expect(page.getByText('这是原始分块内容。')).toBeVisible();
  await expect(page.getByText('这是脱敏后分块内容。')).toBeVisible();
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
  await expect(page.getByRole('heading', { name: '问答历史' })).toBeVisible();
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
    if (path === '/v1/access/departments') return route.fulfill({ json: { departments: [] } });
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
  await expect(page.getByRole('link', { name: '模型 Provider' })).toBeVisible();
  await expect(page.getByRole('link', { name: '用量与成本' })).toBeVisible();
  await expect(page.getByRole('link', { name: '系统状态' })).toBeVisible();
  await page.getByRole('button', { name: '关闭导航菜单' }).click();

  const pages = [
    ['/ask', '从资料中找到答案'],
    ['/history', '问答历史'],
    ['/documents', '文档管理'],
    [`/documents/${documentId}`, '文档详情'],
    [`/documents/${documentId}/chunks`, '文档分块'],
    ['/ingestion-jobs', '入库任务'],
    ['/audit', '审计中心'],
    ['/access/users', '用户与角色'],
    ['/access/departments', '部门权限'],
    ['/settings/providers', '模型 Provider'],
    ['/system/status', '系统状态'],
    ['/system/usage', '用量与成本'],
  ] as const;

  for (const [path, title] of pages) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: title }).first()).toBeVisible();
    const bounds = await page.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      mainScrollWidth: document.querySelector<HTMLElement>('.app-main')?.scrollWidth ?? 0,
      mainClientWidth: document.querySelector<HTMLElement>('.app-main')?.clientWidth ?? 0,
    }));
    expect(bounds.bodyScrollWidth).toBeLessThanOrEqual(375);
    expect(bounds.mainScrollWidth).toBeLessThanOrEqual(bounds.mainClientWidth);
  }

  for (const [path, toolbar] of [
    ['/history', '.history-toolbar'],
    ['/audit', '.audit-toolbar'],
    ['/access/users', '.access-toolbar'],
  ] as const) {
    await page.goto(path);
    await expect(page.locator(toolbar).getByRole('button', { name: '筛选' })).toBeVisible();
  }

  for (const [path, toolbar] of [
    ['/ingestion-jobs', '.task-toolbar'],
    ['/audit', '.audit-toolbar'],
    ['/settings/providers', '.provider-toolbar'],
    ['/system/status', '.system-status-toolbar'],
    ['/system/usage', '.usage-toolbar'],
  ] as const) {
    await page.goto(path);
    await expect(page.locator(toolbar)).toHaveCSS('flex-direction', 'row');
  }

  await page.goto(`/documents/${documentId}/chunks`);
  await expect(page.locator('.document-pagination .el-pagination__total')).toHaveCount(0);
  await expect(page.locator('.document-pagination .el-pager')).toBeVisible();
  const chunksPagination = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.chunks-content');
    const pagination = document.querySelector<HTMLElement>('.document-pagination');
    return {
      contentBottom: content?.getBoundingClientRect().bottom ?? Number.NEGATIVE_INFINITY,
      paginationBottom: pagination?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
      paginationBackground: pagination ? getComputedStyle(pagination).backgroundColor : '',
    };
  });
  expect(chunksPagination.paginationBottom).toBeLessThanOrEqual(chunksPagination.contentBottom);
  expect(chunksPagination.paginationBackground).not.toBe('rgba(0, 0, 0, 0)');

  await page.goto('/system/usage');
  await expect(page.locator('.usage-filter-form')).toHaveCount(0);
  await page.locator('.usage-filter-bar').getByRole('button', { name: '筛选' }).click();
  await expect(page.locator('.usage-filter-drawer')).toBeVisible();
  await expect(page.locator('.usage-filter-drawer').getByPlaceholder('开始时间')).toBeVisible();
  await expect(page.locator('.usage-filter-drawer').getByPlaceholder('结束时间')).toBeVisible();

  await page.goto('/settings/providers');
  await expect(page.locator('.provider-toolbar')).toHaveCSS('flex-direction', 'row');
  await expect(
    page.locator('.provider-toolbar').getByRole('button', { name: '刷新状态' }),
  ).toBeVisible();
  expect(
    await page.locator('.provider-toolbar').evaluate((element) => element.clientHeight),
  ).toBeLessThanOrEqual(60);

  await page.goto('/system/status');
  await expect(page.locator('.system-status-toolbar')).toHaveCSS('flex-direction', 'row');
  await expect(
    page.locator('.system-status-toolbar').getByRole('button', { name: '重新检查' }),
  ).toBeVisible();
  expect(
    await page.locator('.system-status-toolbar').evaluate((element) => element.clientHeight),
  ).toBeLessThanOrEqual(60);

  await page.goto('/history');
  await page.getByRole('button', { name: '筛选' }).click();
  await expect(page.locator('.mobile-filter-drawer')).toBeVisible();
  await expect(page.getByPlaceholder('开始时间')).toBeVisible();
  await expect(page.getByPlaceholder('结束时间')).toBeVisible();
  await page.getByPlaceholder('开始时间').click();
  await expect(page.locator('.mobile-date-picker-popper:visible')).toBeVisible();
  const mobileOverlayBounds = await page.evaluate(() => {
    const drawer = document.querySelector<HTMLElement>('.mobile-filter-drawer');
    const popper = document.querySelector<HTMLElement>(
      '.mobile-date-picker-popper:not([aria-hidden="true"])',
    );
    return {
      drawerHeight: drawer?.getBoundingClientRect().height ?? 0,
      popperLeft: popper?.getBoundingClientRect().left ?? -1,
      popperRight: popper?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY,
    };
  });
  expect(mobileOverlayBounds.drawerHeight).toBeGreaterThanOrEqual(630);
  expect(mobileOverlayBounds.popperLeft).toBeGreaterThanOrEqual(0);
  expect(mobileOverlayBounds.popperRight).toBeLessThanOrEqual(375);
  const historyFilterBounds = await page.evaluate(() => {
    const drawer = document.querySelector<HTMLElement>('.mobile-filter-drawer');
    const dateEditors = document.querySelectorAll<HTMLElement>(
      '.mobile-filter-form .el-date-editor',
    );
    return {
      drawerRight: drawer?.getBoundingClientRect().right ?? Number.NEGATIVE_INFINITY,
      dateEditorsRight: [...dateEditors].map(
        (dateEditor) => dateEditor.getBoundingClientRect().right,
      ),
    };
  });
  expect(historyFilterBounds.dateEditorsRight).toHaveLength(2);
  for (const right of historyFilterBounds.dateEditorsRight) {
    expect(right).toBeLessThanOrEqual(historyFilterBounds.drawerRight);
  }

  await page.setViewportSize({ width: 620, height: 985 });
  await page.goto(`/documents/${documentId}`);
  await expect(page.getByRole('heading', { name: '制度.md' })).toBeVisible();
  const detailMobileLayout = await page.evaluate(() => {
    const actions = document.querySelector<HTMLElement>('.detail-actions');
    const summary = document.querySelector<HTMLElement>('.detail-actions > div:first-child');
    const actionButtons = document.querySelector<HTMLElement>('.detail-action-buttons');
    return {
      actionsHeight: actions?.getBoundingClientRect().height ?? Number.POSITIVE_INFINITY,
      buttonsTop: actionButtons?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
      summaryBottom: summary?.getBoundingClientRect().bottom ?? Number.NEGATIVE_INFINITY,
    };
  });
  expect(detailMobileLayout.actionsHeight).toBeLessThan(260);
  expect(detailMobileLayout.buttonsTop - detailMobileLayout.summaryBottom).toBeLessThanOrEqual(24);

  await page.goto('/settings/providers');
  await expect(page.getByRole('heading', { name: '模型 Provider' }).first()).toBeVisible();
  await expect(page.locator('.provider-toolbar')).toHaveCSS('flex-direction', 'row');

  await page.setViewportSize({ width: 852, height: 393 });
  for (const [path, title] of pages) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: title }).first()).toBeVisible();
    const bounds = await page.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      mainScrollWidth: document.querySelector<HTMLElement>('.app-main')?.scrollWidth ?? 0,
      mainClientWidth: document.querySelector<HTMLElement>('.app-main')?.clientWidth ?? 0,
      headerHeight: document.querySelector<HTMLElement>('.app-header')?.clientHeight ?? 0,
    }));
    expect(bounds.bodyScrollWidth).toBeLessThanOrEqual(852);
    expect(bounds.mainScrollWidth).toBeLessThanOrEqual(bounds.mainClientWidth);
    expect(bounds.headerHeight).toBeGreaterThanOrEqual(44);
    expect(bounds.headerHeight).toBeLessThanOrEqual(48);
  }
});

test('keeps phone task steps compact and department cards grouped', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await mockSession(page, ['documents:read', 'access:read', 'access:write']);
  await page.route('**/v1/ingestion-jobs**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            documentId: '22222222-2222-4222-8222-222222222222',
            sourceName: '移动端任务.md',
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
            warnings: [],
            errorCode: null,
            errorCategory: null,
            retryable: false,
            startedAt: '2026-07-22T09:00:00.000Z',
            completedAt: '2026-07-22T09:01:00.000Z',
            createdAt: '2026-07-22T09:00:00.000Z',
            updatedAt: '2026-07-22T09:01:00.000Z',
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
  await expect(page.locator('.task-steps')).toBeVisible();
  const taskStepsHeight = await page
    .locator('.task-steps')
    .evaluate((element) => Math.round(element.getBoundingClientRect().height));
  expect(taskStepsHeight).toBeLessThan(360);

  await page.goto('/access/departments');
  await expect(page.locator('.department-mobile-list .el-collapse-item')).toHaveCount(3);
  await page.getByText('finance', { exact: true }).click();
  await expect(page.getByRole('button', { name: '保存权限' })).toBeVisible();
  await expect(page.locator('.el-drawer').filter({ hasText: '部门权限' })).toHaveCount(0);
  const departmentHeaders = await page.evaluate(() => {
    return Array.from(
      document.querySelectorAll<HTMLElement>('.department-mobile-list .el-collapse-item__header'),
    ).map((header) => Math.round(header.getBoundingClientRect().height));
  });
  expect(departmentHeaders.every((height) => height < 110)).toBe(true);
});

test('keeps landscape mobile controls aligned and management content scrollable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 852, height: 393 });
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
  const userScroll = await page.locator('.access-content').evaluate((element) => {
    const canScroll = element.scrollHeight > element.clientHeight;
    element.scrollTop = 160;
    return { canScroll, scrollTop: element.scrollTop };
  });
  expect(userScroll.canScroll).toBe(true);
  expect(userScroll.scrollTop).toBeGreaterThan(0);

  await page.goto('/access/departments');
  await expect(page.getByText('department-1', { exact: true })).toBeVisible();
  const departmentScroll = await page.locator('.department-layout').evaluate((element) => {
    const canScroll = element.scrollHeight > element.clientHeight;
    element.scrollTop = 160;
    return { canScroll, scrollTop: element.scrollTop };
  });
  expect(departmentScroll.canScroll).toBe(true);
  expect(departmentScroll.scrollTop).toBeGreaterThan(0);

  await page.goto('/history');
  const historyFilterPosition = await page.locator('.history-toolbar').evaluate((element) => {
    const button = element.querySelector<HTMLElement>('.filter-trigger');
    const toolbarBounds = element.getBoundingClientRect();
    const buttonBounds = button?.getBoundingClientRect();
    return {
      toolbarRight: toolbarBounds.right,
      buttonRight: buttonBounds?.right ?? Number.NEGATIVE_INFINITY,
      buttonTop: buttonBounds?.top ?? Number.NEGATIVE_INFINITY,
      toolbarTop: toolbarBounds.top,
    };
  });
  expect(historyFilterPosition.buttonRight).toBeGreaterThan(
    historyFilterPosition.toolbarRight - 20,
  );
  expect(historyFilterPosition.buttonTop).toBeGreaterThanOrEqual(historyFilterPosition.toolbarTop);

  await page.getByRole('button', { name: '打开导航菜单' }).click();
  const drawerHeader = await page.locator('.mobile-drawer-header').evaluate((element) => {
    const header = document.querySelector<HTMLElement>('.app-header');
    return {
      drawerHeight: element.getBoundingClientRect().height,
      appHeaderHeight: header?.getBoundingClientRect().height ?? 0,
    };
  });
  expect(drawerHeader.drawerHeight).toBe(drawerHeader.appHeaderHeight);
  await page.getByRole('button', { name: '关闭导航菜单' }).click();

  await page.goto('/system/usage');
  await expect(page.getByText('ollama / bge-m3:latest')).toBeVisible();
  const usageLayout = await page.evaluate(() => {
    const intro = document.querySelector<HTMLElement>('.usage-toolbar');
    const filter = document.querySelector<HTMLElement>('.usage-filter-bar');
    const content = document.querySelector<HTMLElement>('.usage-page > .page-content');
    const introBounds = intro?.getBoundingClientRect();
    const filterBounds = filter?.getBoundingClientRect();
    if (content) content.scrollTop = 160;
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
    ['/audit', '.audit-toolbar', '筛选'],
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
  await expect(page.locator('.document-card')).toBeVisible();
  await expect(page.locator('.desktop-data-table')).toHaveCount(0);
  await expect(page.locator('.list-pagination')).toBeVisible();
  const filterButton = page.getByRole('button', { name: '筛选' });
  expect(await filterButton.count()).toBe(1);
  await page.getByRole('button', { name: '上传文档' }).click();
  const uploadDrawer = page.locator('.upload-drawer.el-drawer');
  await expect(uploadDrawer).toBeVisible();
  await expect(uploadDrawer.getByText('选择文件', { exact: true })).toBeVisible();
  await expect(uploadDrawer.getByText('选择或拖入文件', { exact: true })).toHaveCount(0);
  const uploadBounds = await uploadDrawer.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { width: Math.round(bounds.width), height: Math.round(bounds.height) };
  });
  expect(uploadBounds.width).toBe(375);
  expect(uploadBounds.height).toBe(810);
  await expect(uploadDrawer.getByRole('button', { name: '开始上传' })).toBeVisible();
  await uploadDrawer.getByRole('button', { name: '取消' }).click();
  await filterButton.click();
  const filterDrawer = page.locator('.el-drawer').filter({ hasText: '筛选文档' });
  await expect(filterDrawer).toBeVisible();
  await expect(filterDrawer).toHaveCSS('height', '648px');
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

test('keeps every system entry reachable from the mobile drawer', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await mockSession(page, ['system:read']);
  await page.goto('/ask');
  await expect(page.locator('.app-sidebar')).toBeHidden();
  await page.getByRole('button', { name: '打开导航菜单' }).click();
  await expect(page.locator('.mobile-drawer-header')).toHaveCSS('min-height', '56px');
  await expect(
    page.locator('.el-overlay').filter({ has: page.locator('.mobile-drawer-header') }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: '模型 Provider' })).toBeVisible();
  await expect(page.getByRole('link', { name: '用量与成本' })).toBeVisible();
  await expect(page.getByRole('link', { name: '系统状态' })).toBeVisible();
});

test('uses the Drawer instead of an icon-only sidebar at 900px', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 933 });
  await mockSession(page);
  await page.goto('/ask');
  await expect(page.locator('.app-sidebar')).toBeHidden();
  await expect(page.getByRole('button', { name: '打开导航菜单' })).toBeVisible();
});

test('keeps the complete desktop navigation and document table at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSession(page, ['documents:read']);
  await page.route('**/v1/documents?**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  await page.goto('/documents');
  await expect(page.locator('.app-sidebar')).toBeVisible();
  await expect(page.getByRole('button', { name: '折叠侧栏' })).toBeVisible();
  await expect(page.locator('.desktop-data-table')).toBeVisible();
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
  const collapseButton = page.getByRole('button', { name: '折叠侧栏' });
  await expect(collapseButton).toBeVisible();
  const ingestionLayout = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.app-header');
    const sidebar = document.querySelector<HTMLElement>('.app-sidebar');
    const heading = document.querySelector<HTMLElement>('.page-heading');
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
  await expect(page.getByRole('button', { name: '折叠侧栏' })).toBeVisible();
  await expect(page.locator('.audit-table-wrap .el-empty')).toHaveCount(0);
  await expect(page.locator('.audit-content .el-pagination__total')).toContainText('51');
  await page.evaluate(() => {
    const table = document.querySelector<HTMLElement>('.audit-table-wrap');
    if (!table) return;
    const spacer = document.createElement('div');
    spacer.style.height = '1400px';
    spacer.setAttribute('aria-hidden', 'true');
    table.append(spacer);
    table.scrollTo({ top: 700 });
  });
  const auditLayout = await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>('.page-heading');
    const toolbar = document.querySelector<HTMLElement>('.audit-toolbar');
    const table = document.querySelector<HTMLElement>('.audit-table-wrap');
    const pageSection = document.querySelector<HTMLElement>('.audit-page');
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
    const toolbar = document.querySelector<HTMLElement>('.usage-toolbar');
    const section = document.querySelector<HTMLElement>('.app-main > section');
    return {
      actionsGap: actions ? getComputedStyle(actions).columnGap : '',
      expectedActionsGap: actions
        ? getComputedStyle(actions).getPropertyValue('--kb-space-2').trim()
        : '',
      toolbarDirection: toolbar ? getComputedStyle(toolbar).flexDirection : '',
      toolbarPosition: toolbar ? getComputedStyle(toolbar).position : '',
      sectionLeft: section?.getBoundingClientRect().left ?? 0,
      sectionRight: section?.getBoundingClientRect().right ?? 0,
    };
  });
  expect(usageLayout.actionsGap).toBe(usageLayout.expectedActionsGap);
  expect(usageLayout.toolbarDirection).toBe('row');
  expect(usageLayout.toolbarPosition).toBe('static');
  expect(usageLayout.sectionLeft).toBe(ingestionLayout.headingLeft);
  expect(usageLayout.sectionRight).toBe(ingestionLayout.headingRight);

  await page.goto('/documents');
  await expect(page.getByRole('heading', { name: '文档管理' })).toBeVisible();
  await expect(page.locator('.documents-toolbar')).toBeVisible();
  await expect(page.locator('.documents-content')).toBeVisible();
  await expect(page.locator('.documents-toolbar')).toHaveCSS('position', 'static');
  const documentsLayout = await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>('.page-heading');
    const section = document.querySelector<HTMLElement>('.documents-page');
    const toolbar = document.querySelector<HTMLElement>('.documents-toolbar');
    const content = document.querySelector<HTMLElement>('.documents-content');
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
  await expect(page.locator('.access-toolbar-left')).toBeVisible();
  await expect(page.locator('.access-toolbar-right')).toBeVisible();
  await expect(page.locator('.access-toolbar-left')).toContainText('已验证身份目录');
  await expect(page.locator('.access-toolbar-left')).not.toContainText('身份源 + 托管角色');
  await expect(page.locator('.access-toolbar')).toHaveCSS('position', 'static');
  await expect(page.locator('.access-intro')).toHaveCount(0);
  await expect(page.locator('.access-filters')).toHaveCount(0);
  await expect(page.locator('.access-table-wrap .el-empty')).toHaveCount(0);
  const accessToolbarLayout = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>('.access-toolbar');
    const left = document.querySelector<HTMLElement>('.access-toolbar-left');
    const right = document.querySelector<HTMLElement>('.access-toolbar-right');
    const filters = document.querySelector<HTMLElement>('.access-filter-form');
    const description = left?.querySelector<HTMLElement>('.text-block');
    const createAccount = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === '新增后台账号',
    );
    return {
      toolbarRight: toolbar?.getBoundingClientRect().right ?? 0,
      leftRight: left?.getBoundingClientRect().right ?? 0,
      rightLeft: right?.getBoundingClientRect().left ?? 0,
      filtersTop: filters?.getBoundingClientRect().top ?? 0,
      filtersBottom: filters?.getBoundingClientRect().bottom ?? 0,
      descriptionTop: description?.getBoundingClientRect().top ?? 0,
      descriptionBottom: description?.getBoundingClientRect().bottom ?? 0,
      createRight: createAccount?.getBoundingClientRect().right ?? 0,
    };
  });
  expect(accessToolbarLayout.rightLeft).toBeGreaterThan(accessToolbarLayout.leftRight);
  expect(accessToolbarLayout.filtersTop).toBeLessThan(accessToolbarLayout.descriptionBottom);
  expect(accessToolbarLayout.filtersBottom).toBeGreaterThan(accessToolbarLayout.descriptionTop);
  expect(accessToolbarLayout.createRight).toBeLessThanOrEqual(accessToolbarLayout.toolbarRight);
  expect(accessToolbarLayout.createRight).toBeGreaterThan(accessToolbarLayout.toolbarRight - 180);
  await page.getByRole('button', { name: '编辑角色' }).click();
  await expect(page.locator('.role-dialog')).toBeVisible();
  await expect(page.locator('.role-dialog')).not.toHaveClass(/el-drawer/);
});
