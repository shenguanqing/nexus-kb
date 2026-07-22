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
  await page.route('**/v1/knowledge/query', (route) =>
    route.fulfill({
      json: {
        conversationId: '11111111-1111-4111-8111-111111111111',
        answer: '付款周期为 30 天。[来源1]',
        noAnswer: false,
        reason: null,
        traceId: '21111111-1111-4111-8111-111111111111',
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
    }),
  );
  await page.goto('/ask');
  await page.getByLabel('输入知识库问题').fill('付款周期是多久？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('付款周期为 30 天。')).toBeVisible();
  await expect(page.getByText('付款制度.md')).toBeVisible();
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
