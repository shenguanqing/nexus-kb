# 当前开发任务

> 项目：知枢 NexusKB
> 当前阶段：阶段 2——文件上传、文档管理与第一批解析器
> 状态：已完成（2026-07-16）

---

## 1. 上一阶段交付记录

阶段 1“仓库初始化与本地开发环境”已于 2026-07-16 完成并验证：

- pnpm monorepo、NestJS/Fastify API、FastAPI Parser Worker 和共享契约已建立。
- PostgreSQL、Redis、Chroma、Parser Worker、API 可通过 Docker Compose 启动，五个服务均 healthy。
- API 仅绑定 `127.0.0.1:3000`，其余服务没有宿主机端口。
- API/Worker 分别以 UID 10001/10002 非 root 用户运行；Worker 对原始文档 volume 为只读。
- `GET /health/live` 与 `GET /health/ready` 已实测通过，ready 覆盖 PostgreSQL、Redis、Chroma、Worker 和共享目录。
- API 容器已通过内网和内部 token 调用 Worker 的 TXT 解析接口，契约校验成功。
- PostgreSQL、Redis、Chroma 重启后恢复 healthy，持久化 volume 保留。
- TypeScript lint、typecheck、5 个测试、build、format check 通过。
- Python ruff、严格 mypy、4 个 pytest 测试通过。
- `pnpm install --frozen-lockfile` 和 `docker compose up -d --build` 通过。

实现差异与决策：

- 当前 Worker 仅实现 UTF-8 TXT/Markdown 最小解析，复杂解析依照本阶段继续扩展。
- Chroma `1.0.20` 镜像没有 Python，healthcheck 使用 Bash TCP 检查；API readiness 使用 `/api/v2/heartbeat`。
- named volume 通过 API 镜像内预创建 `/data/raw-docs` 并设置 UID 10001 所有权，保证 API 非 root 写入和 Worker 只读访问。
- 当前配置 schema 只校验阶段 1 实际使用的环境变量；模型 Provider 配置在实现 Provider 阶段加入，避免要求本地基础设施启动时提供付费 Key。

---

## 2. 当前目标

实现安全的异步文档上传与管理基础闭环，并完成第一批无需重型 OCR/Tika 的解析器：

```text
上传文件 → 安全校验与 UUID 存储 → PostgreSQL 文档/版本/任务记录
→ BullMQ 入队 → Worker 解析 TXT/Markdown/DOCX/XLSX
→ 保存解析结果与任务状态
```

本阶段不调用 Embedding、LLM 或 Rerank，不写入 Chroma。

---

## 3. 本轮任务

### 3.1 PostgreSQL 与队列

- [x] 引入 Prisma 与不可变迁移。
- [x] 定义 Document、DocumentVersion、IngestionJob 模型及 tenant 索引。
- [x] 引入 BullMQ，使用 ingestionJobId 作为稳定 jobId。
- [x] 保存任务状态、尝试次数、trace ID、parser 版本和 warning。
- [x] 增加 PostgreSQL/Redis 集成测试。

### 3.2 安全上传

- [x] 实现流式上传与大小限制。
- [x] 白名单化 TXT、Markdown、DOCX、XLSX。
- [x] 联合校验扩展名、MIME 与 magic bytes。
- [x] 使用 UUID 存储文件并计算 SHA-256。
- [x] 拒绝路径穿越、软链接、空文件、伪造 MIME 和超限文件。
- [x] tenant、department、owner 和 sensitivity 只来自服务端身份/策略。

### 3.3 文档 API

- [x] `POST /v1/documents` 返回 `202`、documentId 和 jobId。
- [x] `GET /v1/documents/:documentId` 强制 tenant 过滤。
- [x] `GET /v1/ingestion-jobs/:jobId` 强制 tenant 过滤。
- [x] `DELETE /v1/documents/:documentId` 先实现安全、幂等的状态与原文件删除。
- [x] 错误响应包含稳定 code 和 trace ID，不泄露存储路径。

### 3.4 第一批解析器与契约

- [x] 将 TXT/Markdown 从单元素存根升级为保留标题路径的结构化元素。
- [x] 实现 DOCX 解析器。
- [x] 实现 XLSX/openpyxl 解析器并保留 sheet 与表头。
- [x] 加入 MIME/后缀路由和空结果失败策略。
- [x] 配置解析超时、页数/行数与结果元素数量限制。
- [x] 增加真实 Worker 契约测试，覆盖缺字段、错误类型和超大响应。

### 3.5 安全与端到端测试

- [x] 两个 tenant 无法读取彼此文档或任务。
- [x] 客户端伪造 tenant/role/department 字段无效。
- [x] Redis job payload 只含 ID 和文件引用，不含文件正文。
- [x] Worker 仍无模型 Key、无 Chroma 权限、无宿主机端口。
- [x] 上传 → 排队 → 解析 → 状态完成的 Compose 端到端测试通过。
- [x] 删除后原文件不可访问，重复删除保持幂等。

---

## 4. 完成条件

- [x] `pnpm install --frozen-lockfile` 成功。
- [x] TypeScript lint、typecheck、test 和 build 全部通过。
- [x] Python ruff、mypy 和 pytest 全部通过。
- [x] 数据库迁移可在空库执行，并可在已有阶段 1 volume 上安全应用。
- [x] Docker Compose 五服务保持 healthy。
- [x] 至少 TXT、Markdown、DOCX、XLSX 各有一个脱敏固定 fixture 并成功解析。
- [x] 上传、查询任务、tenant 隔离、非法文件和删除端到端测试通过。
- [x] README、`.env.example`、OpenAPI/JSON Schema 和相关设计文档同步。
- [x] 仓库与日志不包含密钥、上传正文、数据库文件、向量数据或本机绝对路径。

---

## 5. 明确不做

- PDF/Unstructured、OCR、Tika、CAD。
- 分块、脱敏、Embedding 与 Chroma 写入。
- LLM、Rerank 和知识问答 API。
- 完整 OIDC/SSO 与前端。

这些能力按 `docs/05-开发任务清单.md` 的后续阶段实施，不在本阶段提前铺开。

---

## 6. 下一阶段入口

下一阶段进入分块、脱敏与出网策略：先定义稳定 chunk ID、标题/表格感知分块、PII 脱敏和 confidential 零云端调用策略，再接入独立的 Embedding Provider 与新 Chroma collection。详细拆分应在开始阶段 3 前补充到本文件。
