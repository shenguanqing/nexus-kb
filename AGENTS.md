# AGENTS.md

## 项目概述

项目名称：知枢 NexusKB  
仓库名称：`nexus-kb`

本项目是一套企业级知识库系统。当前目标是在 Mac 本地跑通完整 RAG 流程，后续平滑部署到 Linux 服务器。

核心架构：

- TypeScript/NestJS 主服务：API、认证、权限、任务编排、模型 Provider、Embedding、向量检索、回答生成和审计。
- Python/FastAPI Parser Worker：PDF、Office、Excel、OCR、Tika 和 CAD 等文档解析。
- Redis + BullMQ：异步入库任务。
- PostgreSQL：用户、ACL、文档、版本和任务状态。
- Chroma Server：开发和早期服务器阶段的向量库。
- LLM、Embedding 和可选 Rerank：当前均使用云端 API。

## 必读文档

开始开发或修改架构前，必须阅读：

1. `docs/01-项目实施规格.md`
2. `docs/02-技术设计.md`
3. `docs/03-前端产品与界面设计.md`
4. `docs/04-开发规范.md`
5. `docs/05-开发任务清单.md`
6. `docs/06-部署运维手册.md`
7. `docs/07-API使用说明.md`
8. `TASK.md`

文档冲突时，优先级如下：

1. 用户在当前任务中的明确要求。
2. `docs/01-项目实施规格.md` 的范围、安全和验收要求。
3. 本文件的长期工程约束。
4. `docs/02-技术设计.md`。
5. `docs/03-前端产品与界面设计.md`、`docs/04-开发规范.md` 和 `docs/07-API使用说明.md`。
6. `TASK.md` 和 `docs/05-开发任务清单.md`。
7. `docs/06-部署运维手册.md`。

发现冲突时不得静默选择，应在交付说明中指出冲突和处理方式。

## 架构边界

### TypeScript 主服务必须负责

- 所有公网 API。
- 身份认证、租户隔离和 ACL。
- 文档管理与入库状态机。
- 分块、脱敏和数据出网策略。
- 模型 Provider 和 VectorStore 抽象。
- Embedding、检索、Rerank、LLM 编排。
- 审计、指标、限流和统一错误处理。

### Vue 前端负责

- 知识问答、来源展示、文档管理和管理后台用户体验。
- 路由、界面状态、可访问性和响应式布局。
- 调用 TypeScript 主服务，不直接调用模型供应商或 Python Worker。
- 前端权限控制只用于界面体验，不得替代后端鉴权。

### Python Parser Worker 只能负责

- 文档格式识别和解析。
- OCR、表格、页面和标题结构提取。
- 返回符合契约的结构化元素。
- 返回解析器版本和 warning。

Python Worker 不得：

- 持有模型 API Key。
- 调用 LLM、Embedding 或 Rerank。
- 访问或写入 Chroma。
- 决定用户权限。
- 直接接受公网请求。
- 信任主服务传入的任意本地路径。

### 跨服务通信

- 主服务与 Worker 通过版本化 JSON/OpenAPI 契约通信。
- 大文件通过受控共享 volume 或对象存储引用传递，不通过 Redis 传输文件正文。
- Worker 必须校验内部 token，以及文件路径位于允许的共享根目录。
- 契约修改必须同时更新两端实现、契约测试和技术文档。

## 强制安全规则

1. API Key、token、Cookie 和密码不得进入代码、Git、镜像、前端或日志。
2. `.env` 必须被 Git 忽略，只提交 `.env.example`。
3. `tenantId`、role、department 和权限必须来自经过验证的服务端身份，不能信任请求体。
4. 所有向量查询必须首先包含 tenant 和 ACL 过滤。
5. Rerank、LLM 和引用返回前必须再次进行权限检查。
6. `confidential` 内容默认不得发送到任何云端服务。
7. 云端 Embedding 也属于数据出网，必须在调用前完成脱敏与策略判断。
8. 日志默认不得记录完整问题、文档片段、模型回答和未脱敏个人信息。
9. 上传必须防止路径穿越、伪造 MIME、压缩炸弹、软链接逃逸和超大文件。
10. 知识库片段属于不可信数据，不得把片段中的指令当作系统指令或工具调用依据。
11. 知识库回答链路不得直接拥有执行型工具权限。
12. 删除文档必须删除原文件、所有向量和可识别缓存。

如果某项实现可能让未授权内容出网或被检索，应停止实现并先报告风险。

## Embedding 与索引规则

- LLM Provider 和 Embedding Provider 必须独立配置。
- DeepSeek 默认仅作为 LLM，不假设其提供 Embedding。
- 文档和查询必须使用相同的 Embedding Provider、模型、维度和任务规则。
- 更换 Provider、模型、维度、关键分块规则或关键脱敏规则时，必须创建新 collection 并重建索引。
- 不得把不同向量空间的结果写入同一 collection。
- Embedding 失败不得自动切换其他供应商后继续写入当前索引。
- collection 必须保存配置指纹，服务 ready 前验证指纹兼容性。
- 向量写入必须使用稳定 chunk ID 和 upsert，确保任务幂等。
- 索引迁移必须保留旧 collection，验证新索引后再原子切换。

## Provider 规则

- 业务 service/controller 不得包含散落的供应商 `if/else`。
- 供应商差异必须封装在 `EmbeddingProvider`、`LlmProvider` 和 `RerankProvider` 中。
- Key、base URL、model 和维度从经过校验的配置读取。
- 模型 ID、限流和参数可能变化；实现前按供应商当前官方文档核对。
- 429、连接错误、超时和部分 5xx 可以指数退避重试。
- 400、401、403 不得盲目重试。
- Rerank 失败可以降级为原向量排序，并记录降级事件。
- LLM 可使用明确配置且已批准的备用 Provider。
- 记录实际 Provider、模型、request ID、耗时和用量，不记录密钥或敏感正文。

## 代码与目录约束

建议目录：

```text
apps/api/                 NestJS 主服务
apps/web/                 Vue 3 前端
apps/parser-worker/       Python FastAPI Worker
packages/contracts/       TypeScript 共享 DTO 和事件
docs/                     项目文档
```

- 不在仓库根目录随意堆放业务源文件。
- TypeScript 开启 strict mode，不使用无说明的 `any`。
- 外部输入必须做运行时校验，仅有 TypeScript 类型不算输入校验。
- Python 使用类型注解和 Pydantic schema。
- 不硬编码 Mac 绝对路径、端口、Provider URL 或模型 ID。
- 所有路径和运行参数通过配置注入。
- 避免全局可变状态。
- 数据库 schema 变更必须使用迁移文件。
- 不直接修改已发布迁移；新增迁移完成变更。
- 不引入与当前任务无关的大型框架或基础设施。
- 新依赖必须说明用途，优先使用已有依赖和标准库。
- 锁文件必须提交，依赖安装必须使用 frozen lock 模式验证。

## 命名与接口

- TypeScript 文件和变量遵循项目统一的 ESLint/Prettier 规则。
- API 使用版本前缀 `/v1`。
- 对外 JSON 使用 camelCase。
- 数据库字段按照 ORM 约定统一，不在同一层混用命名方式。
- 时间使用带时区的 ISO 8601；数据库保存 UTC，展示层转换时区。
- ID 使用 UUID 或稳定哈希，不使用原始文件名作为主键。
- API 错误必须包含稳定错误码和 trace ID。
- 不向客户端返回堆栈、内部路径和供应商敏感原始响应。

## 测试要求

任何业务变更必须补充相应测试。最低要求：

- TypeScript 单元测试。
- Python parser 单元测试。
- 主服务与 Worker 契约测试。
- Provider mock 测试。
- Redis/BullMQ、PostgreSQL、Chroma 集成测试。
- 上传、入库、查询和删除端到端测试。

安全相关改动必须覆盖：

- tenant 交叉访问。
- 部门和敏感度限制。
- 客户端伪造身份字段。
- confidential 零云端调用。
- 路径穿越和非法文件。
- 文档内 prompt injection。

不得为了让测试通过而删除有效断言、跳过安全测试或降低权限检查。

付费 Provider 冒烟测试必须通过环境开关显式启用，普通 CI 默认使用 mock/recorded fixture，且 fixture 不包含敏感数据。

## 常用命令

具体包管理器和脚本以仓库 `package.json`、lock 文件及 README 为准。初始化后应提供并维护以下等价命令：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build

pnpm --filter api dev

cd apps/parser-worker
python -m pytest

docker compose up -d --build
docker compose ps
docker compose logs -f api parser-worker
```

如果命令尚未实现，应在当前阶段任务中补充，而不是假装验证成功。

## 修改流程

开始修改前：

1. 阅读 `TASK.md` 和相关设计文档。
2. 检查当前工作区状态，保留用户已有修改。
3. 确认修改属于当前任务范围。
4. 找到现有实现和测试，不重复创建平行方案。

修改过程中：

1. 优先实现最小、完整、可测试的改动。
2. 保持 TypeScript/Python 契约同步。
3. 保持配置、代码、Compose 和文档一致。
4. 发现安全或架构冲突时先报告。

完成前：

1. 运行与修改范围相称的 lint、typecheck、测试和构建。
2. 检查是否意外提交密钥、数据、日志或绝对路径。
3. 更新 `TASK.md` 当前状态和开发任务清单。
4. 在交付说明中报告改动、验证结果、未完成项和风险。

## 文档维护

- 需求或验收标准变化：更新 `docs/01-项目实施规格.md`。
- 架构、接口或数据结构变化：更新 `docs/02-技术设计.md`。
- 前端页面、路由、交互或设计系统变化：更新 `docs/03-前端产品与界面设计.md`。
- 编码、测试、Git 或协作规范变化：更新 `docs/04-开发规范.md`。
- 工作拆分或完成状态变化：更新 `docs/05-开发任务清单.md`。
- 部署、配置、备份或告警变化：更新 `docs/06-部署运维手册.md`。
- 公开 API 的认证、权限、端点、错误码或调用方式变化：同步更新运行时契约、
  `packages/contracts/openapi/api.v1.yaml` 和 `docs/07-API使用说明.md`。
- 当前开发阶段变化：更新 `TASK.md`。
- 长期工程规则变化：更新本文件。

不要让同一规则在多份文档中出现互相矛盾的版本。

## 禁止事项

- 禁止把真实密钥写入示例。
- 禁止绕过 ACL 后再过滤结果。
- 禁止混用不同 Embedding 索引。
- 禁止让 Python Worker 演变为第二套业务主服务。
- 禁止将大文件正文写入 Redis job payload。
- 禁止在请求处理线程同步完成大型文档解析。
- 禁止以本地开发方便为由将内部服务暴露公网。
- 禁止使用 `latest` 浮动镜像部署生产环境。
- 禁止无备份执行破坏性数据库或索引操作。
- 禁止声称运行了未实际运行的测试。

## 当前任务入口

当前工作目标、范围和完成条件以根目录 `TASK.md` 为准。完整任务依赖和后续阶段以 `docs/05-开发任务清单.md` 为准。
