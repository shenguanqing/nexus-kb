# 当前开发任务

> 项目：知枢 NexusKB
> 当前阶段：阶段 12——删除、版本和重建索引
> 状态：已完成（2026-07-18）

---

## 1. 背景

阶段 11 已完成安全查询闭环。本轮补齐文档生命周期和索引迁移，确保删除覆盖原文件、所有 collection 和
本地可识别数据；重新索引或更换 Embedding 配置失败时，旧 active version 与旧 collection 继续可用。

---

## 2. 当前目标

```text
单文档 reindex：创建候选版本 → 解析/脱敏/Embedding → stable upsert 回读
→ PostgreSQL 原子激活 → 保留旧版本回滚

全量索引迁移：新配置 prepare 全部候选 → 质量与完整性验证
→ 单 transaction activate → 协调 API 配置切换

删除：deleting 墓碑 → 停止任务 → 清理全部 collection
→ 删除原文件与本地正文 → 保留无正文审计
```

---

## 3. 本轮任务

### 3.1 删除闭环

- [x] 删除前写入 `deleting` 墓碑并使相关入库任务终止。
- [x] 根据版本和任务记录清理文档涉及的全部 Chroma collection。
- [x] 删除原文件、KnowledgeChunk、解析元素、warning、指纹和 collection 标识。
- [x] 任一步失败保留墓碑，重复 DELETE 可安全补偿。
- [x] `DocumentLifecycleAudit` 保留删除事实，不保存文档正文。

### 3.2 版本和单文档 reindex

- [x] 实现 `POST /v1/documents/:documentId/reindex` 与 OpenAPI 契约。
- [x] 创建递增 DocumentVersion 和 `kind=reindex` 的独立任务。
- [x] 候选失败、策略阻止或删除竞态不影响旧 active version。
- [x] 向量写入与回读确认完成后，在一个 transaction 中激活新版本并 supersede 旧版本。
- [x] 文档详情返回版本状态、解析器、chunk 数、指纹、collection 和激活时间。

### 3.3 全量索引迁移

- [x] `INDEX_MIGRATION_ACTION=prepare` 使用新配置构建不自动激活的候选版本。
- [x] 迁移进程禁用普通 BullMQ consumer，避免旧配置 consumer 消费候选任务。
- [x] `activate` 前验证 collection 指纹/cosine 配置和所有 active 文档候选完整性。
- [x] 用单一 PostgreSQL transaction 原子切换全部 active version；并发变化整体回滚。
- [x] 保留旧版本和旧 collection，通过恢复旧配置并再次 activate 回滚。

---

## 4. 完成条件

- [x] 单文档 reindex 失败时旧版本仍可查询。
- [x] 全量 prepare 失败时不修改任何 active version。
- [x] 候选不完整或切换时有并发变化则拒绝激活并整体回滚。
- [x] 删除完成后原文件、本地正文和所有已知 collection 向量均不可识别恢复。
- [x] 生命周期审计不包含原文、问题或回答。
- [x] lint、typecheck、单元测试、build、format check 和 secret scan 通过。

---

## 5. 文档冲突处理

上一版 `TASK.md` 曾把阶段 12 写为“会话与缓存”，但 `docs/05-开发任务清单.md` 的正式阶段 12 是
“删除、版本和重建索引”，且 `docs/01-项目实施规格.md` 将彻底删除、版本原子激活和 reindex 列为核心范围。
本轮按仓库规定的文档优先级执行正式阶段 12；会话与消息历史留到后续前端 F2/对应后端契约阶段。

---

## 6. 下一阶段入口

继续阶段 13 可观测性和审计，实现 `/metrics`、HTTP/Provider/队列/解析/检索指标、结构化审计查询与告警说明；
指标不得使用 userId、documentId 或 traceId 等高基数 label，也不得记录问题、回答或文档正文。
