# 当前开发任务

> 项目：知枢 NexusKB
> 当前阶段：阶段 13——可观测性和审计
> 状态：已完成（2026-07-18）

---

## 1. 背景

阶段 12 已完成文档删除、版本和索引迁移闭环。本轮为 HTTP、Provider、入库和查询链路建立低基数
Prometheus 指标，并把既有三类审计事实收敛为受权限保护、tenant 隔离且不含正文的查询接口。

---

## 2. 当前目标

```text
请求/任务/Provider 事件 → 低基数 Counter/Histogram/Gauge → /metrics
→ Prometheus recording/alert rules → P50/P95/P99、错误、积压、成本和健康告警

QueryAudit + DocumentLifecycleAudit + CloudPolicyEvent
→ audit:read → tenant-first 查询 → 结构化无正文响应
```

---

## 3. 本轮任务

### 3.1 Prometheus 指标

- [x] 实现 public `/metrics`，并在运维文档要求由监控网段限制访问。
- [x] HTTP 使用稳定路由模板和状态类别，Histogram 支持 P50/P95/P99 聚合。
- [x] Provider 记录延迟、rate_limit、unavailable/5xx、timeout、重试和 token 用量。
- [x] 只按显式 `provider:model` 价格表估算成本，缺失价格不产生虚假成本。
- [x] 记录 BullMQ 队列状态、最老等待时间和任务处理耗时。
- [x] 记录解析结果/耗时、OCR warning、检索空结果和 Rerank 降级。
- [x] 抓取 raw docs 磁盘使用率以及 PostgreSQL、Redis、Chroma、Parser Worker 健康状态。

### 3.2 结构化审计查询

- [x] 新增 `GET /v1/audit/events` 及共享 Zod/OpenAPI 契约。
- [x] 使用独立 `audit:read` capability，角色不能隐式替代权限。
- [x] QueryAudit、DocumentLifecycleAudit 和 CloudPolicyEvent 均先按服务端 tenantId 查询。
- [x] 返回资源 ID、trace、结果、Provider/model、策略和耗时，不查询或返回问题、回答或文档正文。
- [x] 支持类型、时间游标和 1–100 条结果限制。

### 3.3 运维与告警

- [x] 记录指标名称、label 约束、抓取边界和模型价格配置方式。
- [x] 提供 API 5xx/P95、Provider 429/5xx、队列积压、解析失败率、空检索率、磁盘和 Chroma PromQL。
- [x] 明确指标不得使用 tenantId、userId、documentId、jobId 或 traceId 等高基数 label。

---

## 4. 完成条件

- [x] `/metrics` 在完整 Compose 环境输出 Prometheus text exposition，依赖和磁盘指标可刷新。
- [x] 审计查询需要 `audit:read` 且自动化测试验证 tenant 交叉访问为 0。
- [x] 指标和审计响应均不包含问题、回答、文档片段或密钥。
- [x] TypeScript 格式、lint、secret scan、typecheck、111 项单元/契约测试和 build 通过。
- [x] PostgreSQL/Redis/Chroma 10 项集成测试通过。
- [x] Parser Worker ruff、mypy 和 13 项 pytest 通过。

---

## 5. 文档冲突处理

`docs/06-部署运维手册.md` 要求查看每 tenant 成本，而 `docs/04-开发规范.md` 禁止把 tenantId 用作高基数
Prometheus label。本轮按更严格的低基数约束：Prometheus 只记录 Provider/model 全局用量和成本；每 tenant
成本由受权限保护的审计数据或集中日志离线聚合，不把 tenantId 加入 `/metrics`。

---

## 6. 下一阶段入口

继续阶段 14 质量评测，建立 30–100 条带正确答案、目标文档和页码的评测集，覆盖无答案与无权限问题，
计算 Recall@K、MRR、引用正确率、拒答率、越权率、P95 延迟和成本，并比较 Vector Top 5 与
Top 20 + Rerank Top 5。
