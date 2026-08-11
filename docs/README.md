# 文档导航

> 本目录维护当前有效的项目文档。`.history/`、测试 fixture 和工具缓存不属于日常阅读或维护范围。

## 阅读路径

| 你的目的 | 首选文档 | 它解决的问题 |
| --- | --- | --- |
| 确认 Codex/开发者的长期工程与安全约束 | [AGENTS.md](../AGENTS.md) | 必读文档、架构边界、安全规则和修改流程。 |
| 了解现在在做什么、是否有阻塞 | [TASK.md](../TASK.md) | 当前阶段、验证证据、未完成门槛和下一步。 |
| 安排后续开发 | [05-开发任务清单.md](./05-开发任务清单.md) | 各阶段的依赖、任务范围和完成条件。 |
| 确认产品范围与安全底线 | [01-项目实施规格.md](./01-项目实施规格.md) | 必须实现的能力、验收标准和不可突破的边界。 |
| 修改架构、数据或跨服务契约 | [02-技术设计.md](./02-技术设计.md) | 架构、领域模型、服务职责和关键技术决策。 |
| 修改页面或交互 | [03-前端产品与界面设计.md](./03-前端产品与界面设计.md) | 页面、交互、权限体验和响应式基线。 |
| 修改代码、测试或协作流程 | [04-开发规范.md](./04-开发规范.md) | 编码、测试、Git 和协作要求。 |
| 部署、排障或日常运维 | [06-部署运维手册.md](./06-部署运维手册.md) | 部署流程、备份、监控、告警和故障处理。 |
| 调用或改动公开 API | [07-API使用说明.md](./07-API使用说明.md) | 认证、权限、端点、错误码和调用方式。 |

## 事实源

- 当前工作、状态、验证记录和阻塞项：`TASK.md`。
- 阶段路线图、依赖和完成条件：`05-开发任务清单.md`。
- 长期工程、安全与文档维护规则：根目录 [AGENTS.md](../AGENTS.md)。
- API 字段和响应结构：[公开 API OpenAPI](../packages/contracts/openapi/api.v1.yaml)。
- Parser Worker 契约：[Parser Worker OpenAPI](../packages/contracts/openapi/parser-worker.v1.yaml)。
- 完整环境变量清单：根目录 [`.env.example`](../.env.example)。

其他文档应链接到这些事实源，不复制会随实现频繁变化的清单、字段或配置值。

## 按模块查阅

- 应用职责与运行入口：[apps/README.md](../apps/README.md)。
- NestJS API 模块与安全边界：[apps/api/README.md](../apps/api/README.md)。
- Vue 页面、目录与前端边界：[apps/web/README.md](../apps/web/README.md)。
- 文档解析算法、限制和本地验证：[apps/parser-worker/README.md](../apps/parser-worker/README.md)。
- 本地 BGE 重排服务、模型下载和安全边界：[apps/reranker-worker/README.md](../apps/reranker-worker/README.md)。
- 真实质量评测数据集、运行与决策门槛：[evaluation/README.md](../evaluation/README.md)。

## 维护边界

- 正式文档包括根目录 `AGENTS.md`、`README.md`、`TASK.md`、本目录的编号文档、各应用 README 和 `evaluation/README.md`。
- `.history/` 是历史快照；`**/.pytest_cache/` 与测试临时目录是工具产物。它们均不应作为当前规则或任务状态的依据。
- 需求、架构、前端、开发规范、任务、运维和 API 变化分别更新对应编号文档；具体归属见 [AGENTS.md](../AGENTS.md)。
