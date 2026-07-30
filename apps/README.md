# 应用目录说明

`apps/` 保存 NexusKB 可以独立运行的四个应用。跨应用 DTO、运行时校验和 OpenAPI 契约不放在这里，
统一维护在 [`packages/contracts`](../packages/contracts)。

## 应用索引

| 目录                               | 技术栈                  | 主要职责                                                | 详细说明                                          |
| ---------------------------------- | ----------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| [`api`](./api)                     | TypeScript、NestJS      | 公网 API、认证、ACL、入库编排、模型调用、向量检索和审计 | [API README](./api/README.md)                     |
| [`web`](./web)                     | Vue 3、TypeScript、Vite | 知识问答、来源展示、文档管理和管理后台                  | [Web README](./web/README.md)                     |
| [`parser-worker`](./parser-worker) | Python、FastAPI         | 内网文档解析、结构提取和受控 DWG 转换                   | [Parser Worker README](./parser-worker/README.md) |
| [`reranker-worker`](./reranker-worker) | Python、FastAPI      | 内网 BGE 候选重排，只返回输入索引与分数                 | [Reranker Worker README](./reranker-worker/README.md) |

## 服务调用关系

```text
Browser
  │
  ▼
Vue Web ──HTTP──▶ NestJS API
                      │
                      ├── PostgreSQL
                      ├── Redis / BullMQ
                      ├── Chroma
                      ├── LLM / Embedding / Rerank Provider
                      ├── internal HTTP ──▶ Parser Worker
                      └── internal HTTP ──▶ Local Reranker Worker (optional)
```

- API 是唯一公网业务入口。
- Web 只能调用 API，不能直接调用模型供应商、数据库或 Parser Worker。
- Parser Worker 只接受 API 发起的内部请求，不持有模型 Key，不访问 Chroma，也不判断用户权限。
- Local Reranker Worker 只接受 API 发起的内部请求，不访问原始文档、数据库或 Chroma；API 先完成 ACL 与策略检查，再发送有界候选文本。
- 原始大文件通过受控共享 volume 或对象存储引用传递，不进入 Redis job payload。

## 从哪里开始阅读

按问题类型选择入口：

- 查 API 启动、模块和安全边界：[`api/README.md`](./api/README.md)。
- 查前端路由、页面、状态和安全渲染：[`web/README.md`](./web/README.md)。
- 查 TXT、Markdown、DOCX、XLSX、DXF、DWG 解析算法：[`parser-worker/README.md`](./parser-worker/README.md)。
- 查本地 BGE 重排模型、启动和安全边界：[`reranker-worker/README.md`](./reranker-worker/README.md)。
- 查公开接口字段和认证方式：[`docs/07-API使用说明.md`](../docs/07-API使用说明.md)。
- 查完整架构和数据流：[`docs/02-技术设计.md`](../docs/02-技术设计.md)。
- 查当前阶段和下一步：[`TASK.md`](../TASK.md)。

## 通用开发命令

在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

单个应用的开发与测试命令见各自 README。Docker Compose 启动、配置和排障见根目录
[`README.md`](../README.md) 与 [`docs/06-部署运维手册.md`](../docs/06-部署运维手册.md)。
