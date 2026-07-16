# 当前开发任务

> 项目：知枢 NexusKB
> 当前阶段：阶段 4——独立 Embedding Provider
> 状态：已完成（2026-07-16）

---

## 1. 上一阶段交付记录

阶段 3“分块、脱敏与出网策略”已于 2026-07-16 完成：

- TypeScript 主服务按标题路径、页码、工作表和表格结构生成稳定 chunk。
- 原文与脱敏文本分开保存，内置手机号、身份证、银行卡和邮箱规则。
- confidential 默认在任何 Provider 调用前失败关闭。
- 允许的文档进入 `prepared`，策略阻止的文档进入 `policy_blocked`。

---

## 2. 当前目标

建立与业务编排解耦的 Embedding Provider 层，并实现首个经官方文档核对的平台适配器：

```text
脱敏文本 / 查询
→ CloudPolicyService
→ EmbeddingService
→ EmbeddingProviderFactory
→ Alibaba text-embedding-v4
→ 数量、顺序、维度校验
→ 返回向量与无正文调用遥测
```

本阶段不把向量写入 Chroma，不激活文档版本，也不实现查询 API。

---

## 3. 本轮任务

### 3.1 Provider 抽象

- [x] 定义 `EmbeddingProvider`。
- [x] 严格区分 `embedDocuments` 与 `embedQuery`。
- [x] Provider 暴露 id、model、dimensions、region 和 taskMode。
- [x] 实现集中式 `EmbeddingProviderFactory`。
- [x] 未配置 Provider 时失败关闭，不构造虚假本地向量。
- [x] DeepSeek 不在 Embedding Provider 可选项中。

### 3.2 Alibaba 适配器

- [x] 使用 Node 原生 fetch 调用 OpenAI 兼容 `/embeddings`。
- [x] 首个模型固定为经官方文档核对的 `text-embedding-v4`。
- [x] 支持官方列出的 64、128、256、512、768、1024、1536、2048 维度。
- [x] 单批最多 10 条，并按配置进行有限批处理。
- [x] 传递 `dimensions` 和 `encoding_format=float`。
- [x] 按响应 index 恢复顺序。
- [x] 验证返回数量、索引连续性、模型和向量维度。

### 3.3 配置、错误与稳定性

- [x] 默认 `EMBEDDING_PROVIDER=none`，本地基础设施不依赖付费 Key。
- [x] 选择 Alibaba 时强制校验 Key、HTTPS base URL、model、region 和维度。
- [x] 定义 Authentication、RateLimit、Timeout、InvalidRequest、Unavailable 和 InvalidResponse。
- [x] 429、超时、连接错误和部分 5xx 指数退避并加入 jitter。
- [x] 400、401、403、404、422 不重试。
- [x] Embedding 失败不自动切换其他供应商。
- [x] Provider 错误映射为稳定 API code 和安全中文消息。

### 3.4 策略、指纹和遥测

- [x] confidential 在实际 Provider 方法执行前再次失败关闭。
- [x] 配置指纹包含 Provider、模型、维度、task mode、分块参数和脱敏版本。
- [x] 记录 Provider、模型、区域、request ID、耗时、尝试次数和 token usage。
- [x] 遥测不记录 Key、输入正文或向量内容。
- [x] 付费冒烟测试通过显式环境开关启用，普通测试默认跳过。

---

## 4. 完成条件

- [x] 文档批量返回向量数与输入数一致。
- [x] 文档和查询向量都严格符合配置维度。
- [x] 相同配置生成相同指纹，关键语义变化生成不同指纹。
- [x] 429 可以重试，400/401/403 不重试。
- [x] confidential Provider mock 调用次数为 0。
- [x] 默认配置无需任何模型 Key 即可启动。
- [x] TypeScript lint、typecheck、单元测试、build 和 format check 通过。
- [x] README、`.env.example` 和相关设计/运维文档同步。

---

## 5. 实现说明与边界

- 官方文档核对日期为 2026-07-16。`text-embedding-v4` 当前单次最多 10 条、每条最多 8192
  tokens，默认推荐 1024 维；模型限制变化时应先更新配置和契约测试。
- Alibaba 当前使用 symmetric task mode，文档和查询调用保持独立方法但使用相同向量空间。
- Provider 遥测记录 token usage，不在代码中硬编码可能变化的价格；成本换算留到可观测性阶段。
- 文本哈希向量缓存和 ingestion 批次 checkpoint 需要与 Chroma 写入及任务状态一起设计，本阶段不提前实现。
- 付费冒烟测试已提供但未默认执行；普通 CI 只使用 mock，不需要真实 Key。

---

## 6. 下一阶段入口

下一阶段进入 Chroma VectorStore：

1. 定义 `VectorStore` 接口并实现 Chroma TypeScript adapter。
2. 使用当前 Embedding 配置指纹创建独立 collection。
3. collection metadata 保存 Provider、模型、维度、task mode、分块和脱敏版本。
4. 服务 ready 前校验 collection 指纹，任何不兼容必须失败关闭。
5. 使用稳定 chunkId upsert，并在向量写入前再次校验数量与维度。
6. 实现 tenant + ACL 过滤接口骨架以及按 tenant/document 删除。
7. Chroma 完成写入并验证后，才把 DocumentVersion 原子切换为 active。

认证、完整 ACL、查询编排、Rerank 和 LLM 仍按后续阶段实施。
