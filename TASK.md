# 当前开发任务

> 项目：知枢 NexusKB
> 当前阶段：阶段 6——认证与 ACL
> 状态：已完成（2026-07-16）

---

## 1. 上一阶段交付记录

阶段 5.5“前序阶段收尾与可靠性补强”已完成：

- 配置 profile、脱敏摘要和 Pino 结构化日志。
- tenant + 内容哈希 + ACL 去重。
- 入库 checkpoint、错误分类、失败任务查询和断点恢复。
- deleting 墓碑与向量补偿删除。

---

## 2. 当前目标

```text
Authorization Bearer token
→ JWT 签名、issuer、audience、alg、时间声明验证
→ 运行时 claims 校验
→ 服务端 Identity
→ capability 检查
→ tenant + department + sensitivity + owner ACL
→ VectorStore 安全过滤器
```

---

## 3. 本轮任务

### 3.1 身份与认证

- [x] Identity 包含 userId、tenantId、department、roles、allowedSensitivities 和 capabilities。
- [x] 仅 development/test 且 `AUTH_REQUIRED=false` 时允许固定开发身份。
- [x] 定义可替换 `TokenVerifier`。
- [x] 使用 OIDC JWKS 验证 JWT 签名、issuer、audience、算法、exp 和 nbf。
- [x] 对签名验证后的业务 claims 做运行时校验。
- [x] 使用全局 Nest Guard 将 Identity 写入 request。
- [x] 健康检查显式标记为 public。

### 3.2 文档 ACL

- [x] 上传要求 documents:write capability。
- [x] 读取要求 documents:read capability。
- [x] 删除要求 documents:delete capability。
- [x] 所有查询首先强制 tenant。
- [x] public 对 tenant 内允许读取者可见。
- [x] internal/confidential 要求允许敏感度，并满足同部门、owner 或 tenant 管理员规则。
- [x] 管理员仍不能跨 tenant。
- [x] 入库任务查询继承关联文档 ACL。

### 3.3 Vector ACL

- [x] 从服务端 Identity 构造 VectorAclFilter。
- [x] 普通用户只允许 public、同部门和 owner 分支。
- [x] tenant 管理员可访问 tenant 内允许敏感度，但不能跨 tenant。
- [x] 客户端不能提交原始 Chroma where 或可信身份字段。
- [x] 为 Rerank、LLM 和引用返回提供可复用二次授权 policy。

---

## 4. 完成条件

- [x] 缺失、格式错误、签名错误或 claims 不完整的 token 返回 401。
- [x] `AUTH_REQUIRED=true` 时绝不回退开发身份。
- [x] production 不能关闭认证。
- [x] 客户端伪造 tenant、role、department、capability 无效。
- [x] tenant 交叉访问全部失败关闭。
- [x] 部门、敏感度和 owner 规则有成功与拒绝测试。
- [x] tenant 管理员仍不能读取其他 tenant。
- [x] lint、typecheck、单元测试、集成测试、build 和 format check 通过。

---

## 5. 下一阶段入口

完成后进入 LLM 与 Rerank Provider，再实现查询 API、来源验证和无答案拒答。
