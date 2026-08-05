# 本地 BGE Reranker Worker

这是一个仅供 API 在 Compose 内网调用的候选重排序服务，运行 `BAAI/bge-reranker-v2-m3`，只返回输入候选的下标和相关性分数。它没有原始文档 volume、数据库、向量库、模型 Provider Key 或公网端口。NestJS API 会先完成 ACL 和数据出网策略检查，再向它发送数量受限的候选文本。

Ollama 不参与重排序：其本地 API 没有稳定的 rerank 端点。本服务直接使用 `sentence-transformers` 的 BGE cross-encoder。

服务默认关闭。要在本地启用，先在 Git 忽略的 `.env` 中配置：

```dotenv
RERANK_PROVIDER=local_bge
RERANK_MODEL=BAAI/bge-reranker-v2-m3
LOCAL_RERANK_ENABLED=true
LOCAL_RERANK_BASE_URL=http://reranker-worker:8100
# 可选；留空时本地开发复用 PARSER_INTERNAL_TOKEN。
RERANK_INTERNAL_TOKEN=
```

> [!IMPORTANT]
> 先完成模型下载，再启动常驻 Worker。下载任务可访问专用下载网络；常驻 Worker 只能读取本地缓存，不能联网下载模型。

使用当前 Compose 入口执行以下命令。下面以基础模式为例；已启用 DWG 时将 `docker:base` 改为 `docker:full`：

```bash
pnpm docker:base -- --profile model-init run --rm reranker-model-init
pnpm docker:base -- up -d --build api reranker-worker
```

生产部署前，将 `LOCAL_RERANK_MODEL_REVISION` 固定为已批准的 Hugging Face revision。Docker Desktop 会以 CPU 运行该 Linux Worker；正式启用前应评估延迟与质量。
