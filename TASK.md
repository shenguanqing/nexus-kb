# 当前开发任务

> 项目：知枢 NexusKB
> 当前阶段：阶段 15——Vue 前端
> 状态：完成（F1–F5 已实现，并通过本地、Playwright 与容器集成验收）

---

## 1. 背景

阶段 14 的可重复评测框架已经完成，但正式真实数据运行仍等待业务方批准的脱敏标注集。用户于
2026-07-18 明确授权保留阶段 14 未完成并先进入阶段 15；不得将前端推进视为质量验收通过，也不得默认启用
Rerank。

真实问题、标准答案和目标来源可能包含业务信息。仓库当前没有经过批准的真实评测集；按 confidential
零出网和日志无正文约束，不读取本地业务文档来自动编造问题，也不把合成 fixture 计为真实验收结果。

---

## 2. 阶段 15 当前目标

```text
Vue 3 + TypeScript + Vite
→ AppShell / 服务端身份摘要 / 路由 capability
→ 统一运行时校验 API client
→ 知识问答 / 无答案 / 错误重试 / 来源抽屉
→ 文档管理与入库任务
→ 管理后台与完整 E2E
```

---

## 3. 本阶段已完成

### 3.1 F1 基础框架

- [x] 创建 Vue 3、TypeScript strict、Vite、Vue Router、Pinia、Element Plus 和 Vitest 工程。
- [x] 实现 AppShell、桌面/平板/移动基础响应式、设计 token、403 和 404 页面。
- [x] 新增 `GET /v1/auth/session` 共享 Zod/OpenAPI 契约，刷新后重新取得服务端身份与 capability。
- [x] 路由 guard 区分未认证与无权限，导航隐藏只作为体验层权限控制。
- [x] 统一 API client 的 credentials、超时、运行时响应校验和安全错误映射。

### 3.2 F2 知识问答核心切片

- [x] 实现问答欢迎空态、示例问题、Enter/Shift+Enter 和输入长度限制。
- [x] 对接正式 `POST /v1/knowledge/query` 契约，不发送 tenant、角色、部门或检索过滤器。
- [x] 实现检索中、无答案、429/网络/服务错误、保留问题与重试状态。
- [x] 回答按纯文本渲染，展示仅由正文 `[来源N]` 实际引用的紧凑来源卡片、trace ID 和实际模型摘要；当前登录会话跨导航连续保留已完成问答轮次，直至点击“新建问答”。
- [x] 来源抽屉只展示后端返回的授权 metadata，并声明后续查看内容需要重新鉴权。

### 3.3 测试与视觉 QA

- [x] 覆盖 API 成功/错误映射和 AskComposer 键盘行为。
- [x] 1440×900 验证空态、提问、回答和来源抽屉；控制台无新增运行错误。
- [x] Element Plus 按需导入，避免完整组件库进入首屏包。

### 3.4 F3 文档管理与生命周期

- [x] 新增 ACL 约束下的正式文档列表、分页、文件名/状态/敏感度/部门/格式筛选契约。
- [x] 新增服务端上传大小、格式以及签名身份 metadata 选项接口，不接受客户端 tenant、角色或部门覆盖。
- [x] 实现 Vue 文档表格、URL query 筛选、空态/错误重试、分页和单文件上传入口。
- [x] 上传继续使用服务端身份的部门与默认敏感度，前端不把界面权限控制当作后端鉴权。
- [x] 新增 ACL 约束的入库任务列表/详情/重试，以及文档详情、版本、重建、永久删除和分块详情运行时契约。
- [x] 实现真实任务步骤、失败技术详情、条件轮询、可重试失败任务，以及文档版本和索引摘要页面；版本索引摘要提供 collection 标识、向量数（分块数）和写入时间。文档详情可进入按版本、服务端分页的分块详情页，展示原始/脱敏文本与位置等 metadata，但不返回向量值。
- [x] 任务重试只允许可写、失败且明确可重试的任务；文档重建保留旧版本直至新索引激活。
- [x] 文档详情与入库任务保留安全的来源路由，支持上下文返回；任务筛选支持明确状态选项和一键重置。
- [x] 用户与角色、部门权限侧栏入口补充真实点击回归覆盖；窄屏导航仍保留两个入口。

### 3.5 F4 审计中心切片

- [x] 对接正式 `GET /v1/audit/events` 运行时契约，不接受客户端 tenant 或权限范围覆盖。
- [x] 实现事件类型 URL 筛选、游标加载、空状态、错误重试和结构化事件详情。
- [x] 问答正文、回答、文档片段、来源 chunk ID 和内部 collection 不进入审计页面展示。

### 3.6 F4 Provider 与系统状态切片

- [x] 新增独立 `system:read` capability，并由服务端身份与路由双层执行体验/强制鉴权。
- [x] 对接正式 `GET /v1/system/providers`，只返回 Provider/model、域名摘要、区域、配置状态和索引指纹。
- [x] 对接正式 `GET /v1/system/status`，返回脱敏依赖健康、入库队列和原始文档磁盘使用率。
- [x] 实现 Provider 与系统状态页面；刷新状态不会触发付费模型合成调用。

### 3.7 F4 用户目录切片

- [x] 新增 `UserDirectoryEntry` migration，在会话接口只同步经过验证的 tenant、用户、部门、角色和认证时间。
- [x] 新增独立 `access:read` capability 与 `GET /v1/access/users` 正式契约；平台管理员限当前 tenant，其他调用者
      固定到自身部门。
- [x] 实现用户 ID 搜索、平台管理员部门筛选、分页、空态、错误重试与响应式用户目录页面。
- [x] 角色 mutation 使用应用托管覆盖，并在认证 guard 中参与真实授权；capability 仍来自已验证身份，不能通过角色编辑扩权。
- [x] 角色和部门策略变更写入独立访问审计，并保护最后一个有效平台管理员。

### 3.8 F2–F5 收尾

- [x] 问答历史由服务端按 tenant + user 强制隔离，支持搜索、日期筛选、详情与幂等删除；浏览器不持久化正文。
- [x] 多文件上传为每个文件维护独立状态与重试；授权 metadata 修改触发安全的新版本重建流程。
- [x] 部门敏感度策略只能收紧已验证身份声明；用量页基于现有查询审计汇总，不可用 token/成本保持未知。
- [x] Playwright 使用脱敏固定数据覆盖有来源回答、拒答、无权限路由、768px 和 Axe WCAG 2 A/AA。

### 3.9 阶段 15 后续登录与布局收尾

- [x] 新增受控账号密码认证模式、服务端 session migration、登录限速、HttpOnly Cookie、退出登录和共享
      Zod/OpenAPI 契约；密码、原始 token 和账号配置不进入浏览器持久化、日志或数据库明文。
- [x] 登录页根据公开的登录方式摘要显示账号密码表单，密码提交后立即清空；OIDC/JWT 与 development 身份模式保留。
- [x] `app-main` 与所有 `xxxx-page` 填满可用视口；页面标题与工具栏位于非滚动区，文档、入库、审计、用户、
      历史和系统页面的正文在各自内容块内滚动，移除 toolbar sticky 定位。
- [x] 移动端布局回归：移除页面标题中的重复“知枢 NexusKB”文案，来源路由返回操作统一置于 `h1` 最右侧；640px
      下底部导航、日期范围、Provider、系统说明与用量布局保持在容器内。表格与可滚动列表仅在内容块内滚动，并冻结表头或标题；`page-content` 与文档详情不再整体横向滚动。
- [x] 前端信息架构与移动端收尾：桌面端采用分组侧边栏、顶部面包屑和高密度卡片内容区；移动端改为完整权限入口的 Drawer、44px 触控控件和单列卡片表格。`document-detail-page` 在 1240px 以下改为纵向操作区，所有页面标题统一为分类、标题、说明和返回操作结构。
- [x] 响应式细节收尾：文档管理在 900–1240px 使用弹性筛选 Grid 且内容块内固定表头；640px Drawer/弹框遮罩覆盖 shell、顶部高度统一，工具栏查询与重置保持成组。详情信息改用 Element 描述组件或 `div + Flex/Grid`，详情操作区使用独立卡片外观。
- [x] 截图回归修复：全断点弹框遮罩覆盖侧栏，审计表由表格自身滚动以固定表头；640px 下历史、文档与审计筛选均保持可读的紧凑网格，移动断点切换不保留桌面侧栏折叠状态。
- [x] 窄屏导航回归：641–900px 统一使用 Drawer，删除难以操作的图标侧栏；所有 Dialog 通过 body Teleport 全局遮罩，并在移动端限制为安全视口宽高。
- [x] 上传体验回归：文本文件使用流式 UTF-8 校验，避免多字节字符跨 8 KiB 边界时误报；上传弹窗每次打开清空上次选择，整批成功进入队列后自动关闭。
- [x] 入库体验与复杂 CAD 回归：上传状态标签列对齐，进行中任务耗时每秒刷新并在结束后冻结；实测
      `E-一区一层照明平面图.dwg` 遍历 348,256 个实体、输出 3,321 个元素后，将受 schema 硬上限保护的
      `MAX_CAD_ENTITIES` 默认值从 200,000 调整为 500,000；手动重试重新计算本轮耗时。
- [x] 实测 `2、2#教学楼弱电平面图20200530.dwg` 遍历 774,303 个实体、输出 989 个元素，将默认
      `MAX_CAD_ENTITIES` 受控提高至 1,000,000（schema 硬上限仍为 2,000,000）；Worker 资源限制错误通过
      allowlist 稳定码传至 API 和任务详情，不再全部显示为 `PARSER_INVALID_REQUEST`。

### 3.10 本地 Provider 与待建立索引恢复

- [x] 新增受控本机 Ollama Embedding Provider，支持 `bge-m3:latest` / 1024 维度，无需 API Key；容器仅可访问
      `host.docker.internal:11434` 或内部 `ollama:11434`，并有配置、Provider、云策略和 Factory 测试。
- [x] Google `gemini-3.5-flash-lite` 请求省略该模型已废弃的 `temperature` 参数。
- [x] `prepared` 文档可在配置 Embedding 后通过“继续建立索引”恢复为 `local_prepared`，复用本地分块而不重新上传或解析。
- [x] 文档状态由容易误解的“待激活”调整为“待建立索引”，并补充本地启动、Ollama、Gemini、DWG、数据存储与 Vetur/Volar 指南。

### 3.11 DWG 本地优先验证

- [x] 新增 `compose.dwg.yaml` 与受控 ODA 派生 Parser Worker：仅从本地忽略目录安装经批准的 Linux x64 Debian 包，
      Apple Silicon Mac 通过 Docker Desktop 的 `linux/amd64` 兼容层运行；不会将 ODA 二进制、许可证或凭据纳入 Git。
- [x] 已从 ODA 官方页面取得 Linux x64 Debian 包（`odafileconverter` `27.1.0.0`，SHA-256
      `c71363cd54758177af47a365154f180dc50a1e2b52a131994fda541c13a36766`），并在 `linux/amd64`
      派生镜像中验证启动器、运行库和 Worker readiness；本地 `.env` 已使用该实际版本启用转换。
- [x] 已在最终只读 Worker 中实际转换并解析已上传的 `Drawing1.dwg`：得到 9 个元素，parser version 为
      `oda-27.1.0.0+ezdxf-1.4.4`；ODA 使用私有 tmpfs 源副本和官方 `*.dwg` 过滤器，不扫描其他上传文件。
- [x] 已以 `compose.yaml + compose.dwg.yaml` 重建本地 API 与 Worker；Worker `/health/ready` 报告
      `dwgConverter.status=up`，修复了仅使用基础 Compose 镜像导致的 `PARSER_UNAVAILABLE`。
- [x] DWG 转换改为本地默认启动路径：`.env.example`、配置默认值、Compose fallback 与 README 均要求使用
      `compose.yaml + compose.dwg.yaml` 的 ODA 派生 Worker；没有 ODA 时默认失败关闭，不能静默降级。
- [ ] 在已登录的本地 Web 页面为失败任务点击“重试”，完成 `Drawing1.dwg` 的索引与 Gemini 问答端到端冒烟验证
      （服务端鉴权保持启用，Gemini 仅在检索到来源后调用）。
- [x] 无有效 `[来源N]` 的 LLM 文本不再作为 Provider 502 返回；改为安全的无答案响应，保留“只能返回可核验来源”规则。
- [x] 若 Gemini 已调用但因“资料不足”或缺少有效引用而安全拒答，`QueryAudit` 仍保留实际 LLM Provider/model；
      未进入 LLM 的检索拒答仅显示 Embedding Provider。
- [x] 修复 `vue2` / `vue 2` 等语义等价问法结果不一致：查询链路统一产品版本号空格，引用不可核验时使用
      相同授权上下文受控修复一次，仍失败则记录 `LLM_ANSWER_UNVERIFIABLE` 并安全拒答。
- [x] 上传多文件时限制 `upload-file-list` 高度并在弹框块内独立滚动，避免撑高页面产生 Y 轴滚动。
- [x] 问答正文中的 `[来源N]` 改为小号次要色行内标记，与正文建立清晰视觉层级。

---

## 4. 阶段 15 验证状态

- [x] `pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm build` 通过。
- [x] `pnpm --filter @nexus-kb/web test:e2e` 6/6 通过，覆盖账号密码登录、固定 shell 与块内滚动。
- [x] Docker API 镜像构建、Prisma migration、ready 检查和 PostgreSQL/Redis/Chroma 集成测试通过。

---

## 5. 阶段 14 保留未完成

仍需业务方提供 30–100 条真实脱敏标注集、实际 ACL identity profile、两轮受控 Provider 运行和成本归属。
Rerank 继续默认关闭；后续取得数据时返回阶段 14 完成正式验收。

---

## 6. 下一开发入口

阶段 15 已完成。本地 Ollama / Gemini 配置与待建立索引恢复已补齐。当前优先入口为第 3.11 节的真实
`Drawing1.dwg` Web 端到端验证：ODA Linux x64 包和转换器已就绪，但服务端鉴权保持启用，需要已登录的本地
会话完成上传。阶段 14 的真实数据质量验收仍按第 5 节保留；完成 DWG 验证后再进入阶段 16 服务器上线准备。
