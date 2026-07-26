import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const session = (
  capabilities = [
    'documents:read',
    'documents:write',
    'access:read',
    'access:write',
    'system:read',
  ],
) => ({
  authenticated: true,
  mode: 'development',
  identity: {
    tenantId: 'tenant-fixture',
    userId: 'admin.fixture',
    department: 'platform',
    roles: ['platform_admin'],
    allowedSensitivities: ['public', 'internal', 'confidential'],
    capabilities,
    defaultSensitivity: 'internal',
  },
});

async function mockSession(page: Page, capabilities?: string[]): Promise<void> {
  await page.route('**/v1/auth/session', (route) => route.fulfill({ json: session(capabilities) }));
}

test('asks a grounded question and renders an authorized source', async ({ page }) => {
  await mockSession(page);
  await page.route('**/v1/knowledge/query', (route) => {
    const question = route.request().postDataJSON().question;
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
  await expect(page.getByText('今天想从企业知识库了解什么？')).toBeVisible();
  await expect(page.getByText('付款周期是多久？', { exact: true })).not.toBeVisible();
});

test('renders explicit no-answer and blocks unauthorized management routes', async ({ page }) => {
  await mockSession(page, ['documents:read']);
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
  await page.getByLabel('输入知识库问题').fill('不存在的制度？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('暂时没有找到足够依据')).toBeVisible();
  await page.goto('/access/users');
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
  await expect(page.getByText('不是企业知识库资料', { exact: false })).toBeVisible();
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

  await page.goto(`/documents/${documentId}`);
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
    viewport: innerWidth,
    scroll: document.body.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.viewport);
  await expect(page.getByRole('heading', { name: '问答历史' })).toBeVisible();
});

test('keeps every authorized page within a 640px mobile viewport', async ({ page }) => {
  const documentId = '6769af9a-a4d0-4dc2-a97d-942584a9c826';
  await page.setViewportSize({ width: 640, height: 900 });
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
          total: 0,
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
      return route.fulfill({ json: { events: [], nextBefore: null } });
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
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: '未找到' } } });
  });

  await page.goto('/ask');
  await page.getByRole('button', { name: '打开导航菜单' }).click();
  await expect(page.getByRole('link', { name: '模型 Provider' })).toBeVisible();
  await expect(page.getByRole('link', { name: '用量与成本' })).toBeVisible();
  await expect(page.getByRole('link', { name: '系统状态' })).toBeVisible();
  await page.getByRole('button', { name: '关闭导航菜单' }).click();

  const pages = [
    ['/ask', '从可信资料中找到答案'],
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
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    const bounds = await page.evaluate(() => ({
      viewport: window.innerWidth,
      bodyScrollWidth: document.body.scrollWidth,
      mainScrollWidth: document.querySelector<HTMLElement>('.app-main')?.scrollWidth ?? 0,
      mainClientWidth: document.querySelector<HTMLElement>('.app-main')?.clientWidth ?? 0,
    }));
    expect(bounds.bodyScrollWidth).toBeLessThanOrEqual(bounds.viewport);
    expect(bounds.mainScrollWidth).toBeLessThanOrEqual(bounds.mainClientWidth);
  }
});

test('renders document rows as touch-friendly cards at 640px', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await mockSession(page, ['documents:read']);
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
        total: 1,
      },
    }),
  );
  await page.goto('/documents');
  await expect(page.getByRole('article')).toContainText('移动端验收制度.md');
  await expect(page.locator('.mobile-data-card')).toBeVisible();
  await expect(page.locator('.desktop-data-table')).toBeHidden();
});

test('keeps every system entry reachable from the mobile drawer', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await mockSession(page, ['system:read']);
  await page.goto('/ask');
  await expect(page.locator('.app-sidebar')).toBeHidden();
  await page.getByRole('button', { name: '打开导航菜单' }).click();
  await expect(page.locator('.mobile-drawer-header')).toHaveCSS('min-height', '56px');
  await expect(page.locator('.el-overlay')).toHaveCSS('z-index', '3000');
  await expect(page.getByRole('link', { name: '模型 Provider' })).toBeVisible();
  await expect(page.getByRole('link', { name: '用量与成本' })).toBeVisible();
  await expect(page.getByRole('link', { name: '系统状态' })).toBeVisible();
});

test('uses the Drawer instead of an icon-only sidebar at 829px', async ({ page }) => {
  await page.setViewportSize({ width: 829, height: 933 });
  await mockSession(page);
  await page.goto('/ask');
  await expect(page.locator('.app-sidebar')).toBeHidden();
  await expect(page.getByRole('button', { name: '打开导航菜单' })).toBeVisible();
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
    route.fulfill({ json: { events: [], nextBefore: null } }),
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
      json: { users: [], total: 0, offset: 0, limit: 25, scope: 'tenant' },
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
    const actions = document.querySelector<HTMLElement>('.usage-actions');
    const toolbar = document.querySelector<HTMLElement>('.usage-intro');
    const section = document.querySelector<HTMLElement>('.app-main > section');
    return {
      actionsGap: actions ? getComputedStyle(actions).columnGap : '',
      toolbarPosition: toolbar ? getComputedStyle(toolbar).position : '',
      sectionLeft: section?.getBoundingClientRect().left ?? 0,
      sectionRight: section?.getBoundingClientRect().right ?? 0,
    };
  });
  expect(usageLayout.actionsGap).toBe('10px');
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
  await expect(page.locator('.access-toolbar')).toHaveCSS('position', 'static');
  await expect(page.locator('.access-filters')).toHaveCount(0);
});
