# 知枢 NexusKB

知枢 NexusKB 是一套 RAG 知识库系统，支持文本、PDF、Word、Excel、图片及 DXF/DWG 图纸的解析、入库与在线预览，并为大型 CAD 图纸提供瓦片化深度缩放。系统通过租户与 ACL 实施权限隔离，提供语义检索、可溯源问答、来源引用和全链路审计能力。

当前仓库提供包含多租户、权限、审计和管理后台的完整能力集；后续计划在共享 RAG 核心上增加 Lite 模式，具体范围尚未定义。文档中的 `docker:full` 仅表示包含 DWG 等服务的完整 Compose 拓扑，不代表产品版本。

当前 Vue 前端与本地 RAG 主链路已经完成；真实业务数据质量评测仍等待获批的脱敏数据集。详细进度见 [`TASK.md`](./TASK.md)。

## 阅读路径

- [第一次启动](#第一次启动推荐本地开发模式)
- [启用本机向量索引](#启用本机向量索引ollama)
- [启用完整 RAG 问答](#启用完整-rag-问答)
- [启用管理员配置发布](#启用管理员配置发布按需)
- [启用 DWG 解析](#启用-dwg-解析按需)
- [启动全部 Docker 服务](#启动全部-docker-服务按需启用-dwg)
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

| 组件             | 职责                             | 本地运行位置                      |
| ---------------- | -------------------------------- | --------------------------------- |
| Vue Web          | 知识问答与管理界面               | Mac 宿主机，默认 `127.0.0.1:5173` |
| NestJS API       | 认证、权限、入库、检索与模型编排 | Docker，默认 `127.0.0.1:3000`     |
| Deployment Agent | 管理员受控配置发布与自动回滚     | Docker 内网；默认不启动           |
| Parser Worker    | 文档解析与结构提取               | Docker 内网                       |
| Apache Tika      | PDF 本地解析失败时的受控兜底     | Docker 内网                       |
| PostgreSQL       | 文档、ACL、版本和任务状态        | Docker 内网                       |
| Redis            | BullMQ 异步任务队列              | Docker 内网                       |
| Chroma           | 向量索引                         | Docker 内网                       |

Deployment Agent、Parser Worker、Apache Tika、PostgreSQL、Redis 和 Chroma 默认不向宿主机或公网开放端口。

### 名词速览

后文会反复出现以下几个词。首次阅读时只需了解基本含义：

- **Embedding（向量化）**：把文本转换成一串数字（向量），用于语义检索，而不是关键词匹配。
- **LLM Provider**：生成最终问答回复的大模型服务，比如 OpenAI、Google 等。
- **RAG**：先检索出相关文档片段，再交给 LLM 生成有依据的回答，即"检索增强生成"。
- **Rerank（重排序）**：对检索出的候选片段按相关性再排一次序，提升最终结果质量，属于可选项。
- **ACL / tenant**：权限与租户隔离，用于控制哪些人可以查看哪些文档。

## 选择运行模式

第一次接触本项目，建议使用“本地开发模式”。它会启用管理端所需的 deployment-agent；模型、DWG 与 DBeaver 仍按需启用。

| 模式                 | 需要额外准备                | 可以验证                                   | 暂时不能做                 |
| -------------------- | --------------------------- | ------------------------------------------ | -------------------------- |
| 本地开发模式（推荐） | 本地 `.env` 的四项随机值    | 管理界面、配置发布、文档解析、数据库和队列 | 未配置模型时不能检索或问答 |
| 基础自检模式         | 无 deployment-agent 配置    | 容器、数据库、队列和常规文档解析           | 配置发布与模型功能         |
| 本机向量索引         | Ollama + `bge-m3`           | 文档向量化与本地检索                       | 未配置 LLM 时不能生成回答  |
| 完整 RAG             | Embedding + 获批的云端 LLM  | 检索、回答和来源引用                       | 取决于已启用的文档格式     |
| DWG 解析             | 经许可的 ODA File Converter | DWG 转 DXF 后解析                          | 不会自动启用模型           |

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

## Compose 命令入口

仓库提供以下 pnpm 入口；所有命令都必须从仓库根目录运行：

| 入口                     | 适用范围                               | 示例                                   |
| ------------------------ | -------------------------------------- | -------------------------------------- |
| `pnpm docker:base --`    | 基础服务，不含 DWG、部署代理或 DBeaver | `pnpm docker:base -- up -d --build`    |
| `pnpm docker:dev --`     | 推荐本地开发，不含 DWG 和 DBeaver      | `pnpm docker:dev -- ps`                |
| `pnpm docker:oidc --`    | 临时 Keycloak SSO/PKCE 回归，仅本机    | `pnpm docker:oidc -- up -d keycloak`   |
| `pnpm docker:full --`    | DWG + deployment-agent 的完整常驻服务  | `pnpm docker:full -- ps`               |
| `pnpm docker:full:db --` | 完整服务，并临时开放本地 DBeaver 端口  | `pnpm docker:full:db -- up -d --build` |

`docker:dev` 启用 `configuration` profile；`docker:full` 额外加载 `compose.dwg.yaml`；`docker:full:db` 再额外加载 `compose.db-gui.yaml`。这些入口会先加载 `.env`，再在存在时加载后台发布生成的 `config/runtime.env`，确保 Compose 插值和容器运行值都以激活版本为准；基础/开发模式仍固定关闭 DWG。不要绕过入口拼接另一套 Compose 命令。同一运行周期请始终使用同一个入口。一次性 Reranker 模型下载不属于常驻服务，仍使用 `--profile model-init run`。

`docker:oidc` 仅加载 `compose.oidc.yaml` 中的临时 Keycloak，不进入生产拓扑，并固定映射为 `127.0.0.1:18080`，避免占用常见的本地 8080 服务。它要求 `.env` 中有 `KEYCLOAK_TEST_ADMIN_PASSWORD` 与 `KEYCLOAK_TEST_USER_PASSWORD`；运行后使用 `sso-tester` 和后者的本地密码在 [登录页](http://127.0.0.1:5173/login) 验证 SSO。清理时只能移除 Keycloak 自己的容器与 volume：`pnpm docker:oidc -- rm -s -f keycloak keycloak-bootstrap` 后执行 `docker volume rm nexus-kb_keycloak_data`。不得使用 `down -v`，它会删除同一 Compose 项目的数据库、Redis 等其他 volumes。

## 第一次启动（推荐本地开发模式）

本节不需要模型 API Key、Ollama 或 ODA。完成后可进入管理界面、使用 Provider 配置发布、上传 TXT、Markdown、PDF、DOC、DOCX、XLSX、PNG/JPG 或 DXF 测试文件，验证本地解析、分块、脱敏和预览流程。当前上传白名单内的所有格式都有预览：PDF/图片/文本直接显示，DOC/DOCX/XLSX 本地转 PDF，小型 DXF 本地转 SVG，超大/高成本 CAD 使用按视口懒渲染的本地 PNG 瓦片；CAD 可深度缩放，全部预览可全屏，转换不可用时显示解析文本。DOC 正文解析依赖 Compose 中的内网 Tika。问答和向量检索需要在后续配置模型。Parser Worker 镜像会在构建阶段预置 LibreOffice、Noto CJK 字体、中文/英文 OCR 模型，首次构建耗时和镜像体积会明显增加，运行时不会下载字体或模型。

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

> [!IMPORTANT]
> `.env` 会保存密码和可能的 API Key，已被 Git 忽略。接下来填写时，不要把这个文件提交、发送或截图分享出去。

生成四个不同的随机值：

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -base64 32
openssl rand -hex 32
```

打开 `.env`，至少完成以下修改：

1. 将第一个随机值同时填入 `POSTGRES_PASSWORD`，并替换 `DATABASE_URL` 中的数据库密码。
2. 将第二个随机值填入 `PARSER_INTERNAL_TOKEN`。
3. 将第三个随机值填入 `SYSTEM_CONFIG_ENCRYPTION_KEY`。
4. 将第四个随机值填入 `DEPLOYMENT_AGENT_TOKEN`，并设置 `DEPLOYMENT_AGENT_URL=http://deployment-agent:8200`。
5. 使用下面的本地开发配置：

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
SYSTEM_CONFIG_ENCRYPTION_KEY=<第三个随机值>
DEPLOYMENT_AGENT_URL=http://deployment-agent:8200
DEPLOYMENT_AGENT_TOKEN=<第四个随机值>
```

这里显式关闭 DWG，表示本次启动不提供 DWG 上传能力；其他已支持格式不受影响。`DEV_ROLES_JSON=["admin"]` 只用于本地开发身份，便于访问文档管理页面，不能用于生产环境。

### 3. 启动本地开发服务

确认 Docker Desktop 已运行。首次启动需要拉取镜像并构建服务。Parser Worker 还会下载 CPU PyTorch wheel 和中英文 OCR 模型，因此会比后续启动耗时更长。然后执行：

```bash
pnpm docker:up:dev
```

随后可用 `pnpm docker:dev -- ps` 确认 `api`、`deployment-agent`、`parser-worker`、`tika`、`postgres`、`redis` 和 `chroma` 正常运行。

### 4. 检查服务状态

```bash
curl http://127.0.0.1:3000/health/live
curl http://127.0.0.1:3000/health/ready
```

- `live` 表示 API 进程已启动。
- `ready` 返回 HTTP 200 且 `status` 为 `ready`，才表示依赖链路已经就绪。

如果 `ready` 失败，先查看日志：

```bash
pnpm docker:dev -- logs --tail=100 api deployment-agent parser-worker tika
```

### 5. 启动前端

另开一个终端，在仓库根目录执行：

```bash
pnpm --filter @nexus-kb/web dev
```

浏览器打开 [http://127.0.0.1:5173](http://127.0.0.1:5173/)。开发模式会使用 `.env` 中的服务端固定身份，不需要输入账号密码。

### 6. 完成第一次验证

1. 进入“文档管理”。
2. 上传一份不含敏感信息的 TXT、Markdown、PDF、DOC、DOCX、XLSX、PNG/JPG 或 DXF 文件。
3. 在“上传与入库任务”查看解析、分块和脱敏状态。
4. 任务完成后，文档应显示“待建立索引”。

此时本地开发环境已经跑通，管理页面不会因配置发布功能未启用而返回 503。要让文档进入向量索引，请继续启用 Ollama；要生成问答回答，还需要配置云端 LLM。

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

> [!WARNING]
> 文档与查询必须使用相同的 Embedding Provider、模型和维度。更换这些配置后不能继续写入旧 collection，必须创建新索引并执行迁移。

```dotenv
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=bge-m3:latest
EMBEDDING_DIMENSIONS=1024
EMBEDDING_REGION=local
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_KEEP_ALIVE=30m
```

Ollama 不需要 API Key。`host.docker.internal` 是 API 容器访问 Mac 宿主机的地址，不要改成任意公网 HTTP 地址。API 使用 Ollama 原生 `/api/embed` 并通过 `OLLAMA_KEEP_ALIVE` 将模型保留在内存中；该值只影响模型驻留时间，不改变向量空间。

### 3. 重建 API 容器

下面以推荐本地开发模式为例。已启用 DWG 或 DBeaver 时，必须使用 [选择固定的 Compose 入口](#选择固定的-compose-入口)中当前模式对应的入口，不能临时切回开发模式。

```bash
pnpm docker:dev -- up -d --force-recreate api
curl --fail-with-body http://127.0.0.1:3000/health/ready
```

之前处于“待建立索引”的文档，可在文档详情点击“继续建立索引”，系统会复用已完成的解析、分块和脱敏结果。

## 启用完整 RAG 问答

完整问答需要同时满足：

1. 已配置可用的 Embedding Provider。
2. 已配置组织批准的云端 LLM Provider。
3. 文档状态已经变为“已生效”。

在 `.env` 中将 `LLM_PROVIDER` 改为 `openai`、`google`、`deepseek`、`alibaba` 或 `custom`，并填写该平台控制台当前可用的模型 ID、HTTPS Base URL 和 API Key。例如使用 Google 时需要填写：

> [!IMPORTANT]
> API Key 只应保存在 Git 忽略的 `.env` 或 Secret Manager 中。不要写入代码、Git、截图或 shell 命令。`confidential` 内容默认不能发送到云端 LLM 或 Rerank。

```dotenv
LLM_PROVIDER=google
LLM_MODEL=<控制台当前可用的模型 ID>
GEMINI_API_KEY=<本地开发 Key>
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
```

修改后只需重建 API（下面以推荐本地开发模式为例；已启用 DWG 或 DBeaver 时，须改用 [选择固定的 Compose 入口](#选择固定的-compose-入口)中当前模式对应的入口）：

```bash
pnpm docker:dev -- up -d --force-recreate api
curl --fail-with-body http://127.0.0.1:3000/health/ready
```

然后在“知识问答”中提问，并核对回答是否包含 `[来源N]` 和对应来源卡片。

- Rerank 默认保持 `none`，是否启用应由正式质量评测决定。

### 启用本地 BGE Rerank（按需）

本地 Rerank 使用独立、仅 Compose 内网可访问的 `reranker-worker`，模型为 `BAAI/bge-reranker-v2-m3`；它不复用 Ollama，也不属于 Parser Worker。主服务在 tenant、ACL、敏感度与出网策略检查后，才向它发送有限候选分块；该服务仅返回输入下标与分数。

在 Git 忽略的 `.env` 中配置：

```dotenv
RERANK_PROVIDER=local_bge
RERANK_MODEL=BAAI/bge-reranker-v2-m3
LOCAL_RERANK_ENABLED=true
LOCAL_RERANK_BASE_URL=http://reranker-worker:8100
# 可选；留空时本地开发复用 PARSER_INTERNAL_TOKEN。
RERANK_INTERNAL_TOKEN=
```

然后执行：

```bash
# 推荐模式使用 docker:dev；已启用 DWG 时使用 docker:full。
pnpm docker:dev -- --profile model-init run --rm reranker-model-init
pnpm docker:dev -- up -d --build api reranker-worker
pnpm docker:dev -- ps api reranker-worker
```

首条命令是一次性模型预下载：它只连接专用的下载网络并将模型写入 Docker named volume。常驻 Reranker 仍只有内部网络、没有公网端口。Apple Silicon Docker Desktop 默认使用 Linux CPU 推理；先通过受控评测确认延迟与质量，再让它参与日常问答；任何失败都会安全回退到原向量排序。完整服务边界和运行说明见 [reranker-worker README](./apps/reranker-worker/README.md)。

Provider 的完整配置项见 [技术设计：配置](./docs/02-技术设计.md#4-配置)，运行检查、数据出网和密钥安全规则见 [部署运维手册：健康检查](./docs/06-部署运维手册.md#6-健康检查)。

## 启用管理员配置发布（按需）

默认不启用。启用后，管理员可以在“Provider 与系统状态”页面创建加密的运行配置版本，并发布 LLM、Rerank、问答与限流、上传入库及 Parser/Tika/CAD/DWG 运行参数。独立的 `deployment-agent` 只接受 API 的内部请求，只能按服务端计算结果重建 `api`、`parser-worker`、`parser-worker-dwg` 或 `reranker-worker`；readiness 失败时会自动恢复上一版配置。

> [!WARNING]
> `deployment-agent` 是唯一挂载 Docker socket 的组件。它不暴露宿主机端口，不能执行任意命令或重建任意服务。不要为 API、Web 或 Parser Worker 挂载 Docker socket，也不要手工编辑 `config/runtime.env`。

### 1. 配置独立密钥与内部令牌

在受保护的本地 `.env` 或 Secret Manager 中配置以下三个值；不要提交、复制到工单或打印到日志：

```bash
openssl rand -base64 32  # SYSTEM_CONFIG_ENCRYPTION_KEY
openssl rand -hex 32     # DEPLOYMENT_AGENT_TOKEN
```

```dotenv
SYSTEM_CONFIG_ENCRYPTION_KEY=<base64 编码的 32 字节密钥>
DEPLOYMENT_AGENT_URL=http://deployment-agent:8200
DEPLOYMENT_AGENT_TOKEN=<至少 32 字符的独立随机 token>
```

这三个值必须同时存在；任一值留空时配置发布保持禁用。请备份 `SYSTEM_CONFIG_ENCRYPTION_KEY`：直接替换它会导致历史配置版本无法解密。

### 2. 启动代理并验证

必须从仓库根目录执行。推荐模式使用 `docker:dev`；完整模式的 `docker:full` 同样包含 `configuration` profile：

```bash
pnpm docker:dev -- config --quiet
pnpm docker:dev -- up -d --build --force-recreate deployment-agent api
pnpm docker:dev -- ps deployment-agent api
curl --fail-with-body http://127.0.0.1:3000/health/ready
```

代理容器会以与宿主机相同的仓库绝对路径调用 Docker Compose，因此只能从仓库根目录启动。`deployment-agent` 仅在 Compose 内网的 `8200` 端口监听，健康状态可通过 `pnpm docker:dev -- ps` 或 `pnpm docker:dev -- logs deployment-agent` 查看，不能从浏览器或公网直接访问。

### 3. 使用边界与失败处理

- 进入版本化发布流程的仅限 LLM、Rerank、问答与限流、上传入库及 Parser/Tika/CAD/DWG 运行参数；Embedding Provider、模型、维度、分块/脱敏规则必须走索引迁移，数据库、认证根配置、网络、volume 和内部 token 仍由运维流程管理。
- 发布时代理会原子写入 Git 忽略、权限为 `0600` 的 `config/runtime.env`，然后以固定参数重建受影响服务，并连续两次检查 readiness。
- 发布失败会自动还原上一份 `runtime.env` 并再次验证；页面显示“已自动回滚”。若出现 `ROLLBACK_FAILED`，停止进一步发布，查看代理与目标服务日志，并按备份恢复。

完整的密钥轮换、运行时配置与故障处置说明见 [部署运维手册：启用前端配置发布](./docs/06-部署运维手册.md#55-启用前端配置发布)。

## 启用 DWG 解析（按需）

DWG 转换依赖独立授权的 ODA File Converter。仓库与基础镜像不包含安装包、许可证或二进制。

从 [ODA 官方下载页](https://www.opendesign.com/guestfiles/oda_file_converter) 获取经组织许可的 **Linux x64 Debian (`.deb`)** 安装包，并将它放到：

```text
apps/parser-worker/vendor/oda/oda-file-converter.deb
```

该文件已被 Git 忽略，禁止提交到仓库。随后按照 [部署运维手册：CAD / DWG 转换流程](./docs/06-部署运维手册.md#91-cad--dwg-转换流程)读取实际安装版本、填写 `DWG_CONVERTER_RELEASE`。

> [!IMPORTANT]
> 从以下 `pnpm docker:full` 命令开始即进入 **DWG 模式**。后续统一使用 `pnpm docker:full -- <Compose 子命令>`；该入口保留原生 `parser-worker` 处理图片/PDF 等常规文件，并额外启动 `linux/amd64` 的 `parser-worker-dwg`。API 仅把 DWG 路由到后者，两个 Worker 的 readiness 都必须通过。

构建前先打开 Docker Desktop，等待 Docker Engine 完全启动，并确认下面两条命令均成功：

```bash
docker info
docker compose version
```

然后使用完整入口构建 DWG 专用 Worker、校验合并配置并启动整套服务：

```bash
pnpm docker:full -- build parser-worker-dwg
pnpm docker:full -- config --quiet
pnpm docker:full -- up -d --build
pnpm docker:full -- ps
```

单独执行第一条 `build parser-worker-dwg` 可以提前暴露 ODA 安装包、版本或 Worker 镜像构建问题；后续 `up -d --build` 会复用已有构建缓存，并确保 API 等其他需要构建的服务也与当前源码一致。DWG 专用镜像会下载 CPU PyTorch wheel 和 EasyOCR 中文/英文模型，耗时数分钟属于正常现象；需要观察详细进度时使用：

```bash
pnpm docker:full -- --progress plain build parser-worker-dwg
```

DWG 派生镜像固定从 PyTorch CPU wheel 源安装 Torch/Torchvision，不应下载名称以 `nvidia_` 开头的 CUDA 运行时包。构建后可执行以下只读冒烟检查；输出中的 `cuda` 应为 `None`：

```bash
docker run --rm --platform linux/amd64 --entrypoint python nexus-kb-parser-worker \
  -c "import torch; print({'torch': torch.__version__, 'cuda': torch.version.cuda})"
```

`ps` 中的 `api`、原生 `parser-worker`、`parser-worker-dwg`、`tika`、`postgres`、`redis` 和 `chroma` 应正常运行，随后再检查：

```bash
curl --fail-with-body http://127.0.0.1:3000/health/live
curl --fail-with-body http://127.0.0.1:3000/health/ready
```

如果还需要通过 DBeaver 访问 PostgreSQL，统一改用 `pnpm docker:full:db -- <Compose 子命令>`；该入口额外加载本地调试覆盖文件，生产环境不得使用。

缺少或未获许可的 ODA 安装包时，请保持 `DWG_CONVERSION_ENABLED=false`；不要绕过转换器就绪检查，也不要暴露 Worker 端口。

## 启动全部 Docker 服务（按需启用 DWG）

这不是第一次启动后的必做步骤。只有在完成上一节的 ODA 安装包与 `.env` 配置后才使用它；它会在本地开发模式基础上增加 DWG 专用 Worker，并启动全部**常驻** Docker 服务。

```bash
pnpm docker:up:all
```

它等同于完整 Compose 文件组合并启用 `configuration` profile。缺少 ODA 时继续使用 `pnpm docker:up:dev`，不要用“全部启动”绕过 DWG 的安全检查。

如果需要一次启动全部常驻 Docker 服务，并同时把 PostgreSQL 映射到 DBeaver 使用的 `127.0.0.1:15432`，改用：

```bash
pnpm docker:full:db -- up -d --build
```

`pnpm docker:up:all` 不加载 `compose.db-gui.yaml`，因此不会开放 `15432`。Compose 覆盖文件不会永久附着在容器上；本地需要持续使用 DBeaver 时，后续的 `up`、`ps`、`logs`、`exec`、`down` 和 `--force-recreate` 也应统一使用 `pnpm docker:full:db --`。Vue 前端不在 Compose 中，仍需单独运行 `pnpm --filter @nexus-kb/web dev`。

本地 BGE Rerank 的模型下载是有意隔离的短任务，不会由该命令自动执行；首次启用时按上文的 `reranker-model-init` 命令预下载模型。

## 日常使用

### 选择固定的 Compose 入口

先选择一个入口，后续所有 `config`、`build`、`up`、`ps`、`logs`、`exec`、`down` 和 `--force-recreate` 都使用它，避免 DWG Worker 被切回基础镜像或 DBeaver 端口映射被移除。

| 当前模式                         | 统一入口                                  |
| -------------------------------- | ----------------------------------------- |
| 本地开发模式（推荐）             | `pnpm docker:dev -- <Compose 子命令>`     |
| 基础自检模式                     | `pnpm docker:base -- <Compose 子命令>`    |
| DWG + deployment-agent           | `pnpm docker:full -- <Compose 子命令>`    |
| DWG + deployment-agent + DBeaver | `pnpm docker:full:db -- <Compose 子命令>` |

切换入口前先执行对应的 `config --quiet`。如果只是修改某个服务的运行配置，继续使用当前入口并定向重建该服务。

### 停止与再次启动

以下示例为推荐本地开发模式。停止服务并保留数据：

> [!CAUTION]
> 不要把 `docker compose down -v` 当作日常停止命令。`-v` 会删除 PostgreSQL、Chroma、Redis 和上传文件使用的本地 volume。

```bash
pnpm docker:dev -- down
```

再次启动：

```bash
pnpm docker:up:dev
```

### 修改后如何生效

默认使用 `docker:dev`；已启用 DWG 时，将命令中的 `docker:dev` 换为 `docker:full`，并把 Parser Worker 改为 `parser-worker parser-worker-dwg`。

| 改动                           | 需要做什么                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| Vue 页面、样式                 | Vite 自动更新；若改了 `vite.config.ts` 或 `VITE_*`，重启 `pnpm --filter @nexus-kb/web dev`。 |
| API 源码或 Dockerfile          | `pnpm docker:dev -- up -d --build --force-recreate api`                                      |
| API 的 `.env` 配置             | `pnpm docker:dev -- up -d --force-recreate api`                                              |
| Parser 源码、依赖或 Dockerfile | `pnpm docker:dev -- up -d --build --force-recreate parser-worker`                            |
| Parser 的 `.env` 解析限制      | `pnpm docker:dev -- up -d --force-recreate parser-worker`                                    |
| 不确定改了哪些 Docker 服务     | `pnpm docker:up:dev`                                                                         |

修改后检查：`pnpm docker:dev -- ps`、`curl --fail-with-body http://127.0.0.1:3000/health/ready`。首次启用本地 Rerank、数据库密码轮换和 DWG 的专用重启命令见 [部署运维手册](./docs/06-部署运维手册.md#53-env-配置重载)。

每次改动完成后，按影响范围运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`；Docker 服务再检查 `ps`、`/health/ready` 和相关日志。完整部署场景与数据库密码变更规则见 [部署运维手册](./docs/06-部署运维手册.md#53-env-配置重载)。

`POSTGRES_USER`、`POSTGRES_DB` 和 `POSTGRES_PASSWORD` 只在空数据卷首次初始化时生效。已有 volume 时，重建 PostgreSQL 不会自动修改数据库内的账号或密码；出现认证失败时按下方 FAQ 同步密码，不要通过删除 volume 来“刷新配置”。README 生成的十六进制随机密码可直接写入 `DATABASE_URL`；自行使用包含 `@`、`:`、`/`、`#` 或 `%` 的密码时，必须对 URL 中的密码部分进行百分号编码。

### 数据存放位置

| 数据                                      | 位置                              |
| ----------------------------------------- | --------------------------------- |
| 上传的原始文件                            | Docker `raw_docs` volume          |
| 本地生成的预览 PDF/SVG/CAD 瓦片 bundle    | Docker `preview_artifacts` volume |
| 文档、ACL、版本、任务、原始及脱敏分块文本 | Docker `postgres_data` volume     |
| 向量、脱敏检索文本和标量 ACL metadata     | Docker `chroma_data` volume       |
| 队列状态                                  | Docker `redis_data` volume        |

需要使用 DBeaver 只读查看 PostgreSQL 时，见 [部署运维手册：使用 DBeaver](./docs/06-部署运维手册.md#54-使用-dbeaver-只读查看-postgresql)。

## 常见问题 FAQ

### 1. `docker info` 或 Compose 提示无法连接 Docker daemon

**原因：** Docker Desktop 没有启动，或 Docker Engine 仍在初始化。

**解决：**

1. 打开 Docker Desktop。
2. 等待界面显示 Engine 已运行。
3. 重新执行 `docker info` 和 `docker compose version`。
4. 两条命令都成功后再运行 `pnpm docker:base -- up`，或在前置条件齐备时运行 `pnpm docker:up:all`。

### 2. `/health/ready` 失败，或 `parser-worker` 一直不健康

先使用当前模式的固定 Compose 文件组合查看 HTTP 状态、依赖检查、容器状态和 API 日志。下面以基础模式为例：

```bash
curl --fail-with-body -i http://127.0.0.1:3000/health/live
curl --fail-with-body -i http://127.0.0.1:3000/health/ready
docker compose ps
docker compose logs --tail=100 api parser-worker tika
```

`live` 失败通常表示 API 没有启动或正在重启；`live` 成功但 `ready` 返回 503 时，查看响应中的 `checks`：

| 失败项         | 优先检查                                                                  |
| -------------- | ------------------------------------------------------------------------- |
| `postgres`     | `DATABASE_URL`、数据库角色密码、`docker compose logs --tail=100 postgres` |
| `redis`        | Redis 容器状态和 `docker compose logs --tail=100 redis`                   |
| `chroma`       | Chroma 容器、磁盘和 collection 指纹兼容性                                 |
| `parserWorker` | Worker/Tika 日志、内部 token、ODA/DWG 配置、解析资源限制                  |
| `rawDocs`      | `raw_docs` volume 是否挂载，以及 API 对目录的读写权限                     |

不需要 DWG 时，明确设置 `DWG_CONVERSION_ENABLED=false` 并使用基础 `compose.yaml`；需要 DWG 时，按本文的 DWG 章节加载 `compose.dwg.yaml`。`PARSER_INTERNAL_TOKEN` 必须至少 16 个字符且两端一致；修改配置后需要 `--force-recreate` 实际读取该配置的服务。

### 3. Parser Worker 镜像构建十几分钟仍未完成

首次构建需要下载 Python 依赖、CPU PyTorch wheel 和 EasyOCR 模型，具体耗时取决于网络和 Docker Desktop 分配的资源。先不要反复执行完整的 `up --build --force-recreate`，改用当前运行模式的固定 Compose 文件组合单独观察 Parser 构建。DWG 模式执行：

```bash
pnpm docker:full -- --progress plain build parser-worker
```

根据最后持续输出的步骤排查：

- 正在下载 `torch`、`torchvision` 或 OCR 模型：首次构建的正常下载，后续会复用 BuildKit 缓存。
- 正在下载 `nvidia_cublas_cu*`、`nvidia_cudnn_cu*` 等包：依赖解析异常，不要继续等待；当前 `Dockerfile.dwg` 应固定使用 CPU wheel。
- 长时间停在拉取基础镜像或 wheel：检查网络、Docker Desktop 磁盘空间和代理设置。
- 构建进程无输出且 Docker Desktop 内存或磁盘占用已满：先释放 Docker 资源或增加资源配额，不要删除项目数据 volume。

镜像构建成功后，不需要再次构建所有服务。仅重建实际受影响的运行实例：

```bash
pnpm docker:full -- up -d --no-deps --force-recreate tika parser-worker parser-worker-dwg api
pnpm docker:full -- ps tika parser-worker parser-worker-dwg api
```

### 4. PostgreSQL 或 API 报密码认证失败

典型错误包括 DBeaver 的 `FATAL: password authentication failed` 和 Prisma `P1000`。这通常发生在已有 `postgres_data` volume 后修改了 `.env`：容器环境变量已经变化，但数据库角色仍保留旧密码。

以下恢复流程假设 `POSTGRES_USER` 和 `POSTGRES_DB` 没有改名；它们同样只在空 volume 首次初始化时生效。如果误改了这两项，先恢复为该 volume 初始化时使用的角色和数据库名称。

使用当前模式的固定 Compose 文件组合进入 PostgreSQL；下面以基础模式为例：

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

在 `psql` 内安全更新当前角色密码，不要把新密码直接写进 shell 命令：

```text
\password
\q
```

随后把同一密码同步写入 `.env` 的 `POSTGRES_PASSWORD` 和 `DATABASE_URL`，再使用同一 Compose 文件组合重建 PostgreSQL 与 API，并验证 ready：

```bash
pnpm docker:base -- up -d --force-recreate postgres api
curl --fail-with-body http://127.0.0.1:3000/health/ready
```

DBeaver 使用 `127.0.0.1:15432`，数据库和用户名读取 `.env` 的 `POSTGRES_DB`、`POSTGRES_USER`（默认均为 `kb`），密码使用 `POSTGRES_PASSWORD`。不得使用 `docker compose down -v` 处理认证失败，该命令会删除数据 volume。

### 5. 文档显示“待建立索引”，或问答没有返回答案

这通常不是解析失败：

- `EMBEDDING_PROVIDER=none`：文档只完成本地解析、分块和脱敏，因此显示“待建立索引”。
- 已配置 Embedding，但 `LLM_PROVIDER=none`：可以建立向量索引，但不能生成最终回答。
- 修改 Provider 后没有重建 API：容器仍在使用旧配置。

按顺序检查 `.env`，使用当前模式的固定 Compose 文件组合执行 `up -d --force-recreate api`，再访问 `/health/ready`。已有“待建立索引”文档可在详情页点击“继续建立索引”，无需重新上传。

## 开发与测试

文档修改和日常代码检查：

```bash
pnpm docs:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

涉及 API 集成或前端完整流程时再运行：

```bash
pnpm test:parser
pnpm --filter @nexus-kb/api test:integration
pnpm --filter @nexus-kb/web test:e2e
```

需要在已授权的本地完整 RAG 环境中验证固定 PDF/图片的“上传 → 解析 → 向量索引”链路时，使用受显式开关保护的 `pnpm smoke:ingestion`。它需要交互提供的本地账号密码，完成后会删除本次创建的测试文档并登出；具体命令见 [API 使用说明](./docs/07-API使用说明.md#62-读取上传限制并上传)。

## 文档导航

完整的阅读路径、事实源和模块入口统一维护在 [docs/README.md](./docs/README.md)，避免根目录 README 与文档目录重复维护两份索引。

- 当前工作、验证记录和阻塞项：[TASK.md](./TASK.md)。
- 机器可读字段契约：[公开 API OpenAPI](./packages/contracts/openapi/api.v1.yaml) 与 [Parser Worker OpenAPI](./packages/contracts/openapi/parser-worker.v1.yaml)。

## 安全提示

- 不要将 `.env`、API Key、Cookie、JWT、密码或真实业务文档提交到 Git。
- `tenantId`、角色、部门和 ACL 必须由服务端身份产生，客户端不能自行指定。
- `confidential` 内容默认不得发送到云端 Provider。
- Parser Worker 只负责解析，不持有模型 Key，不访问 Chroma，也不对公网开放。
- 文档片段是不可信数据，不能把其中的指令当作系统指令或工具调用依据。
