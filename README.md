# 知枢 NexusKB

知枢 NexusKB 是一套企业级知识库系统，提供文档入库、权限过滤、向量检索、知识问答、来源引用和审计能力。

当前 Vue 前端与本地 RAG 主链路已经完成；真实业务数据质量评测仍等待获批的脱敏数据集。详细进度见
[`TASK.md`](./TASK.md)。

## 快速导航

- [第一次启动](#第一次启动)
- [启用本机向量索引](#启用本机向量索引ollama)
- [启用完整 RAG 问答](#启用完整-rag-问答)
- [启用 DWG 解析](#启用-dwg-解析按需)
- [常见问题 FAQ](#常见问题-faq)
- [开发与测试](#开发与测试)

## 项目能做什么

```text
上传文档
  → 本地解析、分块和脱敏
  → Embedding 生成向量
  → Chroma 存储向量
  → 按 tenant 和 ACL 检索
  → LLM 生成回答
  → 返回来源并记录审计
```

主要服务：

| 组件          | 职责                             | 本地运行位置                      |
| ------------- | -------------------------------- | --------------------------------- |
| Vue Web       | 知识问答与管理界面               | Mac 宿主机，默认 `127.0.0.1:5173` |
| NestJS API    | 认证、权限、入库、检索与模型编排 | Docker，默认 `127.0.0.1:3000`     |
| Parser Worker | 文档解析与结构提取               | Docker 内网                       |
| PostgreSQL    | 文档、ACL、版本和任务状态        | Docker 内网                       |
| Redis         | BullMQ 异步任务队列              | Docker 内网                       |
| Chroma        | 向量索引                         | Docker 内网                       |

Parser Worker、PostgreSQL、Redis 和 Chroma 默认不向宿主机或公网开放端口。

## 选择运行模式

第一次接触本项目，建议先使用“新手基础模式”。确认页面和基础链路正常后，再按需启用 Ollama、云端 LLM 或
DWG。

| 模式                 | 需要额外准备                | 可以验证                                    | 暂时不能做                |
| -------------------- | --------------------------- | ------------------------------------------- | ------------------------- |
| 新手基础模式（推荐） | 无                          | 前端、API、数据库、队列、常规文档解析与脱敏 | 向量检索和问答            |
| 本机向量索引         | Ollama + `bge-m3`           | 文档向量化与本地检索                        | 未配置 LLM 时不能生成回答 |
| 完整 RAG             | Embedding + 获批的云端 LLM  | 检索、回答和来源引用                        | 取决于已启用的文档格式    |
| DWG 解析             | 经许可的 ODA File Converter | DWG 转 DXF 后解析                           | 不会自动启用模型          |

> [!NOTE]
> `EMBEDDING_PROVIDER=none` 和 `LLM_PROVIDER=none` 时，文档显示“待建立索引”是正常状态，不代表处理失败。

## 环境要求

### 必需

- macOS（当前本地流程主要在 Apple Silicon Mac 验证）
- [Node.js](https://nodejs.org/) 22 或更高版本
- pnpm 10.27.x
- [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/) 与 Docker Compose
- 建议至少预留 30 GB 可用磁盘

### 按需安装

- [Ollama](https://docs.ollama.com/macos)：仅本机 Embedding 需要
- Python 3.11：仅在宿主机直接开发或测试 Parser Worker 时需要
- ODA File Converter：仅解析 DWG 需要，仓库不分发该第三方软件

在仓库根目录检查环境：

```bash
node --version
pnpm --version
docker info
docker compose version
```

如果没有 pnpm，或版本与项目不一致：

```bash
corepack enable
corepack prepare pnpm@10.27.0 --activate
pnpm --version
```

`docker info` 必须成功。若提示无法连接 Docker daemon，请先打开 Docker Desktop，并等待 Docker Engine 启动完成。

## 第一次启动

本节不需要模型 API Key、Ollama 或 ODA。完成后可以进入管理界面，上传 TXT、Markdown、DOCX、XLSX 或 DXF
测试文件，验证本地解析、分块和脱敏流程。

除特别说明外，所有命令都在仓库根目录执行。

### 1. 安装依赖

```bash
pnpm install --frozen-lockfile
```

安装过程还会生成 API 使用的 Prisma Client。

### 2. 创建本地配置

```bash
cp .env.example .env
```

生成两个不同的随机值：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

打开 `.env`，至少完成以下修改：

1. 将第一个随机值同时填入 `POSTGRES_PASSWORD`，并替换 `DATABASE_URL` 中的数据库密码。
2. 将第二个随机值填入 `PARSER_INTERNAL_TOKEN`。
3. 使用下面的新手配置：

```dotenv
DWG_CONVERSION_ENABLED=false

EMBEDDING_PROVIDER=none
LLM_PROVIDER=none
RERANK_PROVIDER=none

AUTH_REQUIRED=false
PASSWORD_AUTH_ENABLED=false
DEV_ROLES_JSON=["admin"]
```

数据库密码必须保持一致，例如：

```dotenv
POSTGRES_PASSWORD=<第一个随机值>
DATABASE_URL=postgresql://kb:<第一个随机值>@postgres:5432/kb
```

这里显式关闭 DWG，表示本次启动不提供 DWG 上传能力；其他已支持格式不受影响。`DEV_ROLES_JSON=["admin"]`
只用于本地开发身份，便于访问文档管理页面，不能用于生产环境。

> [!IMPORTANT]
> `.env` 包含密码和可能的 API Key，已被 Git 忽略。不要提交、发送或截图分享该文件。

### 3. 启动后端服务

确认 Docker Desktop 已运行，然后执行：

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

首次启动需要拉取镜像和构建服务，耗时通常比后续启动长。`docker compose ps` 最终应显示 `api`、
`parser-worker`、`postgres`、`redis` 和 `chroma` 正常运行。

### 4. 检查服务状态

```bash
curl http://127.0.0.1:3000/health/live
curl http://127.0.0.1:3000/health/ready
```

- `live` 表示 API 进程已启动。
- `ready` 返回 HTTP 200 且 `status` 为 `ready`，才表示依赖链路已经就绪。

如果 `ready` 失败，先查看日志：

```bash
docker compose logs --tail=100 api parser-worker
```

### 5. 启动前端

另开一个终端，在仓库根目录执行：

```bash
pnpm --filter @nexus-kb/web dev
```

浏览器打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。开发模式会使用 `.env` 中的服务端固定身份，
不需要输入账号密码。

### 6. 完成第一次验证

1. 进入“文档管理”。
2. 上传一份不含敏感信息的 TXT、Markdown、DOCX、XLSX 或 DXF 文件。
3. 在“上传与入库任务”查看解析、分块和脱敏状态。
4. 任务完成后，文档应显示“待建立索引”。

此时基础环境已经跑通。要让文档进入向量索引，请继续启用 Ollama；要生成问答回答，还需要配置云端 LLM。

## 启用本机向量索引（Ollama）

当前项目只使用 Ollama 生成 Embedding，不使用它生成最终问答回答。

### 1. 安装模型并验证 Ollama

安装并打开 Ollama App 后执行：

```bash
ollama --version
ollama pull bge-m3:latest
ollama ls
curl http://127.0.0.1:11434/api/tags
```

如果 `curl` 无法连接，可在单独终端执行 `ollama serve` 并保持运行；不要重复启动多个实例。

### 2. 修改 `.env`

```dotenv
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=bge-m3:latest
EMBEDDING_DIMENSIONS=1024
EMBEDDING_REGION=local
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

Ollama 不需要 API Key。`host.docker.internal` 是 API 容器访问 Mac 宿主机的地址，不要改成任意公网 HTTP
地址。

### 3. 重建 API 容器

下面以新手基础模式为例。如果已经启用 DWG 或 DBeaver，必须使用
[日常使用](#选择固定的-compose-文件组合)中当前模式对应的完整 Compose 文件组合，不能临时切回基础配置。

```bash
docker compose up -d --force-recreate api
curl --fail-with-body http://127.0.0.1:3000/health/ready
```

之前处于“待建立索引”的文档，可在文档详情点击“继续建立索引”，系统会复用已完成的解析、分块和脱敏结果。

> [!WARNING]
> 文档与查询必须使用相同的 Embedding Provider、模型和维度。更换这些配置后不能继续写入旧 collection，
> 必须创建新索引并执行迁移。

## 启用完整 RAG 问答

完整问答需要同时满足：

1. 已配置可用的 Embedding Provider。
2. 已配置组织批准的云端 LLM Provider。
3. 文档状态已经变为“已生效”。

在 `.env` 中将 `LLM_PROVIDER` 改为 `openai`、`google`、`deepseek`、`alibaba` 或 `custom`，并填写该平台
控制台当前可用的模型 ID、HTTPS Base URL 和 API Key。例如使用 Google 时需要填写：

```dotenv
LLM_PROVIDER=google
LLM_MODEL=<控制台当前可用的模型 ID>
GEMINI_API_KEY=<本地开发 Key>
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
```

修改后只需重建 API：

下面以新手基础模式为例。如果已经启用 DWG 或 DBeaver，必须使用
[日常使用](#选择固定的-compose-文件组合)中当前模式对应的完整 Compose 文件组合。

```bash
docker compose up -d --force-recreate api
curl --fail-with-body http://127.0.0.1:3000/health/ready
```

然后在“知识问答”中提问，并核对回答是否包含 `[来源N]` 和对应来源卡片。

- 不要把 API Key 写进代码、Git、截图或 shell 命令。
- Rerank 默认保持 `none`，是否启用应由正式质量评测决定。
- `confidential` 内容默认禁止发送到云端 LLM 或 Rerank。

Provider 的完整配置项见 [技术设计：配置](./docs/02-技术设计.md#4-配置)，运行检查、数据出网和密钥安全规则见
[部署运维手册：健康检查](./docs/06-部署运维手册.md#6-健康检查)。

## 启用 DWG 解析（按需）

DWG 转换依赖独立授权的 ODA File Converter。仓库与基础镜像不包含安装包、许可证或二进制。

从 [ODA 官方下载页](https://www.opendesign.com/guestfiles/oda_File_Converter) 获取经组织许可的
**Linux x64 Debian (`.deb`)** 安装包，并将它放到：

```text
apps/parser-worker/vendor/oda/oda-file-converter.deb
```

该文件已被 Git 忽略，禁止提交到仓库。随后按照
[部署运维手册：CAD / DWG 转换流程](./docs/06-部署运维手册.md#91-cad--dwg-转换流程)读取实际安装版本、填写
`DWG_CONVERTER_RELEASE`。

构建前先打开 Docker Desktop，等待 Docker Engine 完全启动，并确认下面两条命令均成功：

```bash
docker info
docker compose version
```

然后使用同一组 Compose 文件构建 DWG 专用 Worker、校验合并配置并启动整套服务：

```bash
docker compose -f compose.yaml -f compose.dwg.yaml build parser-worker
docker compose -f compose.yaml -f compose.dwg.yaml config --quiet
docker compose -f compose.yaml -f compose.dwg.yaml up -d --build
docker compose -f compose.yaml -f compose.dwg.yaml ps
```

单独执行第一条 `build parser-worker` 可以提前暴露 ODA 安装包、版本或 Worker 镜像构建问题；后续
`up -d --build` 会复用已有构建缓存，并确保 API 等其他需要构建的服务也与当前源码一致。`ps` 中的 `api`、
`parser-worker`、`postgres`、`redis` 和 `chroma` 应正常运行，随后再检查：

```bash
curl --fail-with-body http://127.0.0.1:3000/health/live
curl --fail-with-body http://127.0.0.1:3000/health/ready
```

如果还需要通过 DBeaver 访问 PostgreSQL，应在 `config`、`build`、`up`、`ps`、`logs`、`down` 和
`--force-recreate` 命令中保持同一文件组合，并追加 `-f compose.db-gui.yaml`；该覆盖文件仅限本地调试，
生产环境不得加载。

缺少或未获许可的 ODA 安装包时，请保持 `DWG_CONVERSION_ENABLED=false`；不要绕过转换器就绪检查，也不要暴露
Worker 端口。

## 日常使用

### 选择固定的 Compose 文件组合

先根据当前运行模式选择一组命令前缀，后续所有 `config`、`build`、`up`、`ps`、`logs`、`exec`、`down` 和
`--force-recreate` 命令都使用同一组文件，避免 DWG Worker 被切回基础镜像或 DBeaver 端口映射被移除。

| 当前模式           | Compose 命令前缀                                                            |
| ------------------ | --------------------------------------------------------------------------- |
| 基础模式           | `docker compose`                                                            |
| 基础模式 + DBeaver | `docker compose -f compose.yaml -f compose.db-gui.yaml`                     |
| DWG                | `docker compose -f compose.yaml -f compose.dwg.yaml`                        |
| DWG + DBeaver      | `docker compose -f compose.yaml -f compose.dwg.yaml -f compose.db-gui.yaml` |

切换文件组合前先执行对应的 `config --quiet`。如果只是修改某个服务的运行配置，继续使用当前前缀并定向重建该服务，
不要为了缩短命令而省略已经启用的覆盖文件。

### 停止与再次启动

以下示例为基础模式。其他模式将 `docker compose` 替换为上表对应的完整前缀。停止服务并保留数据：

```bash
docker compose down
```

再次启动：

```bash
docker compose up -d
```

> [!CAUTION]
> 不要把 `docker compose down -v` 当作日常停止命令。`-v` 会删除 PostgreSQL、Chroma、Redis 和上传文件
> 使用的本地 volume。

### 修改 `.env` 后让配置生效

环境变量在容器创建时读取。普通配置变化不需要重新构建镜像，但需要重建读取该配置的服务：

下表以基础模式前缀为例；DWG 或 DBeaver 模式必须替换为上表中的完整前缀。

| 修改内容                                    | 重建服务                                                  |
| ------------------------------------------- | --------------------------------------------------------- |
| LLM、Embedding、Rerank、认证、ACL、查询配置 | `docker compose up -d --force-recreate api`               |
| Parser、CAD、DWG 和资源限制                 | `docker compose up -d --force-recreate parser-worker`     |
| `PARSER_INTERNAL_TOKEN`                     | `docker compose up -d --force-recreate api parser-worker` |

`POSTGRES_USER`、`POSTGRES_DB` 和 `POSTGRES_PASSWORD` 只在空数据卷首次初始化时生效。已有 volume 时，重建
PostgreSQL 不会自动修改数据库内的账号或密码；出现认证失败时按下方 FAQ 同步密码，不要通过删除 volume
来“刷新配置”。README 生成的十六进制随机密码可直接写入 `DATABASE_URL`；自行使用包含 `@`、`:`、`/`、`#`
或 `%` 的密码时，必须对 URL 中的密码部分进行百分号编码。

### 数据存放位置

| 数据                                      | 位置                          |
| ----------------------------------------- | ----------------------------- |
| 上传的原始文件                            | Docker `raw_docs` volume      |
| 文档、ACL、版本、任务、原始及脱敏分块文本 | Docker `postgres_data` volume |
| 向量、脱敏检索文本和标量 ACL metadata     | Docker `chroma_data` volume   |
| 队列状态                                  | Docker `redis_data` volume    |

需要使用 DBeaver 只读查看 PostgreSQL 时，见
[部署运维手册：使用 DBeaver](./docs/06-部署运维手册.md#54-使用-dbeaver-只读查看-postgresql)。

## 常见问题 FAQ

### 1. `docker info` 或 Compose 提示无法连接 Docker daemon

**原因：** Docker Desktop 没有启动，或 Docker Engine 仍在初始化。

**解决：**

1. 打开 Docker Desktop。
2. 等待界面显示 Engine 已运行。
3. 重新执行 `docker info` 和 `docker compose version`。
4. 两条命令都成功后再运行 `docker compose up`。

### 2. `/health/ready` 失败，或 `parser-worker` 一直不健康

先使用当前模式的固定 Compose 文件组合查看 HTTP 状态、依赖检查、容器状态和 API 日志。下面以基础模式为例：

```bash
curl --fail-with-body -i http://127.0.0.1:3000/health/live
curl --fail-with-body -i http://127.0.0.1:3000/health/ready
docker compose ps
docker compose logs --tail=100 api
```

`live` 失败通常表示 API 没有启动或正在重启；`live` 成功但 `ready` 返回 503 时，查看响应中的 `checks`：

| 失败项         | 优先检查                                                                  |
| -------------- | ------------------------------------------------------------------------- |
| `postgres`     | `DATABASE_URL`、数据库角色密码、`docker compose logs --tail=100 postgres` |
| `redis`        | Redis 容器状态和 `docker compose logs --tail=100 redis`                   |
| `chroma`       | Chroma 容器、磁盘和 collection 指纹兼容性                                 |
| `parserWorker` | Worker 日志、内部 token、ODA/DWG 配置、解析资源限制                       |
| `rawDocs`      | `raw_docs` volume 是否挂载，以及 API 对目录的读写权限                     |

不需要 DWG 时，明确设置 `DWG_CONVERSION_ENABLED=false` 并使用基础 `compose.yaml`；需要 DWG 时，按本文的
DWG 章节加载 `compose.dwg.yaml`。`PARSER_INTERNAL_TOKEN` 必须至少 16 个字符且两端一致；修改配置后需要
`--force-recreate` 实际读取该配置的服务。

### 3. PostgreSQL 或 API 报密码认证失败

典型错误包括 DBeaver 的 `FATAL: password authentication failed` 和 Prisma `P1000`。这通常发生在已有
`postgres_data` volume 后修改了 `.env`：容器环境变量已经变化，但数据库角色仍保留旧密码。

以下恢复流程假设 `POSTGRES_USER` 和 `POSTGRES_DB` 没有改名；它们同样只在空 volume 首次初始化时生效。
如果误改了这两项，先恢复为该 volume 初始化时使用的角色和数据库名称。

使用当前模式的固定 Compose 文件组合进入 PostgreSQL；下面以基础模式为例：

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

在 `psql` 内安全更新当前角色密码，不要把新密码直接写进 shell 命令：

```text
\password
\q
```

随后把同一密码同步写入 `.env` 的 `POSTGRES_PASSWORD` 和 `DATABASE_URL`，再使用同一 Compose 文件组合重建
PostgreSQL 与 API，并验证 ready：

```bash
docker compose up -d --force-recreate postgres api
curl --fail-with-body http://127.0.0.1:3000/health/ready
```

DBeaver 使用 `127.0.0.1:15432`，数据库和用户名读取 `.env` 的 `POSTGRES_DB`、`POSTGRES_USER`（默认均为
`kb`），密码使用 `POSTGRES_PASSWORD`。不得使用 `docker compose down -v` 处理认证失败，该命令会删除数据
volume。

### 4. 文档显示“待建立索引”，或问答没有返回答案

这通常不是解析失败：

- `EMBEDDING_PROVIDER=none`：文档只完成本地解析、分块和脱敏，因此显示“待建立索引”。
- 已配置 Embedding，但 `LLM_PROVIDER=none`：可以建立向量索引，但不能生成最终回答。
- 修改 Provider 后没有重建 API：容器仍在使用旧配置。

按顺序检查 `.env`，使用当前模式的固定 Compose 文件组合执行 `up -d --force-recreate api`，再访问
`/health/ready`。已有“待建立索引”文档可在详情页点击“继续建立索引”，无需重新上传。

## 开发与测试

文档修改和日常代码检查：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

涉及 API 集成或前端完整流程时再运行：

```bash
pnpm --filter @nexus-kb/api test:integration
pnpm --filter @nexus-kb/web test:e2e
```

## 文档索引

| 文档                                                               | 内容                               |
| ------------------------------------------------------------------ | ---------------------------------- |
| [`TASK.md`](./TASK.md)                                             | 当前阶段、完成状态与下一步         |
| [`docs/01-项目实施规格.md`](./docs/01-项目实施规格.md)             | 项目范围、安全边界与验收标准       |
| [`docs/02-技术设计.md`](./docs/02-技术设计.md)                     | 架构、模块、数据结构与关键实现     |
| [`docs/03-前端产品与界面设计.md`](./docs/03-前端产品与界面设计.md) | 页面、交互、权限与响应式规范       |
| [`docs/04-开发规范.md`](./docs/04-开发规范.md)                     | 编码、测试、Git 与协作规范         |
| [`docs/05-开发任务清单.md`](./docs/05-开发任务清单.md)             | 完整阶段任务                       |
| [`docs/06-部署运维手册.md`](./docs/06-部署运维手册.md)             | 部署、配置、备份、监控与故障处理   |
| [`docs/07-API使用说明.md`](./docs/07-API使用说明.md)               | 认证、权限、端点、错误码与调用示例 |

机器可读契约：

- [公开 API OpenAPI](./packages/contracts/openapi/api.v1.yaml)
- [Parser Worker OpenAPI](./packages/contracts/openapi/parser-worker.v1.yaml)

## 安全提示

- 不要将 `.env`、API Key、Cookie、JWT、密码或真实业务文档提交到 Git。
- `tenantId`、角色、部门和 ACL 必须由服务端身份产生，客户端不能自行指定。
- `confidential` 内容默认不得发送到云端 Provider。
- Parser Worker 只负责解析，不持有模型 Key，不访问 Chroma，也不对公网开放。
- 文档片段是不可信数据，不能把其中的指令当作系统指令或工具调用依据。
