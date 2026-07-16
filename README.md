# 知枢 NexusKB

知枢 NexusKB 是企业级知识库项目。本仓库当前完成阶段 2：在阶段 1 基础设施上实现了安全流式上传、PostgreSQL 文档模型、BullMQ 异步入库，以及 TXT、Markdown、DOCX、XLSX 解析闭环。

完整 RAG、OIDC/SSO、模型 Provider 和前端仍在后续阶段，进度以 [`TASK.md`](./TASK.md) 为准。

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

## 安全说明

- `.env`、上传文件、向量、数据库文件和日志均被 Git 忽略。
- 不要在问题、提交、日志或示例中写入真实密钥。
- 主服务是唯一对外 API；Parser Worker 不持有模型 Key，也没有 Chroma 权限。
