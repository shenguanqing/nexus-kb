# 当前开发任务

> 项目：知枢 NexusKB
> 当前阶段：阶段 4 补强——CAD 文件解析
> 状态：已完成（2026-07-17）

---

## 1. 背景

阶段 4 原有 TXT/Markdown、DOCX 和 XLSX 解析已经完成，但企业工程知识库关键的 CAD 仍缺少 DXF
解析与 DWG 转换边界。本轮在不改变 Worker 架构职责的前提下补齐 CAD 入库链路。

---

## 2. 当前目标

```text
DWG / DXF 上传安全校验
→ 异步 Parser Worker
→ DWG 在私有临时目录转换为 DXF
→ ezdxf 正常读取 / 严格 recover
→ 图纸摘要 + 文字 + 块属性 + 尺寸
→ TypeScript 分块、脱敏与后续索引
```

---

## 3. 本轮任务

### 3.1 DXF 上传与契约

- [x] API 上传白名单、MIME 和 DXF signature 校验支持 `.dxf`。
- [x] ingestion storageKey 契约允许 UUID `.dxf`。
- [x] Worker MIME 路由支持 DXF 和 DWG。

### 3.2 DXF 结构化解析

- [x] 固定 `ezdxf 1.4.4`。
- [x] 提取 DXF 版本、单位、布局、图层与实体统计摘要。
- [x] 提取 TEXT、MTEXT、ATTRIB、ATTDEF 和 DIMENSION。
- [x] 递归提取嵌套块内容，并限制实体数、递归深度和输出元素数。
- [x] 对可恢复 ASCII 结构错误使用 strict recover，并返回安全 warning。

### 3.3 DWG 自动转换

- [x] API 校验 DWG MIME 与 `AC10xx` signature，storageKey 契约允许 UUID `.dwg`。
- [x] Worker 使用服务端固定绝对路径调用 ODA File Converter，不接受用户命令或路径。
- [x] 转换在任务私有临时目录完成，限制超时、输出大小并在结束时清理 DXF。
- [x] 转换产物复用 ezdxf 解析器，并返回转换器/解析器版本和安全 warning。
- [x] 入库任务增加 `converting` 状态，前端使用不确定进度条展示真实转换阶段。

---

## 4. 完成条件

- [x] 合法 DXF 可从 API 上传并进入现有异步解析链路。
- [x] 伪造 DXF、损坏 DXF、路径逃逸和资源超限失败关闭。
- [x] CAD 输出保留布局、图层、entity type、handle、块路径等来源 metadata。
- [x] DWG 可直接上传；转换器路径、参数、临时目录和资源限制均由服务端控制。
- [x] lint、typecheck、单元测试、build 和 format check 通过。

---

## 5. 下一阶段入口

CAD 补强完成后继续进入查询 API，实现查询输入校验、Query Embedding、ACL Top K、相邻块合并、
相关度阈值、LLM 回答、审计和无答案拒答。
