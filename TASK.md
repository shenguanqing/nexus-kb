# 当前开发任务

> 项目：知枢 NexusKB
> 当前阶段：阶段 11——查询 API
> 状态：已完成（2026-07-18）

---

## 1. 背景

文档入库、Embedding、Chroma 索引、OIDC/ACL、LLM 和可选 Rerank 基础件已经完成。本轮将这些能力
串成安全、可观测且能明确拒答的知识查询闭环。

---

## 2. 当前目标

```text
查询输入校验 + Redis 用户/tenant 限流
→ Query Embedding
→ Chroma ACL Top 20
→ active version 复核 + 相邻 chunk 合并
→ 相关度阈值
→ 可选 Rerank
→ LLM 回答与来源编号校验
→ 引用最终鉴权 + 无正文审计
```

---

## 3. 本轮任务

### 3.1 API 与安全入口

- [x] 实现 `POST /v1/knowledge/query` 和版本化请求/响应契约。
- [x] 问题执行 trim、Unicode NFC、长度和控制字符校验，不接受客户端身份或 where 字段。
- [x] Redis 原子执行用户级和 tenant 级每分钟限流，Redis 故障时失败关闭。

### 3.2 检索与回答

- [x] 使用文档索引相同的 Embedding Provider、模型、维度和任务模式生成 Query Embedding。
- [x] 仅通过 `AclPolicy.vectorFilter` 构造 tenant、部门、敏感度和 owner 过滤器。
- [x] 校验 Chroma metadata，过滤距离阈值，并从 PostgreSQL 合并 active version 相邻 chunk。
- [x] 可选 Rerank 失败降级为向量顺序，相关度不足时不调用 Rerank 或 LLM。
- [x] LLM 前和回答返回前再次复核 ACL 与 active version，权限变化时丢弃回答。
- [x] 校验 `[来源N]`，返回真实 document version、chunk IDs、traceId 和实际模型标识。

### 3.3 审计与契约

- [x] 新增 `QueryAudit` migration，仅保存身份范围、问题长度、结果、Provider/model、chunk IDs 和耗时。
- [x] 问题、回答和片段正文不写入 QueryAudit 或普通业务日志。
- [x] OpenAPI、环境变量、技术设计、开发规范、运维和前端无答案交互同步更新。

---

## 4. 完成条件

- [x] 有足够相关资料时返回带合法来源的回答。
- [x] 相关度不足时返回 `noAnswer=true`，且 LLM 调用次数为 0。
- [x] 删除、失效、跨 tenant 或请求期间失去权限的文档不会作为来源返回。
- [x] 用户/tenant 限流和 Redis 故障均失败关闭。
- [x] lint、typecheck、单元测试、build、format check 和 secret scan 通过。

---

## 5. 下一阶段入口

继续阶段 12 会话与缓存，实现会话/消息数据模型、会话列表与详情、删除/归档、摘要和权限收紧后的缓存失效；
回答与来源仍必须复用阶段 11 的最终授权链路。
