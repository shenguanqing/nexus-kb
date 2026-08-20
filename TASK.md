# 当前开发任务

> 项目：知枢 NexusKB；当前阶段：阶段 16——服务器上线准备；状态：进行中，前端、本地 RAG 主链路与阶段 14 真实质量评测已完成，剩余阶段 4/7 增强项已明确延期。

---

## 1. 当前目标

为 Linux 服务器上线完成可验证的最小准备。完整 checklist、依赖与勾选状态见 [05-开发任务清单.md](./docs/05-开发任务清单.md)。

- 固定生产镜像、非 root 与最小权限。
- 配置 TLS、认证、Secret Manager、PostgreSQL/Redis 持久化。
- 完成备份恢复演练、日志指标采集、压测与安全测试。
- 确认数据保留、删除策略和模型区域合规。

## 2. 质量结论与边界

阶段 14 已使用 44 条本机真实技术资料问题完成两轮 DeepSeek 受控评测：32 条可回答、6 条无答案、6 条无权限。私有数据集、身份映射、原始 run 与聚合报告均保持 Git 忽略和 `0600`；仓库只提交方法、代码与聚合结论。

- Vector Top 5：Recall@5 `0.71875`、MRR `0.651042`、引用正确率 `0.884615`、P95 `4049 ms`、平均单题成本 `$0.000297`。
- Vector Top 20 + 本地 BGE Top 5：最终 Recall@5 `0.71875`、MRR `0.520833`、引用正确率 `0.88`、P95 `18680 ms`、平均单题成本 `$0.000432`。
- 两轮无答案拒答率均为 `1`、越权泄露率均为 `0`、错误率均为 `0`、成本覆盖率均为 `1`。
- 候选未提升 Recall、MRR 回退 `0.130209`，P95 为基线 `4.613485` 倍且平均成本为 `1.454545` 倍，决策为 `keep_disabled`；Rerank 继续默认关闭。
- 基线引用正确率仍低于本次批准门槛 `0.9`，属于阶段 16 上线前需明确接受或继续优化的质量风险，不把“完成评测”表述为“所有质量门槛通过”。
- 上述指标采集于跨页邻块切组修复之前。当前实现已改变 Rerank/LLM 上下文边界，报告保留为历史证据但不再作为当前版本上线基线；正式上线前需按同一 44 条数据集重新执行两轮评测，重新确认质量、延迟、成本与 Rerank 决策。在重跑前继续保持 Rerank 关闭。

数据集、运行命令和决策门槛见 [`evaluation/README.md`](./evaluation/README.md)。

## 3. 阶段 16 前遗留与明确延期

以下原阶段 4/7 项目尚未实现，但不属于当前上传白名单或运行时 Provider 范围，因此不阻塞进入阶段 16：

- PPTX、HTML、RTF 和 EML 解析与预览。
- OpenAI Embedding 的运行时配置、Factory 接入和契约测试。

这些项目不得被描述为已交付。阶段 16 的压测、恢复演练或获批业务需求如证明其中任一项是生产上线前置条件，必须先提高优先级并完成实现、测试与文档；详细勾选项见 [开发任务清单](./docs/05-开发任务清单.md#阶段-16-前遗留与明确延期)。

## 4. 已完成基线

- 前端交付：Vue 前端、知识问答与来源、文档生命周期、管理后台、响应式与可访问性已完成。
- 本地 RAG 链路已覆盖 Alibaba、Google 和受控 Ollama Embedding、可配置 LLM、文本哈希向量复用、批次级 checkpoint、待建立索引恢复、DOC/DXF/DWG 解析和统一预览。
- API、Parser Worker、前端与 Compose 的安全边界、共享 OpenAPI/Zod 契约、迁移和自动化测试已建立。
- 文档职责已收敛：当前任务在本文，阶段路线图在任务清单，配置在 `.env.example`，接口字段在 OpenAPI。

历史实现细节、验证命令和提交记录以 Git 历史为准；当前架构、产品体验、运维与 API 规则分别见 `docs/01` 至 `docs/07`。

## 5. 最近确认

- 2026-08-21：修复 Mobile 聚焦输入控件时 iOS 自动放大页面：新增 `--kb-font-size-mobile-input: 16px` 语义 token，并统一应用于 Element Plus Input、Textarea、Select、DatePicker/Range 输入文本；继续保留 viewport 用户缩放能力，不使用 `user-scalable=no` 规避问题。375px Playwright 同步覆盖问答 textarea、文档搜索与用量日期输入的 16px 计算字号。目标 Prettier、ESLint、Stylelint、Web typecheck、文档检查、`git diff --check` 与 375px 综合 Playwright 1/1 通过。
- 2026-08-21：修复 Mobile 用量 DatePicker 浮层内容偏左与英文内置文案：高优先级全局原生选择器覆盖 Element Plus 动态加载的 322px 面板定宽，使日期面板填满安全视口 popper，并让日历内容保持左右对称 token 内距；根级 ConfigProvider 实际传入简体中文 locale，年月、星期、“此刻”和“确定”统一中文。前端类型检查、全量 Web 单测 117/117、目标 Prettier 与独立 375px Playwright 回归 1/1 通过；原 375px 综合用例已通过本次日期浮层断言，后续被既有文档 ID 复制入口可访问名断言阻塞，未误记为全绿。
- 2026-08-20：完成全量 27 个 Vue SFC 与前端测试一致性审计，集中同步 `*.test.ts` 和 `phase15.spec.ts` 中已漂移的可访问名、共享 class、断点、工具栏高度、Drawer 尺寸、分页背景、滚动目标、空态和 Element Plus 结构断言。来源抽屉移除失效的 `heading/panel/text-block/:global()`，改用 `kb-*` 语义结构、token 与行内安全高度；文档 ID 文本本身作为点击复制触发区，不额外显示“复制”按钮，详情/分块/来源标题补齐 heading 语义，viewport 恢复用户缩放。清理 `DocumentDetailView` 空 Desktop media query，并将误复制为第二套文档详情实现的 `ComingSoonView` 恢复为轻量占位页，避免平行业务页面继续漂移。全量 Web 单测 117/117、`phase15.spec.ts` 35/35、Prettier、ESLint、Stylelint、Web typecheck、文档检查、`git diff --check` 与生产构建通过。
- 2026-08-20：全站页码分页位置统一收敛到对应 `kb-block-content` 内容外壳底部：文档管理、审计中心和入库任务不再把分页作为 `page` 直接子节点，用户目录与文档分块保持既有正确结构；带边框的 `kb-block + kb-block-scroll` 与透明分页统一为同级，分页不再进入 border 块。文档预览降级列表同步拆分正文滚动区与固定底部分页；组件测试补齐共享外壳及非边框父级断言，分块组件与 E2E 定位同步移除已失效的 `document-pagination` 旧类名。目标 Prettier、ESLint、Stylelint、Web typecheck、文档检查、`git diff --check`、生产构建、分页相关组件测试 19/19 和管理页滚动模型 Playwright 1/1 通过；入库工具栏综合用例在到达本次边框/分页断言前被既有高度旧断言阻塞（预期 74px、当前实际 40px），未误记为通过。
- 2026-08-20：修复用户目录与部门权限内容块无法稳定纵向滚动：`access-table-wrap` 移除无布局职责且会引入 Grid 内容最小尺寸的 `display: grid`，继续由 `kb-block-scroll` 承担滚动；Mobile `department-layout` 显式挂载 `kb-block-scroll` 并改为普通 Block，避免唯一 Collapse 被 Grid 拉伸后由 `overflow: hidden` 裁掉；Desktop/Pad 仍由左右子面板各自滚动。目标 Prettier、ESLint、Stylelint、Web typecheck、文档检查、`git diff --check`、生产构建、430px 用户目录回归和新增 667px Mobile 双容器滚动 Playwright 1/1 通过。既有 852px 综合用例已通过用户目录与部门内部面板滚动断言，后续仍被 Pad 视口查找 Mobile 菜单的旧断言阻塞，未误记为全绿。
- 2026-08-20：文档分块移除无样式、脚本或独立测试职责的 `chunks-content` class，`phase15.spec.ts` 改用 `.document-chunks-page > .kb-block-content` 共享结构定位。首轮浏览器验证发现分页被拆成 Grid 第三个直接子节点后下移到内容边界之外，已将分页放回共享 `kb-block-content` 外壳，保留两行 Grid 与内部滚动模型。目标 Prettier、ESLint、Stylelint、Web typecheck、文档检查、`git diff --check`、生产构建、分块组件测试 3/3 和管理页滚动模型 Playwright 1/1 通过。375px 全页面综合用例已通过分块分页边界断言，后续仍被既有用量日期浮层“确定”文案断言阻塞，未误记为全绿。
- 2026-08-20：主导航新增路由级 `activeNavigation` 归属，不再仅依赖 Vue Router 对当前路由记录的默认 active 判定；文档详情、预览和分块统一保持“文档管理”选中，PC、Pad 与 Mobile sidebar 共用 `is-active` 视觉状态和 `aria-current="page"` 语义。目标 Prettier、ESLint、Stylelint、Web typecheck、文档检查、`git diff --check`、生产构建、路由归属单测 13/13 与文档详情 PC/Pad/Mobile Playwright 1/1 通过。误执行的全量 Web 单测为 114/115，唯一失败仍是既有 Provider Anchor `40` / `36` 高度断言，未误记为全绿。
- 2026-08-20：应用壳层与问答工作台的 `page-header` 改为 Element Plus `el-page-header`，标题说明与操作分别使用 `content` / `extra` 插槽，保留右侧返回入口、Mobile 结构分支和页面滚动边界；页面一级标题同步补齐 heading 语义。目标 ESLint、Stylelint、Web typecheck、文档检查、`git diff --check`、生产构建和问答页/壳层 Pad/Mobile Playwright 3/3 通过；既有问答综合用例仍被 `AskComposer` 当前“输入问题”可访问名与用例旧的“输入知识库问题”断言不一致阻塞，未误记为通过。
- 2026-08-20：应用顶栏 `top-breadcrumb` 由手写文本与分隔符改为 Element Plus `el-breadcrumb` / `el-breadcrumb-item`，保留“页面分组 / 当前页面”内容、Pad 展示与 Mobile 隐藏规则。目标 ESLint、Stylelint、Web typecheck、文档检查、`git diff --check`、生产构建和独立 Pad 面包屑 Playwright 1/1 通过；既有 768px 壳层综合用例仍在面包屑断言前被页面标题缺少 heading 语义的已有断言阻塞，未误记为通过。
- 2026-08-20：全站页面间距收敛到语义 token：页面/组件区块优先使用 `--kb-layout-gap`，紧凑列表行使用 `--kb-list-row-padding`，块级容器与工具栏使用 12px 的 `--kb-block-padding`；业务 Vue/CSS 已无直接 `var(--kb-space-3)`，仅 `tokens.css` 保留五处语义变量定义。Web Stylelint、ESLint、文档检查、`git diff --check` 与独立 Vite 生产构建通过。全量 Web typecheck 仍被 `SourceDrawer.vue` 引用已删除的 `isPhone` 阻塞；全量单测 100/102，失败为对应 SourceDrawer 移动抽屉断言和既有 Provider Anchor 高度断言；375px 全页面 Playwright 专项仍被既有 Vite 动态导入 `DocumentsView.vue` 失败阻塞，均未误记为通过。
- 2026-08-19：收口短视口 Dialog 与 Pad sidebar：全局 Element Dialog 改为纵向 Flex，header/footer 固定且 body 独立滚动，上传文档、新增账号、管理后台账号在 360px 高度下不越界；Pad 图标导航移除 `tablet-group-title` / `tablet-group-flyout` 与点击打开状态，hover/键盘聚焦只显示当前入口 Tooltip，点击直接导航，`app-sidebar` 独立支持 Y 轴滚动。目标 ESLint、Stylelint、Web typecheck、Mobile/Pad/短视口 Playwright 3/3、生产构建与文档检查通过。
- 2026-08-19：用户目录 `access-toolbar` 在 Pad 端取消两行 Grid 定位，与 PC 一致使用“搜索 + 部门 + 筛选/重置 + 新增账号”单行布局；768px 回归新增同行、74px 高与无横向溢出断言。目标 ESLint、Stylelint、Web typecheck、三端工具栏 Playwright 1/1、生产构建与文档检查通过。
- 2026-08-19：全站 opacity 收敛为 `tokens.css` 的 hidden、decorative、disabled、muted、visible 五档；原 0.55/0.65 合并为 muted 0.6，历史删除入口、文档反馈、问答脉冲、移动禁用操作和状态页装饰均改用语义 token。Stylelint 新增规则禁止 CSS/Vue 再写裸 opacity 数字，全仓扫描无遗留。
- 2026-08-19：完成历史、文档与移动筛选细节回归：PC/Pad 问答历史每次搜索后清空右侧旧会话与 URL `conversationId`；PC/Pad 文档管理空数据时不再渲染空 Table，统一使用带图形的 `el-empty`；文档详情基本信息新增完整 UUID 与复制入口，入库任务继续按 UUID 精确筛选。Mobile `access-table-wrap` / `department-layout` 保留外层单边框并移除内层 Collapse 边框；文档、入库与用户筛选按钮统一按 Drawer 非空条件显示 `filter-trigger.is-active::after` 激活点。目标组件测试 15/15、历史/文档/文档详情/用户部门/入库筛选浏览器专项 5/5、根级 lint/密钥扫描/文档检查、Stylelint、Web ESLint/typecheck、E2E TypeScript 与生产构建通过；全量 Web 单测 100/102，仍仅为 Provider Anchor 两项既有断言失败。
- 2026-08-19：修复移动筛选状态与列表 surface 回归：文档、入库、用户及用量 Drawer 的“重置”改为清空本页全部筛选并立即重新加载，不再遗留工具栏 Input/Select；入库文档 ID 在 API 请求前校验 UUID，非法值只显示字段错误，字段/API 错误态不显示旧分页。Mobile 问答历史移除“筛选”按钮并将空态改为剩余空间双轴居中；`access-table-wrap` 与 `department-layout` 恢复白色 `kb-block` surface。目标组件测试 13/13、移动布局/文档重置/用户重置/入库校验与重置浏览器专项 4/4、根级 lint/密钥扫描/文档检查、Stylelint、Web ESLint/typecheck、E2E TypeScript 与生产构建通过；全量 Web 单测 98/100，仍仅为 Provider Anchor 两项既有断言失败。
- 2026-08-19：完成移动筛选与 Element Plus 浮层收口：审计中心在 Mobile 将事件类型 Select/重置直接收入 `audit-toolbar` 并移除筛选 Drawer；移动筛选触发按钮统一 `filter-trigger`，历史与入库搜索 Input 移除前置 Search 图标。根级 Element ConfigProvider 启用简体中文 locale，Select/DatePicker/Dropdown 等浮层统一当前 UI 的 surface、边框、圆角、阴影与交互色；用量 Drawer 内 DatePicker 改为 Teleport 至高层级全局浮层，避免被 Drawer 滚动容器裁剪。目标组件测试 8/8、375px 浏览器专项 1/1、根级 lint/密钥扫描/文档检查、Stylelint、Web ESLint/typecheck 与生产构建通过；全量 Web 单测 96/98，仍仅为 Provider Anchor 两项既有断言失败。
- 2026-08-19：对齐上传 Drawer、Mobile sidebar 和上传 Dialog 的 Close 交互：移动侧栏 Close 改为原生按钮，三者统一 default/hover/focus/active 色阶；边框全程保持中性色，hover/focus 仅使用 primary-soft 背景，active 使用 nav-accent 背景，不再出现蓝色边框。
- 2026-08-19：收口全站错误态与弹层 Close 视觉：修正“无法加载入库任务”标题语义，`kb-error-state` 统一使用 danger-soft 背景、边框、lg 圆角和 600 标题字重，不依赖外层是否为 `kb-block`；Dialog/Drawer 默认 Close 及 Mobile sidebar 自定义 Close 统一为带边框的圆形控件。
- 2026-08-19：优化 Mobile sidebar 顶部身份展示：品牌与关闭按钮保持首行，用户头像、用户名和部门收入独立的 `mobile-sidebar-identity` 信息卡，长用户名仅在卡片内安全省略，不再挤压 Logo 与关闭入口。
- 2026-08-19：修复文档管理加载失败时错误态、空表头与“暂无符合条件的文档”同时显示的回归；内容区改为错误态与列表/空态互斥渲染。
- 2026-08-19：入库任务的状态与任务类型字典从 `IngestionJobsView.vue` 收敛至 `ingestion-presentation.ts`，筛选选项与列表展示共用同一状态事实源；`ingestion` / `reindex` / `index_migration` 不再直接回显英文值。
- 2026-08-19：补齐审计中心“操作”列的中文事件映射，覆盖用户创建/更新/删除、角色、部门策略、文档索引与运行配置发布事件；未知动作使用中文兜底，不再直接显示英文事件码。
- 2026-08-19：Danger Button hover 改为与 Primary 相同的色阶机制：新增由 `--kb-color-danger` 与 surface 派生的 `--kb-color-danger-highlight`，映射官方 `--el-color-danger-light-3` / error light-3；filled Danger 恢复 Element 默认的“基色 → highlight、白字不变”交互，不再强制 hover 与默认态同色。三端浏览器回归校验 hover 变量命中 highlight token。
- 2026-08-19：修复 filled Danger Button hover 误用 `danger-soft` 浅背景并继续显示白字的问题；因现有 token 没有 danger-dark 色阶，hover / active 保持 `--kb-color-danger` 背景、边框与 `--kb-color-on-primary` 文字，确保对比度且不发明临时颜色。三端浏览器回归校验实际 CSS 变量映射。
- 2026-08-19：Primary Button 描边由偏重的 `--kb-color-primary-dark` 调整为柔和色阶：default 使用 `--kb-color-brand-highlight`，hover / active 使用 `--kb-color-primary`；继续保持边框与填充可辨，不改变尺寸和圆角。
- 2026-08-19：修复 filled Primary Button 因边框与背景同色而视觉膨胀的问题；保持 40px 高度、padding 与 md 圆角不变，仅将 default / hover / active 边框映射为 `--kb-color-primary-dark`，disabled 继续使用既有浅色阶。三端浏览器回归确认 Primary 边框存在且与背景色不同。
- 2026-08-19：按最终圆角层级将 `element.css` 内普通 Element 组件统一调整为 `--kb-radius-md`（10px），页面 `kb-block` 公共容器继续使用 `--kb-radius-lg`（12px）；pill、circle、Tag 与 bottom sheet 保留语义圆角。三端回归分别校验 Input/Button 为 md、工具栏容器为 lg。
- 2026-08-19：全站普通圆角统一提升到 `--kb-radius-lg`（12px），不修改或重复定义 token：`kb-block` 页面容器、Button、Input、Select、DatePicker、InputNumber、Pagination、Card、Dialog、Collapse 与 Upload 使用同一圆角；pill、circle、Tag 与 bottom sheet 保留语义圆角。三端 Playwright 同时校验工具栏、Input、Button 的计算圆角均等于 `--kb-radius-lg`，专项 1/1、Stylelint、ESLint、typecheck、生产构建与文档检查通过。
- 2026-08-19：按最新视觉要求撤销 Mobile `large` 控件策略，全站 Element Plus 由根级 ConfigProvider 固定为 `default`，并将 default / large / small 的 Button、Input、Select、DatePicker、InputNumber、Pagination、Tabs、Dropdown、Collapse、Upload 和弹层关闭按钮外框统一到 `--kb-control-height`。普通表单控件圆角统一为 `--kb-radius-sm`；Button 同步统一 padding、字号、图标 gap 和 circle 宽度。PC 1440px、Pad 768px、Mobile 375px 浏览器计算尺寸均确认 Input/Button 为 40/40；专项 Playwright 1/1、Stylelint、typecheck、生产构建通过。
- 2026-08-19：修复 Element Plus 2.14.3 默认 Button 未读取 `--el-component-size` 导致与 Input 高度不一致的问题；default Button 显式映射 `--kb-control-height`，large 映射 `--kb-control-height-touch`，并同步统一 padding、字号、圆角、图标 gap 与 circle 宽度。新增 PC 1440px、Pad 768px、Mobile 375px 浏览器计算尺寸断言，分别确认 Input/Button 为 40/40、40/40、44/44；专项 Playwright 1/1、Stylelint、typecheck、生产构建通过。
- 2026-08-19：基于本地确认的 Element Plus 2.14.3 重做 light theme：`element.css` 优先使用官方 `--el-*` 映射现有 `--kb-*` 色彩、背景、文本、边框、圆角、阴影、字号和尺寸 token，除 768/1280 既有媒体查询外无硬编码 `px`、颜色或业务 selector。根级 ConfigProvider 统一 Mobile `large`、Pad / PC `default`；Tabs、Dialog、Drawer、Collapse、Upload 等不支持统一交互 size 的组件成套覆盖高度、padding、字号与间距。问答 textarea 业务外观下沉至 `AskComposer.vue`，共享 Collapse 边框移至 `main.css`。新增尺寸 composable 单测 2/2，相关组件测试 12/12、根级 lint、Stylelint、typecheck、生产构建和三端 Playwright 2/3 通过；剩余 768px 用例在布局无横向溢出后被既有“问答历史”heading 语义断言阻塞。全量 Web 单测 86/88，仍仅为 Provider Anchor 两项既有断言。
- 2026-08-19：完成 Web CSS 三层职责重构：`tokens.css` 只声明颜色、字体、间距、控件与 768/1280 断点变量，根节点的字体、前景色与背景迁入 `main.css`；`element.css` 只保留跨页面通用的 Element Plus 原生类覆盖。Provider 配置表单、文档分块 Tabs、上传 Dialog 和来源 Drawer 的业务变体分别下沉至对应 Vue SFC scoped 样式；无挂载点的 `mobile-date-picker-popper` 被删除，其 Mobile 安全视口约束提升为全局 DatePicker 基线；用户目录与部门权限共同使用的 `kb-collapse-list` 保持单一全局变体。新增的样式归属规范已同步 AGENTS、前端设计、开发规范、任务清单与 Web README。根级 lint（含 Web ESLint、密钥扫描、文档检查）、Stylelint、typecheck、生产构建、相关组件测试 10/10 和三端按钮间距 Playwright 1/1 通过；全量 Web 单测 84/86，仍仅为 Provider Anchor 的两项既有断言。另 5 项相关 Playwright 分别在既有标题语义、用户页动态导入、Provider 标题、移动用户筛选 placeholder 与上传 metadata 空格断言处提前阻塞，未将其记为样式回归通过。
- 2026-08-19：优化文档分块卡片布局，将标题与位置、Chunk ID、metadata、原始/脱敏正文分层；metadata 复用 `kb-data-fields` 与无分隔线 modifier，相邻 Chunk ID 按上一个/下一个分行并允许 fingerprint 安全换行；Desktop/Pad 保持正文双栏，Mobile 改用 Element Plus Tabs 且一次只挂载一份正文。分块专项单测 2/2、Prettier、Stylelint、目标 ESLint、typecheck、生产构建通过；既有分块 Playwright 仍在进入目标页前被“用户与角色”页面标题断言阻塞，未将其记为通过。
- 2026-08-19：完成 Vue CSS 二次精简与 classname 收口：删除空 style/媒体查询/规则、重复公共声明、无效 Grid/Flex 属性和无用途 class；`main.css` 重排并抽取双栏、状态工具栏和两级错误态，状态命名统一为 `is-*`，Element 覆盖继续集中在 `element.css`。Stylelint、ESLint、typecheck、生产构建通过；全量 Web 单测 82/84，仍仅为 Provider Anchor 两项既有断言；CSS 专项 Playwright 4/5，剩余用户目录用例停在既有移动管理员筛选断言，补跑的用户目录专项又被 `/kb-block/` 同时命中 `kb-block-scroll` 的既有断言阻塞。
- 2026-08-19：问答历史三端均移除开始/结束时间与对应 URL/API 筛选状态；PC 与 Pad 的 `history-toolbar` 保持单行“会话搜索 + 筛选/重置”，Mobile 移除筛选 Drawer 并将“筛选 / 重置”直接放在搜索框右侧。历史专项单测 5/5、typecheck、目标 ESLint、Stylelint 和 PC/Pad/Mobile Playwright 1/1 通过。
- 2026-08-19：问答历史列表移除 Element Plus 页码分页和 URL 页码状态，改为上划到列表底部附近时按 `offset/limit` 追加下一批；补齐并发请求锁、追加去重、筛选竞态隔离、增量失败重试和全部加载提示。历史专项单测 4/4、typecheck、目标 ESLint、Stylelint、生产构建和 Playwright 1/1 通过；全量 Web 单测 80/82，仍仅被 Provider Anchor 的两项既有断言阻塞。
- 2026-08-19：完成全量 Web classname 正反向审计；移除无 CSS、无脚本行为、无必要测试用途的模板 class，删除无节点命中的孤立选择器，并将原依赖业务内容 class 的 E2E 定位改为共享容器结构。全量 Web Prettier、ESLint、Stylelint、typecheck、13 项受影响组件测试、文档检查、生产构建及跨页面容器/移动返回入口专项 Playwright 2/2 通过。
- 2026-08-19：全站内容容器的滚动职责收敛为 `page-content`（整页内容滚动）与 `kb-block-content` / `kb-block-scroll`（固定外壳 + 内部滚动）两种模型；系统状态移除互相覆盖的双重 class，入库任务、文档分块和用户目录删除重复的 Flex/overflow 声明，Mobile padding 改为显式 modifier。Web typecheck、目标 ESLint、Stylelint、受影响组件测试 5/5、文档检查、生产构建和跨页面 375px 专项 Playwright 1/1 通过。全量 Web 单测 79/81，仍被 Provider Anchor 的两项既有断言阻塞；补跑的三项历史响应式用例中，用户目录已通过新的内部滚动检查，另外两项先被既有移动/管理页标题断言阻塞，横屏综合用例继续在既有部门外层滚动断言处失败，未将其记为全绿。
- 2026-08-19：文档管理与审计中心的 Mobile 内容面板收敛为同一 `kb-block` 结构，统一外壳、内容滚动、间距、空态和分页视觉。Web typecheck、目标 ESLint、Stylelint、5 项组件测试、文档检查、生产构建和 375px 专项 Playwright 1/1 通过。
- 2026-08-19：Pad 图标 sidebar 的 hover、键盘聚焦与触屏长按浮层收敛为只显示当前入口，不再展开同组的全部入口。Web typecheck、目标 ESLint、文档检查、生产构建和 900px 专项 Playwright 1/1 通过。
- 2026-08-19：`useBreakpoint()` 删除与 `isMobile` 查询条件完全相同的 `isPhone` 别名；Vue 结构分支统一使用 `isMobile`（`max-width: 767px`）。
- 2026-08-18：问答工作台顶部移除页面私有 `ask-header` / `eyebrow`，复用其他菜单的 `page-header`、`page-header-copy` 和 `page-header-actions` 结构；标题基础视觉从 AppShell scoped 样式抽至 `main.css`，不再有两套页面标题布局。
- 2026-08-18：页面一级标题由无命名空间的 `heading heading--h1` 统一迁为 `kb-heading--h1`；基础字号在 `main.css` 集中定义，页面只保留自身的上下文尺寸差异。
- 2026-08-18：所有块级容器、modifier、列表和标题结构统一为单一 `kb-block*` 命名，删除并不再兼容 `kb-card`、`kb-panel`、`kb-card--*`、`kb-panel--*` 与 `kb-card__*` class；所有基础 padding 与 Element Card 统一为 `--kb-block-padding`，移除重复的 Card/Panel token 别名。原 `text-block` 与无效的后代 warning 选择器统一为 `kb-text` / `kb-text--warning`，状态样式直接挂在内容节点。Mobile 用户目录的 `access-table-wrap` 填满工具栏与权限说明之间的可用空间，并在自身滚动。所有 Web 样式文件按“紧凑 / Pad / Mobile / 低高度 Mobile 横屏 / 交互能力”顺序整理媒体查询、补齐统一注释，并清理空媒体查询；`main.css` 依重置、全局基础、页面布局、块容器、公共结构、反馈、品牌、回答来源、分页和无障碍顺序组织。
- 2026-08-18：按当前页面规范将用户目录“筛选部门”改为由受控部门目录驱动的 `el-select`，PC/Pad 与 Mobile 筛选 Drawer 一致；用户目录与部门权限的手机折叠列表收敛为 `kb-collapse-list` / `kb-collapse-list__summary`。新增 `kb-panel` 作为结构化列表、表格和工具栏的块级基础容器，与 `kb-card` 共同集中基础视觉和 modifier；删除页面内重复的筛选触发、移动折叠列表、Panel 头部及无引用样式。Web typecheck、ESLint、Stylelint、文档检查、生产构建、81 项单元测试及用户目录专项 Playwright 均通过。
- 2026-08-17：统一审计、用量、用户目录、文档详情与 Provider 摘要的数据卡片为 `kb-data-*` 语义结构，由 `kb-card` 提供基础视觉；删除 `mobile-data-*` / `mobile-field-*` 与 Provider 的重复字段行样式。Web 单测 81/81、Stylelint、ESLint、typecheck、Provider 专项 Playwright、生产构建与文档检查通过。
- 2026-08-17：用量与入库任务工具栏在 Pad（768–1279px）恢复单行布局；Mobile 继续使用既有筛选 Drawer 与重排。两项专项 Playwright 回归、Web ESLint、typecheck、生产构建与文档检查通过。
- 2026-08-17：修复审计中心游标分页的总数回归；Element Plus 分页重新绑定 API 返回的 tenant/type 范围 `total`，避免用可见游标页数推算记录总数。新增审计页分页回归测试；Web 全量单测 80/80、ESLint 与 typecheck 通过。
- 2026-08-17：完成 Web 端 UI/UX 与响应式样式收口。Design Tokens 扩展为语义 surface、状态背景、控件尺寸、字号、阴影与过渡；Element Plus 的按钮、输入、表格、Tabs、分页、Dialog 与 Drawer 统一为同一视觉与移动可用性基线。将跨页面错误态、移动筛选与数据卡片抽至 `main.css`，清理各页重复声明和无效注释，并移除 900px/901px 的局部样式分叉，统一沿现有 768px/1280px 断点重排。Web ESLint、typecheck、79 项单元测试与生产构建通过；完整 Playwright 回归仍在首个既有导航断言处失败（从问答页跳转历史页未发生），本轮未改动路由或导航逻辑。
- 2026-08-17：进一步统一 Web 基础规格：Element Plus 的输入、选择、日期、数字与按钮控件在 PC / Pad / Mobile 均使用 40px 高度；移除手机端按钮单独升至 44px 的分叉。新增 `kb-card` 与 compact / spacious / flush / interactive modifier，将 Provider、详情、预览、用量、系统、历史、任务与数据容器的重复 Card 基础样式收敛到全局 Token，不改变各页面业务布局或行为。
- 2026-08-17：移除业务模板中的通用 `panel` class，以 `kb-card` 作为当时唯一基础 Card class。Provider 数据卡、文档详情 `detail-grid`、工具栏、来源、数据表容器和各类同层级卡片均以“业务语义 class + `kb-card`（及 modifier）”表达；基础视觉不再由业务 class 分散定义。该阶段性约定已由 2026-08-18 的 `kb-panel` 容器规范补充。
- 2026-08-10：同源 PDF/Office 预览的 iframe 允许策略与跨域嵌入防护已落地。
- 2026-08-11：问答上下文联动、行内来源和历史来源详情已完成安全回归。
- 2026-08-11：完成第二轮全量 Markdown 审查，修正文档与运行时事实漂移，并将格式、链接、端点、Provider 与断点检查纳入 `pnpm docs:check` 和 CI。
- 2026-08-11：阶段 4/7 未完成项从“已完成阶段”折叠区移出，明确为不阻塞阶段 16 的延期增强与优化；Embedding 遥测按现有实现更正为已完成。
- 2026-08-11：完成 DOC 经内网 Tika 解析和本地 PDF 预览、Google `gemini-embedding-001` 运行时接入、完整指纹文本哈希向量缓存，以及失败后跳过已缓存批次的 Embedding checkpoint 续跑。
- 2026-08-11：用量页在零查询时展示当前 Embedding Provider/model，并明确其数量是“涉及问答”而非供应商请求；审计中心的知识问答只展示实际 LLM，云端策略展示并固化当时的 Embedding Provider/model，历史事件按 collection 事实回填已支持模型。
- 2026-08-11：阶段 14 使用 44 条真实问题完成 DeepSeek 双策略质量评测；越权泄露率与错误率均为 0，成本覆盖率 100%，本地 BGE 候选未带来 Recall 增益且显著增加延迟/成本，因此保持 Rerank 默认关闭。评测同时补齐 DeepSeek 缓存差异计价、合并来源的稳定 chunk 匹配和本地 cross-encoder 512-token 推理边界。
- 2026-08-11：修复邻块跨 PDF 页/工作表合并导致来源位置继承首块的问题；同页连续块仍按预算合并，页码或工作表变化时强制切组，确保问答来源打开到实际内容所在页。
- 2026-08-11：补齐租户级用量事实：问答请求作用域采集实际 Provider telemetry，并与查询审计原子持久化输入/输出 token 和调用时估算成本；用量页按 tenant/时间聚合，迁移前历史、Provider 未回传 usage 或未配置价格时继续保持未知，页面缺失值统一展示“暂无数据”。
- 2026-08-13：完成前端 CSS 归属整理：`main.css` 收敛到 reset、全局无障碍/动效、回答来源/Markdown 与 Element Plus Teleport 浮层规则；审计、用户、历史、部门、文档、入库、用量、Provider、系统状态和错误页等页面/业务组件样式分别迁入对应 Vue SFC，并先保留必要的页面间重复声明，公共 CSS 后续再抽象。已通过 Web CSS lint、ESLint、typecheck、77 项单元测试和生产构建。全量 `phase15.spec.ts` 为 15/24；其余 9 项仍涉及当前导航/历史/移动详情/任务与部门/更多抽屉/上传拖放区断言及开发服务器动态导入失败，未把本轮结果记为 E2E 全绿。
- 2026-08-13：前端 UX/UI 响应式基线更新为 PC（不可折叠的展开四组侧栏）/ Pad（全部入口图标、组间分隔线、顶部面包屑及 hover、键盘或长按浮层菜单）/ Mobile（三个高频入口 +“更多”底部导航，以及带身份头部、分组卡片和安全退出的底部抽屉）。设计 token 更新为低饱和靛蓝和中性灰；文档管理在 Pad 以下使用卡片列表。已通过 Web typecheck、ESLint、74 项单元测试和生产构建。
- 2026-08-13：问答历史按参考稿完成 PC / Pad / Mobile 三档视觉与交互对齐：桌面统一 32px 单行筛选并将列表、分页和详情收进一体式卡片，Pad 保持窄列表双栏并将筛选拆成两行，Mobile 使用顶部菜单页头、搜索 + 文字筛选入口、列表/详情两级全宽卡片、左滑删除与 Element Plus 页码分页；专项 Playwright 回归此前为 2/2、Web 单测 74/74、typecheck、ESLint、Stylelint、文档检查和生产构建通过。本次分页组件调整按用户要求未运行 `phase15.spec.ts`。完整 Playwright 为 15/19，仍有入库步骤、部门横屏滚动、“更多”抽屉卡片背景和管理页壳层对齐 4 项现有响应式用例待当前 UX/UI 重构收口。
- 2026-08-13：文档管理工具栏对齐问答历史的三端布局；上传文档弹层按参考稿重做为 PC 460px / Pad 400px 居中 Dialog 与 Mobile 全屏底部卡片，手机正文独立滚动且取消/开始上传等宽吸底。文件队列统一为上传中、`failed` 和 `queued` 卡片，上传请求使用同源带凭据 XHR 展示真实字节进度，响应仍执行运行时 schema 验证和统一安全错误映射。已通过文档专项 Playwright 4/4、Web 单测 77/77、typecheck、ESLint、Stylelint、文档检查和生产构建。
- 2026-08-13：移动端问答与历史的来源详情改为复用“更多”视觉语言的底部弹层，使用全视口遮罩、顶部拖拽把手和右上角关闭按钮；PC / Pad 继续使用右侧抽屉，打开详情不切换路由。已通过来源组件测试 4/4、Web 单测 75/75、typecheck、ESLint、Stylelint、文档检查和生产构建；按本轮要求未运行或修改 `phase15.spec.ts`。
- 2026-08-13：文档详情按参考稿完成三档卡片布局：PC 双摘要卡并排，Pad 堆叠，Mobile 仅保留右上角“⋯”并以底部操作面板承载预览、修改权限、重新索引和红色删除项；DWG 转换 warning 展示为蓝色格式转换说明。文档详情专项 Playwright 1/1、Web 单测 77/77、目标 ESLint/Stylelint、文档检查和 Vite 生产打包通过；全量 Web typecheck 仍被 `DocumentsView.vue` 与 `HistoryView.vue` 既有的三处 `type="button"` 类型错误阻塞，本页未新增类型错误。
- 2026-08-13：入库任务筛选栏对齐问答历史的 PC / Pad / Mobile 三端布局：桌面单行、Pad 两行，Mobile 保留文档 ID 输入与文字“筛选”入口，状态收入底部 Drawer。已通过专项 Playwright 1/1、Web 单测 77/77、typecheck、ESLint、Stylelint、文档检查和生产构建。
- 2026-08-13：`main.css` 中入库卡片与工具栏专属样式迁入 `IngestionJobsView.vue` scoped 样式，删除无使用的 `dl/dt/dd`、旧筛选表单和重复响应式规则；任务内容面板通过 `overflow: hidden` 使圆角实际裁剪内部滚动区与分页。已通过专项 Playwright 1/1、Web 单测 77/77、typecheck、ESLint、Stylelint 和生产构建。
- 2026-08-13：入库任务列表改为按状态默认展开：进行中和失败任务展开，完成及其他终态收起；收起行仅保留摘要、7 点进度、状态和展开指示，完整步骤与清单只在展开时挂载。Pad 展开步骤改为块内横向滚动，Mobile 保留垂直步骤。已通过入库任务专项 Playwright 2/2、Web 单测 77/77、typecheck、ESLint、Stylelint、文档检查和生产构建。
- 2026-08-13：修复入库任务 Mobile 长文件名撑宽列表并产生水平偏移，任务容器及摘要链路强制 `min-width: 0`、文件名省略且列表只允许 Y 轴滚动；Pad 步骤横向滚动背景迁到滚动视口，内容背景改为透明，消除滚动后白底缺口。已通过入库任务专项 Playwright 2/2、Web 单测 77/77、typecheck、ESLint、Stylelint、文档检查和生产构建。
- 2026-08-13：修复模型 Provider 页在应用壳层内无法纵向滚动；补回页面级 Flex 高度约束，使长表单继续由 `.page-content` 独立滚动，并增加实际 `scrollTop` 回归断言。已通过专项 Playwright 1/1、Web 单测 77/77、typecheck、目标 ESLint/Stylelint、文档检查和生产构建。
- 2026-08-14：前端业务 CSS 选择器统一改为“父容器语义 + 元素用途”的 class，保留 `strong`、`span`、`article`、`header`、表格和列表等原生标签；Markdown 动态节点及相关脚本/回归定位同步使用 class。仓库复扫只保留 `main.css` 的全局 reset/base 标签选择器与受控第三方样式例外。Web Stylelint、ESLint、typecheck、78 项单元测试、文档检查和生产构建通过；完整 Playwright 为 17/24，其中问答 Markdown/来源、900px 分组导航和核心问答页 WCAG AA 通过，另 7 项仍为历史卡片/返回按钮、移动详情操作、任务步骤、部门横屏滚动、更多抽屉背景和上传拖放区高度等现有布局断言，未将本轮记为 E2E 全绿。
- 2026-08-14：移动端应用壳层统一隐藏 `.page-header-copy`，不再只对问答历史做路由特判；无返回操作时同时移除空的 `page-header`，文档详情等来源页面只保留返回入口。Web typecheck、ESLint、Stylelint 和移动端页头专项 Playwright 1/1 通过。
- 2026-08-14：修复 `SafeMarkdown` 样式迁入 scoped SFC 后无法命中 `v-html` 节点的回归；表格恢复原生 table 布局、左/中/右对齐和可聚焦的块内横向滚动，并补齐 1–6 级标题、非 1 起始有序列表、分隔线、换行、粗体、斜体和删除线回归。Web 78 项单测、typecheck、ESLint、Stylelint 与 Markdown 专项 Playwright 1/1 通过。
- 2026-08-14：Element Plus 原生类覆盖从业务 SFC 与 `main.css` 集中迁入全局 `styles/element.css`，入口只引入一次；表格固定表头、移动筛选控件、权限折叠面板等通用规则直接使用 `.el-*`，未为迁移新增共享业务 class。Drawer、Dialog、日期浮层等确有互斥样式的场景只保留组件自身 class 或 popper-class。仓库复扫确认业务 Vue/CSS 不再包含 `.el-*` 覆盖；Web Stylelint、ESLint、typecheck、78 项单元测试、文档检查和生产构建通过。完整 Playwright 结果与迁移回调前一致为 16/26，剩余 10 项仍是 Markdown fixture、历史卡片/返回入口、分块标题、移动详情/任务/部门、上传区和更多抽屉等现有断言，未将本轮记为 E2E 全绿。
- 2026-08-14：全站 `el-drawer` 统一为同一视觉壳层：header/body/footer、标题与关闭按钮、分隔线、背景、阴影和安全区由 `element.css` 的原生类规则集中提供，底部 Drawer 统一 18px 顶部圆角与拖拽把手；来源详情、更多导航和文档操作删除各自手写的把手及标题栏，只保留方向、容量和正文布局差异。修复“更多”Drawer 重复关闭按钮并统一导航卡片背景；来源、历史筛选、上传和更多 Drawer 专项 Playwright 4/4 通过。
- 2026-08-14：文档操作 Drawer 的 `mobile-action-list` 对齐“更多”Drawer：操作项统一为图标、文字、右侧箭头三列卡片，复用背景、边框、圆角与 hover 反馈，危险操作保留红色语义；“更多”Drawer 的文本关闭符号改为与其他 Drawer 相同尺寸的 Element `Close` 图标。Web Stylelint、目标 ESLint、typecheck、79 项单元测试、文档检查和生产构建通过。
- 2026-08-14：修复问答历史与用量页 DatePicker 被 Element 默认宽度覆盖的问题；`element.css` 通过原生 `.el-date-editor` 组合选择器统一填满可收缩列，用量筛选从 Flex 收敛为两个等宽日期列加操作按钮的 Grid。历史 Mobile Drawer 与用量桌面专项 Playwright 2/2 通过。
- 2026-08-14：按最终确认调整问答历史 Pad 筛选栏：第二行由两个等宽弹性日期列和固定操作列组成，开始/结束时间撑满操作组之外的全部剩余宽度，结束时间与操作按钮之间只保留标准 gap，不设置额外空白列。针对 Element DatePicker 组件样式延迟加载后恢复默认 220px 的情况，全局原生组合选择器使用明确优先级覆盖；768px 专项 Playwright 已验证实际宽度大于 220px 且无额外间隙。
- 2026-08-14：移动端问答历史详情的“← 返回会话列表”入口已移入应用壳层 `page-header-actions`，与“返回文档列表”、“返回文档详情”统一位置和视觉规格；历史详情卡顶部只保留会话标题，返回时仅清理 URL 的 `conversationId`并保留原筛选与页码。目标 ESLint、Stylelint、Web typecheck、79 项单元测试、生产构建、文档检查与历史页专项 Playwright 1/1 通过。
- 2026-08-14：用户目录与用量工具栏对齐文档管理的 PC / Pad / Mobile 三端节奏，删除工具栏内重复页面标题和长说明；必要的“涉及问答”指标口径移到 Provider 数据卡内。用户目录在 Mobile 保留搜索、新增账号和筛选入口，Drawer 只承载部门；用量日期在 Mobile 全部收入筛选 Drawer。目标 ESLint、Stylelint、Web typecheck、79 项单元测试、生产构建、文档检查与三端专项/管理页 Playwright 回归 2/2 通过。
- 2026-08-14：移动端应用菜单由底部“问答 / 文档 / 审计 / 更多”导航改为顶部汉堡按钮控制的左侧 sidebar；侧栏复用 PC 的四组入口、当前项状态与 capability 过滤，保留身份摘要和安全退出，页面正文不再为底部菜单预留 68px。Web typecheck、ESLint、Stylelint、79 项单元测试、文档检查、生产构建和移动 sidebar 专项 Playwright 1/1 通过；补跑的历史三端响应式用例通过，另两个综合用例仍分别受已有的文档详情动态导入/移动操作区和部门横屏滚动断言阻塞，未将全量 E2E 记为全绿。
- 2026-08-14：修复 Element Plus 相邻按钮间距叠加：全局 `.el-button + .el-button` 左外边距归零，PC/Pad/Mobile 工具栏、移动筛选、表格行操作、Dialog/Drawer footer 与 CAD 缩放按钮组均改由父容器显式 `gap` 控制。仓库样式扫描只保留归零规则；Web ESLint、Stylelint、typecheck、79 项单元测试、文档检查、生产构建与三端按钮隔离 Playwright 1/1 通过，文档/用户/用量工具栏及 Pad 上传关联用例 3/3、入库三端和历史响应式用例各 1/1 通过。另两个上传综合用例仍先被已有的移动文件选择区高度和桌面拖放区高度断言阻塞，未将全量 E2E 记为全绿。

## 6. 交付要求

完成本阶段前必须更新本文、[开发任务清单](./docs/05-开发任务清单.md) 和受影响的规格/技术/运维文档，并如实记录实际验证结果与未完成风险。
