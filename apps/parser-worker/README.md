# Parser Worker 应用说明

`apps/parser-worker` 是仅供 NestJS API 内部调用的 Python/FastAPI 文档解析服务。它负责验证受控文件引用、
识别允许的格式、提取结构化元素以及返回解析器版本和 warning。

Worker 不负责认证业务、tenant/ACL、分块、脱敏、Embedding、Rerank、LLM 或 Chroma 写入，也不持有模型
API Key。

## 关键入口与文件

| 路径                                                                         | 作用                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| [`app/main.py`](./app/main.py)                                               | FastAPI、内部 token、健康检查、格式路由和安全错误映射 |
| [`app/config.py`](./app/config.py)                                           | 文件、元素、表格、CAD、DWG 和压缩包资源限制           |
| [`app/schemas.py`](./app/schemas.py)                                         | `ParseRequest`、`ParsedElement`、`ParseResponse`      |
| [`app/security.py`](./app/security.py)                                       | 共享根目录、绝对路径、软链接和文件大小校验            |
| [`app/archive.py`](./app/archive.py)                                         | DOCX/XLSX ZIP 条目、路径和解压总大小校验              |
| [`app/parsers`](./app/parsers)                                               | 各格式解析算法                                        |
| [`bin/nexus-parser-worker-entrypoint`](./bin/nexus-parser-worker-entrypoint) | 容器启动入口                                          |
| [`bin/nexus-oda-file-converter`](./bin/nexus-oda-file-converter)             | 受控 ODA 启动包装                                     |
| [`tests/test_parse.py`](./tests/test_parse.py)                               | 格式、契约、路径和资源限制测试                        |
| [`tests/test_health.py`](./tests/test_health.py)                             | live/ready 测试                                       |

内部接口字段以
[`packages/contracts/openapi/parser-worker.v1.yaml`](../../packages/contracts/openapi/parser-worker.v1.yaml)
为事实源。

## 解析请求流程

```text
POST /internal/v1/parse
→ 恒定时间验证 X-Internal-Token
→ 验证文件位于 RAW_DOCS_PATH
→ 拒绝 ..、软链接逃逸、非文件和超大文件
→ 扩展名与 MIME allowlist 匹配
→ DOCX/XLSX 压缩包安全检查
→ 调用对应解析器
→ 拒绝空结果
→ 返回 parser、parserVersion、elements、warnings
```

每个元素统一包含：

| 字段          | 含义                                               |
| ------------- | -------------------------------------------------- |
| `text`        | 非空文本                                           |
| `elementType` | `heading`、`paragraph`、`table_row`、`cad_text` 等 |
| `page`        | 页码；当前已实现格式通常为空                       |
| `sheet`       | XLSX 工作表名                                      |
| `sectionPath` | 标题、布局、块和图层等结构路径                     |
| `bbox`        | 四元坐标框；当前解析器尚未填充                     |
| `metadata`    | 行号、表头、实体类型、图层等格式特有信息           |

## 解析器算法

### `parsers/text.py`

TXT 和 Markdown 共用 UTF-8 行扫描算法：

- `#` 到 `######` 识别为 1～6 级标题。
- 标题维护层级化 `sectionPath`。
- 连续非空普通行合并成一个 `paragraph`。
- 空行结束当前段落。

因此普通 TXT 中符合 Markdown 标题语法的行也会被识别为标题。当前不会把列表、代码块、引用或 Markdown
表格拆成独立元素。

### `parsers/docx.py`

使用 `python-docx`：

- 按段落遍历，`Heading 1`～`Heading 6` 更新标题路径。
- 其他非空段落输出为 `paragraph`。
- 随后逐表、逐行抽取 `table_row`，单元格用制表符连接。
- metadata 保存 `tableIndex` 和 `rowIndex`。

当前实现先处理全部段落、再处理全部表格，因此不保留正文和表格的原始交错顺序；表格还会继承段落遍历结束时
的标题路径。需要保持精确文档顺序时，应改为遍历 DOCX body XML 中的 block item。

### `parsers/xlsx.py`

使用 `openpyxl` 的 `read_only=True`、`data_only=True` 模式：

- 逐工作表、逐行流式读取。
- 每张表第一个非空行视为 `table_header`。
- 后续非空行输出为 `table_row`。
- `sheet` 保存工作表名。
- metadata 保存原始行号和表头数组。

行数限制按整个工作簿累计；空行不输出元素但仍计入扫描行数。公式读取工作簿保存的缓存结果，不负责重新计算。

### `parsers/dxf.py`

使用 `ezdxf`：

1. 正常读取并 audit；失败时尝试严格 recover。
2. 遍历所有 layout 和实体。
3. 提取 `TEXT`、`MTEXT`、`ATTRIB`、`ATTDEF`。
4. 计算并提取 `DIMENSION` 显示值。
5. 遇到 `INSERT` 时递归遍历属性和块定义。
6. 使用活动块集合检测循环，并限制最大块嵌套深度。
7. 按“文本、布局、图层、块路径”去重。
8. 在首元素生成图纸版本、单位、布局、图层和实体统计摘要。

`sectionPath` 的形式通常为：

```text
Model → 块:TITLE_BLOCK → 图层:ANNOTATION
```

该算法面向 CAD 知识文本抽取，不是完整几何还原：重复块文本可能被合并，块引用的几何变换也不会转换成最终
世界坐标。

### `parsers/dwg.py`

DWG 使用“受控转换后复用 DXF”：

1. 校验前 6 字节是否为允许的 `ACxxxx` DWG 版本签名。
2. 验证配置的 ODA 可执行文件是绝对路径、普通文件、非软链接且可执行。
3. 将单个源文件复制进任务私有临时目录。
4. 用固定参数数组、最小环境变量和超时调用 ODA File Converter。
5. 验证输出 DXF 非空、未超限、非软链接且仍位于私有工作区。
6. 调用 `parse_dxf()`。
7. 返回 ODA 与 ezdxf 的组合版本和转换 warning。

转换产物只存在于临时目录，不替换原始 DWG，并在任务结束时自动清理。ODA 第三方安装包和许可说明见
[`vendor/oda/README.md`](./vendor/oda/README.md)。

## 当前支持范围

| 格式                          | 状态                 | 解析器                         |
| ----------------------------- | -------------------- | ------------------------------ |
| TXT / Markdown                | 已实现               | 原生 UTF-8 行扫描              |
| DOCX                          | 已实现               | python-docx                    |
| XLSX                          | 已实现               | openpyxl                       |
| DXF                           | 已实现               | ezdxf                          |
| DWG                           | 已实现，依赖本地 ODA | ODA → DXF → ezdxf              |
| PDF                           | 未实现               | 规划为 Unstructured，Tika 兜底 |
| PNG / JPG                     | 未实现               | 规划为 OCR                     |
| PPTX / HTML / DOC / RTF / EML | 未实现               | 后续阶段                       |

## 资源与安全限制

主要环境变量定义在 `app/config.py`：

- `MAX_PARSE_BYTES`
- `MAX_ELEMENTS`
- `MAX_SPREADSHEET_ROWS`
- `MAX_CAD_ENTITIES`
- `MAX_CAD_INSERT_DEPTH`
- `MAX_ARCHIVE_ENTRIES`
- `MAX_ARCHIVE_UNCOMPRESSED_BYTES`
- `DWG_CONVERSION_TIMEOUT_SECONDS`
- `MAX_DWG_CONVERTED_BYTES`

请求不能指定解析器可执行文件、临时目录或任意转换参数。日志只记录 trace、job、document、parser 和安全错误
类型，不记录完整正文或内部文件路径。

## 开发与验证

从仓库根目录进入 Worker：

```bash
cd apps/parser-worker
python -m pytest
ruff check .
mypy app tests
```

Python 版本要求为 3.11。Docker 和 DWG 专用 Worker 的启动方式见根目录
[`README.md`](../../README.md) 与 [`docs/06-部署运维手册.md`](../../docs/06-部署运维手册.md)。
