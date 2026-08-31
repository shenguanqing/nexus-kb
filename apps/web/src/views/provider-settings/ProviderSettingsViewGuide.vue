<template>
  <component
    :is="isMobile ? ElDrawer : ElDialog"
    v-model="open"
    :class="isMobile ? 'configuration-guide-drawer' : 'configuration-guide-dialog'"
    :width="isMobile ? undefined : 'min(760px, calc(100% - 32px))'"
    :size="isMobile ? 'min(88dvh, 760px)' : undefined"
    :direction="isMobile ? 'btt' : undefined"
    :align-center="!isMobile"
    :style="isMobile ? undefined : { height: '640px' }"
    title="运行配置字段说明"
    append-to-body
  >
    <div class="configuration-guide__body">
      <div class="configuration-guide__controls">
        <div class="configuration-guide__search">
          <el-input
            v-model="search"
            clearable
            placeholder="搜索字段名或说明，例如 OCR、超时、CAD"
          />
        </div>
        <el-tabs v-model="activeTab" class="configuration-guide-tabs" stretch>
          <el-tab-pane
            v-for="section in filteredSections"
            :key="section.id"
            :label="section.title"
            :name="section.id"
          />
        </el-tabs>
      </div>
      <div v-if="filteredSections.length > 0" ref="content" class="configuration-guide__content">
        <section
          v-for="section in filteredSections"
          v-show="section.id === activeTab"
          :key="section.id"
          class="kb-block-list"
        >
          <div v-for="item in section.items" :key="item.label" class="kb-data-grid__item">
            <span class="kb-heading kb-heading--h5">{{ item.label }}</span>
            <span class="kb-text kb-text--secondary">{{ item.description }}</span>
          </div>
        </section>
      </div>
      <el-empty v-else class="kb-empty-state" description="未找到匹配的配置字段" />
    </div>
  </component>
</template>

<script setup lang="ts">
import { ElDialog, ElDrawer } from 'element-plus';
import { computed, ref, watch } from 'vue';

const configurationGuideSections = [
  {
    id: 'llm',
    title: 'LLM',
    items: [
      { label: '主 Provider', description: '默认回答模型的服务商；选 none 会关闭 LLM 回答。' },
      { label: '主模型', description: '主 Provider 使用的模型 ID，须与该服务商实际可用模型一致。' },
      {
        label: '备用 Provider',
        description: '主服务商发生可重试故障时使用的备选服务商；none 表示不降级。',
      },
      { label: '备用模型', description: '备用 Provider 使用的模型 ID。' },
      { label: '温度', description: '控制回答随机性，范围 0–2；数值越低通常越稳定。' },
      { label: '最大输出 Token', description: '单次回答允许生成的最大 Token 数，范围 1–65,536。' },
      { label: '请求超时（ms）', description: '等待 LLM 响应的最长时间，范围 100–300,000 毫秒。' },
      {
        label: '最大重试次数',
        description: '429、超时和部分 5xx 的最大尝试次数，范围 1–6；认证和参数错误不会重试。',
      },
      { label: '重试初始延迟（ms）', description: '指数退避的初始等待时间，范围 1–10,000 毫秒。' },
      {
        label: 'OpenAI Base URL',
        description: 'OpenAI Provider 的 API 基础地址；仅填写受信任、已批准的服务端地址。',
      },
      { label: 'OpenAI 区域', description: 'OpenAI 实际部署区域标识，用于状态与审计。' },
      {
        label: 'Gemini Base URL',
        description: 'Gemini Provider 的 API 基础地址；仅填写受信任、已批准的服务端地址。',
      },
      { label: 'Gemini 区域', description: 'Gemini 实际部署区域标识，用于状态与审计。' },
      {
        label: 'DeepSeek Base URL',
        description: 'DeepSeek Provider 的 API 基础地址；仅填写受信任、已批准的服务端地址。',
      },
      { label: 'DeepSeek 区域', description: 'DeepSeek 实际部署区域标识，用于状态与审计。' },
      {
        label: '阿里云 Base URL',
        description: '阿里云 Provider 的 API 基础地址；仅填写受信任、已批准的服务端地址。',
      },
      { label: '阿里云区域', description: '阿里云实际部署区域标识，用于状态与审计。' },
      {
        label: '自定义 Base URL',
        description: '兼容 OpenAI API 的自定义 Provider 基础地址；仅填写经过安全审批的服务。',
      },
      { label: '自定义区域', description: '自定义 Provider 的实际部署区域标识，用于状态与审计。' },
      {
        label: 'OpenAI Key',
        description: 'OpenAI 访问密钥。只写入、不回显；留空会保持已配置的密钥不变。',
      },
      {
        label: 'Gemini Key',
        description: 'Gemini 访问密钥。只写入、不回显；留空会保持已配置的密钥不变。',
      },
      {
        label: 'DeepSeek Key',
        description: 'DeepSeek 访问密钥。只写入、不回显；留空会保持已配置的密钥不变。',
      },
      {
        label: '阿里云 Key',
        description: '阿里云访问密钥。只写入、不回显；留空会保持已配置的密钥不变。',
      },
      {
        label: '自定义 Provider Key',
        description: '自定义 Provider 访问密钥。只写入、不回显；留空会保持已配置的密钥不变。',
      },
    ],
  },
  {
    id: 'rerank-query',
    title: 'Rerank 与问答',
    items: [
      {
        label: 'Rerank Provider',
        description: '候选片段重排服务；none 关闭重排，alibaba 或 local_bge 启用受控实现。',
      },
      { label: 'Rerank 模型', description: '重排服务所用模型 ID。' },
      {
        label: 'Rerank Base URL',
        description: '重排服务的受控基础地址；仅填写受信任、已批准的服务端地址。',
      },
      { label: 'Rerank 区域', description: '重排服务的实际部署区域标识，用于状态与审计。' },
      { label: '保留候选数', description: '重排后的最终候选数，范围 1–100。' },
      {
        label: 'Rerank 超时（ms）',
        description: '等待重排响应的最长时间，范围 100–300,000 毫秒；失败时回退向量排序。',
      },
      {
        label: '回答模式',
        description: 'hybrid 可在资料不足时标注为通用知识补充；strict 则仅返回有知识库依据的回答。',
      },
      {
        label: '召回数量',
        description: '向量检索阶段的候选数量，范围 1–100；过大可能增加延迟和后续成本。',
      },
      {
        label: '距离阈值',
        description: '相关性距离上限，范围 0–2；超过阈值的候选不会作为知识库依据。',
      },
      { label: '相邻分块窗口', description: '命中分块向前后合并的相邻分块数，范围 0–3。' },
      {
        label: '合并上下文最大字符数',
        description: '相邻分块合并后的最大字符数，范围 1,000–100,000。',
      },
      {
        label: 'LLM 上下文最大字符数',
        description: '最终送入 LLM 的已授权上下文字符上限，范围 1,000–1,000,000。',
      },
      {
        label: 'Rerank 输入最大字符数',
        description: '单个重排候选允许的最大字符数，范围 1,000–1,000,000。',
      },
      {
        label: '单用户每分钟问答上限',
        description: '每位用户每分钟允许的问答次数，范围 1–1,000。',
      },
      {
        label: 'Tenant 每分钟问答上限',
        description: '整个 tenant 每分钟允许的问答次数，范围 1–100,000。',
      },
    ],
  },
  {
    id: 'ingestion',
    title: '上传与入库',
    items: [
      {
        label: '上传文件最大字节',
        description: 'API 接受的单个上传文件大小上限，范围 1–1,073,741,824 字节。',
      },
      {
        label: '入库并发数',
        description: '可同时处理的入库任务数，范围 1–32；提高会增加 Worker、数据库和模型服务负载。',
      },
      { label: '入库最大尝试次数', description: '可重试入库任务的最大尝试次数，范围 1–20。' },
      {
        label: '入库重试初始延迟（ms）',
        description: '入库任务指数退避的初始等待时间，范围 100–60,000 毫秒。',
      },
    ],
  },
  {
    id: 'parser',
    title: 'Parser',
    items: [
      {
        label: 'API 等待超时（ms）',
        description: 'API 等待 Parser Worker 返回的最长时间，范围 100–900,000 毫秒。',
      },
      {
        label: '单文件最大字节',
        description: 'Parser 实际解析的单文件大小上限，范围 1–1,073,741,824 字节。',
      },
      { label: '最大元素数', description: '一次解析可输出的结构化元素上限，范围 1–1,000,000。' },
      { label: '表格最大行数', description: '单个工作簿累计可扫描的最大行数，范围 1–1,000,000。' },
      { label: 'PDF 最大页数', description: '单个 PDF 可解析的最大页数，范围 1–5,000。' },
      { label: '图片最大像素数', description: '图片宽高乘积上限，范围 1–250,000,000 像素。' },
      {
        label: 'OCR 语言',
        description:
          '逗号分隔、最多 8 个小写语言代码且不含空格。当前镜像只安装 ch_sim,en；改为其他语言不会自动下载模型，必须先扩展镜像内的 EasyOCR 模型和 Tesseract 语言包。',
      },
      {
        label: 'OCR 低置信度阈值',
        description:
          'OCR 文字置信度低于该值会产生数量 warning，范围 0–1；不会在 warning 中暴露正文。',
      },
      {
        label: '压缩包最大条目数',
        description: 'Office 等压缩容器允许的最大条目数，范围 1–100,000。',
      },
      {
        label: '压缩包解压后最大字节',
        description: 'Office 等压缩容器解压后的总大小上限，范围 1–1,073,741,824 字节。',
      },
    ],
  },
  {
    id: 'cad-dwg',
    title: 'CAD / DWG',
    items: [
      {
        label: 'CAD 最大实体数',
        description: '单张 CAD 图纸允许处理的最大实体数，范围 1–2,000,000。',
      },
      { label: 'CAD 最大嵌套深度', description: 'CAD 块引用可展开的最大嵌套深度，范围 1–32。' },
      {
        label: '启用 CAD 超大图纸瓦片预览',
        description: '开启后，满足阈值的大型或复杂图纸使用受控按视口瓦片预览。',
      },
      {
        label: 'CAD 瓦片渲染成本阈值',
        description: '超过该估算渲染成本时转为瓦片预览，范围 1–100,000,000。',
      },
      {
        label: 'CAD 瓦片源文件阈值（字节）',
        description: '源文件超过该大小时转为瓦片预览，范围 1–1,073,741,824 字节。',
      },
      { label: 'CAD 瓦片尺寸（像素）', description: '每块预览瓦片的边长，范围 256–1,024 像素。' },
      {
        label: 'CAD 最大瓦片缩放层级',
        description: '瓦片预览的基础最大缩放层级，范围 1–12；特定远距图纸可在受控条件下动态提升。',
      },
      {
        label: 'CAD 瓦片预取半径',
        description: '当前视口周围预取的瓦片半径，范围 0–2；值越大占用的资源越多。',
      },
      {
        label: 'CAD 瓦片缓存上限（字节）',
        description: 'CAD 预览瓦片缓存的最大占用，范围 1 MiB–2 GiB。',
      },
      {
        label: 'CAD 单次渲染超时（秒）',
        description: '单次 CAD 受控渲染的最长时间，范围 5–600 秒。',
      },
      {
        label: 'CAD 渲染内存上限（字节）',
        description: '单次 CAD 受控渲染可用内存上限，范围 512 MiB–8 GiB。',
      },
      { label: 'DWG 转换超时（秒）', description: 'DWG 转换为 DXF 的最长时间，范围 1–1,800 秒。' },
      {
        label: 'DWG 转换产物最大字节',
        description: '转换后 DXF 的大小上限，范围 1–1,073,741,824 字节。',
      },
      {
        label: '启用 DWG 上传与转换',
        description: '仅在受控 DWG Worker 可用时开启；开启后才接受 DWG 上传并路由转换。',
      },
      {
        label: 'DWG 输出版本',
        description:
          '转换输出的 DXF 版本；可选 ACAD12、13、14、2000、2004、2007、2010、2013 或 2018。',
      },
    ],
  },
  {
    id: 'tika',
    title: 'Tika',
    items: [
      {
        label: '启用 Tika PDF 兜底',
        description: 'Parser 无法处理 PDF 时，是否使用内网 Tika 进行受控兜底解析。',
      },
      { label: 'Tika 超时（秒）', description: '等待内网 Tika 返回的最长时间，范围 1–600 秒。' },
      {
        label: 'Tika 响应最大字节',
        description: '接受 Tika 响应正文的最大大小，范围 1–268,435,456 字节。',
      },
      {
        label: '变更原因',
        description:
          '创建不可变配置版本时必须填写，至少 3 个字符，最多 500 个字符，并会进入发布审计。',
      },
    ],
  },
] as const;

const { isMobile } = defineProps<{ isMobile: boolean }>();
const open = defineModel<boolean>({ required: true });
const search = ref('');
const activeTab = ref('llm');
const content = ref<HTMLElement | null>(null);
const filteredSections = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase();
  if (!keyword) return configurationGuideSections;
  return configurationGuideSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        `${item.label} ${item.description}`.toLocaleLowerCase().includes(keyword),
      ),
    }))
    .filter((section) => section.items.length > 0);
});

watch(filteredSections, (sections) => {
  if (!sections.some((section) => section.id === activeTab.value)) {
    activeTab.value = sections[0]?.id ?? '';
  }
});
watch(
  activeTab,
  () => {
    if (content.value) content.value.scrollTop = 0;
  },
  { flush: 'post' },
);
</script>

<style scoped>
.configuration-guide__body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
  min-height: 0;
}
.configuration-guide__controls {
  flex: 0 0 auto;
}
.configuration-guide__search {
  margin-bottom: var(--kb-space-1);
}
.configuration-guide__content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
</style>
