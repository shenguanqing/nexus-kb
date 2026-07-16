# 知枢 NexusKB

知枢 NexusKB 是企业级知识库项目。本仓库当前完成阶段 3：在上传与解析闭环上增加了结构感知分块、基础 PII/业务规则脱敏，以及 confidential 默认零云端调用的策略门禁。

完整 ACL、查询编排、LLM Provider、OIDC/SSO 和前端仍在后续阶段，进度以 [`TASK.md`](./TASK.md) 为准。

## 环境要求

- Node.js 22 LTS 与 pnpm 10.27
- Docker Desktop（含 Docker Compose）
- Python 3.11（仅在宿主机直接测试 Parser Worker 时需要）

## 安装与检查

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @nexus-kb/api test:integration
pnpm build
```

Parser Worker 本机验证：

```bash
cd apps/parser-worker
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.lock
ruff check app tests
mypy app
pytest
```

## Docker Compose 启动

首次启动前创建本地配置，并把两个占位密码/token 换成本地随机值；`DATABASE_URL` 中的数据库密码必须与 `POSTGRES_PASSWORD` 一致。

```bash
cp .env.example .env
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

只有 API 映射到宿主机的 `127.0.0.1:3000`。Parser Worker、PostgreSQL、Redis 和 Chroma 仅位于 Compose 内部网络；Worker 对原始文档 volume 只有只读权限。

```bash
curl http://127.0.0.1:3000/health/live
curl http://127.0.0.1:3000/health/ready
docker compose logs api parser-worker
```

`/health/live` 只检查进程存活；`/health/ready` 检查 PostgreSQL、Redis、Chroma、Parser Worker 和共享文档目录。健康检查不会调用付费模型。

停止并保留 volume：

```bash
docker compose down
```

不要把 `docker compose down -v` 当作日常停止命令，它会删除本地持久化数据。

## 内部解析契约

- `POST /internal/v1/parse` 只在 Worker 内网提供，并要求 `X-Internal-Token`。
- Worker 支持 UTF-8 TXT/Markdown、DOCX 和 XLSX；Markdown/DOCX 保留标题路径，XLSX 保留 sheet、表头和行号。
- OpenAPI 契约位于 `packages/contracts/openapi/parser-worker.v1.yaml`。
- Worker 会拒绝共享根目录外路径、`..`、符号链接、超限和空文件。

## 文档 API

开发模式下身份来自服务端 `DEV_*` 配置，上传表单中的 `tenantId`、role、department 等字段不会成为可信身份。生产环境必须在后续 OIDC 阶段启用 `AUTH_REQUIRED=true` 并接入认证实现。

```bash
curl -F 'file=@policy.md;type=text/markdown' http://127.0.0.1:3000/v1/documents
curl http://127.0.0.1:3000/v1/documents/<documentId>
curl http://127.0.0.1:3000/v1/ingestion-jobs/<jobId>
curl -X DELETE http://127.0.0.1:3000/v1/documents/<documentId>
```

公共 API 契约位于 `packages/contracts/openapi/api.v1.yaml`。API 启动时自动执行不可变 Prisma migration；任务在 Redis 中只携带 ID 与 UUID 文件引用，不携带正文。

## 本地预处理与出网策略

- TypeScript 主服务按标题路径、页码、工作表和表格结构分块，超长元素按配置的 token 单元切分并保留 overlap。
- `chunkId` 由文档 ID、版本、元素路径和规范化正文稳定生成；相邻 chunk 保存前后关系。
- 原文与脱敏文本分别保存在 PostgreSQL；当前内置手机号、身份证、银行卡和邮箱规则，可通过 `BUSINESS_REDACTION_RULES_JSON` 增加受控业务正则。
- `confidential` 默认在任何 Provider 调用前阻止出网。策略事件只保存资源 ID、决策、原因、敏感度和策略版本，不保存正文。
- 允许出网的文档完成本地预处理后状态为 `prepared`，等待下一阶段 Embedding 与 Chroma 入库；被阻止的文档状态为 `policy_blocked`。

`CHUNK_MAX_TOKENS`、`CHUNK_OVERLAP_TOKENS`、`REDACTION_POLICY_VERSION` 或关键脱敏规则变化会改变索引语义；进入向量阶段后必须创建新 collection 并重建，不能覆盖旧索引。

## Embedding Provider

- 已定义独立的 `EmbeddingProvider` 接口，并严格区分 `embedDocuments` 与 `embedQuery`。
- 当前首个适配器为阿里云百炼 `text-embedding-v4` OpenAI 兼容接口；默认 `EMBEDDING_PROVIDER=none`，不会在本地启动时要求付费 Key。
- 显式设置 `EMBEDDING_PROVIDER=alibaba` 后，启动配置会强制校验 model、dimensions、region、HTTPS base URL 和 `DASHSCOPE_API_KEY`。
- 当前官方限制按单次最多 10 条、每条最多 8192 tokens 实现；响应必须与输入数量、顺序和配置维度一致。
- 429、超时和 500/502/503/504 使用带 jitter 的指数退避；400/401/403/404/422 不重试，也不会切换其他 Provider。
- 每次调用只记录 Provider、模型、区域、request ID、耗时、尝试次数和 token usage，不记录输入正文或 Key。
- 配置指纹包含 Provider、模型、维度、task mode、分块参数和脱敏版本，供下一阶段创建并校验 Chroma collection。
- confidential 仍由 CloudPolicyService 在 Provider 方法执行前失败关闭。

付费冒烟测试默认跳过。仅在已准备专用测试 Key 且明确接受产生费用时运行：

```bash
RUN_PAID_PROVIDER_TESTS=true pnpm --filter @nexus-kb/api test:provider:smoke
```

## Chroma VectorStore

- 使用官方 `chromadb` TypeScript 客户端 3.5.0，并将 Chroma Server 固定为 1.5.9。
- collection 使用 cosine 距离，并保存完整 Embedding 配置指纹；指纹或距离配置不兼容时 readiness 失败。
- collection 名称包含 Provider、模型、维度、schema version 和指纹摘要，不同向量空间不会混写。
- 使用稳定 chunkId 执行 upsert，重复入库不会增加重复向量。
- Chroma 只保存脱敏文本和标量来源/权限 metadata，不保存原始正文。
- 查询接口要求服务端构造 tenant、部门、敏感度和 owner ACL filter，不接受客户端原始 where。
- 删除文档时先按 tenantId + documentId 删除向量，再清理 PostgreSQL chunk 和原文件。
- 文档仅在 Embedding、Chroma upsert 和写入校验全部成功后原子切换为 `active`。
- 默认 `EMBEDDING_PROVIDER=none` 时仅检查 Chroma 连通性，不创建 collection，也不调用付费模型。

真实 Chroma 集成测试随 `test:integration` 在 Compose API 容器内运行，覆盖重复 upsert、tenant 过滤、
按文档删除和错误指纹失败关闭。

## 安全说明

- `.env`、上传文件、向量、数据库文件和日志均被 Git 忽略。
- 不要在问题、提交、日志或示例中写入真实密钥。
- 主服务是唯一对外 API；Parser Worker 不持有模型 Key，也没有 Chroma 权限。
