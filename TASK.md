# 当前开发任务

> 项目：知枢 NexusKB
> 当前阶段：阶段 5.5——前序阶段收尾与可靠性补强
> 状态：已完成（2026-07-16）

---

## 1. 背景

Chroma VectorStore 与索引激活已完成，但总任务清单中的阶段 2、3、5 存在两类遗留：

- 已实现但清单没有同步的状态机、幂等和安全激活能力。
- 尚未闭环的配置摘要、运行日志、内容去重、checkpoint、分类重试和失败任务查询。

本轮先消除这些基础可靠性缺口，再进入认证与 ACL。PDF/OCR/Tika、额外 Embedding Provider 和
第二阶段解析格式不属于本轮范围。

---

## 2. 当前目标

```text
安全配置 profile 与脱敏摘要
→ 内容哈希 + ACL 去重
→ PostgreSQL 持久化 checkpoint
→ 按错误类别决定 BullMQ 重试
→ 重复消费短路与安全恢复
→ tenant 范围失败任务查询
→ 无正文结构化运行日志
```

---

## 3. 本轮任务

### 3.1 配置与日志

- [x] 为 development、test、production 提供明确配置 profile。
- [x] production 默认失败关闭开发身份。
- [x] 启动配置摘要不包含 Key、密码、完整连接串或 token。
- [x] 上传与入库日志包含 trace、tenant、job、document、provider 和状态字段。

### 3.2 文档去重

- [x] 以 tenant、内容哈希、department、sensitivity 和 owner 作为默认 ACL 去重键。
- [x] 数据库使用部分唯一索引阻止并发重复上传。
- [x] 已删除文档允许重新上传。
- [x] 重复上传返回稳定 409 错误且不遗留原始文件。

### 3.3 队列可靠性

- [x] IngestionJob 保存最近安全 checkpoint、错误类别和 retryable。
- [x] Parser、Embedding 和 VectorStore 错误统一分类。
- [x] 非重试错误立即进入 failed；临时错误按 BullMQ 策略重试。
- [x] 本地预处理完成后重试跳过重复解析、分块和策略事件创建。
- [x] completed/policy_blocked/deleted 任务重复消费安全短路。
- [x] 提供 tenant 范围的失败任务查询。
- [x] 使用 deleting 墓碑与向量补偿删除关闭索引/删除竞态。

---

## 4. 完成条件

- [x] 相同 tenant 和 ACL 的相同文件不会创建第二个文档。
- [x] 不同 tenant 或不同 ACL 的相同文件仍可分别创建。
- [x] Parser 临时故障可重试，参数/认证类错误不盲目重试。
- [x] Embedding/Chroma 临时失败后从本地预处理 checkpoint 恢复。
- [x] 重复消费 completed job 不创建新 chunk、策略事件或向量。
- [x] 删除与处理中入库并发时不会复活 chunk 或向量。
- [x] 配置和运行日志不包含密钥、密码、原文或未脱敏正文。
- [x] lint、typecheck、单元测试、集成测试、build 和 format check 通过。

---

## 5. 下一阶段入口

完成后进入认证与 ACL：

1. 定义 JWT/OIDC guard 与可替换 token verifier。
2. Identity 增加 roles、allowedSensitivities 和 capability。
3. 生产环境启用真实认证上下文，彻底移除开发身份路径。
4. 文档、任务、向量查询和删除统一使用服务端身份构造 ACL。
