# NexusKB API 使用说明

> 适用范围：NestJS 主服务公开 API、认证方式、权限边界、调用约定和安全示例
> 本地 Base URL：`http://127.0.0.1:3000`
> 机器可读契约：[api.v1.yaml](../packages/contracts/openapi/api.v1.yaml)

---

## 1. 文档职责与事实源

本文面向前端开发、集成开发和本地运维，说明如何安全调用 NexusKB API。接口字段、类型、必填项和响应结构以 OpenAPI 契约为准；本文负责解释认证、权限、状态语义和推荐调用流程。

公开业务接口统一使用 `/v1` 前缀。以下运维端点不使用 `/v1`：

- `GET /health/live`
- `GET /health/ready`
- `GET /metrics`

Parser Worker 的 `/internal/v1/parse` 不是公开 API。其契约位于 [parser-worker.v1.yaml](../packages/contracts/openapi/parser-worker.v1.yaml)，只能由 Compose 内网中的 API 使用，外部客户端不得直接调用。

接口发生变化时必须同步更新：

1. `packages/contracts/src` 中的运行时 Zod 契约。
2. `packages/contracts/openapi/api.v1.yaml`。
3. 主服务与前端实现及相关测试。
4. 本文中的行为说明和示例。

不得让本文或 README 成为与 OpenAPI 相互矛盾的第二套字段定义。

---

## 2. 通用调用约定

### 2.1 地址与内容类型

Mac 本地默认地址：

```text
http://127.0.0.1:3000
```

- 普通请求与响应使用 `application/json`。
- 文档上传使用 `multipart/form-data`，且每次请求只接受一个 `file`。
- `/metrics` 返回 Prometheus `text/plain`。
- 时间使用带时区的 ISO 8601，例如 `2026-07-28T08:30:00+08:00` 或 `2026-07-28T00:30:00Z`。
- 资源 ID 使用 UUID；chunk ID 和 Embedding 指纹使用 64 位小写十六进制字符串。

### 2.2 Trace ID

API 为每个请求生成 UUID trace ID，并通过响应头 `X-Trace-Id` 返回。客户端也可以发送合法 UUID 格式的 `X-Trace-Id`，用于把一次前端操作与服务端日志、任务和审计关联起来。

错误响应和部分异步操作响应也包含 `traceId`。排障时应记录 trace ID、请求时间和稳定错误码，不要复制密码、Cookie、JWT、完整问题、文档片段或模型回答到工单和日志。

### 2.3 标准错误结构

```json
{
  "error": {
    "code": "DOCUMENT_NOT_FOUND",
    "message": "文档不存在或无权访问",
    "traceId": "00000000-0000-4000-8000-000000000000"
  }
}
```

常用 HTTP 状态：

| 状态          | 含义                                                      |
| ------------- | --------------------------------------------------------- |
| `200`         | 查询、登录、更新或幂等删除成功                            |
| `202`         | 上传、重建或重试请求已进入异步队列                        |
| `400`         | 请求结构、字段、筛选或时间范围不合法                      |
| `401`         | 缺少身份、Cookie/JWT 无效或会话已过期                     |
| `403`         | 已认证，但缺少 capability、管理员角色或数据出网被策略阻止 |
| `404`         | 资源不存在，或为避免泄露而对当前身份不可见                |
| `409`         | 重复文档、状态冲突、任务不可重试或最后管理员保护          |
| `413`         | 上传文件超过服务端限制                                    |
| `429`         | 登录或知识问答触发限流                                    |
| `502/503/504` | Provider、向量库、依赖或超时故障                          |

客户端不得依赖 `message` 做业务分支，应使用稳定的 `error.code` 和 HTTP 状态。服务端不会返回堆栈、内部路径、数据库连接串或 Provider 原始敏感响应。

---

## 3. 认证模式

除明确标记为公开的端点外，所有 API 都需要经过服务端认证。`tenantId`、用户、部门、角色、允许敏感度和 capability 均由服务端身份产生，不能由客户端请求体或自定义 header 覆盖。

### 3.1 Development 身份

仅当 `NODE_ENV=development|test` 且 `AUTH_REQUIRED=false` 时启用。客户端无需发送 Cookie 或 Bearer JWT，服务端使用经过配置校验的 `DEV_*` 身份。

该模式只能用于本地开发和测试。production 强制认证，不会回退到开发身份。

### 3.2 账号密码会话

当 `PASSWORD_AUTH_ENABLED=true` 时，浏览器通过账号密码登录，服务端签发名为 `nexuskb_session` 的 `HttpOnly; SameSite=Strict` 不透明 Cookie。production 还要求 `Secure`。

推荐通过 Vue 登录页使用此模式。命令行测试如确有需要，应交互输入密码并使用权限受限的临时 Cookie 文件，避免密码出现在 shell 历史。以下示例使用 `jq` 安全构造 JSON；未安装 `jq` 时优先使用前端登录，不要手工拼接包含真实密码的命令：

```bash
NEXUSKB_BASE_URL=http://127.0.0.1:3000
NEXUSKB_COOKIE_JAR=/tmp/nexuskb-cookie.txt
umask 077
read -r 'NEXUSKB_USERNAME?Username: '
read -r -s 'NEXUSKB_PASSWORD?Password: '
printf '\n'
jq -n \
  --arg username "$NEXUSKB_USERNAME" \
  --arg password "$NEXUSKB_PASSWORD" \
  '{username: $username, password: $password}' |
  curl --fail-with-body --silent --show-error \
    --cookie-jar "$NEXUSKB_COOKIE_JAR" \
    --header 'Content-Type: application/json' \
    --data-binary @- \
    "$NEXUSKB_BASE_URL/v1/auth/password/login"
unset NEXUSKB_PASSWORD
```

后续示例使用：

```bash
curl --cookie "$NEXUSKB_COOKIE_JAR" "$NEXUSKB_BASE_URL/v1/auth/session"
```

完成测试后登出并删除临时 Cookie：

```bash
curl --request POST \
  --cookie "$NEXUSKB_COOKIE_JAR" \
  "$NEXUSKB_BASE_URL/v1/auth/logout"
rm -f "$NEXUSKB_COOKIE_JAR"
```

Cookie 文件等同于临时登录凭据，不得提交 Git、发送、截图或写入普通日志。

### 3.3 OIDC Bearer JWT

当 `AUTH_REQUIRED=true` 且 `PASSWORD_AUTH_ENABLED=false` 时，受保护端点要求：

```http
Authorization: Bearer <access-token>
```

命令行调试时不要把真实 token 直接写进命令历史：

```bash
read -r -s 'NEXUSKB_ACCESS_TOKEN?Access token: '
printf '\n'
curl --header "Authorization: Bearer $NEXUSKB_ACCESS_TOKEN" \
  "$NEXUSKB_BASE_URL/v1/auth/session"
unset NEXUSKB_ACCESS_TOKEN
```

服务端会验证签名、issuer、audience、算法、有效期和必需 claims。无效 token 不会回退开发身份。

### 3.4 公开端点

以下端点无需业务身份：

- `GET /health/live`
- `GET /health/ready`
- `GET /metrics`
- `GET /v1/auth/login-options`
- `POST /v1/auth/password/login`
- `POST /v1/auth/logout`

`/metrics` 虽然不要求业务 JWT，但生产环境必须由反向代理或网络策略限制为监控网段，不能暴露公网。 `/health/ready` 只返回有界依赖状态，不返回密码、内部地址或业务正文。

---

## 4. 角色、capability 与 ACL

应用角色只有 `user` 和 `admin`。`admin` 自动获得当前 tenant 的全部 capability 和 `public`、`internal`、`confidential` 访问范围；仍不能跨 tenant，也不能放宽 confidential 数据出网策略。`user` 的具体操作仍由 capability 强制校验。

| 接口范围                             | 最低要求                                |
| ------------------------------------ | --------------------------------------- |
| `GET /v1/auth/session`、个人问答历史 | 已认证                                  |
| 知识问答、文档/任务读取、分块详情    | `documents:read`                        |
| 上传、重建、metadata 修改、任务重试  | `documents:write`                       |
| 删除文档                             | `documents:delete`                      |
| 审计事件                             | `audit:read`                            |
| Provider 与系统状态                  | `system:read`                           |
| 创建运行配置版本                     | `admin` + `system:configure`            |
| 发布与回滚运行配置                   | `admin` + `system:deploy`               |
| 用量与成本                           | `admin` + `system:read`                 |
| 用户与部门读取                       | `admin` 全范围；普通用户仍固定为自身部门 |
| 本地后台账号创建、编辑、禁用、删除    | `admin`                                 |
| 角色和部门策略修改                   | `admin`                                 |

所有资源请求先强制 tenant。普通用户还受允许敏感度、public/同部门/本人范围限制；管理员可访问当前 tenant 内的全部敏感度和部门范围。资源不存在和 ACL 不可见通常统一为 404，客户端不能据此推断其他 tenant 的数据是否存在。

客户端不得发送可信身份字段、任意数据库过滤表达式、Chroma `where`、collection 名称或向量值。

---

## 5. 端点目录

### 5.1 健康、认证和指标

| 方法   | 路径                      | 说明                                                         |
| ------ | ------------------------- | ------------------------------------------------------------ |
| `GET`  | `/health/live`            | 仅确认 API 进程存活                                          |
| `GET`  | `/health/ready`           | 检查 PostgreSQL、Redis、Chroma、Parser Worker 及原文件/预览目录 |
| `GET`  | `/metrics`                | Prometheus 指标；生产必须限制监控网段                        |
| `GET`  | `/v1/auth/login-options`  | 返回登录模式摘要，不返回账号配置                             |
| `POST` | `/v1/auth/password/login` | 创建服务端密码会话并设置 HttpOnly Cookie                     |
| `POST` | `/v1/auth/logout`         | 撤销当前密码会话并清除 Cookie                                |
| `GET`  | `/v1/auth/session`        | 返回当前服务端身份、角色和 capability 摘要                   |

### 5.2 文档与入库任务

| 方法     | 路径                                  | capability         | 说明                                    |
| -------- | ------------------------------------- | ------------------ | --------------------------------------- |
| `GET`    | `/v1/documents`                       | `documents:read`   | ACL 文档列表、筛选和分页                |
| `GET`    | `/v1/documents/upload-options`        | `documents:write`  | 上传限制及当前身份可用 metadata         |
| `POST`   | `/v1/documents`                       | `documents:write`  | 单文件上传并创建异步入库任务            |
| `GET`    | `/v1/documents/{documentId}`          | `documents:read`   | 文档摘要、版本和索引状态                |
| `GET`    | `/v1/documents/{documentId}/preview`  | `documents:read`   | 无存储路径的预览 manifest 或降级状态   |
| `GET`    | `/v1/documents/{documentId}/preview/content` | `documents:read` | 再次 ACL 校验后流式返回预览内容      |
| `GET`    | `/v1/documents/{documentId}/chunks`   | `documents:read`   | 按版本分页查看原始/脱敏分块，不返回向量 |
| `POST`   | `/v1/documents/{documentId}/reindex`  | `documents:write`  | 继续建立索引或创建安全的新版本          |
| `PATCH`  | `/v1/documents/{documentId}/metadata` | `documents:write`  | 修改允许的部门/敏感度并触发新版本       |
| `DELETE` | `/v1/documents/{documentId}`          | `documents:delete` | 幂等永久删除原文件、向量和可识别缓存    |
| `GET`    | `/v1/ingestion-jobs`                  | `documents:read`   | ACL 入库任务列表                        |
| `GET`    | `/v1/ingestion-jobs/failed`           | `documents:read`   | 最近最多 50 个失败任务                  |
| `GET`    | `/v1/ingestion-jobs/{jobId}`          | `documents:read`   | 单个任务详情                            |
| `POST`   | `/v1/ingestion-jobs/{jobId}/retry`    | `documents:write`  | 只重试失败且 `retryable=true` 的任务    |

`GET /v1/documents` 支持：

- `search`
- `department`
- `sensitivity=public|internal|confidential`
- `status`
- `format=txt|md|docx|xlsx|pdf|png|jpg|jpeg|dxf|dwg`
- `page`，默认 1
- `pageSize`，默认 20，最大 100

`GET /v1/documents/{documentId}/chunks` 支持 `version`、`page` 和 `pageSize`。分块响应包含原始文本，属于权限敏感数据；不得写入浏览器持久化、普通日志、analytics 或错误上报。

预览 manifest 的 `status` 为 `ready|fallback|unavailable`。`ready` 时才可请求 `/preview/content`；该内容接口支持单一 `Range: bytes=...` 并返回 `Accept-Ranges: bytes`，不支持多段 range。超大型 CAD 的 SVG 可能以 gzip 编码存储，内容接口仍返回 `image/svg+xml`，同时携带 `Content-Encoding: gzip`，浏览器会自动解压；命令行客户端需要使用 `curl --compressed` 才能直接得到 SVG 正文。`fallback` 时使用 `fallbackVersion` 调用 chunks 接口展示解析原文。两个预览接口都会使用当前服务端身份重新执行 tenant 和文档 ACL，响应不返回 storage key 或内部路径。

`GET /v1/ingestion-jobs` 支持 `documentId`、`status`、`page` 和 `pageSize`。

### 5.3 知识问答与个人历史

| 方法     | 路径                                         | 要求             | 说明                              |
| -------- | -------------------------------------------- | ---------------- | --------------------------------- |
| `POST`   | `/v1/knowledge/query`                        | `documents:read` | ACL 检索、可选 Rerank、回答和引用 |
| `GET`    | `/v1/history/conversations`                  | 已认证           | 仅当前 tenant + user 的会话列表   |
| `GET`    | `/v1/history/conversations/{conversationId}` | 会话所有者       | 会话与问答轮次                    |
| `DELETE` | `/v1/history/conversations/{conversationId}` | 会话所有者       | 幂等删除个人会话                  |

历史列表支持 `query`、`from`、`to`、`offset` 和 `limit`。`from` 必须早于或等于 `to`，`limit` 最大 100。

### 5.4 审计、访问和系统管理

| 方法     | 路径                                                 | 要求                         | 说明                                 |
| -------- | ---------------------------------------------------- | ---------------------------- | ------------------------------------ |
| `GET`    | `/v1/audit/events`                                   | `audit:read`                 | 当前 tenant 的结构化审计事件         |
| `GET`    | `/v1/access/users`                                   | `access:read`                | 本地后台账号与已验证身份目录         |
| `POST`   | `/v1/access/users`                                   | `admin`                      | 创建本地后台账号                     |
| `PATCH`  | `/v1/access/users/{userId}`                          | `admin`                      | 编辑本地账号、重置密码、启用或禁用   |
| `DELETE` | `/v1/access/users/{userId}`                          | `admin`                      | 删除本地后台账号并撤销会话           |
| `PATCH`  | `/v1/access/users/{userId}/roles`                    | `admin` + `access:write`     | 将应用角色替换为 `user` 或 `admin`   |
| `GET`    | `/v1/access/departments`                             | `access:read`                | 有效部门敏感度策略                   |
| `PATCH`  | `/v1/access/departments/{department}`                | `admin` + `access:write`     | 只能收紧部门允许敏感度               |
| `GET`    | `/v1/system/providers`                               | `system:read`                | 脱敏 Provider、模型、区域和指纹摘要  |
| `GET`    | `/v1/system/status`                                  | `system:read`                | 脱敏依赖、队列和磁盘状态             |
| `GET`    | `/v1/system/usage`                                   | `admin` + `system:read`      | 指定时间范围内的用量事实             |
| `GET`    | `/v1/system/configuration`                           | `system:read`                | 当前脱敏运行配置、密钥状态与最近版本 |
| `POST`   | `/v1/system/configurations`                          | `admin` + `system:configure` | 校验并创建加密的不可变配置版本       |
| `POST`   | `/v1/system/configurations/{configurationId}/deploy` | `admin` + `system:deploy`    | 异步发布并定向重建受影响服务         |
| `GET`    | `/v1/system/deployments`                             | `system:read`                | 最近发布、readiness 与回滚结果       |
| `GET`    | `/v1/system/deployments/{deploymentId}`              | `system:read`                | 轮询单个发布任务                     |
| `POST`   | `/v1/system/deployments/{deploymentId}/rollback`     | `admin` + `system:deploy`    | 受控发布上一配置版本                 |

审计接口支持 `type=query|document_lifecycle|cloud_policy|access_change`、`before` 和 `limit`，返回 `nextBefore` 时间游标及当前 tenant、事件类型筛选范围内的 `total`。下一页继续传递 `before=<nextBefore>`；`before` 不改变 `total`，游标不是权限凭据。

用户目录使用 `offset`/`limit` 分页，支持 `query` 和 `department`。管理员可以管理本地密码账号；外部 OIDC 身份账号仅可查看，应在身份源中增删。普通用户即使有 `access:read`，也不能通过 `department` 查看其他部门。用量接口要求同时提供 `from` 和 `to`。

配置版本请求只接受共享契约列出的 LLM、Rerank、问答与限流、上传入库、Parser/Tika/CAD/DWG 受控字段。API Key 位于 `secrets` 写入字段，响应永不回显，只返回 `secretConfigured`。客户端不能提交 tenant、服务名、Docker 命令、Compose 文件、callback URL 或 Embedding Provider/模型/维度。Parser、Tika 或 CAD/DWG 字段变更时，服务端固定选择 `parser-worker` 和 `parser-worker-dwg`；发布返回 HTTP 202；客户端轮询 deployment，终态为 `succeeded|rolled_back|failed`，其中每条记录包含生成该配置版本时填写的 `changeReason`。`rolled_back` 表示目标 readiness 失败但上一配置已自动恢复；`failed` 需要运维介入。

---

## 6. 典型调用流程

以下示例假设已经设置：

```bash
NEXUSKB_BASE_URL=http://127.0.0.1:3000
NEXUSKB_COOKIE_JAR=/tmp/nexuskb-cookie.txt
```

密码模式示例使用 `--cookie "$NEXUSKB_COOKIE_JAR"`。Development 模式可移除该参数；OIDC 模式改用上一节的 Bearer header。不要同时发送来源不明的 Cookie 和 JWT。

### 6.1 检查服务

```bash
curl --fail-with-body "$NEXUSKB_BASE_URL/health/live"
curl --fail-with-body "$NEXUSKB_BASE_URL/health/ready"
```

`live` 成功不代表依赖可用；只有 `ready` 返回 HTTP 200 且 `status=ready` 才表示完整依赖链路就绪。

### 6.2 读取上传限制并上传

```bash
curl --fail-with-body \
  --cookie "$NEXUSKB_COOKIE_JAR" \
  "$NEXUSKB_BASE_URL/v1/documents/upload-options"
```

根据响应中的 `acceptedExtensions` 和 `maxUploadBytes` 选择不含敏感数据的测试文件：

```bash
curl --fail-with-body \
  --cookie "$NEXUSKB_COOKIE_JAR" \
  --form 'file=@./sample.md;type=text/markdown' \
  "$NEXUSKB_BASE_URL/v1/documents"
```

上传返回 HTTP 202、`documentId` 和 `jobId`。文件的 tenant、owner、部门和默认敏感度来自服务端身份，不接受客户端表单伪造。

仓库提供受显式开关保护的 PDF/图片真实容器入库冒烟脚本。它使用提供的账号创建 HttpOnly 会话，上传固定无敏感样本、等待任务完成并验证激活版本已写入向量集合；结束时删除本次创建的文档并登出。脚本不会打印凭据、Cookie 或文档正文。仅在本地 Docker 全链路及 Embedding 已就绪时执行：

```bash
read -r 'NEXUSKB_SMOKE_USERNAME?Username: '
read -r -s 'NEXUSKB_SMOKE_PASSWORD?Password: '
printf '\n'
export NEXUSKB_SMOKE_USERNAME NEXUSKB_SMOKE_PASSWORD
NEXUSKB_ALLOW_LIVE_SMOKE=true pnpm smoke:ingestion
unset NEXUSKB_SMOKE_USERNAME NEXUSKB_SMOKE_PASSWORD
```

### 6.3 查看任务和文档

```bash
curl --fail-with-body \
  --cookie "$NEXUSKB_COOKIE_JAR" \
  "$NEXUSKB_BASE_URL/v1/ingestion-jobs/<jobId>"

curl --fail-with-body \
  --cookie "$NEXUSKB_COOKIE_JAR" \
  "$NEXUSKB_BASE_URL/v1/documents/<documentId>"
```

任务可能经历：

```text
queued → converting（仅 DWG）→ parsing → chunking
→ policy_check → embedding → indexing → completed
```

未配置 Embedding 时，文档完成本地预处理后为 `prepared`，界面显示“待建立索引”。这不是失败。

#### 6.3.1 预览文档

先读取 manifest，不要根据文件名自行猜测预览方式：

```bash
curl --fail-with-body \
  --cookie "$NEXUSKB_COOKIE_JAR" \
  "$NEXUSKB_BASE_URL/v1/documents/<documentId>/preview"
```

`status=ready` 时可下载或流式显示内容；PDF 查看器可发送 Range：

```bash
curl --fail-with-body \
  --cookie "$NEXUSKB_COOKIE_JAR" \
  --header 'Range: bytes=0-1048575' \
  "$NEXUSKB_BASE_URL/v1/documents/<documentId>/preview/content" \
  --output /tmp/nexuskb-preview-part
```

该内容可能是原文件，也可能是本地生成的 PDF/SVG；超大型 CAD 调试时应为 `curl` 增加 `--compressed`。响应使用 `private, no-store` 且不返回内部路径。命令行调试完成后删除输出文件，不得将权限敏感预览上传到工单或公共网盘。

### 6.4 查询分块

```bash
curl --fail-with-body \
  --cookie "$NEXUSKB_COOKIE_JAR" \
  "$NEXUSKB_BASE_URL/v1/documents/<documentId>/chunks?version=1&page=1&pageSize=20"
```

该接口返回 `originalText` 和 `redactedText`，但不返回向量。调用前后都会按当前身份重新执行文档 ACL；权限收紧后不能依赖旧响应继续展示正文。

### 6.5 继续建立索引、重建或修改 metadata

```bash
curl --fail-with-body \
  --request POST \
  --cookie "$NEXUSKB_COOKIE_JAR" \
  "$NEXUSKB_BASE_URL/v1/documents/<documentId>/reindex"
```

对于 `prepared` 文档，该操作复用已保存的解析、分块和脱敏结果；对于 active 文档，它创建新版本，旧版本在新索引验证并原子激活前继续可用。

修改部门和敏感度会触发同样的安全新版本流程：

```bash
curl --fail-with-body \
  --request PATCH \
  --cookie "$NEXUSKB_COOKIE_JAR" \
  --header 'Content-Type: application/json' \
  --data '{"department":"platform","sensitivity":"internal"}' \
  "$NEXUSKB_BASE_URL/v1/documents/<documentId>/metadata"
```

客户端不能修改 tenant、owner、collection 或 Embedding 指纹。

### 6.6 知识问答

```bash
curl --fail-with-body \
  --cookie "$NEXUSKB_COOKIE_JAR" \
  --header 'Content-Type: application/json' \
  --data '{"question":"测试文档说明了什么？"}' \
  "$NEXUSKB_BASE_URL/v1/knowledge/query"
```

继续已有会话时可增加 `conversationId`：

```json
{
  "conversationId": "00000000-0000-4000-8000-000000000000",
  "question": "请补充上一条答案的依据。"
}
```

知识库依据回答：

```json
{
  "conversationId": "00000000-0000-4000-8000-000000000000",
  "answer": "示例答案。[来源1]",
  "noAnswer": false,
  "reason": null,
  "answerMode": "grounded",
  "traceId": "00000000-0000-4000-8000-000000000001",
  "sources": [
    {
      "index": 1,
      "documentId": "00000000-0000-4000-8000-000000000002",
      "documentVersion": 1,
      "chunkIds": ["0000000000000000000000000000000000000000000000000000000000000000"],
      "sourceName": "sample.md",
      "page": null,
      "sheet": null,
      "sectionPath": []
    }
  ],
  "model": {
    "provider": "configured-provider",
    "model": "configured-model",
    "fallbackUsed": false
  },
  "rerankDegraded": false
}
```

响应状态必须按字段组合解释：

| 状态                  | 约束                                                                 |
| --------------------- | -------------------------------------------------------------------- |
| `answerMode=grounded` | `noAnswer=false`、至少一个来源、`model` 非空                         |
| `answerMode=general`  | `noAnswer=false`、`sources=[]`、`model` 非空；内容不是企业知识库资料 |
| `noAnswer=true`       | `answerMode=null`、`sources=[]`、`model=null`，`reason` 非空         |

`general` 是默认 hybrid 模式下的通用知识补充，客户端必须持续显示“非知识库资料”。正式 RAG 质量评测使用 strict 模式，不把通用知识补充计为知识库命中。权限变化或 confidential 出网阻止时不得降级为通用回答。

### 6.7 任务重试与永久删除

只有详情中 `status=failed` 且 `retryable=true` 的任务允许重试：

```bash
curl --fail-with-body \
  --request POST \
  --cookie "$NEXUSKB_COOKIE_JAR" \
  "$NEXUSKB_BASE_URL/v1/ingestion-jobs/<jobId>/retry"
```

删除文档是高风险操作，会清理原文件、预览产物、全部版本向量和可识别缓存：

```bash
curl --fail-with-body \
  --request DELETE \
  --cookie "$NEXUSKB_COOKIE_JAR" \
  "$NEXUSKB_BASE_URL/v1/documents/<documentId>"
```

删除接口设计为幂等，但调用方仍应在界面明确展示文档名和影响范围，并要求强确认。不得把自动重试策略无差别应用到上传、重建、metadata 修改、角色修改或删除。

### 6.8 创建并发布运行配置

推荐由管理页调用。若做集成测试，必须交互取得密钥，使用临时 JSON 文件或 stdin，不能把 Key 写入 shell 历史。流程固定为：

1. `POST /v1/system/configurations` 创建版本，保存返回的配置版本 ID。
2. `POST /v1/system/configurations/{id}/deploy` 创建发布任务。
3. 轮询 `GET /v1/system/deployments/{deploymentId}`，直到终态。
4. 只有 `succeeded` 表示目标配置已通过 readiness 并成为 active；`rolled_back` 表示系统已恢复上一版本。

密钥字段留空表示保持上一 active 版本的值；页面提交后必须立即清空输入。成功发布且 `rollbackAvailable=true` 时，可在明确确认后调用 rollback 端点。发布接口不是普通幂等 mutation，客户端不得因网络错误自动重复创建版本或任务；应先刷新版本/发布列表确认状态。

---

## 7. 分页、筛选与重试

项目当前有三种分页形式：

| 形式            | 接口                     | 规则                                 |
| --------------- | ------------------------ | ------------------------------------ |
| `page/pageSize` | 文档、入库任务、文档分块 | 页码从 1 开始，`pageSize` 最大 100   |
| `offset/limit`  | 个人历史、用户目录       | `offset` 从 0 开始，`limit` 最大 100 |
| `before/limit`  | 审计事件                 | 使用响应的 `nextBefore` 继续下一页   |

筛选字段均为白名单。客户端不应发送空字符串、未知排序字段、任意 SQL/Chroma 表达式或未经服务端定义的分页游标。

推荐重试规则：

- GET 网络故障、连接超时和部分 5xx：有限次数指数退避。
- 429：遵循服务端提示并降低频率，不能无限立即重试。
- 400、401、403、404、409：先修正请求、身份、权限或资源状态。
- mutation：只有接口业务语义明确幂等，或客户端具备稳定 request ID 时才自动重试。

---

## 8. 安全与数据处理要求

1. API Key 只允许管理员通过同源配置 API 的 write-only `secrets` 字段提交，由主服务加密保存并交给内部部署代理；不得出现在其他业务 API、响应、前端构建配置、浏览器持久化或日志中。
2. Cookie、JWT、密码和 Provider Key 不得进入 URL、Git、截图、普通日志或错误上报。
3. 问题、回答、分块原文和脱敏正文默认不写入客户端持久化或普通日志。
4. `confidential` 默认不能发送任何云端模型；本机 Ollama Embedding 不代表允许云端 LLM/Rerank。
5. 文档片段是不可信数据，调用方不得把片段内容解释为系统指令或工具调用授权。
6. 分块详情、审计和系统状态返回均为最小披露；不得尝试从 403/404、筛选结果或计数推断无权资源。
7. 业务删除、后台账号、角色修改和部门策略修改必须通过 API，使状态机、tenant/ACL、审计和补偿逻辑生效；不得直接用 DBeaver 修改业务表。最后一个管理员不能删除、禁用或降级。
8. Embedding Provider、模型、维度、关键分块或脱敏规则变化需要新 collection 和索引迁移，不能只重启 API 后继续写旧索引。
9. 配置发布请求不能指定 Docker 服务、命令、路径或 callback；这些由服务端差异计算和部署代理固定白名单决定。`deployment-agent` 内部 callback 不属于公开 API，外部客户端不得调用。

---

## 9. 内部 Parser Worker 契约

`POST /internal/v1/parse` 仅供 API 容器调用：

- 只在 Compose `backend` internal 网络提供。
- 要求 `X-Internal-Token`。
- 文件引用必须位于受控共享根目录。
- Worker 校验路径穿越、符号链接、文件大小和资源上限。
- Worker 只解析文档，不持有模型 Key，不调用 Embedding/LLM/Rerank，不访问 Chroma，不决定权限。

外部系统如需上传或解析文档，只能调用公开的 `POST /v1/documents`，不能绕过 API 直连 Worker。
