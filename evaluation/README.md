# NexusKB 质量评测

本目录只保存评测方法。真实问题、标准答案、目标资源和原始运行结果分别放在
`evaluation/private/` 与 `evaluation/results/`，两者已被 Git 忽略，不得提交到仓库、CI artifact 或普通日志。

## 1. 数据集要求

数据集使用 `@nexus-kb/contracts` 的 `qualityEvaluationDatasetSchema`：

- 30–100 条经过业务方确认的真实问题，case ID 唯一。
- 至少包含一条 `answerable`、`no_answer` 和 `unauthorized`，实际评测应让每类都有足够样本。
- `answerable` 与 `unauthorized` 必须标注标准答案和至少一个目标 document/page/sheet/chunk。
- `no_answer` 的标准答案必须为 null，目标来源必须为空。
- `identityProfile` 只是本地测试身份别名，数据集不得保存 JWT、Cookie、密码或 API Key。

示例结构（仅展示单条结构，不能作为满足 30 条要求的真实评测集）：

```json
{
  "schemaVersion": 1,
  "datasetId": "approved-real-questions-v1",
  "name": "经业务方确认的真实问题 v1",
  "createdAt": "2026-07-18T00:00:00.000Z",
  "decisionPolicy": {
    "minFinalRecallAt5": 0.7,
    "minMrr": 0.7,
    "minCitationAccuracy": 0.95,
    "minNoAnswerRejectionRate": 0.95,
    "maxErrorRate": 0.05,
    "minRecallGain": 0.02,
    "minMrrGain": 0.02,
    "maxCitationAccuracyRegression": 0.01,
    "maxNoAnswerRejectionRegression": 0.02,
    "maxP95LatencyRatio": 1.5,
    "maxAverageCostRatio": 1.25
  },
  "cases": [
    {
      "id": "finance-001",
      "kind": "answerable",
      "identityProfile": "finance-reader",
      "question": "替换为经过批准的真实问题",
      "expectedAnswer": "替换为业务方确认的标准答案",
      "expectedSources": [
        {
          "documentId": "00000000-0000-4000-8000-000000000001",
          "page": 1,
          "sheet": null,
          "chunkIds": []
        }
      ],
      "tags": ["finance"]
    }
  ]
}
```

上述阈值仅演示结构，不是系统默认值。项目规格未规定绝对质量阈值，因此 `decisionPolicy` 必须由业务、产品和技术负责人在正式运行前显式批准，契约不会静默补默认值。

## 2. 双策略运行

使用同一数据集、同一 active collection、同一 Embedding Provider/model/dimensions 和相同身份执行两轮。
不要并发运行付费评测，以免 P95 和单次成本被其他流量污染。

基线 `vector_top_5`：

```text
QUERY_RECALL_TOP_K=5
RERANK_PROVIDER=none
```

候选 `vector_top_20_rerank_top_5`：

```text
QUERY_RECALL_TOP_K=20
RERANK_PROVIDER=alibaba
RERANK_TOP_K=5
```

每条 observation 只保存 caseId、noAnswer、向量排序来源、最终 Top 5、引用来源、durationMs、costUsd 和 errorCode，不保存模型回答正文。`costUsd` 必须来自本次调用的实际 Provider 用量与当期价格；无法归属时写
null，最终 Rerank 建议会保持 `inconclusive`，不得用平均猜测值补齐。

普通 CI 禁止执行付费评测。只有设置专用测试 Key、完成数据出网审批并显式启用
`RUN_PAID_PROVIDER_TESTS=true` 后，才可生成真实运行结果。

### 2.1 准备本地身份映射

身份映射文件只保存服务端身份属性，不得保存 JWT、Cookie、密码或 API Key。`profiles` 的键必须与数据集的
`identityProfile` 一致：

```json
{
  "schemaVersion": 1,
  "profiles": {
    "finance-reader": {
      "tenantId": "tenant-a",
      "userId": "evaluation-user",
      "department": "finance",
      "roles": [],
      "allowedSensitivities": ["public", "internal"],
      "capabilities": ["documents:read"],
      "defaultSensitivity": "internal"
    }
  }
}
```

数据集、身份映射和运行结果均须限制为当前用户可读：

```bash
chmod 600 evaluation/private/dataset.json evaluation/private/identities.json
```

### 2.2 采集真实查询链路

采集命令串行调用正式 `KnowledgeQueryService`，保留向量排序、最终来源和引用的 ID/页码/工作表/分块 ID，
不保存问题、回答或片段正文。命令内部禁用入库消费者，但仍依赖评测环境的 PostgreSQL、Redis、Chroma 和已批准的云端 Provider。运行前应保证用户与租户每分钟查询限额不小于对应 case 数量。

```bash
RUN_PAID_PROVIDER_TESTS=true pnpm --filter @nexus-kb/api quality:capture -- \
  --dataset evaluation/private/dataset.json \
  --identities evaluation/private/identities.json \
  --variant vector_top_5 \
  --output evaluation/private/vector-top-5.run.json

RUN_PAID_PROVIDER_TESTS=true pnpm --filter @nexus-kb/api quality:capture -- \
  --dataset evaluation/private/dataset.json \
  --identities evaluation/private/identities.json \
  --variant vector_top_20_rerank_top_5 \
  --output evaluation/private/vector-top-20-rerank-top-5.run.json
```

CLI 会记录 Chroma collection 名称和 Embedding 配置指纹、校验 Top K/Rerank 配置与所选 variant 一致，
并拒绝覆盖现有文件。聚合器会拒绝比较 collection 或指纹不同的两轮结果。采集结果初始将 `costUsd` 写为 null；应使用每条 observation 的 `traceId` 对照本次 Provider 用量与当期价格，在私有运行文件中补入实际单次成本。费用未完整归属时聚合结论会保持 `inconclusive`。

## 3. 生成聚合报告

确认数据集和两份运行文件均为 0600 权限，且每条 `costUsd` 已按实际用量补齐后执行：

```bash
pnpm --filter @nexus-kb/api quality:evaluate -- \
  --dataset evaluation/private/dataset.json \
  --baseline evaluation/private/vector-top-5.run.json \
  --rerank evaluation/private/vector-top-20-rerank-top-5.run.json \
  --output evaluation/results/report.json
```

输出文件必须不存在，CLI 不覆盖输入或旧报告。报告只包含数据集 ID/名称、聚合指标、策略差值和 Rerank
建议，不复制问题、标准答案或回答正文。

## 4. 指标定义

- `vectorRecallAtK`：可回答问题中，向量 Top K 至少命中一个标注来源的比例。
- `finalRecallAt5`：最终 Top 5 至少命中一个标注来源的比例。
- `mrr`：最终 Top 5 首个正确来源倒数排名的平均值。
- `citationAccuracy`：可回答问题返回引用中匹配标注来源的比例。
- `noAnswerRejectionRate`：无答案问题正确返回 noAnswer 的比例。
- `unauthorizedLeakRate`：无权限问题的向量、最终或引用来源命中受限目标来源的比例，必须为 0。
- `p95LatencyMs`：全部 case durationMs 的 nearest-rank P95。
- `averageCostUsd`：有实际成本记录 case 的平均值；`costCoverage` 必须为 1 才能给出启用建议。

Rerank 只有在越权率为 0，Recall@5、MRR、引用、拒答和错误率达到绝对门槛，引用和拒答无超限回退、
P95/成本比未超阈值，并且 Recall@5 或 MRR 达到最小增益时才建议启用。基线存在越权泄露时结论为
`inconclusive`，必须先作为安全事件修复。
