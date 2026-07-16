# 当前开发任务

> 项目：知枢 NexusKB
> 当前阶段：阶段 5——Chroma VectorStore 与索引激活
> 状态：已完成（2026-07-16）

---

## 1. 上一阶段交付记录

阶段 4“独立 Embedding Provider”已于 2026-07-16 完成：

- 定义独立 `EmbeddingProvider`、factory、统一错误和无正文遥测。
- 实现 Alibaba `text-embedding-v4` 适配器。
- confidential 在 Provider 方法执行前再次失败关闭。
- 配置指纹覆盖 Provider、模型、维度、task mode、分块和脱敏版本。

---

## 2. 当前目标

实现可替换的 Chroma VectorStore，并把允许出网的入库链路推进到安全激活：

```text
prepared chunks
→ Embedding
→ 数量/维度校验
→ Chroma stable-ID upsert
→ 写入结果验证
→ PostgreSQL 保存指纹与 collection
→ DocumentVersion / Document 原子激活
```

---

## 3. 本轮任务

### 3.1 VectorStore 抽象

- [x] 定义 `VectorStore`、VectorChunk、VectorQueryInput 和 RetrievedVectorChunk。
- [x] 业务编排不直接依赖 Chroma SDK。
- [x] 定义统一 VectorStore 错误和安全 API 映射。
- [x] 使用官方 `chromadb` TypeScript 客户端。

### 3.2 Collection 与配置指纹

- [x] Chroma Server 固定升级到 1.5.9，客户端固定为 3.5.0。
- [x] collection 名称包含 Provider、模型、维度、schema version 和指纹摘要。
- [x] collection metadata 保存完整 Embedding 配置指纹语义。
- [x] 使用 cosine 距离。
- [x] `getOrCreateCollection` 后重新读取并验证 metadata 与 HNSW space。
- [x] 指纹或距离配置不一致时 readiness 失败关闭。
- [x] 默认无 Embedding Provider 时只检查 Chroma 连通性，不创建 collection。

### 3.3 向量数据操作

- [x] 使用稳定 chunkId upsert。
- [x] 批量 upsert 后按 ID 读取确认全部写入。
- [x] 写入前再次验证向量数量、维度和有限数值。
- [x] Chroma document 只保存脱敏文本。
- [x] metadata 只保存标量 tenant、来源、部门、敏感度和 owner 信息。
- [x] 查询强制 tenant + ACL filter。
- [x] 实现按 tenantId + documentId 删除。

### 3.4 入库状态机与激活

- [x] 状态机增加 embedding 和 indexing。
- [x] IngestionProcessor 从 BullMQ adapter 中拆分，业务流程可独立测试。
- [x] PostgreSQL 保存 embeddingFingerprint、vectorCollection 和 indexedAt。
- [x] Embedding 或 Chroma 失败时文档不得 active。
- [x] Chroma upsert 验证成功后才原子设置 activeVersion。
- [x] retry 使用稳定 ID 覆盖部分写入，不产生重复向量。
- [x] 删除文档先删除向量，再清理数据库正文和原文件。

---

## 4. 完成条件

- [x] 重复 upsert 不增加向量数量。
- [x] tenant A 查询无法返回 tenant B 向量。
- [x] 删除文档后对应向量消失。
- [x] 错误 fingerprint 或非 cosine collection 阻止 readiness。
- [x] confidential 不调用 Embedding 或 Chroma。
- [x] 向量写入失败不激活文档版本。
- [x] TypeScript lint、typecheck、单元测试、build 和 format check 通过。
- [x] PostgreSQL/Redis/Chroma 集成测试通过。
- [x] Compose 服务保持 healthy，现有 volumes 保留。

---

## 5. 实现说明与边界

- 当前使用跨 tenant 共享 collection，并以服务端构造的 metadata filter 强制 tenant 隔离；未来如按
  tenant 拆 collection，仍必须保留 tenant metadata 和过滤测试。
- 当前 ACL filter 已具备 tenant、公开内容、部门、敏感度和 owner 规则骨架；身份仍来自开发身份，
  完整 JWT/OIDC 与 capability 在下一阶段实现。
- 默认 `EMBEDDING_PROVIDER=none` 时文档保持 `prepared`，不会生成虚假向量。
- 真实付费 Embedding 仍只通过显式冒烟开关启用；Chroma 集成测试使用合成向量，不产生模型费用。
- 当前只维护一个配置对应的 active collection；跨配置重建、灰度切换和旧 collection 回收属于后续
  索引迁移阶段。

---

## 6. 下一阶段入口

下一阶段进入认证与 ACL：

1. 仅 development 且 `AUTH_REQUIRED=false` 时允许固定开发身份。
2. 定义 JWT/OIDC guard 与可替换 token verifier。
3. Identity 增加 roles、allowedSensitivities 和 capability。
4. 文档、任务、向量查询和删除统一使用服务端身份构造 tenant/ACL 条件。
5. 覆盖 tenant、部门、敏感度、owner、管理员仍受 tenant 限制和客户端伪造身份字段。
6. 为 Rerank、LLM 和引用返回预留相同的二次授权 policy。

查询 API、Rerank 和 LLM 仍按后续阶段实施。
