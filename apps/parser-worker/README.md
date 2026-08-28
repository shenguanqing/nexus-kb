# Parser Worker 应用说明

`apps/parser-worker` 是仅供 NestJS API 内部调用的 Python/FastAPI 文档解析服务。它负责验证受控文件引用、识别允许的格式、提取结构化元素以及返回解析器版本和 warning。

Worker 不负责认证业务、tenant/ACL、分块、脱敏、Embedding、Rerank、LLM 或 Chroma 写入，也不持有模型 API Key。

## 阅读路径与关键文件

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
→ DOC 再校验 CFB/OLE 签名，固定经内网 Tika 解析，并用本地 LibreOffice 尝试生成 PDF 预览
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

| 格式                    | 状态                 | 解析器                                       |
| ----------------------- | -------------------- | -------------------------------------------- |
| TXT / Markdown          | 已实现               | 原生 UTF-8 行扫描                            |
| DOC                     | 已实现               | 内网 Apache Tika                             |
| DOCX                    | 已实现               | python-docx                                  |
| XLSX                    | 已实现               | openpyxl                                     |
| DXF                     | 已实现               | ezdxf                                        |
| DWG                     | 已实现，依赖本地 ODA | ODA → DXF → ezdxf                            |
| PDF                     | 已实现               | Unstructured；失败或空结果时由内网 Tika 兜底 |
| PNG / JPG / JPEG        | 已实现               | EasyOCR（CPU、离线模型）                     |
| PPTX / HTML / RTF / EML | 未实现               | 后续阶段                                     |

预览与文本解析独立：

- DOC/DOCX/XLSX 使用镜像内固定 LibreOffice 与 Noto CJK 字体转 PDF；DOC 正文解析要求内网 Tika 就绪，预览失败仍按统一 warning 降级。
- DXF/DWG 按源字节数和实体类型加权渲染成本分流：小图生成受限 SVG；超大或高成本图生成总览图、z0、实体 R-Tree、非可执行 SQLite/R-Tree 图元索引和 manifest，细节 PNG 由内部端点按需渲染并以磁盘 LRU 清理。复杂图初始化使用最多 100,000 个确定性抽样实体和 500,000 个图元的快速几何索引；它会将 ASCII OCS 转为 WCS、忽略不代表可见几何的裸 `INSERT` 边界，并继续从世界坐标重绘高层级瓦片，而不是裁切放大总览 PNG。
- 一个 3×3 metatile 只查询、绘制一次，再裁成相邻瓦片。旧 bundle 首次冷请求原子补建图元索引，之后不再重复解析完整 DXF。
- manifest 包含完整 CAD bounds 和 `worldToPixel`；配置基准 `maxZoom=12`，索引阶段使用最多 4096 个实际渲染可见实体 bbox 的确定性蓄水池样本和两端 1% 稳健范围估计主要几何跨度。关闭/冻结图层和实体自身 `invisible` 标记的几何仍保留在完整 bounds、R-Tree 与瓦片坐标中，但不参与主体样本，避免不可见辅助线把可见主体误判为全图。少量远距辅助实体将完整跨度放大至少 2 倍时，只按倍率为该 bundle 补足最高层级并硬封顶 15，不裁 bounds、不删除图元。瓦片渲染子进程受超时和内存上限保护，新增层级仍按实际视口生成。SVG 保留 CJK 字形替换、非缩放线宽和受控 gzip 兼容逻辑。
- 产物只写入 `PREVIEW_ARTIFACTS_PATH`；预览失败不使解析任务失败。

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
5. 遇到 `INSERT` 时逐实例遍历属性；同一 layout、同一块路径中的块定义只展开一次，重复实例复用已经完成的块定义遍历，避免大型阵列或设备图因重复几何产生指数级文本解析开销。
6. 使用活动块集合检测循环，并限制最大块嵌套深度；顶层实体、每个 `INSERT` 与每个实例属性仍逐项计入安全预算。
7. 按“文本、布局、图层、块路径”去重。
8. 对“建设单位、工程名称、设计编号”等高置信标题栏标签，使用同一 layout、同一块坐标系内的 `insert` 坐标寻找右侧同行最近值，生成 `cad_title_field` 结构化元素；不跨 layout、块坐标系或反向配对。
9. 将最多 200 个已验证字段按 layout 标记汇总为有 20,000 字符硬上限的 `cad_title_summary`，使分散在不同 layout 的楼栋/子项目身份与建设单位等字段进入同一可分块文本；不汇总未配对原始文字。
10. 在首元素生成图纸版本、单位、布局和实体统计摘要；metadata 额外记录实际检查实体数、展开的块上下文数与复用次数，供容量评估使用。

`sectionPath` 的形式通常为：

```text
Model → 块:TITLE_BLOCK → 图层:ANNOTATION
```

`cad_title_field` 使用 `字段：值` 文本和独立“CAD 标题栏”sectionPath，metadata 保留字段/值、配对关系、label/value insert 与 handle；`cad_title_summary` 只复制这些已验证字段并保留 layout 前缀。DXF parserVersion 在 ezdxf 版本后追加 Nexus 语义修订号，使标题栏抽取规则变化可被版本事实识别。

该算法面向 CAD 知识文本抽取，不是完整几何还原：重复块文本可能被合并，块引用的几何变换也不会转换成最终世界坐标。逐实例的 `ATTRIB` 仍会保留，因此不同设备编号或标题属性不会因块定义复用而丢失。标题栏配对仅处理同一坐标系内的高置信标签，不把全图任意同行文字拼接成键值。

预览是解析结果的可选附件。转换后 DXF 达到 128 MiB、文本遍历已使用至少 75% 实体预算，或同一解析复用至少 1,000 次块定义时，初始预览子进程的单次渲染预算会受控收敛到最多 20 秒（初始化总预算最多 60 秒）；超时返回 `CAD_PREVIEW_INITIALIZATION_TIMEOUT` 并继续交付文本解析结果，避免可选预览超过 API 总请求预算。后续对已经成功生成 bundle 的按需瓦片仍使用正常配置预算。

复杂图渐进 bundle 使用 `simplified.json` 的 `formatVersion=3/detailMode=progressive_geometry` 标记并返回 `CAD_PREVIEW_PROGRESSIVE_GEOMETRY` warning。初始化只生成有界快速总览并保存受控转换 DXF；第一次请求细节瓦片时，ezdxf Frontend 完整展开块引用、解析颜色并原子建立 `geometry.sqlite`，随后所有瓦片从该完整索引绘制。完整几何格式 v2 将连续曲线和文字轮廓保存为单个数值型 polyline 记录，而不是让每个扁平线段分别占用 R-Tree 行；格式 v1 继续只读兼容。单记录 BLOB 仍限制为 64 MiB，完整索引仍限制 4,000,000 条记录、1 GiB bundle、2 GiB 默认子进程内存和 180 秒构建时间，不使用可执行反序列化。完整索引成功后还会从同一彩色几何原子替换 `overview.png`、z0 与可选主体鸟瞰，最后写 `overview-state.json`；已有缓存瓦片但缺少该完成标记时仍会补刷新。异常终止留下的 `.geometry.sqlite.<pid>.tmp` 只在下一次同文档持锁构建前按固定命名清理，不匹配的文件不删除。任一上限触发时保留快速总览并失败关闭，不会用抽样结果冒充完整细节。旧的 `formatVersion=1/detailMode=overview` 只放大总览，`formatVersion=2/detailMode=geometry` 仍缺少完整块与颜色；升级后应通过正常 reindex 或受控原子预览重建替换，不能手改 `current.json`、manifest、SQLite 或完成标记。

完整 `bounds` 至少为确定性稳健主体跨度 2 倍时，manifest 额外返回位于完整范围内、带 5% 留白的 `focusBounds`。它不改变索引和瓦片网格，只为前端首次打开与重置提供主体相机建议；远距对象继续可通过鸟瞰和平移访问。旧 bundle 不会自动补字段，需要正常 reindex。

存在 `focusBounds` 时，Worker 还会从几何索引生成独立 `focus-overview.png`；它只通过主服务的 ACL 端点返回，不暴露 bundle 路径。普通 bundle 使用完整几何生成，渐进 bundle 初始化时先用受限总览几何生成，并在首次完整索引完成后与普通全图和 z0 一并替换为完整彩色缩略图。

### `parsers/dwg.py`

DWG 使用“受控转换后复用 DXF”：

1. 校验前 6 字节是否为允许的 `ACxxxx` DWG 版本签名。
2. 验证配置的 ODA 可执行文件是绝对路径、普通文件、非软链接且可执行。
3. 将单个源文件复制进任务私有临时目录。
4. 用固定参数数组、最小环境变量和超时调用 ODA File Converter。
5. 验证输出 DXF 非空、未超限、非软链接且仍位于私有工作区。
6. 调用 `parse_dxf()`。
7. 返回 ODA 与 ezdxf 的组合版本和转换 warning。

转换工作区不替换原始 DWG，并在任务结束时自动清理。复杂图渐进预览是唯一例外：Worker 会在清理工作区前把 DXF 数据副本收入与 `documentId` 绑定、不可直接下载且随文档删除的预览 bundle，用于首次细节请求构建完整几何索引。ODA 第三方安装包和许可说明见 [`vendor/oda/README.md`](./vendor/oda/README.md)。

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
