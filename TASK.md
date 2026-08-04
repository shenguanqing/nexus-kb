# 当前开发任务

> 项目：知枢 NexusKB
> 当前阶段：阶段 15——Vue 前端
> 状态：完成（F1–F5 已实现，并通过本地、Playwright 与容器集成验收）

---

## 1. 背景

阶段 14 的可重复评测框架已经完成，但正式真实数据运行仍等待业务方批准的脱敏标注集。用户于 2026-07-18 明确授权保留阶段 14 未完成并先进入阶段 15；不得将前端推进视为质量验收通过，也不得默认启用 Rerank。

真实问题、标准答案和目标来源可能包含业务信息。仓库当前没有经过批准的真实评测集；按 confidential 零出网和日志无正文约束，不读取本地业务文档来自动编造问题，也不把合成 fixture 计为真实验收结果。

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
- [x] 回答按受控 Markdown 渲染，展示仅由正文 `[来源N]` 实际引用的紧凑来源卡片、trace ID 和实际模型摘要；当前登录会话跨导航连续保留已完成问答轮次，直至点击“新建问答”。
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
- [x] 新增独立 `access:read` capability 与 `GET /v1/access/users` 正式契约；管理员限当前 tenant，其他调用者固定到自身部门。
- [x] 实现用户 ID 搜索、管理员部门筛选、分页、空态、错误重试与响应式用户目录页面。
- [x] 角色 mutation 使用应用托管覆盖，并在认证 guard 中参与真实授权；capability 仍来自已验证身份，不能通过角色编辑扩权。
- [x] 角色和部门策略变更写入独立访问审计，并保护最后一个有效管理员。
- [x] 应用角色收敛为 `user`/`admin`，保留 capability 与 ACL 独立校验，并提供旧角色的降权迁移。
- [x] `user` 侧栏与前端路由只保留知识问答、问答历史；管理页面同时要求 `admin` 和对应 capability。
- [x] 管理员全权账号管理：`admin` 自动获得当前 tenant 的全部应用 capability 与敏感度范围；本地密码账号在数据库以 scrypt 摘要保存，首次仅从受保护的 `PASSWORD_AUTH_USERS_JSON` 引导，之后可在“用户与角色”页面创建、编辑、禁用、重置密码和删除。所有变更撤销必要会话并写入访问审计；最后一个管理员不可删除、禁用或降级，管理员也不能删除、禁用或降级自己；tenant 隔离与 confidential 数据出网策略保持强制执行。
- [x] 管理员配置发布：Provider/问答/Parser 运行参数由前端创建加密的不可变配置版本，密钥只写入不回显；独立 `deployment-agent` 仅按服务端计算的 `api`、`parser-worker`、`reranker-worker` 白名单执行 Compose 重建，readiness 失败自动恢复上一版本，页面显示结果并支持受控回滚。Embedding 向量空间配置不进入普通重启流程。

### 3.8 F2–F5 收尾

- [x] 问答历史由服务端按 tenant + user 强制隔离，支持搜索、日期筛选、详情与幂等删除；浏览器不持久化正文。
- [x] 多文件上传为每个文件维护独立状态与重试；授权 metadata 修改触发安全的新版本重建流程。
- [x] 部门敏感度策略只能收紧已验证身份声明；用量页基于现有查询审计汇总，不可用 token/成本保持未知。
- [x] Playwright 使用脱敏固定数据覆盖有来源回答、拒答、无权限路由、768px 和 Axe WCAG 2 A/AA。

### 3.9 阶段 15 后续登录与布局收尾

- [x] 配置文档收敛：根目录 `.env.example` 为唯一完整可复制配置清单，每个配置项均有紧邻的中文用途说明；技术设计、开发规范与部署手册已同步到现行变量命名，场景文档不再维护重复全量配置。

- [x] 新增受控账号密码认证模式、服务端 session migration、登录限速、HttpOnly Cookie、退出登录和共享 Zod/OpenAPI 契约；密码、原始 token 和账号配置不进入浏览器持久化、日志或数据库明文。
- [x] 登录页根据公开的登录方式摘要显示账号密码表单，密码提交后立即清空；OIDC/JWT 与 development 身份模式保留。
- [x] `app-main` 与所有 `xxxx-page` 填满可用视口；页面标题与工具栏位于非滚动区，文档、入库、审计、用户、历史和系统页面的正文在各自内容块内滚动，移除 toolbar sticky 定位。
- [x] 移动端布局回归：移除页面标题中的重复“知枢 NexusKB”文案，来源路由返回操作统一置于 `h1` 最右侧；375px下底部导航、日期范围、Provider、系统说明与用量布局保持在容器内。表格与可滚动列表仅在内容块内滚动，并冻结表头或标题；`page-content` 与文档详情不再整体横向滚动。
- [x] 前端信息架构与移动端收尾：桌面端采用分组侧边栏、顶部面包屑和高密度卡片内容区；移动端改为完整权限入口的 Drawer、44px 触控控件和单列卡片表格。`document-detail-page` 按侧栏后的实际内容宽度连续重排操作区与信息卡，所有页面标题统一为分类、标题、说明和返回操作结构。
- [x] 响应式细节收尾：文档管理在 901–1279px 使用弹性筛选 Grid 且内容块内固定表头；375px Drawer/弹框遮罩覆盖 shell、顶部高度统一，工具栏查询与重置保持成组。详情信息改用 Element 描述组件或 `div + Flex/Grid`，详情操作区使用独立卡片外观。
- [x] 截图回归修复：全断点弹框遮罩覆盖侧栏，审计表由表格自身滚动以固定表头；375px 下历史、文档与审计筛选均保持可读的紧凑网格，移动断点切换不保留桌面侧栏折叠状态。
- [x] 窄屏导航回归：768–900px 统一使用 Drawer，删除难以操作的图标侧栏；所有 Dialog 通过 body Teleport 全局遮罩，并在移动端限制为安全视口宽高。
- [x] 上传体验回归：文本文件使用流式 UTF-8 校验，避免多字节字符跨 8 KiB 边界时误报；上传弹窗每次打开清空上次选择，整批成功进入队列后自动关闭。
- [x] 入库体验与复杂 CAD 回归：上传状态标签列对齐，进行中任务耗时每秒刷新并在结束后冻结；实测 `E-一区一层照明平面图.dwg` 遍历 348,256 个实体、输出 3,321 个元素后，将受 schema 硬上限保护的 `MAX_CAD_ENTITIES` 默认值从 200,000 调整为 500,000；手动重试重新计算本轮耗时。
- [x] 实测 `2、2#教学楼弱电平面图20200530.dwg` 遍历 774,303 个实体、输出 989 个元素，将默认 `MAX_CAD_ENTITIES` 受控提高至 1,000,000（schema 硬上限仍为 2,000,000）；Worker 资源限制错误通过 allowlist 稳定码传至 API 和任务详情，不再全部显示为 `PARSER_INVALID_REQUEST`。

### 3.10 本地 Provider 与待建立索引恢复

- [x] 新增受控本机 Ollama Embedding Provider，支持 `bge-m3:latest` / 1024 维度，无需 API Key；容器仅可访问 `host.docker.internal:11434` 或内部 `ollama:11434`，并有配置、Provider、云策略和 Factory 测试。
- [x] Google `gemini-3.5-flash-lite` 请求省略该模型已废弃的 `temperature` 参数。
- [x] `prepared` 文档可在配置 Embedding 后通过“继续建立索引”恢复为 `local_prepared`，复用本地分块而不重新上传或解析。
- [x] 文档状态由容易误解的“待激活”调整为“待建立索引”，并补充本地启动、Ollama、Gemini、DWG、数据存储与 Vetur/Volar 指南。

### 3.11 DWG 本地优先验证

- [x] 新增 `compose.dwg.yaml` 与受控 ODA 派生 Parser Worker：仅从本地忽略目录安装经批准的 Linux x64 Debian 包，Apple Silicon Mac 通过 Docker Desktop 的 `linux/amd64` 兼容层运行；不会将 ODA 二进制、许可证或凭据纳入 Git。
- [x] 已从 ODA 官方页面取得 Linux x64 Debian 包（`odafileconverter` `27.1.0.0`，SHA-256 `c71363cd54758177af47a365154f180dc50a1e2b52a131994fda541c13a36766`），并在 `linux/amd64` 派生镜像中验证启动器、运行库和 Worker readiness；本地 `.env` 已使用该实际版本启用转换。
- [x] 已在最终只读 Worker 中实际转换并解析已上传的 `Drawing1.dwg`：得到 9 个元素，parser version 为 `oda-27.1.0.0+ezdxf-1.4.4`；ODA 使用私有 tmpfs 源副本和官方 `*.dwg` 过滤器，不扫描其他上传文件。
- [x] 已以 `compose.yaml + compose.dwg.yaml` 重建本地 API 与 Worker；Worker `/health/ready` 报告 `dwgConverter.status=up`，修复了仅使用基础 Compose 镜像导致的 `PARSER_UNAVAILABLE`。
- [x] DWG 转换改为本地默认启动路径：`.env.example`、配置默认值、Compose fallback 与 README 均要求使用 `compose.yaml + compose.dwg.yaml` 的 ODA 派生 Worker；没有 ODA 时默认失败关闭，不能静默降级。
- [ ] 在已登录的本地 Web 页面为失败任务点击“重试”，完成 `Drawing1.dwg` 的索引与 Gemini 问答端到端冒烟验证（服务端鉴权保持启用，Gemini 仅在检索到来源后调用）。
- [x] 无有效 `[来源N]` 的知识库 LLM 文本不再作为 Provider 502 返回；严格模式安全拒答，混合模式切换为不携带文档上下文、明确标记的通用知识补充。
- [x] 若 Gemini 已调用但因“资料不足”或缺少有效引用而安全拒答，`QueryAudit` 仍保留实际 LLM Provider/model；未进入 LLM 的检索拒答仅显示 Embedding Provider。
- [x] 修复 `vue2` / `vue 2` 等语义等价问法结果不一致：查询链路统一产品版本号空格，引用不可核验时使用相同授权上下文受控修复一次，仍失败则记录 `LLM_ANSWER_UNVERIFIABLE` 并安全拒答。
- [x] 上传多文件时限制 `upload-file-list` 高度并在弹框块内独立滚动，避免撑高页面产生 Y 轴滚动。
- [x] 问答正文中的 `[来源N]` 改为小号次要色行内标记，与正文建立清晰视觉层级。
- [x] `answer-text` 与 `history-answer` 统一使用严格清洗的 Markdown 渲染：支持标题、段落、列表、引用、代码、表格、强调和安全链接；禁用原始 HTML、图片、脚本、iframe、事件属性、内联样式和危险协议，外链统一增加 `noopener noreferrer`，并保留 `[来源N]` 行内标记。
- [x] 查询默认改为混合回答模式：有知识库依据时保持来源强校验；无充分依据或引用修复仍失败时，只发送经过出网策略检查的问题并返回 `answerMode=general`。实时回答、历史和审计明确标记“通用知识补充”，权限变化、confidential 阻止与正式质量评测仍保持严格模式。

### 3.12 本地启动与数据库调试文档

- [x] README 与部署运维手册明确：执行 DWG Worker 的 `docker compose build` 前必须启动 Docker Desktop，并先通过 `docker info` / `docker compose version` 验证 Docker Engine；两处均补齐专用 Worker 构建、合并配置校验、整套服务启动和状态检查的完整命令序列。
- [x] 明确 `.env` 变更按实际读取服务重建：主服务配置重建 `api`，解析/CAD 配置重建 `parser-worker`， `PARSER_INTERNAL_TOKEN` 同时重建两端；普通运行配置变化不要求重新构建镜像。
- [x] 明确 PostgreSQL 初始化账号、数据库和密码在已有 volume 上不会因重建容器自动变更，禁止使用 `down -v` 作为配置重载方式。
- [x] 新增仅绑定 `127.0.0.1:15432` 的 `compose.db-gui.yaml` 和 DBeaver 只读查看说明；生产环境仍不暴露 PostgreSQL。
- [x] README 补全基础、DWG、DBeaver 及组合模式的固定 Compose 文件前缀，完善依赖健康分项诊断、已有 volume 的数据库密码同步流程、URL 密码编码提示和 PostgreSQL/Chroma 数据归属说明。

### 3.13 API 使用说明

- [x] 新增 `docs/07-API使用说明.md`，将 README 的接口调用清单迁入，并补全认证模式、trace ID、错误结构、capability/ACL、全部公开端点、分页、状态语义、重试规则和安全调用示例。
- [x] README 收敛为 API 文档与 OpenAPI 契约入口，不再维护重复的 curl 端点清单。
- [x] 修正 OpenAPI 文档漂移：补充 live/ready 健康端点、密码会话 Cookie security scheme，以及知识问答和历史轮次的 `answerMode` 字段。
- [x] 同步 AGENTS、实施规格、技术设计、前端设计、开发规范、任务清单和运维手册中的 API 文档索引。
- [x] 重构 README 的信息层级，新增零模型/零 ODA 的新手基础模式、分步骤启动流程和常见问题 FAQ，并将 Ollama、完整 RAG、DWG 与数据库调试下沉为按需章节。
- [x] 新增 `apps/README.md` 及 API、Web、Parser Worker 目录级 README，集中说明模块入口、调用关系、开发命令、安全边界和当前解析算法，避免为每个源文件维护易漂移的独立说明。

---

## 4. 阶段 15 验证状态

- [x] `pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm build` 通过。
- [x] `pnpm --filter @nexus-kb/web test:e2e` 14/14 通过，覆盖账号密码登录、固定 shell、块内滚动与响应式布局。
- [x] Docker API 镜像构建、Prisma migration、ready 检查和 PostgreSQL/Redis/Chroma 集成测试通过。

---

## 5. 阶段 14 保留未完成

仍需业务方提供 30–100 条真实脱敏标注集、实际 ACL identity profile、两轮受控 Provider 运行和成本归属。Rerank 继续默认关闭；后续取得数据时返回阶段 14 完成正式验收。

---

## 6. 下一开发入口

阶段 15 已完成。本地 Ollama / Gemini 配置与待建立索引恢复已补齐。当前优先入口为第 3.11 节的真实 `Drawing1.dwg` Web 端到端验证：ODA Linux x64 包和转换器已就绪，但服务端鉴权保持启用，需要已登录的本地会话完成上传。阶段 14 的真实数据质量验收仍按第 5 节保留；完成 DWG 验证后再进入阶段 16 服务器上线准备。

- [x] P0 解析能力补齐第一批：API/契约/Web 已接受 PDF、PNG、JPG、JPEG；Worker 使用本地 Unstructured 与 EasyOCR，增加 PDF 页数、图片像素、离线模型和 OCR 置信度限制，并通过 ARM64 镜像内真实 PDF/OCR 冒烟验证。EasyOCR 用户网络目录固定为 Parser tmpfs，避免最终只读 Worker 写入 `~/.EasyOCR` 导致图片任务失败。
- [x] Parser Worker 首次构建加固：常规依赖显式使用官方 PyPI 并配置有限重试/超时；EasyOCR 模型下载与依赖层分离，断流时清理残包并有限重试。ARM64 与 ODA `linux/amd64` 镜像均完成重建，`pnpm docker:up:all` 与 API readiness 验证通过。
- [x] Apple Silicon 本地 DWG/OCR Worker 拆分：常规文件由原生 `parser-worker` 处理，API 仅把 DWG 路由到 `linux/amd64` 的 ODA `parser-worker-dwg`；两个内部 Worker 都通过独立 readiness 验证，避免 x86 模拟拖慢图片 OCR。
- [x] P0 受控 Tika 兜底：固定版本服务只连接内网；Unstructured 非安全校验失败或空结果时 fallback，含 readiness、超时、返回体上限、warning 和真实 PDF 冒烟验证。
- [ ] P0 解析能力后续：提交固定 PDF/图片测试样本，并完成上传到索引的容器集成测试。

- [x] 新增 Stylelint CSS 声明语义排序配置及独立检查/自动修复命令，覆盖 CSS、SCSS 和 Vue SFC；现有大文件样式不在本次配置变更中批量重排。
- [x] 为 Playwright E2E 增加独立 TypeScript project reference，修复编辑器 ESLint Project Service 无法解析 `apps/web/e2e` 测试文件的问题。
- [x] 修复 LLM 响应正文读取期间的超时分类：主模型故障切换备用模型后，备用模型的 `AbortError` 现返回可重试的 `LLM_TIMEOUT`，不再误报 `LLM_INVALID_RESPONSE`；Google 与 OpenAI-compatible adapter 均覆盖回归测试。
- [x] 新增默认关闭的本地 BGE Rerank：独立内网 `reranker-worker` 运行 `BAAI/bge-reranker-v2-m3`，主服务经 ACL/策略检查后仅发送有限候选文本，Worker 仅返回原始索引与相关度分数；本机与云端配置/Provider 测试覆盖，失败安全降级为向量排序。
- [x] Provider 页面将本地 BGE Rerank 的凭据状态与本机 Ollama Embedding 对齐，显示“本地无需凭据”；内部 Worker token 仍只用于服务间认证且不回显。
- [x] 回答来源卡片与来源详情抽屉仅展示服务端实际返回的位置和章节 metadata；无位置时保留文档名与版本，移除“位置未标注”等无效占位，并将查看文档操作固定在抽屉底部以预留后续预览区域。

### 6.1 Web 与移动端兼容规范收敛（2026-07-26）

- [x] 新增唯一 `breakpoints.scss` 与 `useBreakpoint()`；壳层不再自行调用 `matchMedia`。
- [x] 文档、审计、用户、版本和用量表格按同一数据源在 `<=900px` 切换为移动端卡片，不保留 CSS 隐藏的桌面表格。
- [x] 文档、入库、审计、用户与历史筛选在移动端收纳为底部 Drawer；上传、角色编辑和文档高风险确认按手机 Drawer 规则切换。
- [x] 来源、部门权限与入库步骤条补齐手机全屏/垂直布局；文档危险操作保留输入文件名的强确认。
- [x] Playwright 回归：375px、768px、900px、1280px，覆盖无横向溢出、Drawer 导航、卡片/表格结构切换和可访问性。
- [x] 截图显示回归：修复审计/用户桌面表格与空状态并存、历史列表分页未固定、文档/Provider 受限宽度换行、手机纵向步骤条撑高和部门卡片自动行拉伸；430px 回归断言步骤条紧凑、部门卡片间距固定。
  - [x] 分页与筛选体验收敛：文档、分块、入库、审计、用户和历史共用底部 `list-pagination` 样式与位置，并统一使用 `prev, pager, next` 分页格式；审计 cursor 记录通过受控游标页栈呈现页码翻页。手机端筛选统一置于工具栏右侧，筛选 Drawer 统一为 `72%` 视口高度；用户与部门摘要改为折叠卡片。
  - [x] 审计分页总数修复：接口按 tenant 与事件类型返回准确 `total`，前端分页绑定真实记录总数，同时保留 cursor 页栈的顺序翻页约束。
  - [x] 权限编辑体验收敛：手机端“编辑角色”和“编辑权限”在已展开的用户/部门卡片内直接编辑并保存，不再额外打开 Drawer；桌面端角色编辑使用标准 `el-dialog`。空问答历史不渲染分页，审计表与底部分页合并为同一内容卡片，避免表格列与分页背景被裁切。
  - [x] 移动端浮层层级：`el-config-provider` 将 Element Plus 浮层基线设为 `5000`，移除覆盖组件层级的全局 Overlay 强制值；确保筛选 Drawer、文档权限 metadata 弹框中的 Select、日期选择器等 `el-popper` 位于所属 Overlay 之上。
  - [x] 弹框基础样式回归：动态 `ElDialog/ElDrawer` 显式引入 Element Plus Dialog/Drawer CSS；上传与权限 metadata 弹框恢复桌面居中限宽、手机安全高度、正文独立滚动和固定 footer，手机上传入口不显示拖放文案。
  - [x] 文档 metadata 编辑：将“修改权限 metadata”从动态 Dialog/Drawer 组件改为明确的桌面 Dialog 与手机全屏 Drawer，统一表单控件宽度和页脚操作组，避免弹框内容渲染异常。
  - [x] 移动端标签与输入收敛：展示性 `p`、`dl/dt/dd`、`ul/li`（包括受控 Markdown 输出）统一为 `div + class`；问答改用 Element Plus 多行输入，手机端可聚焦输入控件至少 `16px`，防止 iOS 聚焦自动缩放页面。
  - [x] 文档详情移动端回归：权限、重建与删除操作在两列网格中自动换行，删除操作独占一行；详情卡片标题支持换行，避免 393px 视口截断内容。
  - [x] 移动端历史与标题收敛：历史页拆分为会话列表和详情的独立滚动区，增大行与删除触控区；展示性标题（包括 Markdown）统一为带无障碍层级的 `div + class`，页面区块采用统一移动端间距 token。
  - [x] 手机横屏回归：为 `<=900px`、高度 `<=500px` 的横屏低高度场景增加压缩顶栏、标题区和双栏内容规则；375px 及 852×393 横屏回归均检查全部已授权页面无横向溢出。
  - [x] 移动端时间与介绍区回归：日期范围控件与弹层限制在安全视口内，筛选 Drawer 统一提升至 `72%` 高度并可滚动；审计、用户目录、Provider 和系统状态顶部介绍区共用同一视觉规格。
  - [x] 桌面内容区回归：文档筛选不再将侧栏后的可用宽度误判为完整视口；详情页由统一间距 token 控制区块距离，并在浏览器实时缩放时按实际内容宽度重排，窄桌面操作组不再被裁切。
- [x] 页面布局收敛：顶部留白移至 `app-main`，统一各管理页工具栏面板和紧凑无分割线分页；620px 文档详情操作区不再被 Flex 基准高度撑开，手机历史筛选日期控件与 Provider 介绍/卡片保持容器内可读。
- [x] 移动端介绍与筛选收敛：Provider 与系统状态分别使用自适应高度的专属 intro 类，不复用带最小高度的系统介绍布局；历史、审计、用户、文档与入库的“筛选”入口统一位于对应 `xxxx-toolbar` 面板内。
  - [x] 日期与筛选文案收敛：历史与用量页面的时间范围改为“开始时间 / 结束时间”两个独立日期时间选择器，移除 `datetimerange`；所有提交筛选操作统一命名为“筛选”，不再混用“查询”或“应用”。
  - [x] 移动端补充回归：文档分块页在手机上使用紧凑页码且保持不透明底部分页栏；用量与成本的时间筛选收纳至底部 Drawer，横屏低高度场景压缩介绍区并保留内容块滚动空间。
  - [x] 横屏可操作性回归：用户目录与部门权限使用独立可滚动内容容器；历史筛选右对齐；导航 Drawer 顶栏与应用顶栏统一为 48px；用量、Provider、系统状态及各工具栏收敛为低高度单行布局。Playwright 使用长列表实际验证 `scrollTop` 可写入。
  - [x] 管理页工具栏命名与层级收敛：用户目录身份摘要和筛选合并为单一 `access-toolbar`；Provider、系统状态和用量统一采用 `xxxx-toolbar` 命名；用量桌面端介绍与筛选纵向排列，移动端任务、审计、Provider、系统状态和用量工具栏保持单行操作。
  - [x] 问答历史布局收敛：桌面端 `history-layout` 使用可伸展的主行填满筛选栏以下空间，左侧会话列表与右侧详情保持独立滚动。
