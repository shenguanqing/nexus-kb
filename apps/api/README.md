# NestJS API 应用说明

异步入库、分块脱敏、Provider 编排、向量检索、回答生成、审计和指标。

Parser Worker 只返回结构化元素；分块、脱敏、云端出网策略和向量写入均由本应用完成。

## 关键入口

| 路径                                                         | 作用                                              |
| ------------------------------------------------------------ | ------------------------------------------------- |
| [`src/main.ts`](./src/main.ts)                               | HTTP 服务启动、全局校验、错误处理和运行时配置入口 |
| [`src/app.module.ts`](./src/app.module.ts)                   | NestJS 根模块与各业务模块装配                     |
| [`src/config/app-config.ts`](./src/config/app-config.ts)     | 环境变量 schema、Provider 和运行限制配置          |
| [`prisma/schema.prisma`](./prisma/schema.prisma)             | PostgreSQL 数据模型                               |
| [`src/index-migration.cli.ts`](./src/index-migration.cli.ts) | 向量索引迁移命令入口                              |

公开接口统一使用 `/v1`；接口字段以 [`packages/contracts/openapi/api.v1.yaml`](../../packages/contracts/openapi/api.v1.yaml) 为事实源。

## 模块目录

| 目录                      | 职责                                                           |
| ------------------------- | -------------------------------------------------------------- |
| `src/auth`                | 服务端身份、OIDC/JWT、账号密码会话、角色与 ACL 基础策略        |
| `src/access`              | 用户目录、角色和部门权限管理                                   |
| `src/documents`           | 上传校验、文档、版本、metadata 和删除生命周期                  |
| `src/ingestion`           | BullMQ 任务、Parser 调用后的分块、脱敏、出网策略和索引迁移     |
| `src/parser`              | Parser Worker 内部客户端、响应校验和安全错误映射               |
| `src/knowledge`           | 查询规范化、ACL 检索、上下文策略、回答生成、引用校验和查询审计 |
| `src/history`             | 当前 tenant 与用户隔离的问答历史                               |
| `src/vector-store`        | Chroma VectorStore 抽象与实现                                  |
| `src/model-providers`     | LLM、Embedding、Rerank Provider 抽象、适配器和 factory         |
| `src/audit`               | 结构化审计事件                                                 |
| `src/observability`       | Prometheus 指标                                                |
| `src/health`              | live/ready 健康检查                                            |
| `src/system`、`src/usage` | Provider、依赖状态和用量摘要                                   |
| `src/evaluation`          | 质量数据捕获与离线评测 CLI                                     |
| `src/common`              | 统一异常、错误响应和安全日志                                   |
| `src/database`            | Prisma 生命周期封装                                            |

测试主要位于 `test/`；依赖 PostgreSQL、Redis 或 Chroma 的测试位于 `test/integration/`。

## 关键处理链路

### 文档入库

```text
上传与 MIME/签名校验
→ 保存原文件与文档记录
→ BullMQ 异步任务
→ 调用 Parser Worker
→ 结构优先分块
→ 脱敏与云端策略判断
→ Embedding
→ Chroma upsert
→ 新版本验证并激活
```

### 知识问答

```text
验证服务端身份
→ tenant + ACL 检索过滤
→ 可选 Rerank
→ 来源再次鉴权
→ LLM 回答
→ 引用校验
→ 返回授权来源并写入无正文审计
```

## 安全边界

- `tenantId`、角色、部门和允许敏感度只能来自经过验证的服务端身份。
- 向量查询必须先包含 tenant 和 ACL 过滤，不能先检索再做应用层过滤。
- `confidential` 内容默认禁止发送到云端 Embedding、Rerank 和 LLM。
- 知识库片段是不可信输入，不能成为系统指令或工具调用依据。
- 日志不得记录完整问题、片段、回答、密码、Cookie、token 或 Provider Key。
- Provider 差异必须留在 Provider adapter/factory 中，controller 和业务 service 不散落供应商分支。

## 开发命令

在仓库根目录执行：

```bash
pnpm --filter @nexus-kb/api dev
pnpm --filter @nexus-kb/api lint
pnpm --filter @nexus-kb/api typecheck
pnpm --filter @nexus-kb/api test
pnpm --filter @nexus-kb/api build
```

依赖服务已经启动时，可运行：

```bash
pnpm --filter @nexus-kb/api test:integration
```

数据库 schema 变更必须新增 Prisma migration，不直接修改已发布迁移。完整启动、配置和迁移方式见 [`docs/06-部署运维手册.md`](../../docs/06-部署运维手册.md)。
