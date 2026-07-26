# 知枢 NexusKB

知枢 NexusKB 是企业级知识库项目。当前后端 RAG、安全索引、审计、质量评测框架与阶段 15 Vue 3
企业知识问答和管理前端代码已完成。

阶段 14 的真实评测运行仍等待业务方批准的数据；阶段 15 已完成，当前开发进度以
[`TASK.md`](./TASK.md) 为准。

## 先了解本地运行方式

这个项目由两部分组成：Docker Compose 负责启动 API、内部 Parser Worker、PostgreSQL、Redis 和 Chroma；Vue
前端在宿主机用 Vite 启动。Ollama **不在**本项目的 Compose 文件中：选择它时，需要先在 Mac 宿主机启动
Ollama，再让 Docker 中的 API 通过 `host.docker.internal:11434` 调用它。

| 想达到的效果                     | Embedding 配置                  | LLM 配置            | 上传后的结果                                     |
| -------------------------------- | ------------------------------- | ------------------- | ------------------------------------------------ |
| 先确认基础设施、解析和前端能运行 | `EMBEDDING_PROVIDER=none`       | `LLM_PROVIDER=none` | 文档完成本地解析、分块和脱敏，状态为“待建立索引” |
| 本机建立向量索引                 | Ollama                          | 可保持 `none`       | 文档可建立本地向量索引，但不能生成问答回答       |
| 跑通完整 RAG 问答                | Ollama 或已批准的云端 Embedding | 已配置的云端 LLM    | 文档入库后可检索、生成回答并返回来源             |

当前项目只将 Ollama 用作**本机 Embedding Provider**，不使用它生成问答答案；因此要体验完整问答，仍需按
`.env.example` 配置一个已批准的云端 LLM。`confidential` 内容默认不会发送给云端 LLM 或 Rerank。

## 环境要求

- Node.js 22 LTS 与 pnpm 10.27
- Docker Desktop（含 Docker Compose），且 Docker Desktop 必须已启动
- Python 3.11（仅在宿主机直接测试 Parser Worker 时需要）
- Ollama（仅在选择本机 Ollama 作为 Embedding Provider 时需要）
- 解析 DWG 时需另行安装并授权 ODA File Converter；仓库和基础镜像不分发该第三方二进制

在仓库根目录执行下面的命令，确认基础工具可用。若 `pnpm` 版本不是 `10.27.x`，请先按 Node.js 的 Corepack
说明启用与项目 `packageManager` 字段匹配的 pnpm 版本。

```bash
node --version
pnpm --version
docker info
docker compose version
```

## 项目启动顺序

以下步骤适用于第一次启动，也适用于希望从零理解各服务关系的开发者。所有命令都在仓库根目录执行，除非命令
另有说明。

### 1. 安装 Node.js 依赖

```bash
pnpm install --frozen-lockfile
```

这一步只安装本仓库的 Node.js 依赖，并生成 API 所需的 Prisma 客户端；它不会启动 Docker 服务。

### 2. 创建并填写本地配置

```bash
cp .env.example .env
```

`.env` 已被 Git 忽略，不能提交、发送或截图。打开 `.env` 后先完成下面两项：

1. 运行两次 `openssl rand -hex 32`，分别复制两个不同的随机值。
2. 将其中一个值同时替换 `POSTGRES_PASSWORD` 和 `DATABASE_URL` 中 `kb:` 后、`@postgres` 前的密码；将另一个值
   替换 `PARSER_INTERNAL_TOKEN`。后者至少需要 16 个字符。

然后根据想运行的模式确认以下配置：

- **只验证基础设施**：保留 `EMBEDDING_PROVIDER=none` 和 `LLM_PROVIDER=none`。服务可以正常启动，上传后显示
  “待建立索引”是预期行为。
- **使用 Ollama 建立本机向量索引**：先完成下一节的 Ollama 启动与模型下载，再填写给出的五个
  `EMBEDDING_*` / `OLLAMA_BASE_URL` 配置。
- **生成问答回答**：除了 Embedding 外，还要将 `LLM_PROVIDER` 改成 `openai`、`google`、`deepseek`、`alibaba`
  或 `custom` 之一，并填写该 Provider 当前可用的 `LLM_MODEL` 与对应 API Key。不要把 Key 写入代码、命令历史、
  截图或 Git。Rerank 保持默认 `none` 即可。

### 3. 如选择 Ollama，先在 Mac 上启动并验证它

不使用 Ollama 时跳到下一步。使用 Ollama 时，请先从 [Ollama macOS 官方安装说明](https://docs.ollama.com/macos)
安装并打开 Ollama App。首次启动时允许它建立 `ollama` 命令行链接；重新打开终端后执行：

```bash
ollama --version
ollama pull bge-m3:latest
ollama ls
curl http://127.0.0.1:11434/api/tags
```

`ollama pull` 会下载本项目使用的 Embedding 模型；`ollama ls` 中应能看到 `bge-m3:latest`，最后一条命令应返回
模型列表 JSON。该模型在 Ollama 中以约 1.2GB 的下载提供；模型名与拉取方式可在
[bge-m3 模型页](https://ollama.com/library/bge-m3) 核对。

通常 Mac 上打开 Ollama App 后服务会在后台运行。若 `curl` 无法连接，或只安装了命令行工具，请在一个单独终端运行
`ollama serve` 并保持该终端打开；不要同时启动多个 `ollama serve` 实例。Ollama 默认本地 API 地址为
`http://localhost:11434/api`，可参阅 [Ollama API 说明](https://docs.ollama.com/api/introduction)。

确认服务和模型都正常后，在 `.env` 中设置：

```dotenv
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=bge-m3:latest
EMBEDDING_DIMENSIONS=1024
EMBEDDING_REGION=local
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

`OLLAMA_BASE_URL` 是 Docker 内 API 容器访问 Mac 宿主机的地址，不要改成浏览器地址，也不要填写任意公网 HTTP
地址。Ollama 不需要 API Key。以后若已存在“已生效”的文档，不要直接把模型或维度改成另一套值后继续写旧索引；
应按本文后面的“版本、删除与索引迁移”流程创建新索引。

### 4. 准备并构建默认启用的 DWG 专用 Worker

DWG 转换默认开启，因此首次启动前必须准备经组织批准的 ODA File Converter。项目会将 Parser Worker 固定为
`linux/amd64`，使 Docker Desktop 能在 Apple Silicon Mac 上兼容运行 ODA 的 Linux x64 Debian 安装包。基础 Worker
镜像没有 ODA；缺少这个包时，默认启动会失败关闭，而不会悄悄跳过 DWG 转换。

1. 从 [ODA 官方下载页](https://www.opendesign.com/guestfiles/oda_File_Converter) 下载经组织许可的
   **Linux x64 Debian (`.deb`)** 安装包，重命名为 `oda-file-converter.deb`，并放入
   `apps/parser-worker/vendor/oda/`。该文件已被 Git 忽略，绝不能提交安装包、许可证或凭据。
2. 构建派生 Worker：

   ```bash
   docker compose -f compose.yaml -f compose.dwg.yaml build parser-worker
   ```

3. 读取容器内实际安装版本。不要猜测版本，也不要使用旧的 `/opt/oda/ODAFileConverter` 路径：

   ```bash
   docker compose -f compose.yaml -f compose.dwg.yaml run --rm --no-deps --entrypoint dpkg-query parser-worker \
     -W -f='${Version}\n' odafileconverter
   ```

4. `.env.example` 已默认设置 `DWG_CONVERSION_ENABLED=true` 和项目提供的受控启动器。把上一步输出的真实版本填入
   `.env` 的 `DWG_CONVERTER_RELEASE`，保留以下值：

   ```dotenv
   DWG_CONVERSION_ENABLED=true
   DWG_CONVERTER_EXECUTABLE=/usr/local/bin/nexus-oda-file-converter
   DWG_CONVERTER_RELEASE=<上一步显示的实际版本>
   ```

### 5. 启动 Docker 服务和内部解析契约

以下 Compose 命令会**同时启动** API、DWG 专用 Parser Worker、PostgreSQL、Redis 和 Chroma。Parser Worker 就是
“内部解析契约”的运行端，无需也不应在宿主机另开 Python 进程或映射 Worker 端口。

```bash
docker compose -f compose.yaml -f compose.dwg.yaml config --quiet
docker compose -f compose.yaml -f compose.dwg.yaml up -d --build
docker compose -f compose.yaml -f compose.dwg.yaml ps
```

首次构建会拉取基础镜像并构建 API 与 Parser Worker。`docker compose ... ps` 最终应显示 `api`、`parser-worker`、
`postgres`、`redis` 和 `chroma` 均在运行；healthcheck 完成后会显示为 `healthy`。默认流程不会使用不含 ODA 的
基础 Parser Worker 镜像。

内部解析链路在此步骤中的工作方式如下：

```text
浏览器 → API（唯一宿主机端口：127.0.0.1:3000）
            → 受控共享 volume 写入原始文件
            → Parser Worker 的 POST /internal/v1/parse
               （仅 Compose 内网、X-Internal-Token、原始文件只读）
```

Worker 不对宿主机暴露端口，也不持有模型 API Key 或 Chroma 写权限。请不要从 Mac 直接请求
`/internal/v1/parse`，也不要为了调试把它映射到公网；API 会在上传任务中调用它。

### 6. 验证 API、依赖和 Parser Worker

```bash
curl http://127.0.0.1:3000/health/live
curl http://127.0.0.1:3000/health/ready
docker compose -f compose.yaml -f compose.dwg.yaml logs --tail=100 parser-worker
docker compose -f compose.yaml -f compose.dwg.yaml exec parser-worker python -c \
  "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready').read().decode())"
```

`/health/live` 只检查 API 进程是否存活；`/health/ready` 会检查 PostgreSQL、Redis、Chroma、Parser Worker 和
共享文档目录，成功时 `status` 为 `ready`，且 `checks.parserWorker.status` 为 `up`。最后一条命令只在 Compose
内网检查 Worker 自己的 ready 响应，必须显示 `dwgConverter.status=up`。健康检查不会调用 Ollama 或任何付费模型。
若这里失败，先阅读 `parser-worker` 日志；不要通过关闭内部 token、关闭 DWG 或暴露 Worker 端口来绕过问题。

### 7. 启动 Vue 前端并完成第一次上传

另开一个终端：

```bash
pnpm --filter @nexus-kb/web dev
```

打开命令输出的本地地址，使用“上传文档”上传一份不含敏感数据的 TXT、Markdown、DOCX、XLSX 或 DXF 测试文件。
上传成功后到“上传与入库任务”查看真实状态：解析 → 分块/脱敏 → Embedding（已配置时）→ 建立索引。

- `EMBEDDING_PROVIDER=none` 时，任务完成后显示“待建立索引”；这表示本地预处理已经成功，不是错误。
- 已配置 Ollama 时，任务应在本机建立向量索引。若是先上传、后配置 Ollama，运行
  `docker compose -f compose.yaml -f compose.dwg.yaml up -d --force-recreate api` 使 API 读取新配置，然后在文档详情点击
  “继续建立索引”，无需重新上传。
- 已同时配置 LLM 时，文档变为“已生效”后可在“知识问答”提问，并检查回答是否带有来源。未配置 LLM 时不要期待
  系统生成回答。

失败任务请在“上传与入库任务”查看错误码和 trace ID；排除原因后只点击一次“重试”。

### 8. 正常停止与再次启动

日常停止会保留本地数据：

```bash
docker compose -f compose.yaml -f compose.dwg.yaml down
```

再次启动使用：

```bash
docker compose -f compose.yaml -f compose.dwg.yaml up -d
```

不要把 `docker compose down -v` 当作日常停止命令，它会删除本地持久化数据。原始上传文件位于 Docker `raw_docs`
volume；文档 metadata、版本、任务和分块位于 PostgreSQL volume；向量及其脱敏 metadata 位于 Chroma volume；
Redis 只保存队列状态，不保存文件正文。

## 内部解析契约

- `POST /internal/v1/parse` 已在上述第 5 步随 `parser-worker` 自动启动，只在 Worker 内网提供，并要求
  `X-Internal-Token`。
- Worker 支持 UTF-8 TXT/Markdown、DOCX、XLSX、DXF 和 DWG；DWG 在受控临时目录转成 DXF 后，使用 ezdxf
  提取图纸摘要、布局、图层、文字、块属性和尺寸，并保留 CAD entity metadata。
- OpenAPI 契约位于 `packages/contracts/openapi/parser-worker.v1.yaml`；API 会在运行时校验 Worker 的响应。
- Worker 会拒绝共享根目录外路径、`..`、符号链接、超限和空文件。
- DWG 转换默认开启；第 4 步构建的 Worker 使用受控启动器，`/health/ready` 会将转换器纳入就绪检查，并要求
  `dwgConverter.status=up`。
- ODA 可执行文件及其运行库必须通过组织批准的镜像或宿主机部署流程提供，不能把下载包、许可证或二进制提交到 Git。

## 安装与检查

日常代码检查：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @nexus-kb/api test:integration
pnpm --filter @nexus-kb/web test:e2e
pnpm build
```

Parser Worker 宿主机直接验证（Docker Compose 日常启动不需要执行）：

```bash
cd apps/parser-worker
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.lock
ruff check app tests
mypy app
pytest
```

## 文档 API

仅在 development/test 且 `AUTH_REQUIRED=false` 时，身份来自服务端 `DEV_*` 配置。受保护模式可选择
OIDC Bearer JWT，或启用服务端管理的账号密码会话。OIDC 通过 JWKS 校验签名、issuer、audience、算法和
时间声明；账号密码模式只在 API 端校验配置的账号，向浏览器签发 HttpOnly、SameSite=Strict 的不透明 Cookie，
数据库只保存 Cookie 的 SHA-256 摘要。两种模式都会在服务端构造 tenant、department、roles、
allowedSensitivities 和 capabilities；请求体或自定义 header 中的同名字段不可信。

```bash
curl -F 'file=@policy.md;type=text/markdown' http://127.0.0.1:3000/v1/documents
curl http://127.0.0.1:3000/v1/documents/<documentId>
curl 'http://127.0.0.1:3000/v1/documents/<documentId>/chunks?version=1&page=1&pageSize=20'
curl http://127.0.0.1:3000/v1/ingestion-jobs/<jobId>
curl http://127.0.0.1:3000/v1/ingestion-jobs/failed
curl http://127.0.0.1:3000/v1/auth/session
curl -X DELETE http://127.0.0.1:3000/v1/documents/<documentId>
curl http://127.0.0.1:3000/metrics
curl 'http://127.0.0.1:3000/v1/audit/events?limit=50'
curl http://127.0.0.1:3000/v1/system/providers
curl http://127.0.0.1:3000/v1/system/status
curl 'http://127.0.0.1:3000/v1/access/users?limit=25'
curl http://127.0.0.1:3000/v1/access/departments
curl http://127.0.0.1:3000/v1/history/conversations
curl http://127.0.0.1:3000/v1/system/usage
```

公共 API 契约位于 `packages/contracts/openapi/api.v1.yaml`。API 启动时自动执行不可变 Prisma migration；任务在 Redis 中只携带 ID 与 UUID 文件引用，不携带正文。

## 认证与 ACL

- production 强制 `AUTH_REQUIRED=true`。默认使用 OIDC，并要求配置 `OIDC_ISSUER`、`OIDC_AUDIENCE` 和
  HTTPS `OIDC_JWKS_URI`。
- 如需使用账号密码登录，设置 `PASSWORD_AUTH_ENABLED=true`，并通过本地未提交的 `.env` 或服务器 Secret
  Manager 注入 `PASSWORD_AUTH_USERS_JSON`。每个账号必须包含 `username`、至少 12 位的 `password`、
  `tenantId`、`userId`、`department`、`roles`（`["user"]` 或 `["admin"]`）、`allowedSensitivities`、
  `capabilities` 和 `defaultSensitivity`；该
  JSON 不得进入 `.env.example`、Git、镜像层或日志。启用该模式时不需要 OIDC 配置，OIDC 仍是生产环境的首选。
- 账号密码模式提供 `GET /v1/auth/login-options`、`POST /v1/auth/password/login` 和
  `POST /v1/auth/logout`。前端不会保存密码或会话 token；退出会撤销服务端会话并清空 Cookie。
- JWT 仅允许配置的 RSA/ECDSA 非对称算法；未知密钥、错误 issuer/audience、过期 token 或不完整 claims
  均返回 401，不回退开发身份。
- 文档 API 使用 `documents:read`、`documents:write`、`documents:delete` capabilities；tenant 级审计查询
  另需 `audit:read`；Provider、系统状态与用量摘要另需 `system:read`；已验证用户目录另需 `access:read`，
  角色与部门 mutation 另需 `access:write` 和管理员角色。
- 所有资源查询首先强制 tenant；普通用户只能访问允许敏感度内的 public、同部门或本人文档。
- 应用角色只允许 `user` 和 `admin`；`admin` 可在 capability 允许时跨部门管理当前 tenant 内允许敏感度的
  文档，但不能跨 tenant，也不能绕过敏感度和数据出网策略。
- 入库任务继承关联文档 ACL；VectorStore filter 只能由服务端 Identity 构造。
- 分块详情只允许 `documents:read` 且通过同一文档 ACL 的用户访问；接口按版本分页返回原始/脱敏文本和来源
  metadata，供管理员核验分块质量，但不返回向量值、内容哈希或内部存储路径。
- 健康检查是显式 public route，不会暴露身份或业务数据。

相同 tenant、内容哈希、department、sensitivity 和 owner 的重复上传返回
`DOCUMENT_DUPLICATE`（HTTP 409）。数据库只为新写入生成稳定去重键，兼容升级前已经存在的历史重复记录；
文档软删除后允许重新上传。

## 本地预处理与出网策略

- TypeScript 主服务按标题路径、页码、工作表和表格结构分块，超长元素按配置的 token 单元切分并保留 overlap。
- `chunkId` 由文档 ID、版本、元素路径和规范化正文稳定生成；相邻 chunk 保存前后关系。
- 原文与脱敏文本分别保存在 PostgreSQL；当前内置手机号、身份证、银行卡和邮箱规则，可通过 `BUSINESS_REDACTION_RULES_JSON` 增加受控业务正则。
- `confidential` 默认在任何云端 Provider 调用前阻止出网。受控本机 Ollama Embedding 不离开本机，但云端 LLM/Rerank
  仍被禁止；策略事件只保存资源 ID、决策、原因、敏感度和策略版本，不保存正文。
- 未配置 Embedding 时，文档完成本地预处理后状态为 `prepared`（界面显示“待建立索引”）；配置完成后可在文档详情
  点击“继续建立索引”，复用本地 chunk 而不重新解析或上传。被策略阻止的文档状态为 `policy_blocked`。

`CHUNK_MAX_TOKENS`、`CHUNK_OVERLAP_TOKENS`、`REDACTION_POLICY_VERSION` 或关键脱敏规则变化会改变索引语义；进入向量阶段后必须创建新 collection 并重建，不能覆盖旧索引。

## Embedding Provider

- 已定义独立的 `EmbeddingProvider` 接口，并严格区分 `embedDocuments` 与 `embedQuery`。
- 支持阿里云百炼云端 Embedding 与本机 Ollama OpenAI-compatible Embedding；默认
  `EMBEDDING_PROVIDER=none`，不会在本地启动时要求付费 Key。
- 显式设置 `EMBEDDING_PROVIDER=alibaba` 后，启动配置会强制校验 model、dimensions、region、HTTPS base URL 和 `DASHSCOPE_API_KEY`。
- 显式设置 `EMBEDDING_PROVIDER=ollama` 后，启动配置会校验 `EMBEDDING_REGION=local`、模型、维度和受控本机
  `OLLAMA_BASE_URL`；Docker Desktop 推荐 `http://host.docker.internal:11434`。Ollama 不使用 API Key，
  `EMBEDDING_DIMENSIONS` 必须与所选模型实际输出维度一致。
- 当前官方限制按单次最多 10 条、每条最多 8192 tokens 实现；响应必须与输入数量、顺序和配置维度一致。
- 429、超时和 500/502/503/504 使用带 jitter 的指数退避；400/401/403/404/422 不重试，也不会切换其他 Provider。
- 每次调用只记录 Provider、模型、区域、request ID、耗时、尝试次数和 token usage，不记录输入正文或 Key。
- 配置指纹包含 Provider、模型、维度、task mode、分块参数和脱敏版本，供下一阶段创建并校验 Chroma collection。
- confidential 仍由 CloudPolicyService 在云端 Provider 方法执行前失败关闭；对 `ollama/local` 可由显式本机规则放行。

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

## 查询 API

- `POST /v1/knowledge/query` 依次执行输入校验、Redis 双层限流、Query Embedding、Chroma ACL Top K、
  active version 复核、相邻 chunk 合并、阈值拒答、可选 Rerank、LLM 和引用最终复核。
- 相关度不足不会调用 LLM；权限在生成期间发生变化时丢弃回答并返回安全的无答案响应。
- 若 LLM 已调用但资料没有足够依据，或回答缺少有效 `[来源N]`，系统仍会安全返回“无答案”。审计记录保留实际
  Provider/model；仅有 Embedding Provider 表示流程在检索阶段结束。
- `QueryAudit` 只记录 traceId、身份范围、问题长度、Provider/model、chunk IDs、结果与耗时，不记录问题、
  回答或片段正文。

## 质量评测

阶段 14 已提供严格的私有数据集/双策略运行契约和离线聚合器，可计算 Recall@K、MRR、引用准确率、拒答率、
越权率、P95 与单次成本，并根据门槛给出 Rerank 建议。真实问题和运行结果不得提交 Git，完整方法见
[`evaluation/README.md`](./evaluation/README.md)。

## 入库可靠性

- `IngestionJob` 持久化最近安全 checkpoint、错误类别、尝试次数和 `retryable`。
- Parser、Embedding 和 VectorStore 临时错误按配置指数退避；认证、参数和配置不兼容错误立即终止。
- 本地分块与脱敏完成后 checkpoint 为 `local_prepared`，后续重试跳过重复解析和策略事件创建。
- completed、policy_blocked 和 deleted job 的重复投递直接短路。
- `INGESTION_MAX_ATTEMPTS` 与 `INGESTION_RETRY_BASE_DELAY_MS` 控制队列重试。
- 删除先进入 `deleting` 墓碑并停止任务，再删除向量和本地数据；如果索引任务在临界窗口完成 upsert，
  激活失败路径会补偿删除向量。重复 DELETE 会继续未完成清理。

## 版本、删除与索引迁移

- `POST /v1/documents/:documentId/reindex` 为同一原文件创建递增版本；新版本失败、被策略阻止或尚未完成时，
  旧 `activeVersion` 保持不变。
- 删除会先进入 `deleting`，按版本和任务记录清理所有关联 Chroma collection，再删除原文件、chunk 和可识别
  解析数据；任何一步失败都保留墓碑供重复 DELETE 补偿。
- Provider、模型、维度、分块或脱敏指纹变化时，使用独立进程准备候选索引。准备阶段不启动普通队列 consumer，
  不切换 active version：

```bash
INDEX_MIGRATION_ACTION=prepare pnpm --filter @nexus-kb/api index:migrate
```

- 完成质量评测、备份和切换窗口确认后，使用同一新配置原子激活全部候选版本：

```bash
INDEX_MIGRATION_ACTION=activate pnpm --filter @nexus-kb/api index:migrate
```

旧版本和旧 collection 不会自动删除。需要回滚时恢复旧 Embedding 配置并再次执行 `activate`；正式切换需与
API 配置发布协调，避免 active version 与查询向量空间短暂不一致。

真实 Chroma 集成测试随 `test:integration` 在 Compose API 容器内运行，覆盖重复 upsert、tenant 过滤、
按文档删除和错误指纹失败关闭。

## 安全说明

- `.env`、上传文件、向量、数据库文件和日志均被 Git 忽略。
- 不要在问题、提交、日志或示例中写入真实密钥。
- 主服务是唯一对外 API；Parser Worker 不持有模型 Key，也没有 Chroma 权限。
