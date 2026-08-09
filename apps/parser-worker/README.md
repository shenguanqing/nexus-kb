# Parser Worker 应用说明

`apps/parser-worker` 是仅供 NestJS API 内部调用的 Python/FastAPI 文档解析服务。它负责验证受控文件引用、识别允许的格式、提取结构化元素以及返回解析器版本和 warning。

Worker 不负责认证业务、tenant/ACL、分块、脱敏、Embedding、Rerank、LLM 或 Chroma 写入，也不持有模型 API Key。

## 关键入口与文件

| 路径                                                                         | 作用                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| [`app/main.py`](./app/main.py)                                               | FastAPI、内部 token、健康检查、格式路由和安全错误映射 |
| [`app/config.py`](./app/config.py)                                           | 文件、元素、表格、CAD、DWG 和压缩包资源限制           |
| [`app/schemas.py`](./app/schemas.py)                                         | `ParseRequest`、`ParsedElement`、`ParseResponse`      |
| [`app/security.py`](./app/security.py)                                       | 共享根目录、绝对路径、软链接和文件大小校验            |
| [`app/archive.py`](./app/archive.py)                                         | DOCX/XLSX ZIP 条目、路径和解压总大小校验              |
| [`app/preview.py`](./app/preview.py)                                         | Office PDF、CAD SVG 的受控本地预览产物                |
| [`app/parsers`](./app/parsers)                                               | 各格式解析算法                                        |
| [`bin/nexus-parser-worker-entrypoint`](./bin/nexus-parser-worker-entrypoint) | 容器启动入口                                          |
| [`bin/nexus-oda-file-converter`](./bin/nexus-oda-file-converter)             | 受控 ODA 启动包装                                     |
| [`tests/test_parse.py`](./tests/test_parse.py)                               | 格式、契约、路径和资源限制测试                        |
| [`tests/test_health.py`](./tests/test_health.py)                             | live/ready 测试                                       |

内部接口字段以 [`packages/contracts/openapi/parser-worker.v1.yaml`](../../packages/contracts/openapi/parser-worker.v1.yaml) 为事实源。

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
→ 可选生成与 documentId 绑定的 preview artifact
→ 返回 parser、parserVersion、elements、warnings、preview
```

每个元素统一包含：

| 字段          | 含义                                               |
| ------------- | -------------------------------------------------- |
| `text`        | 非空文本                                           |
| `elementType` | `heading`、`paragraph`、`table_row`、`cad_text` 等 |
| `page`        | PDF 页码；图片 OCR 固定为 1                        |
| `sheet`       | XLSX 工作表名                                      |
| `sectionPath` | 标题、布局、块和图层等结构路径                     |
| `bbox`        | OCR 文字的 `[x1, y1, x2, y2]` 四元坐标框           |
| `metadata`    | 行号、表头、实体类型、图层等格式特有信息           |

## 当前支持范围

以下算法章节按格式逐一介绍；先看这张总表可以快速确认某个格式是否已支持：

| 格式                          | 状态                 | 解析器                                       |
| ----------------------------- | -------------------- | -------------------------------------------- |
| TXT / Markdown                | 已实现               | 原生 UTF-8 行扫描                            |
| DOCX                          | 已实现               | python-docx                                  |
| XLSX                          | 已实现               | openpyxl                                     |
| DXF                           | 已实现               | ezdxf                                        |
| DWG                           | 已实现，依赖本地 ODA | ODA → DXF → ezdxf                            |
| PDF                           | 已实现               | Unstructured；失败或空结果时由内网 Tika 兜底 |
| PNG / JPG / JPEG              | 已实现               | EasyOCR（CPU、离线模型）                     |
| PPTX / HTML / DOC / RTF / EML | 未实现               | 后续阶段                                     |

预览与文本解析独立：DOCX/XLSX 使用镜像内固定 LibreOffice 与 Noto CJK 字体转 PDF。DXF/DWG 先根据源字节数和按实体类型加权的渲染成本分流：小图生成受限 SVG，超大/高成本图纸同步生成总览图、z0、实体 R-Tree、非可执行 SQLite/R-Tree 扁平图元索引和 manifest，其他 PNG 瓦片由内部端点按需渲染并使用磁盘 LRU 清理。一个 3×3 metatile 只查询和绘制一次，再裁成相邻瓦片；旧 bundle 在首次冷请求时原子补建图元索引，之后不再重复解析完整 DXF。manifest 包含 CAD bounds 和 `worldToPixel`；瓦片渲染子进程受超时与内存上限保护。SVG 路径仍保留 CJK 字形替换、非缩放线宽和受控 gzip 兼容逻辑。产物只写入 `PREVIEW_ARTIFACTS_PATH`，预览失败不使解析任务失败。

## 解析器算法

### `parsers/text.py`

TXT 和 Markdown 共用 UTF-8 行扫描算法：

- `#` 到 `######` 识别为 1～6 级标题。
- 标题维护层级化 `sectionPath`。
- 连续非空普通行合并成一个 `paragraph`。
- 空行结束当前段落。

因此普通 TXT 中符合 Markdown 标题语法的行也会被识别为标题。当前不会把列表、代码块、引用或 Markdown 表格拆成独立元素。

### `parsers/docx.py`

使用 `python-docx`：

- 按段落遍历，`Heading 1`～`Heading 6` 更新标题路径。
- 其他非空段落输出为 `paragraph`。
- 随后逐表、逐行抽取 `table_row`，单元格用制表符连接。
- metadata 保存 `tableIndex` 和 `rowIndex`。

当前实现先处理全部段落、再处理全部表格，因此不保留正文和表格的原始交错顺序；表格还会继承段落遍历结束时的标题路径。需要保持精确文档顺序时，应改为遍历 DOCX body XML 中的 block item。

### `parsers/xlsx.py`

使用 `openpyxl` 的 `read_only=True`、`data_only=True` 模式：

- 逐工作表、逐行流式读取。
- 每张表第一个非空行视为 `table_header`。
- 后续非空行输出为 `table_row`。
- `sheet` 保存工作表名。
- metadata 保存原始行号和表头数组。

行数限制按整个工作簿累计；空行不输出元素但仍计入扫描行数。公式读取工作簿保存的缓存结果，不负责重新计算。

### `parsers/pdf.py`

PDF 先使用 pypdf 严格检查加密状态和页数上限，再交给固定版本 Unstructured 的本地 `auto` 策略。文本型 PDF 使用直接文本提取；扫描型 PDF 仅使用镜像内的 Poppler/Tesseract 中文与英文语言包，不配置或调用远程推理 URL。输出保留页码，空结果按统一规则失败。Worker 设置 `DO_NOT_TRACK=true`，禁止 Unstructured 遥测。

### `parsers/image.py`

PNG、JPG 和 JPEG 先由 Pillow 校验文件完整性与总像素上限，再使用 CPU 模式 EasyOCR。中文/英文模型在镜像构建阶段写入只读模型目录，运行时设置 `download_enabled=False`，不会因用户文件触发下载。EasyOCR 的用户网络目录固定在 `PARSER_TEMP_PATH/easyocr-user-network`，避免写入只读的 Worker 根文件系统。每个文字元素保存置信度与坐标框，低于阈值的元素只产生数量 warning，不在 warning 中包含正文。

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

该算法面向 CAD 知识文本抽取，不是完整几何还原：重复块文本可能被合并，块引用的几何变换也不会转换成最终世界坐标。

### `parsers/dwg.py`

DWG 使用“受控转换后复用 DXF”：

1. 校验前 6 字节是否为允许的 `ACxxxx` DWG 版本签名。
2. 验证配置的 ODA 可执行文件是绝对路径、普通文件、非软链接且可执行。
3. 将单个源文件复制进任务私有临时目录。
4. 用固定参数数组、最小环境变量和超时调用 ODA File Converter。
5. 验证输出 DXF 非空、未超限、非软链接且仍位于私有工作区。
6. 调用 `parse_dxf()`。
7. 返回 ODA 与 ezdxf 的组合版本和转换 warning。

转换产物只存在于临时目录，不替换原始 DWG，并在任务结束时自动清理。ODA 第三方安装包和许可说明见 [`vendor/oda/README.md`](./vendor/oda/README.md)。

## 资源与安全限制

主要环境变量定义在 `app/config.py`：

- `MAX_PARSE_BYTES`
- `MAX_ELEMENTS`
- `MAX_SPREADSHEET_ROWS`
- `MAX_PDF_PAGES`
- `MAX_IMAGE_PIXELS`
- `OCR_MODEL_STORAGE_PATH`
- `OCR_LANGUAGES`
- `OCR_CONFIDENCE_WARNING_THRESHOLD`
- `TIKA_ENABLED`
- `TIKA_BASE_URL`
- `TIKA_REQUEST_TIMEOUT_SECONDS`
- `MAX_TIKA_RESPONSE_BYTES`
- `TIKA_VERSION`
- `MAX_CAD_ENTITIES`
- `MAX_CAD_INSERT_DEPTH`
- `CAD_TILED_PREVIEW_ENABLED`
- `CAD_PREVIEW_TILE_COST_THRESHOLD`
- `CAD_PREVIEW_TILE_SOURCE_BYTES_THRESHOLD`
- `CAD_PREVIEW_TILE_SIZE`
- `CAD_PREVIEW_MAX_ZOOM`
- `CAD_PREVIEW_METATILE_RADIUS`
- `CAD_PREVIEW_TILE_CACHE_BYTES`
- `CAD_PREVIEW_RENDER_TIMEOUT_SECONDS`
- `CAD_PREVIEW_RENDER_MEMORY_BYTES`
- `MAX_ARCHIVE_ENTRIES`
- `MAX_ARCHIVE_UNCOMPRESSED_BYTES`
- `DWG_CONVERSION_TIMEOUT_SECONDS`
- `MAX_DWG_CONVERTED_BYTES`
- `PREVIEW_ARTIFACTS_PATH`
- `LIBREOFFICE_EXECUTABLE`
- `PREVIEW_CONVERSION_TIMEOUT_SECONDS`
- `MAX_PREVIEW_BYTES`

请求不能指定 Tika 地址、解析器可执行文件、临时目录或任意转换参数。Compose 中的 Tika 只连接 `backend` 内部网络，不发布宿主机端口；加密、页数超限等安全拒绝不会进入 fallback。日志只记录 trace、job、document、parser 和安全错误类型，不记录完整正文或内部文件路径。

## 开发与验证

从仓库根目录进入 Worker。运行前确认本机 Python 版本为 3.11：

```bash
cd apps/parser-worker
python -m pytest
ruff check .
mypy app tests
```

如宿主机没有项目要求的 Python 3.11 与锁定依赖，使用仓库根目录的等价 Docker 测试入口：

```bash
pnpm test:parser
```

该命令只启动一次性 `parser-worker-tests` profile 服务：它复用只读 Worker 镜像、只挂载测试目录，不暴露端口也不加入日常服务。固定 PDF/PNG 样本在测试启动时确定性生成，避免测试依赖本机 OCR 或 PDF 工具链。

宿主机测试适合验证解析契约、限制和安全分支，但 PDF/OCR 的完整运行环境以 Docker 镜像为准：镜像还包含 Poppler、Tesseract 中文/英文语言包、CPU PyTorch，以及构建阶段预载且运行时只读的 EasyOCR 和 NLTK 模型资源。运行时不得为用户文档下载模型或语言资源。涉及 `requirements.lock`、PDF、图片、OCR 或 Dockerfile 的变更，至少还应构建并启动 Parser 镜像，然后从容器内检查 Worker readiness：

```bash
pnpm docker:full -- exec parser-worker python -c \
  "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=10).read().decode())"
```

基础模式使用 `pnpm docker:base -- exec ...`。常规 Worker 响应必须包含 `rawDocs=up` 和 `tika=up`；完整模式还应分别检查 `parser-worker-dwg` 的 `dwgConverter=up`。

DWG 派生镜像构建完成后，可确认没有误装 CUDA 运行时：

```bash
docker run --rm --platform linux/amd64 --entrypoint python nexus-kb-parser-worker \
  -c "import torch; print({'torch': torch.__version__, 'cuda': torch.version.cuda})"
```

输出中的 `cuda` 应为 `None`。Docker 和 DWG 专用 Worker 的启动方式见根目录 [`README.md`](../../README.md) 与 [`docs/06-部署运维手册.md`](../../docs/06-部署运维手册.md)。
