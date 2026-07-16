# 当前开发任务

> 项目：知枢 NexusKB
> 当前阶段：阶段 3——分块、脱敏与出网策略
> 状态：已完成（2026-07-16）

---

## 1. 上一阶段交付记录

阶段 2“文件上传、文档管理与第一批解析器”已于 2026-07-16 完成：

- 安全流式上传、UUID 文件存储、SHA-256、扩展名/MIME/magic bytes 联合校验已实现。
- PostgreSQL 保存 Document、DocumentVersion 和 IngestionJob；BullMQ payload 仅含 ID 与文件引用。
- TXT、Markdown、DOCX、XLSX 解析器已形成上传、排队、解析和状态查询闭环。
- tenant 隔离、伪造身份字段、非法文件、路径逃逸和幂等删除测试已覆盖。

---

## 2. 当前目标

在 TypeScript 主服务中完成所有云端调用之前的本地预处理：

```text
Worker 结构化元素
→ 标题/页码/工作表/表格感知分块
→ 稳定 chunk ID 与相邻关系
→ PII 和业务规则脱敏
→ public/internal/confidential 出网策略
→ 保存待 Embedding 的脱敏 chunk 或策略阻止状态
```

本阶段不调用 Embedding、LLM 或 Rerank，不写入 Chroma。

---

## 3. 本轮任务

### 3.1 分块

- [x] 按标题路径、页码、工作表和元素类型分组。
- [x] 超长元素按确定性 token 单元切分。
- [x] 通过 `CHUNK_MAX_TOKENS` 和 `CHUNK_OVERLAP_TOKENS` 配置预算。
- [x] 表格行在每个拆分 chunk 中保留表头。
- [x] 保存 page、sheet、sectionPath、elementTypes 和前后 chunk ID。
- [x] 使用 documentId、version、元素路径和规范化正文生成稳定 SHA-256 chunkId。

### 3.2 脱敏

- [x] 内置手机号、身份证、银行卡和邮箱规则。
- [x] 支持受控 JSON 配置业务正则。
- [x] 原文与脱敏文本分开保存。
- [x] 保存脱敏命中摘要和 `redactionPolicyVersion`。
- [x] 普通日志和策略事件不记录脱敏前正文。

### 3.3 出网策略

- [x] public/internal 默认允许进入后续云端阶段。
- [x] confidential 默认阻止任何 Provider 操作。
- [x] 预留 sensitivity + providerId + region 精确规则。
- [x] 策略阻止时 Provider mock 调用次数为 0。
- [x] 保存无正文 CloudPolicyEvent。
- [x] 允许的文档进入 `prepared`；阻止的文档进入 `policy_blocked`。

### 3.4 数据、删除与幂等

- [x] 新增不可变 Prisma migration。
- [x] retry 时按 tenant/document/version 删除并重建 chunk，避免重复。
- [x] 软删除文档时物理删除本地 chunk，并清空版本解析正文。
- [x] DocumentVersion 保存 chunk 数、脱敏策略版本和云端策略决策。

---

## 4. 完成条件

- [x] 相同输入和配置生成相同 chunkId。
- [x] 每个 chunk 不超过配置 token 上限，超长切分保留 overlap。
- [x] 分块结果可还原文档、版本、页码/工作表与标题路径。
- [x] confidential 默认零 Provider 调用。
- [x] 策略事件不含原文或脱敏正文。
- [x] TypeScript lint、typecheck 和单元测试通过。
- [x] Prisma schema 校验通过。
- [x] README、`.env.example`、API 契约和相关设计/运维文档同步。

---

## 5. 实现说明与边界

- 当前 token 预算是 Provider 无关的 Unicode 确定性 token 单元。阶段 4 接入具体 Embedding
  Provider 时必须通过契约测试核对模型实际 token 上限；若更换计数或关键分块规则，创建新 collection
  并重建索引。
- `prepared` 只表示本地解析、分块、脱敏和策略检查完成，不代表文档已写入向量库或可查询。
- confidential 的精确放行能力只是策略接口和配置预留；生产启用任何规则前仍需合规审批。
- 本阶段不提前实现 Embedding Provider、配置指纹、批处理重试、Chroma adapter 或查询 API。

---

## 6. 下一阶段入口

下一阶段进入独立 Embedding Provider：

1. 定义 `EmbeddingProvider`，严格区分 `embedDocuments` 与 `embedQuery`。
2. 增加 Provider factory、配置校验和统一错误类别。
3. 先实现一个经官方文档核对的 Provider，并使用 mock 完成数量、顺序、维度和重试契约测试。
4. 定义包含 Provider、模型、维度、任务规则、分块版本和脱敏版本的配置指纹。
5. confidential 继续通过本阶段 CloudPolicyService 在 Provider 调用前失败关闭。

Chroma collection 创建和写入仍属于再下一阶段，不与 Provider 实现混在同一阶段。
