# 当前开发任务

> 项目：知枢 NexusKB
> 当前阶段：阶段 7——LLM 与 Rerank Provider
> 状态：已完成（2026-07-16）

---

## 1. 上一阶段交付记录

阶段 6“认证与 ACL”已完成：

- OIDC JWKS JWT 验证与服务端 Identity。
- documents capability、tenant、department、sensitivity 和 owner ACL。
- Chroma tenant + ACL 预过滤。
- Rerank、LLM 和引用返回可复用的二次授权 policy。

---

## 2. 当前目标

```text
ACL 过滤后的候选片段
→ Rerank 前 ACL + 云端策略复查
→ 可选 Alibaba qwen3-rerank
→ 失败时降级为原向量排序
→ LLM 前 ACL + 云端策略复查
→ Primary LLM + 显式 fallback
→ 来源编号校验
→ active version + ACL 最终引用复查
```

---

## 3. 本轮任务

### 3.1 LLM Provider

- [x] 定义 `LlmProvider`、统一 usage、错误和遥测契约。
- [x] 实现 OpenAI-compatible adapter，支持 OpenAI、DeepSeek、Alibaba 和 Custom。
- [x] 实现 Google 原生 `generateContent` adapter。
- [x] Provider factory 集中读取 Key、base URL、model 和 region。
- [x] 429、超时和部分 5xx 指数退避；认证和参数错误不重试。
- [x] 仅在显式配置时启用备用 Provider。

### 3.2 提示与输出安全

- [x] 系统提示限制为只基于资料回答。
- [x] 将知识片段明确声明为不可信数据而非指令。
- [x] 使用统一 `[来源N]` 格式。
- [x] 拒绝不存在、越界或完全缺失的来源编号。
- [x] Provider 遥测不记录问题、片段、回答或密钥。

### 3.3 Rerank 与二次授权

- [x] `RERANK_PROVIDER=none` 默认关闭。
- [x] 定义 `RerankProvider` 并实现 Alibaba `qwen3-rerank`。
- [x] Rerank 失败或策略拒绝时降级为原向量排序并记录事件。
- [x] Rerank 和 LLM 前再次校验 tenant、department、sensitivity、owner 与云端策略。
- [x] 引用返回前可按 PostgreSQL active version 和当前 ACL 最终复查。

---

## 4. 完成条件

- [x] 可配置 Alibaba Embedding + DeepSeek LLM。
- [x] OpenAI、Google、DeepSeek、Alibaba 和 Custom LLM 均由统一 factory 构造。
- [x] confidential 默认对 Rerank 和 LLM 保持零云端调用。
- [x] LLM 临时故障只使用显式配置的备用 Provider。
- [x] Rerank 关闭或故障时保留原向量排序。
- [x] prompt injection 文本只能作为 source 数据进入提示。
- [x] 来源编号和最终 active/ACL 引用复查有自动化测试。
- [x] lint、typecheck、单元测试、集成测试、build 和 format check 通过。

---

## 5. 下一阶段入口

完成后进入查询 API，实现查询输入校验、Query Embedding、ACL Top K、相邻块合并、
相关度阈值、LLM 回答、审计和无答案拒答。
