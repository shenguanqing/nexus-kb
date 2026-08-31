# 当前开发任务

> 项目：知枢 NexusKB；当前阶段：阶段 16——服务器上线准备；状态：进行中。

## 1. 当前目标

完成 Linux 服务器上线所需的最小可验证准备。阶段依赖、完整清单和勾选状态见[开发任务清单](./docs/05-开发任务清单.md)。

- 固定生产镜像，落实非 root、只读文件系统和最小权限。
- 配置 TLS、认证、Secret Manager，以及 PostgreSQL/Redis 持久化。
- 完成备份恢复演练、日志指标采集、压测和安全测试。
- 确认数据保留、删除策略和模型区域合规。

## 2. 当前状态

- Vue 前端、文档生命周期、管理后台、响应式与可访问性已完成。
- 本地 RAG 主链路已打通，覆盖受控 Embedding、LLM、ACL 检索、引用校验、审计、索引恢复和统一预览。
- API、Parser Worker、前端、Compose、共享契约、迁移和自动化测试的主要安全边界已建立。
- Web 组件目录已按功能归属收敛：`src/components/` 仅保留跨功能复用的 `SafeMarkdown` 与 `SourceDrawer`；一级导航页面保留在 `views` 根目录，文档管理的二级路由页面以及知识问答、历史与 Provider 设置的专用子组件分别归入 `views/documents`、`views/knowledge`、`views/history` 与 `views/provider-settings`，并按页面或功能域命名前缀；`AppShellNavIcon` 随应用壳层放入 `layouts`，CAD 鸟瞰视口类型位于 `utils/cad-overview.ts`。
- Web P1 审查问题已修复：`<768px` 的 Element Plus 输入、选择、文本域与日期输入恢复至少 16px 的计算字号，避免 iOS 聚焦自动缩放且不禁用用户缩放；页面、状态页、文档子页、来源抽屉与受控 Markdown 标题恢复 `role="heading"` / `aria-level`。Web Lint/Stylelint、类型检查、36 个测试文件 145 项测试、生产构建、文档检查与 Playwright 41/41 均通过。
- Web 页面 scoped 样式已完成命名空间复核：页面独有 class 使用页面文件名语义前缀（如 `audit-*`、`provider-*`、`documents-*`、`ingestion-*`、`knowledge-*`），不改变 `kb-*`、`el-*` 或功能子组件自身的封装 class；静态 class 统一按“页面/组件私有 class、公共结构 class、文字基类、modifier/状态”排列，文档详情、分块与预览文件标题统一使用 `kb-block__title kb-heading kb-heading--h4`；页面与受控 Markdown 标题继续通过 `role="heading"` 和 `aria-level` 保留可访问层级语义。
- Mobile 用户折叠列表的长用户名或用户 ID 现在会在状态标签和展开箭头前安全收缩并单行省略，状态与操作入口保持固定可见；浏览器回归使用完整 UUID 覆盖该布局边界。
- 真实 Chrome 重启开发服务后逐项点击 9 个一级菜单，确认所谓“刷新”来自各页面快速 API 请求立即挂载的 Element Loading 遮罩，而非浏览器整页导航；按实测 200–350ms 的本机快速请求范围，`kb-page` 遮罩现延迟 400ms 显示，快速请求不再闪屏，慢请求仍保留真实加载反馈。
- 按要求停止 5173、使用原始 `pnpm --filter @nexus-kb/web dev` 并清空旧优化缓存冷启动后，Vite 日志确认首次访问懒加载页面会逐批发现 Element Plus 组件样式并输出 `optimized dependencies changed. reloading`，这才是实际整页刷新根因。扫描全部 Vue SFC 与 `optimizeDeps.include` CSS trailing glob 均已冷启动验证无效；关闭 resolver 的逐组件样式注入、改为入口一次加载官方完整 CSS并只预优化 Element Plus 本体与图标后，再次清空缓存、停止 5173、按原命令冷启动并逐项点击全部 10 个一级入口，`AppShell` 始终保持挂载，Vite 全程没有新的依赖优化、reload 或动态模块加载失败日志。用于早期排查的运行时菜单模块预加载已删除，避免管理员登录后后台下载全部页面 JavaScript；删除后又完成一轮相同的清缓存、原命令冷启动和 10 个菜单实测，结论保持不变。
- 运行配置页已补齐由可键盘操作的 Info 图标直接打开的全屏遮罩字段说明，不再套用 Button 外框；PC/Pad 为 640px 固定高度 Dialog、移动端底部 Drawer，标题、搜索和顶部 Tab 固定，字段内容块内滚动，覆盖所有可编辑控件的用途、范围与发布限制；OCR 语言明确提示当前镜像只支持 `ch_sim,en`，不能仅靠改运行配置扩展语言。Element Table 表头背景同时调整为透明，不再绘制独立浅色填充。运行配置分区已从长表单 Anchor 改为 PC/Pad/Mobile 统一的真正 Tabs，一次只渲染当前 LLM、Rerank 与问答、上传与入库、Parser、CAD/DWG 或 Tika 分区。切换 Tab 不再定位长表单的深层 section，而是将真实外层 `kb-block` 对齐回页面内容顶部；页面仍由 `.kb-page__content` 统一滚动，没有表单嵌套滚动区。Provider 定向组件测试 7/7、Web Lint/Stylelint、类型检查和生产构建通过；未重跑 Playwright 全量。
- 阶段 4/7 的 PPTX、HTML、RTF/EML 解析预览，以及 OpenAI Embedding 运行时接入仍延期；不得描述为已交付，也不默认阻塞阶段 16。

## 3. 质量结论与上线边界

阶段 14 使用 44 条受控真实技术资料问题完成两轮评测：32 条可回答、6 条无答案、6 条无权限。私有数据集、身份映射、原始运行记录和聚合报告均不纳入 Git；仓库只保留方法与聚合结论。

| 策略                           | Recall@5 |      MRR | 引用正确率 |       P95 | 平均单题成本 |
| ------------------------------ | -------: | -------: | ---------: | --------: | -----------: |
| Vector Top 5                   |  0.71875 | 0.651042 |   0.884615 |  4,049 ms |    $0.000297 |
| Vector Top 20 + 本地 BGE Top 5 |  0.71875 | 0.520833 |       0.88 | 18,680 ms |    $0.000432 |

- 两轮无答案拒答率为 1，越权泄露率和错误率为 0，成本覆盖率为 1。
- Rerank 未提升 Recall，MRR 下降，P95 和成本上升；决策为 `keep_disabled`，继续默认关闭。
- 引用正确率低于上线参考门槛 0.9，属于必须明确接受或继续优化的质量风险。
- 上述数据来自跨页邻块切组修复前，属于历史证据，不是当前版本上线基线。上线前须用同一数据集重跑两轮，重新确认质量、延迟、成本和 Rerank 决策；重跑前保持 Rerank 关闭。

评测数据集、运行方式和决策门槛见[评测说明](./evaluation/README.md)。

## 4. 最近确认

- 浏览器 OIDC 登录已补齐 Authorization Code + PKCE `S256`：登录页会从公开 login-options 读取 public client 配置，使用一次性 state/verifier 跳转身份源并在 `/auth/callback` 兑换 access token；token 仅留在内存、统一 API client 才注入 Bearer header。隔离的 `docker:oidc` Keycloak 26.7.2 已完成真实本机回归：CORS 预检、PKCE 回调、JWT 签名/issuer/audience/claims、API session 和 `/ask` 工作台均通过。该 realm 固定回环端口、无 client secret、受控 `admin` role/claims 和忽略 Git 的临时账户密码，只用于开发测试。生产 IdP、HTTPS、实际 CORS、密钥托管、账号映射、过期与退出仍须另行验收，不得描述为生产 SSO 已验证。
- Parser warning 前端展示已统一：文档详情索引说明和入库任务 `task-warning` 复用同一字典，将重复块复用、渐进式 CAD 预览、DWG 转换、DXF 恢复/审计、OCR 低置信度、Tika fallback 与预览降级等稳定码转换为中文标题和说明；未知新码使用中文兜底并保留技术码。入库 `task-warning` / `task-error` 现共用 `kb-block__header + kb-data-fields/kb-data-field` 布局，分别使用 warning-soft/warning 与 danger-soft/danger，字段文字继承容器语义色；文档详情的 `index-warning-list` 直接组合 `kb-data-fields` 并统一承载 warning 背景与文字色，无独立职责的 `recent-jobs-item` 已删除。
- 文档删除补偿已补强：授权文档列表默认展示 `deleting` 墓碑并提供输入完整文件名后的“继续清理”，详情、分块和预览仍保持关闭；Parser 请求若在删除后才返回或失败，Consumer 会丢弃结果、回收该 documentId 的 PDF/SVG/CAD 预览并避免把已删除任务重新标记为失败。排查两条历史 DWG 墓碑时进一步确认旧 CAD bundle 目录为 `2750`，API 因缺少共享组写权限返回 `EACCES`；新产物各级目录现固定为 `2770`，两份目标旧产物已按精确 documentId 补齐组写权限。“重庆S04 AGV项目二期Layout20240806-V5.dwg”已通过正式幂等 DELETE 完成补偿：Document/全部版本为 deleted、分块与 Chroma 向量均为 0、预览目录已删除且审计已落库；另一条历史墓碑保留待单独确认。Parser CAD 定向测试 22/22 与 Ruff 定向检查通过。
- 文档高风险确认 UI 已收敛：删除待清理的“继续清理删除”、永久删除与重新/继续建立索引共用 `DocumentsDangerConfirm` 输入完整文档名的确认组件，桌面与移动端仅切换 Dialog/底部 Drawer 容器；`prepared` 状态会明确说明复用既有解析、分块和脱敏结果。组件与文档列表定向测试 9/9、Web Stylelint/Lint、类型检查和生产构建均通过。
- 全局 Element Dialog 已参考 Drawer 统一为 Header、可滚动 Body 和 Footer 三段式布局：根容器保持零 padding，PC/Pad 各分区均使用 `--kb-block-padding` 四边等宽内距，避免桌面端沿用 24px spacious padding；Header/Footer 分隔线横跨弹层两端，关闭按钮参与 Header Flex 布局。底部 Drawer 继续保留把手、圆角和安全区。
- 视觉 token 已切换为中性画布与蓝色 accent；浅色成功、警告、危险和次要文字，以及深色次要文字均按其实际 soft 背景调整至至少 4.55:1 对比度。CAD 固定深色画布不跟随主题 token。Web Stylelint/Lint、定向测试 9/9、类型检查和生产构建均通过。
- Element Button 已补齐跨主题危险 hover、禁用态和 typed plain 状态的语义配色；文档、用户与角色、配置发布表格的操作统一为 Element Plus 默认 `link` Button，不覆盖默认状态色或透明背景。全局 40px 控件高度已排除 `link`/`text`，使它们恢复官方文字高度与内边距。危险 hover 与禁用态文字对比度分别不低于 6.09:1 和 4.64:1；Web Stylelint/Lint、定向测试 10/10、类型检查和生产构建均通过。
- Element Plus 语义色阶已恢复 `light-3/5/7/8/9` 和 `dark-2` 的分级映射，避免不同 hover、plain、disabled 与 active 状态坍缩为同一 soft 色。Web Stylelint/Lint、定向测试 10/10、类型检查和生产构建均通过。
- 移动文档操作项与回答来源卡片已改为保留完整键盘语义的 `div`，不再继承通用 Button 基线：前者固定 48px 操作行，后者按内容自适应高度显示完整来源信息。Web Stylelint/Lint、相关组件测试 14/14、类型检查和生产构建均通过。
- 全局 Drawer 内置关闭按钮已提高选择器优先级，确保各页面均显示为统一的圆形控件。
- 移动导航的 `el-button is-circle` 关闭按钮已补回 `border-radius: 50%`，避免被通用 Button 圆角覆盖；已删除重复的 `mobile-sidebar-close` class，E2E 改以可访问名称定位。
- 账号管理 Dialog 已按截图回归收紧：新增账号与管理后台账号在 PC/Pad 改为两列 Grid，FormItem 去除重复底部 margin，由统一 gap 控制字段节奏；账号摘要与表单分组，Mobile 继续使用单列底部 Drawer。
- CAD 渐进预览近期已完成颜色、块展开、完整边界、主体聚焦、主体/全图切换、动态最大缩放、隐藏图元可见性和原子刷新等修复。对于转换 DXF `<=128 MiB` 且加权成本 `<=1,000,000` 的图，reindex 现按最多 150 秒及既有内存、400 万图元、1 GiB bundle 上限预建最终几何，使首次 100% 与放大后回归 100% 使用同一 overview/z0；失败继续安全保留快速总览，超大图仍走渐进细节。
- 查询链路近期已完成短中文文档线索、重复候选折叠、连续问答上下文、无权限过滤、引用校验和资料不足时拒答收敛；不因检索不足生成无关通用答案。
- 最近一次相关验证覆盖 CAD 专项、Parser 定向检查、契约、API、Web、生产构建、Compose 配置和 readiness；具体通过数及未执行项以 Git 历史和对应测试输出为准。
- 本次以一份已匿名照明平面图 DWG 完成 v10 真实重建：181 秒内激活 795/795 分块，首次访问前已有 417,525 图元最终索引；首次与“放大→重置 100%”后的 overview/z0 SHA-256 分别保持 `0a296f…bec4` / `11d914…230`，页面无控制台错误。CAD 提前成功、超时降级和 150 秒封顶定向测试 3/3、Ruff 定向检查通过；未运行 Parser/Web 全量、全仓构建或 E2E。
- 小型 CAD SVG 空白问题已定位并修复：一份测试图 SVG 内容完整，但原始 `stroke-width=1973` 在叠加 `non-scaling-stroke` 后被 Chromium 解释为 1973 屏幕像素，白色笔画覆盖整张图。Worker 现按物理宽高/viewBox 换算并限制为 1–8px，同时输出默认 SVG namespace；正式 v3 已激活，新产物从 5,693 字节调整为 5,566 字节，线宽为 1px，登录态页面确认矩形、尺寸标注和文字可见。SVG CAD 定向测试 2/2 与 Ruff 定向检查通过；本次未运行全量测试、全仓构建或 E2E。
- Web 端已补齐浅色、显式深色和系统深色的 Design Token 覆盖；Element Plus、Markdown、原始/脱敏分块对比、登录品牌区及加载遮罩均通过语义 token 适配。顶栏主题菜单支持跟随系统、浅色和深色；手动选择保存在浏览器本地，“跟随系统”会清除覆盖，不触及 API、鉴权或业务状态；CAD 预览画布继续固定为深色内容画布。验证结果以本次改动对应的 Web 定向测试、类型检查与生产构建输出为准。
- `SafeMarkdown` 已增加本地 KaTeX 公式渲染，覆盖 `\\[...\\]`、`$$...$$` 块公式与 `\\(...\\)`、`$...$` 行内公式，并兼容模型可能输出的 `[\\ ... \\]` 变体；围栏代码块保持字面代码，但会修复模型遗留的“未闭合且紧随块公式”围栏，避免历史回答整体落入 `pre`。LLM 提示词禁止以围栏包裹公式。配置关闭 trust 扩展并限制尺寸/宏展开，保留 KaTeX 必需的受控 MathML 与布局样式，长块公式可横向滚动。对应组件测试通过；全量 Web 校验以本次改动的命令输出为准。

历史实现细节、验证命令和提交记录以 Git 历史为准。当前架构、产品体验、开发规范、运维和 API 规则分别见[项目实施规格](./docs/01-项目实施规格.md)、[技术设计](./docs/02-技术设计.md)、[前端设计](./docs/03-前端产品与界面设计.md)、[开发规范](./docs/04-开发规范.md)、[部署运维手册](./docs/06-部署运维手册.md)和[API 使用说明](./docs/07-API使用说明.md)。

## 5. 阻塞与风险

- 生产上线清单尚未完成：镜像与权限、TLS/认证、密钥托管、持久化、备份恢复、监控告警、压测、安全测试和合规确认仍需逐项验收。
- 评测报告与当前实现存在边界差异，不能把历史指标或“评测完成”表述为当前版本已通过全部质量门槛。
- 若阶段 16 的压测、恢复演练或已批准业务需求证明延期解析器或 Embedding 接入是上线前置条件，应重新提高其优先级并同步代码、测试和文档。

## 6. 交付要求

完成本阶段前，必须更新本文、[开发任务清单](./docs/05-开发任务清单.md)及受影响的规格、技术、运维或 API 文档，并如实记录实际验证结果、未完成项和风险。配置、接口字段和跨服务契约分别以 `.env.example`、公开 OpenAPI 和 Parser Worker OpenAPI 为事实源。
