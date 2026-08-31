# Vue Web 应用说明

`apps/web` 是 NexusKB 的浏览器界面，使用 Vue 3、TypeScript、Vite、Vue Router、Pinia 和 Element Plus。它提供知识问答、来源展示、问答历史、文档与入库任务管理、访问控制、审计、Provider、系统状态和用量页面。

Web 只负责用户体验。真正的身份、tenant、ACL、敏感度和 capability 校验始终由 NestJS API 执行。

页面样式中的区块间距、列表行内距和块内距分别优先使用 `--kb-layout-gap`、`--kb-list-row-padding`、`--kb-block-padding`；`--kb-space-3` 只保留在 token 定义或不属于这些布局语义的基础间距中。

## 阅读路径

| 路径                                                           | 作用                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| [`src/main.ts`](./src/main.ts)                                 | 创建 Vue 应用、注册 Router、Pinia 和 Element Plus 配置 |
| [`src/App.vue`](./src/App.vue)                                 | 应用根组件                                             |
| [`src/router/index.ts`](./src/router/index.ts)                 | 页面路由与导航守卫                                     |
| [`src/layouts/AppShell.vue`](./src/layouts/AppShell.vue)       | PC/Pad 侧栏、移动端侧向 sidebar、顶栏和内容壳层        |
| [`src/api/client.ts`](./src/api/client.ts)                     | 统一 HTTP client、超时、Cookie 和安全错误映射          |
| [`src/stores/auth.ts`](./src/stores/auth.ts)                   | 服务端会话、角色和 capability 状态                     |
| [`src/styles/tokens.css`](./src/styles/tokens.css)             | 仅声明颜色、字体、间距、控件与断点设计 token           |
| [`src/styles/element.css`](./src/styles/element.css)           | Element Plus 跨页面通用原生类覆盖                      |
| [`src/styles/main.css`](./src/styles/main.css)                 | Reset、全局基础、公共布局与工具类                      |
| [`src/styles/breakpoints.scss`](./src/styles/breakpoints.scss) | 唯一响应式断点定义                                     |

## 目录结构

```text
apps/web/
├── src/
│   ├── api/                 # 按业务域封装 API 调用和运行时校验
│   ├── components/
│   │   └── common/          # 跨功能复用的通用、安全渲染组件
│   ├── composables/         # useBreakpoint 等复用逻辑
│   ├── layouts/             # 应用壳层与全局导航
│   ├── router/              # 路由、权限体验和安全返回导航
│   ├── stores/              # Pinia 会话与问答状态
│   ├── styles/              # 设计 token、全局样式和唯一断点
│   ├── test/                # Vitest 公共测试环境
│   ├── utils/               # Markdown 等纯工具函数
│   ├── views/               # 路由页面、功能私有子组件与展示层数据整理
│   ├── App.vue
│   └── main.ts
├── e2e/                     # Playwright 完整流程和响应式回归
├── public/
├── index.html
├── playwright.config.ts
├── vite.config.ts
└── vitest.config.ts
```

同目录的 `*.test.ts` 是对应模块的单元或组件测试；展示层数据整理通常放在 `*-presentation.ts`，避免把复杂转换散落在 Vue 模板中。

`src/components/` 只放跨功能复用的 Vue 公共组件；当前公共组件置于 `common/`，文件名使用与导出组件一致的 PascalCase。一级导航页面直接放在 `views/` 根目录；文档详情、预览和分块等功能二级路由页面，以及只服务于某个页面的子 Vue，可以放入 `views/<feature>/`。页面私有子组件以所属页面名开头，例如 `DocumentsPreviewTileViewer.vue`，其测试文件同样使用完整组件名。由同一功能域的多个页面共享、但不跨功能复用的子组件使用功能域前缀。类型、纯函数和其他实现细节放入 `utils/`、`composables/` 或所属功能目录。

页面 scoped 样式中的页面独有 class 使用文件名语义前缀：`AuditView.vue` 使用 `audit-*`，`ProviderSettingsView.vue` 使用 `provider-*`。`kb-*`、`el-*` 和子组件自身封装的 class 保持各自命名空间，不用页面前缀重写。

## 页面范围

主要页面位于 `src/views`：

- `KnowledgeAskView`：知识问答、严格/通用回答模式和来源。
- `HistoryView`：当前登录用户的问答历史。
- `DocumentsView`、`DocumentsDetailView`、`DocumentsChunksView`、`DocumentsPreviewView`：文档、版本、授权分块和全格式预览；CAD SVG 与按视口加载的 Canvas 瓦片查看器提供有界缩放和鸟瞰图。所有 CAD 鸟瞰都只显示统一的“拖动定位”提示；manifest 有 `focusBounds` 时额外显示“主体 / 全图”范围切换。瓦片配置基准为 z12，远距实体稀释主体时 manifest 可动态补足到 z15；查看器按设备像素比和实际层级限制继续放大，避免把最高瓦片再次模糊拉伸。渐进瓦片在完整索引前使用单请求初始化并在失败后停止自动预取，首批细节成功后恢复双并发且只刷新一次鸟瞰，使快速总览切换到完整彩色几何；有 `focusBounds` 时首次打开与重置聚焦主体，鸟瞰默认显示 ACL 保护的“主体”缩略图并可切换“全图”，全图、平移和瓦片仍覆盖完整 `bounds`。旧 manifest 保持原行为。全部预览支持全屏。
- `IngestionJobsView`：入库状态、步骤、失败详情和安全重试。
- `UsersView`、`DepartmentsView`：角色与部门权限。
- `AuditView`：无正文结构化审计。
- `ProviderSettingsView`、`SystemStatusView`、`UsageView`：Provider、依赖和用量摘要。

## 安全与前端边界

- 请求不能携带可信 `tenantId`、角色、部门或任意向量过滤表达式。
- 路由和按钮隐藏只改善体验，不能替代后端鉴权。
- 问题、回答和文档片段不写入浏览器持久化、analytics 或普通错误上报。
- Markdown 必须通过统一的严格清洗组件渲染；禁止原始 HTML、脚本、iframe、图片、事件属性和危险协议。
- 外部链接必须使用安全协议，并添加 `noopener noreferrer`。
- API 错误分支依赖稳定错误码和 HTTP 状态，不依赖可变的错误文案。

## 响应式约定

- 断点只从 `breakpoints.scss` 和 `useBreakpoint()` 读取。
- Element Plus 由根级 `ElConfigProvider` 固定使用 `default`；三端表单控件统一为 `--kb-control-height`，页面不重复判断控件尺寸。
- 页面公共容器使用 `--kb-radius-lg`，普通 Element 控件使用 `--kb-radius-md`；pill、circle、Tag 与 bottom sheet 保留语义圆角。
- `<768px` 使用可展开/收起的移动端侧向 sidebar 与卡片结构，不保留底部导航或仅靠 CSS 隐藏的桌面表格。
- 表格、列表和详情正文在各自内容块内滚动，避免整个页面横向溢出。
- 触控目标至少 44px；手机可聚焦输入控件字号至少 16px。

详细页面和交互规范见 [`docs/03-前端产品与界面设计.md`](../../docs/03-前端产品与界面设计.md)。

## 开发命令

在仓库根目录执行：

```bash
pnpm --filter @nexus-kb/web dev
pnpm --filter @nexus-kb/web lint
pnpm --filter @nexus-kb/web typecheck
pnpm --filter @nexus-kb/web test
pnpm --filter @nexus-kb/web build
```

需要浏览器完整回归时：

```bash
pnpm --filter @nexus-kb/web test:e2e
```
