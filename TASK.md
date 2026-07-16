# 当前开发任务

> 项目：知枢 NexusKB  
> 当前阶段：阶段 1——仓库初始化与本地开发环境  
> 状态：未开始

---

## 1. 当前目标

建立可运行、可测试的 monorepo 骨架，并通过 Docker Compose 在 Mac 上启动：

- TypeScript/NestJS API 主服务。
- Python/FastAPI Parser Worker。
- PostgreSQL。
- Redis。
- Chroma Server。

本阶段只完成基础设施、服务边界和健康检查，不提前实现完整文档解析、Embedding、检索和 LLM 问答。

---

## 2. 开发前必读

1. `AGENTS.md`
2. `docs/01-项目实施规格.md`
3. `docs/02-技术设计.md`
4. `docs/04-开发规范.md`
5. `docs/05-开发任务清单.md` 的阶段 1 和阶段 2
6. `docs/06-部署运维手册.md` 的本地部署部分

---

## 3. 本轮任务

### 3.1 初始化仓库

- [ ] 使用建议仓库名 `nexus-kb` 创建 Git 仓库。
- [ ] 初始化 pnpm workspace。
- [ ] 创建根目录 `package.json`、`pnpm-workspace.yaml` 和 lock 文件。
- [ ] 配置统一的 lint、format、typecheck、test 和 build 脚本。
- [ ] 创建 `.gitignore`、`.env.example` 和 `README.md`。
- [ ] 将四份项目文档放入 `docs/`。

### 3.2 TypeScript 主服务

- [ ] 在 `apps/api` 创建 NestJS 项目。
- [ ] 使用 Fastify adapter。
- [ ] 开启 TypeScript strict mode。
- [ ] 添加经过 schema 校验的配置模块。
- [ ] 添加 Pino 结构化日志和 trace ID。
- [ ] 实现 `GET /health/live`。
- [ ] 实现 `GET /health/ready`。
- [ ] 添加基础单元测试。
- [ ] 编写多阶段 Dockerfile，并使用非 root 用户。

### 3.3 Python Parser Worker

- [ ] 在 `apps/parser-worker` 创建 Python 3.11 FastAPI 项目。
- [ ] 添加 Pydantic 配置。
- [ ] 实现 `GET /health/live`。
- [ ] 实现 `GET /health/ready`。
- [ ] 实现需要内部 token 的测试接口或最小 parse stub。
- [ ] 验证文件路径只能位于共享文档目录。
- [ ] 添加 pytest 测试。
- [ ] 编写 Dockerfile，并使用非 root 用户。

### 3.4 共享契约

- [ ] 创建 `packages/contracts`。
- [ ] 定义第一版 ParseRequest、ParsedElement 和 ParseResponse。
- [ ] 为 Worker 接口生成或维护 JSON Schema/OpenAPI。
- [ ] 主服务对 Worker 响应进行运行时校验。
- [ ] 添加一条主服务调用 Worker 的契约测试。

### 3.5 Docker Compose

- [ ] 加入 API。
- [ ] 加入 Parser Worker。
- [ ] 加入 PostgreSQL。
- [ ] 加入 Redis。
- [ ] 加入 Chroma Server。
- [ ] 创建持久化 volumes。
- [ ] API 对宿主机只绑定 `127.0.0.1`。
- [ ] Parser Worker、PostgreSQL、Redis 和 Chroma 不映射公网端口。
- [ ] 为所有服务配置 healthcheck。
- [ ] Worker 对原始文件 volume 使用只读挂载。
- [ ] 固定所有生产相关镜像 tag，不使用 `latest`。

### 3.6 CI 基础

- [ ] 安装依赖使用 frozen lock。
- [ ] 运行 TypeScript lint、typecheck、test 和 build。
- [ ] 运行 Python lint/type check/test。
- [ ] CI 不运行需要真实模型 Key 的测试。
- [ ] CI 检查仓库中是否出现疑似密钥。

---

## 4. 本阶段明确不做

- 完整 Unstructured/Tika/OCR/CAD 解析。
- BullMQ 入库状态机。
- 云端 Embedding Provider。
- Chroma collection 与向量入库。
- 用户认证和完整 ACL。
- LLM 与 Rerank。
- 前端界面。
- 生产服务器发布。

如果某个基础实现确实需要预留接口，可以创建最小抽象和 stub，但不要提前扩展成未验证的完整功能。

---

## 5. 完成条件

只有满足以下所有条件，本阶段才可标记完成：

- [ ] `pnpm install --frozen-lockfile` 成功。
- [ ] TypeScript lint、typecheck、test 和 build 全部通过。
- [ ] Python 测试和静态检查通过。
- [ ] `docker compose up -d --build` 成功。
- [ ] Compose 中所有服务状态 healthy。
- [ ] `GET http://127.0.0.1:3000/health/live` 返回成功。
- [ ] `GET http://127.0.0.1:3000/health/ready` 能反映依赖状态。
- [ ] 主服务可以通过内网调用 Parser Worker。
- [ ] Parser Worker 无模型 Key、无 Chroma 写权限、无公网端口。
- [ ] PostgreSQL、Redis 和 Chroma 重启后数据 volume 仍存在。
- [ ] 仓库不包含真实密钥、上传文档、数据库文件、向量数据和运行日志。
- [ ] README 包含本地安装、启动、检查、测试和停止方法。
- [ ] 实际命令和文档一致。

---

## 6. 验证命令

初始化实现后，至少应存在以下等价命令；以最终 `package.json` 和 README 为准：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build

cd apps/parser-worker
python -m pytest

docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3000/health/live
curl http://127.0.0.1:3000/health/ready
docker compose logs api parser-worker
```

不得在未运行命令的情况下将对应完成条件标记为已完成。

---

## 7. 完成后的更新

完成本阶段后：

1. 将本文状态改为“已完成”。
2. 勾选实际完成项，不勾选未验证项。
3. 在 `docs/05-开发任务清单.md` 勾选阶段 1 和实际完成的阶段 2 项目。
4. 记录重要技术决策和与原设计的差异。
5. 将 `TASK.md` 更新为下一阶段“文件上传、文档管理与 Python 第一批解析器”。

---

## 8. 交付说明模板

```markdown
## 已完成

- ...

## 验证结果

- `pnpm test`：通过/失败
- `pnpm build`：通过/失败
- `python -m pytest`：通过/失败
- `docker compose up`：通过/失败

## 未完成或阻塞

- ...

## 重要决策与风险

- ...

## 下一步

- ...
```
