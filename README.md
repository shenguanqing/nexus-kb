# 知枢 NexusKB

知枢 NexusKB 是企业级知识库项目。当前已完成上传、解析、分块脱敏、Alibaba Embedding 抽象和
Chroma 安全索引激活，正在收尾前序阶段的去重、checkpoint、分类重试和失败任务查询。

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
- Worker 支持 UTF-8 TXT/Markdown、DOCX、XLSX 和 DXF；DXF 使用 ezdxf 提取图纸摘要、布局、图层、文字、块属性和尺寸，并保留 CAD entity metadata。
- OpenAPI 契约位于 `packages/contracts/openapi/parser-worker.v1.yaml`。
- Worker 会拒绝共享根目录外路径、`..`、符号链接、超限和空文件。
- DWG 不直接进入 Worker；先在隔离工作站使用已批准的 ODA File Converter 转为 DXF，人工抽查图层、文字、外部参照和单位后，再上传转换产物。

## 文档 API

仅在 development/test 且 `AUTH_REQUIRED=false` 时，身份来自服务端 `DEV_*` 配置。启用认证后，API
只接受 `Authorization: Bearer <JWT>`，通过 OIDC JWKS 校验签名、issuer、audience、算法和时间声明，
再校验 tenant、department、roles、allowedSensitivities、capabilities 等业务 claims。请求体或自定义
header 中的 tenant、role、department 不会成为可信身份。

```bash
curl -F 'file=@policy.md;type=text/markdown' http://127.0.0.1:3000/v1/documents
curl http://127.0.0.1:3000/v1/documents/<documentId>
curl http://127.0.0.1:3000/v1/ingestion-jobs/<jobId>
curl http://127.0.0.1:3000/v1/ingestion-jobs/failed
curl -X DELETE http://127.0.0.1:3000/v1/documents/<documentId>
```

公共 API 契约位于 `packages/contracts/openapi/api.v1.yaml`。API 启动时自动执行不可变 Prisma migration；任务在 Redis 中只携带 ID 与 UUID 文件引用，不携带正文。

## 认证与 ACL

- production 强制 `AUTH_REQUIRED=true`，并要求配置 `OIDC_ISSUER`、`OIDC_AUDIENCE` 和 HTTPS
  `OIDC_JWKS_URI`。
- JWT 仅允许配置的 RSA/ECDSA 非对称算法；未知密钥、错误 issuer/audience、过期 token 或不完整 claims
  均返回 401，不回退开发身份。
- 文档 API 使用 `documents:read`、`documents:write`、`documents:delete` capabilities。
- 所有资源查询首先强制 tenant；普通用户只能访问允许敏感度内的 public、同部门或本人文档。
- `platform_admin`/`document_admin` 可跨部门管理当前 tenant 内允许敏感度的文档，但不能跨 tenant。
- 入库任务继承关联文档 ACL；VectorStore filter 只能由服务端 Identity 构造。
- 健康检查是显式 public route，不会暴露身份或业务数据。

相同 tenant、内容哈希、department、sensitivity 和 owner 的重复上传返回
`DOCUMENT_DUPLICATE`（HTTP 409）。数据库只为新写入生成稳定去重键，兼容升级前已经存在的历史重复记录；
文档软删除后允许重新上传。

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

## 入库可靠性

- `IngestionJob` 持久化最近安全 checkpoint、错误类别、尝试次数和 `retryable`。
- Parser、Embedding 和 VectorStore 临时错误按配置指数退避；认证、参数和配置不兼容错误立即终止。
- 本地分块与脱敏完成后 checkpoint 为 `local_prepared`，后续重试跳过重复解析和策略事件创建。
- completed、policy_blocked 和 deleted job 的重复投递直接短路。
- `INGESTION_MAX_ATTEMPTS` 与 `INGESTION_RETRY_BASE_DELAY_MS` 控制队列重试。
- 删除先进入 `deleting` 墓碑并停止任务，再删除向量和本地数据；如果索引任务在临界窗口完成 upsert，
  激活失败路径会补偿删除向量。重复 DELETE 会继续未完成清理。

真实 Chroma 集成测试随 `test:integration` 在 Compose API 容器内运行，覆盖重复 upsert、tenant 过滤、
按文档删除和错误指纹失败关闭。

## 安全说明

- `.env`、上传文件、向量、数据库文件和日志均被 Git 忽略。
- 不要在问题、提交、日志或示例中写入真实密钥。
- 主服务是唯一对外 API；Parser Worker 不持有模型 Key，也没有 Chroma 权限。
