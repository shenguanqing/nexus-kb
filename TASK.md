# 当前开发任务

> 项目：知枢 NexusKB
> 当前阶段：阶段 14——质量评测
> 状态：进行中（评测框架已完成，等待真实脱敏标注集与受控付费运行）

---

## 1. 背景

阶段 13 已完成可观测性和审计。本轮建立可重复、可审查的 RAG 质量评测流程，对比 Vector Top 5 与
Vector Top 20 + Rerank Top 5，并以质量、安全、延迟和成本共同决定是否默认启用 Rerank。

真实问题、标准答案和目标来源可能包含业务信息。仓库当前没有经过批准的真实评测集；按 confidential
零出网和日志无正文约束，不读取本地业务文档来自动编造问题，也不把合成 fixture 计为真实验收结果。

---

## 2. 当前目标

```text
30–100 条真实问题 + 标准答案 + 目标文档/页码 + 身份 profile
→ Vector Top 5 run
→ Vector Top 20 + Rerank Top 5 run
→ Recall@K / Recall@5 / MRR / 引用 / 拒答 / 越权 / P95 / 成本
→ 安全与回退门槛
→ Rerank enable | keep_disabled | inconclusive
```

---

## 3. 已完成

### 3.1 评测契约与数据安全

- [x] 定义 30–100 条数据集 schema，并要求 answerable、no_answer、unauthorized 三类均存在。
- [x] 要求可回答与无权限 case 标注标准答案和 document/page/sheet/chunk 目标。
- [x] 定义两种固定策略 run，要求 observation 与全部 case 一一对应且 ID 唯一。
- [x] 原始 observation 不保存回答正文；聚合报告不复制问题或标准答案。
- [x] Git 忽略 `evaluation/private/` 与 `evaluation/results/`，身份只保存 profile 别名，不保存凭证。

### 3.2 指标与决策

- [x] 计算 Vector Recall@K、最终 Recall@5 和 MRR。
- [x] 计算引用准确率、无答案拒答率和错误率。
- [x] 对向量、最终 Top 5 和引用三层验证 unauthorized 目标来源，越权率必须为 0。
- [x] 使用 nearest-rank 计算 P95，记录平均单次成本及成本覆盖率。
- [x] 对比质量增益、引用/拒答回退、P95 比和成本比并输出 Rerank 建议。
- [x] 基线越权时结论为 inconclusive，候选越权时保持关闭，成本或延迟不完整时不允许启用。

### 3.3 工具与测试

- [x] 提供 `quality:capture` CLI，显式保护付费调用，并从正式查询链路采集不含正文的来源引用与 trace ID。
- [x] 提供 `quality:evaluate` CLI，限制输入大小、不覆盖输入或旧报告，输出文件权限为 0600。
- [x] 提供脱敏合成契约/计算测试，不在普通 CI 调用付费 Provider。
- [x] 记录真实数据收集、双策略运行、指标定义、成本来源和上线门槛。

---

## 4. 等待真实数据后完成

- [ ] 由业务方提供并批准 30–100 条真实问题、标准答案、目标文档与页码/工作表。
- [ ] 数据集中加入足够的无答案和无权限问题，并确认身份 profile 的实际 ACL。
- [ ] 在相同索引与身份下完成 Vector Top 5 和 Vector Top 20 + Rerank Top 5 两轮受控运行。
- [ ] 为每个 case 归属实际 Provider 成本，确保 costCoverage=1。
- [ ] 生成正式报告并验证 unauthorizedLeakRate=0。
- [ ] 根据正式报告决定是否默认启用 Rerank，并把结论更新到配置和运维文档。

---

## 5. 当前阻塞与所需输入

继续真实评测需要用户提供或确认一个本地、已脱敏且允许用于云端 Provider 的 30–100 条评测集。若数据包含
confidential 内容，必须保持 Rerank/LLM/Embedding 零云端调用，不能为了完成阶段勾选而放宽策略。付费评测
还需显式设置 `RUN_PAID_PROVIDER_TESTS=true` 并使用专用测试 Key；本轮未自行触发任何付费调用。

---

## 6. 下一阶段入口

阶段 14 尚未完成，不能进入阶段 15。正式评测通过并确定 Rerank 默认策略后，再开始 Vue 3 前端。
