<template>
  <section class="page">
    <div class="provider-toolbar kb-status-toolbar">
      <div>
        <strong class="provider-toolbar__title">模型与运行配置</strong>
        <div>
          <el-text>密钥只写入、不回显；发布由内部白名单代理执行并验证 readiness。</el-text>
        </div>
      </div>
      <el-button :loading="loading" @click="load">刷新状态</el-button>
    </div>

    <div
      ref="pageContent"
      v-loading="publishing"
      class="page-content"
      :element-loading-text="publishingText"
      element-loading-background="rgba(255, 255, 255, 0.78)"
    >
      <div v-if="errorMessage && !result" class="kb-error-state" role="alert">
        <strong class="kb-text--danger">无法加载 Provider 配置</strong>
        <span>{{ errorMessage }}</span>
        <el-button @click="load">重试</el-button>
      </div>

      <template v-else>
        <div v-loading="loading" class="kb-block-list provider-card-list" aria-live="polite">
          <article
            v-for="provider in result?.providers ?? []"
            :key="provider.kind"
            class="kb-block"
          >
            <div class="kb-block-header">
              <span class="kb-block-title">{{ providerKindLabels[provider.kind] }}</span>
              <el-tag :type="provider.configurationStatus === 'configured' ? 'success' : 'info'">
                {{ provider.configurationStatus === 'configured' ? '已配置' : '未启用' }}
              </el-tag>
            </div>
            <div class="kb-block-title">{{ providerTitle(provider) }}</div>
            <div class="kb-data-fields">
              <div class="kb-data-field">
                <span class="kb-data-field__label">服务域名</span>
                <span class="kb-data-field__value">{{ provider.endpointHost ?? '—' }}</span>
              </div>
              <div class="kb-data-field">
                <span class="kb-data-field__label">区域</span>
                <span class="kb-data-field__value">{{ provider.region ?? '—' }}</span>
              </div>
              <div class="kb-data-field">
                <span class="kb-data-field__label">凭据状态</span>
                <span class="kb-data-field__value">
                  {{ credentialLabel(provider.provider, provider.credentialConfigured) }}
                </span>
              </div>
              <div v-if="provider.dimensions" class="kb-data-field">
                <span class="kb-data-field__label">向量维度</span>
                <span class="kb-data-field__value">{{ provider.dimensions }}</span>
              </div>
              <div v-if="provider.fingerprint" class="kb-data-field">
                <span class="kb-data-field__label">索引配置指纹</span>
                <span class="kb-data-field__value">{{ provider.fingerprint }}</span>
              </div>
            </div>
          </article>
        </div>

        <el-alert
          class="embedding-migration-alert"
          title="Embedding 配置由索引迁移流程单独管理"
          description="更换 Embedding Provider、模型或维度会创建新的向量空间，本页不会直接覆盖或仅重启 API。"
          type="warning"
          :closable="false"
          show-icon
        />

        <div v-if="configuration" class="configuration-panel kb-block">
          <div class="configuration-heading">
            <div class="configuration-heading__content">
              <strong>编辑运行配置</strong>
              <span class="configuration-heading__description">
                保存后会创建不可变版本，并仅重建受影响的白名单服务。
              </span>
            </div>
            <el-tag :type="configuration.deploymentAgentAvailable ? 'success' : 'danger'">
              {{ configuration.deploymentAgentAvailable ? '部署代理就绪' : '部署代理未启用' }}
            </el-tag>
          </div>

          <div class="configuration-editor">
            <nav class="configuration-anchor" aria-label="运行配置分区导航">
              <el-anchor
                :container="pageContent"
                :direction="isDesktop ? 'vertical' : 'horizontal'"
                :offset="isDesktop ? 0 : 40"
                :bound="24"
              >
                <el-anchor-link href="#configuration-llm" title="LLM" />
                <el-anchor-link
                  href="#configuration-rerank"
                  :title="isDesktop ? 'Rerank 与问答' : 'Rerank'"
                />
                <el-anchor-link
                  href="#configuration-ingestion"
                  :title="isDesktop ? '上传与入库' : '入库'"
                />
                <el-anchor-link href="#configuration-parser" title="Parser" />
                <el-anchor-link
                  href="#configuration-cad"
                  :title="isDesktop ? 'CAD / DWG' : 'CAD'"
                />
                <el-anchor-link href="#configuration-tika" title="Tika" />
              </el-anchor>
            </nav>

            <el-form label-position="top" class="configuration-form">
              <div id="configuration-llm" class="configuration-section">
                <div role="heading" aria-level="3">LLM</div>
                <div class="configuration-fields">
                  <el-form-item label="主 Provider">
                    <el-select v-model="form.LLM_PROVIDER">
                      <el-option
                        v-for="provider in llmProviders"
                        :key="provider"
                        :label="provider"
                        :value="provider"
                      />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="主模型">
                    <el-input v-model="form.LLM_MODEL" maxlength="128" />
                  </el-form-item>
                  <el-form-item label="备用 Provider">
                    <el-select v-model="form.LLM_FALLBACK_PROVIDER">
                      <el-option
                        v-for="provider in llmProviders"
                        :key="provider"
                        :label="provider"
                        :value="provider"
                      />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="备用模型">
                    <el-input v-model="form.LLM_FALLBACK_MODEL" maxlength="128" />
                  </el-form-item>
                  <el-form-item label="温度">
                    <el-input-number
                      v-model="numericForm.LLM_TEMPERATURE"
                      :min="0"
                      :max="2"
                      :step="0.1"
                    />
                  </el-form-item>
                  <el-form-item label="最大输出 Token">
                    <el-input-number
                      v-model="numericForm.LLM_MAX_OUTPUT_TOKENS"
                      :min="1"
                      :max="65536"
                    />
                  </el-form-item>
                  <el-form-item label="请求超时（ms）">
                    <el-input-number
                      v-model="numericForm.LLM_REQUEST_TIMEOUT_MS"
                      :min="100"
                      :max="300000"
                    />
                  </el-form-item>
                  <el-form-item label="最大重试次数">
                    <el-input-number v-model="numericForm.LLM_MAX_ATTEMPTS" :min="1" :max="6" />
                  </el-form-item>
                  <el-form-item label="重试初始延迟（ms）">
                    <el-input-number
                      v-model="numericForm.LLM_RETRY_BASE_DELAY_MS"
                      :min="1"
                      :max="10000"
                    />
                  </el-form-item>
                </div>
                <div class="configuration-fields">
                  <el-form-item label="OpenAI Base URL">
                    <el-input v-model="form.OPENAI_BASE_URL" maxlength="2048" />
                  </el-form-item>
                  <el-form-item label="OpenAI 区域">
                    <el-input v-model="form.OPENAI_REGION" maxlength="64" />
                  </el-form-item>
                  <el-form-item label="Gemini Base URL">
                    <el-input v-model="form.GEMINI_BASE_URL" maxlength="2048" />
                  </el-form-item>
                  <el-form-item label="Gemini 区域">
                    <el-input v-model="form.GEMINI_REGION" maxlength="64" />
                  </el-form-item>
                  <el-form-item label="DeepSeek Base URL">
                    <el-input v-model="form.DEEPSEEK_BASE_URL" maxlength="2048" />
                  </el-form-item>
                  <el-form-item label="DeepSeek 区域">
                    <el-input v-model="form.DEEPSEEK_REGION" maxlength="64" />
                  </el-form-item>
                  <el-form-item label="阿里云 Base URL">
                    <el-input v-model="form.ALIBABA_BASE_URL" maxlength="2048" />
                  </el-form-item>
                  <el-form-item label="阿里云区域">
                    <el-input v-model="form.ALIBABA_REGION" maxlength="64" />
                  </el-form-item>
                  <el-form-item label="自定义 Base URL">
                    <el-input v-model="form.CUSTOM_BASE_URL" maxlength="2048" />
                  </el-form-item>
                  <el-form-item label="自定义区域">
                    <el-input v-model="form.CUSTOM_REGION" maxlength="64" />
                  </el-form-item>
                </div>
                <div class="configuration-fields">
                  <el-form-item label="OpenAI Key">
                    <el-input
                      v-model="secrets.OPENAI_API_KEY"
                      type="password"
                      show-password
                      autocomplete="new-password"
                      :placeholder="secretPlaceholder('OPENAI_API_KEY')"
                    />
                  </el-form-item>
                  <el-form-item label="Gemini Key">
                    <el-input
                      v-model="secrets.GEMINI_API_KEY"
                      type="password"
                      show-password
                      autocomplete="new-password"
                      :placeholder="secretPlaceholder('GEMINI_API_KEY')"
                    />
                  </el-form-item>
                  <el-form-item label="DeepSeek Key">
                    <el-input
                      v-model="secrets.DEEPSEEK_API_KEY"
                      type="password"
                      show-password
                      autocomplete="new-password"
                      :placeholder="secretPlaceholder('DEEPSEEK_API_KEY')"
                    />
                  </el-form-item>
                  <el-form-item label="阿里云 Key">
                    <el-input
                      v-model="secrets.DASHSCOPE_API_KEY"
                      type="password"
                      show-password
                      autocomplete="new-password"
                      :placeholder="secretPlaceholder('DASHSCOPE_API_KEY')"
                    />
                  </el-form-item>
                  <el-form-item label="自定义 Provider Key">
                    <el-input
                      v-model="secrets.CUSTOM_API_KEY"
                      type="password"
                      show-password
                      autocomplete="new-password"
                      :placeholder="secretPlaceholder('CUSTOM_API_KEY')"
                    />
                  </el-form-item>
                </div>
              </div>

              <div id="configuration-rerank" class="configuration-section">
                <div role="heading" aria-level="3">Rerank 与问答</div>
                <div class="configuration-fields">
                  <el-form-item label="Rerank Provider">
                    <el-select v-model="form.RERANK_PROVIDER">
                      <el-option label="none" value="none" />
                      <el-option label="alibaba" value="alibaba" />
                      <el-option label="local_bge" value="local_bge" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="Rerank 模型">
                    <el-input v-model="form.RERANK_MODEL" maxlength="128" />
                  </el-form-item>
                  <el-form-item label="Rerank Base URL">
                    <el-input v-model="form.RERANK_BASE_URL" maxlength="2048" />
                  </el-form-item>
                  <el-form-item label="Rerank 区域">
                    <el-input v-model="form.RERANK_REGION" maxlength="64" />
                  </el-form-item>
                  <el-form-item label="保留候选数">
                    <el-input-number v-model="numericForm.RERANK_TOP_K" :min="1" :max="100" />
                  </el-form-item>
                  <el-form-item label="Rerank 超时（ms）">
                    <el-input-number
                      v-model="numericForm.RERANK_REQUEST_TIMEOUT_MS"
                      :min="100"
                      :max="300000"
                    />
                  </el-form-item>
                  <el-form-item label="回答模式">
                    <el-select v-model="form.QUERY_ANSWER_MODE">
                      <el-option label="hybrid" value="hybrid" />
                      <el-option label="strict" value="strict" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="召回数量">
                    <el-input-number v-model="numericForm.QUERY_RECALL_TOP_K" :min="1" :max="100" />
                  </el-form-item>
                  <el-form-item label="距离阈值">
                    <el-input-number
                      v-model="numericForm.QUERY_MAX_DISTANCE"
                      :min="0"
                      :max="2"
                      :step="0.01"
                    />
                  </el-form-item>
                  <el-form-item label="相邻分块窗口">
                    <el-input-number
                      v-model="numericForm.QUERY_NEIGHBOR_WINDOW"
                      :min="0"
                      :max="3"
                    />
                  </el-form-item>
                  <el-form-item label="合并上下文最大字符数">
                    <el-input-number
                      v-model="numericForm.QUERY_MAX_MERGED_CONTEXT_CHARS"
                      :min="1000"
                      :max="100000"
                    />
                  </el-form-item>
                  <el-form-item label="LLM 上下文最大字符数">
                    <el-input-number
                      v-model="numericForm.QUERY_MAX_LLM_CONTEXT_CHARS"
                      :min="1000"
                      :max="1000000"
                    />
                  </el-form-item>
                  <el-form-item label="Rerank 输入最大字符数">
                    <el-input-number
                      v-model="numericForm.QUERY_MAX_RERANK_INPUT_CHARS"
                      :min="1000"
                      :max="1000000"
                    />
                  </el-form-item>
                  <el-form-item label="单用户每分钟问答上限">
                    <el-input-number
                      v-model="numericForm.QUERY_USER_RATE_LIMIT_PER_MINUTE"
                      :min="1"
                      :max="1000"
                    />
                  </el-form-item>
                  <el-form-item label="Tenant 每分钟问答上限">
                    <el-input-number
                      v-model="numericForm.QUERY_TENANT_RATE_LIMIT_PER_MINUTE"
                      :min="1"
                      :max="100000"
                    />
                  </el-form-item>
                </div>
              </div>

              <div id="configuration-ingestion" class="configuration-section">
                <div role="heading" aria-level="3">上传与入库</div>
                <div class="configuration-fields">
                  <el-form-item label="上传文件最大字节">
                    <el-input-number
                      v-model="numericForm.MAX_UPLOAD_BYTES"
                      :min="1"
                      :max="1073741824"
                    />
                  </el-form-item>
                  <el-form-item label="入库并发数">
                    <el-input-number
                      v-model="numericForm.INGESTION_CONCURRENCY"
                      :min="1"
                      :max="32"
                    />
                  </el-form-item>
                  <el-form-item label="入库最大尝试次数">
                    <el-input-number
                      v-model="numericForm.INGESTION_MAX_ATTEMPTS"
                      :min="1"
                      :max="20"
                    />
                  </el-form-item>
                  <el-form-item label="入库重试初始延迟（ms）">
                    <el-input-number
                      v-model="numericForm.INGESTION_RETRY_BASE_DELAY_MS"
                      :min="100"
                      :max="60000"
                    />
                  </el-form-item>
                </div>
              </div>

              <div id="configuration-parser" class="configuration-section">
                <div role="heading" aria-level="3">Parser</div>
                <div class="configuration-fields">
                  <el-form-item label="API 等待超时（ms）">
                    <el-input-number
                      v-model="numericForm.PARSER_REQUEST_TIMEOUT_MS"
                      :min="100"
                      :max="900000"
                    />
                  </el-form-item>
                  <el-form-item label="单文件最大字节">
                    <el-input-number
                      v-model="numericForm.MAX_PARSE_BYTES"
                      :min="1"
                      :max="1073741824"
                    />
                  </el-form-item>
                  <el-form-item label="最大元素数">
                    <el-input-number v-model="numericForm.MAX_ELEMENTS" :min="1" :max="1000000" />
                  </el-form-item>
                  <el-form-item label="表格最大行数">
                    <el-input-number
                      v-model="numericForm.MAX_SPREADSHEET_ROWS"
                      :min="1"
                      :max="1000000"
                    />
                  </el-form-item>
                  <el-form-item label="PDF 最大页数">
                    <el-input-number v-model="numericForm.MAX_PDF_PAGES" :min="1" :max="5000" />
                  </el-form-item>
                  <el-form-item label="图片最大像素数">
                    <el-input-number
                      v-model="numericForm.MAX_IMAGE_PIXELS"
                      :min="1"
                      :max="250000000"
                    />
                  </el-form-item>
                  <el-form-item label="OCR 语言">
                    <el-input v-model="form.OCR_LANGUAGES" maxlength="128" />
                  </el-form-item>
                  <el-form-item label="OCR 低置信度阈值">
                    <el-input-number
                      v-model="numericForm.OCR_CONFIDENCE_WARNING_THRESHOLD"
                      :min="0"
                      :max="1"
                      :step="0.05"
                    />
                  </el-form-item>
                  <el-form-item label="压缩包最大条目数">
                    <el-input-number
                      v-model="numericForm.MAX_ARCHIVE_ENTRIES"
                      :min="1"
                      :max="100000"
                    />
                  </el-form-item>
                  <el-form-item label="压缩包解压后最大字节">
                    <el-input-number
                      v-model="numericForm.MAX_ARCHIVE_UNCOMPRESSED_BYTES"
                      :min="1"
                      :max="1073741824"
                    />
                  </el-form-item>
                </div>
              </div>

              <div id="configuration-cad" class="configuration-section">
                <div role="heading" aria-level="3">CAD / DWG</div>
                <div class="configuration-fields">
                  <el-form-item label="CAD 最大实体数">
                    <el-input-number
                      v-model="numericForm.MAX_CAD_ENTITIES"
                      :min="1"
                      :max="2000000"
                    />
                  </el-form-item>
                  <el-form-item label="CAD 最大嵌套深度">
                    <el-input-number
                      v-model="numericForm.MAX_CAD_INSERT_DEPTH"
                      :min="1"
                      :max="32"
                    />
                  </el-form-item>
                  <el-form-item label="启用 CAD 超大图纸瓦片预览">
                    <el-switch
                      v-model="form.CAD_TILED_PREVIEW_ENABLED"
                      active-value="true"
                      inactive-value="false"
                    />
                  </el-form-item>
                  <el-form-item label="CAD 瓦片渲染成本阈值">
                    <el-input-number
                      v-model="numericForm.CAD_PREVIEW_TILE_COST_THRESHOLD"
                      :min="1"
                      :max="100000000"
                    />
                  </el-form-item>
                  <el-form-item label="CAD 瓦片源文件阈值（字节）">
                    <el-input-number
                      v-model="numericForm.CAD_PREVIEW_TILE_SOURCE_BYTES_THRESHOLD"
                      :min="1"
                      :max="1073741824"
                    />
                  </el-form-item>
                  <el-form-item label="CAD 瓦片尺寸（像素）">
                    <el-input-number
                      v-model="numericForm.CAD_PREVIEW_TILE_SIZE"
                      :min="256"
                      :max="1024"
                      :step="256"
                    />
                  </el-form-item>
                  <el-form-item label="CAD 最大瓦片缩放层级">
                    <el-input-number
                      v-model="numericForm.CAD_PREVIEW_MAX_ZOOM"
                      :min="1"
                      :max="12"
                    />
                  </el-form-item>
                  <el-form-item label="CAD 瓦片预取半径">
                    <el-input-number
                      v-model="numericForm.CAD_PREVIEW_METATILE_RADIUS"
                      :min="0"
                      :max="2"
                    />
                  </el-form-item>
                  <el-form-item label="CAD 瓦片缓存上限（字节）">
                    <el-input-number
                      v-model="numericForm.CAD_PREVIEW_TILE_CACHE_BYTES"
                      :min="1048576"
                      :max="2147483647"
                    />
                  </el-form-item>
                  <el-form-item label="CAD 单次渲染超时（秒）">
                    <el-input-number
                      v-model="numericForm.CAD_PREVIEW_RENDER_TIMEOUT_SECONDS"
                      :min="5"
                      :max="600"
                    />
                  </el-form-item>
                  <el-form-item label="CAD 渲染内存上限（字节）">
                    <el-input-number
                      v-model="numericForm.CAD_PREVIEW_RENDER_MEMORY_BYTES"
                      :min="536870912"
                      :max="8589934592"
                    />
                  </el-form-item>
                  <el-form-item label="DWG 转换超时（秒）">
                    <el-input-number
                      v-model="numericForm.DWG_CONVERSION_TIMEOUT_SECONDS"
                      :min="1"
                      :max="1800"
                    />
                  </el-form-item>
                  <el-form-item label="DWG 转换产物最大字节">
                    <el-input-number
                      v-model="numericForm.MAX_DWG_CONVERTED_BYTES"
                      :min="1"
                      :max="1073741824"
                    />
                  </el-form-item>
                  <el-form-item label="启用 DWG 上传与转换">
                    <el-switch
                      v-model="form.DWG_CONVERSION_ENABLED"
                      active-value="true"
                      inactive-value="false"
                    />
                  </el-form-item>
                  <el-form-item label="DWG 输出版本">
                    <el-select v-model="form.DWG_OUTPUT_VERSION">
                      <el-option
                        v-for="version in [
                          'ACAD2018',
                          'ACAD2013',
                          'ACAD2010',
                          'ACAD2007',
                          'ACAD2004',
                          'ACAD2000',
                          'ACAD14',
                          'ACAD13',
                          'ACAD12',
                        ]"
                        :key="version"
                        :label="version"
                        :value="version"
                      />
                    </el-select>
                  </el-form-item>
                </div>
              </div>

              <div id="configuration-tika" class="configuration-section">
                <div role="heading" aria-level="3">Tika</div>
                <div class="configuration-fields">
                  <el-form-item label="启用 Tika PDF 兜底">
                    <el-switch
                      v-model="form.TIKA_ENABLED"
                      active-value="true"
                      inactive-value="false"
                    />
                  </el-form-item>
                  <el-form-item label="Tika 超时（秒）">
                    <el-input-number
                      v-model="numericForm.TIKA_REQUEST_TIMEOUT_SECONDS"
                      :min="1"
                      :max="600"
                    />
                  </el-form-item>
                  <el-form-item label="Tika 响应最大字节">
                    <el-input-number
                      v-model="numericForm.MAX_TIKA_RESPONSE_BYTES"
                      :min="1"
                      :max="268435456"
                    />
                  </el-form-item>
                </div>
              </div>

              <div class="configuration-actions">
                <el-form-item label="变更原因" required>
                  <el-input
                    v-model="changeReason"
                    maxlength="500"
                    show-word-limit
                    placeholder="说明为什么修改本次配置"
                  />
                </el-form-item>
                <el-button
                  class="configuration-submit"
                  type="primary"
                  :loading="saving"
                  :disabled="
                    !configuration.deploymentAgentAvailable ||
                    changeReason.trim().length < 3 ||
                    Boolean(activeDeployment)
                  "
                  @click="saveAndDeploy"
                >
                  保存并发布
                </el-button>
              </div>
            </el-form>
          </div>
        </div>

        <div class="deployment-panel kb-block">
          <div class="configuration-heading">
            <div class="configuration-heading__content">
              <strong>发布记录</strong>
              <span class="configuration-heading__description">
                显示变更原因、受影响服务、readiness 结果与回滚入口。
              </span>
            </div>
          </div>
          <el-table
            v-if="!isMobile"
            class="deployment-table"
            :data="deployments"
            height="360"
            empty-text="暂无发布记录"
          >
            <el-table-column prop="configVersion" label="版本" width="90">
              <template #default="scope">v{{ scope.row.configVersion }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="scope">
                <el-tag :type="deploymentTag(deploymentRow(scope.row).status)">
                  {{ deploymentStatus(deploymentRow(scope.row).status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="服务" min-width="100">
              <template #default="scope">
                {{ scope.row.services.join('、') }}
              </template>
            </el-table-column>
            <el-table-column
              prop="changeReason"
              label="变更原因"
              min-width="250"
              show-overflow-tooltip
            />
            <el-table-column prop="errorCode" label="结果码" min-width="250">
              <template #default="scope">{{ scope.row.errorCode ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="110">
              <template #default="scope">
                <el-button
                  v-if="deploymentRow(scope.row).rollbackAvailable && !activeDeployment"
                  text
                  type="warning"
                  @click="rollback(deploymentRow(scope.row))"
                >
                  回滚
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <div v-else class="deployment-card-list">
            <article
              v-for="deployment in deployments"
              :key="deployment.id"
              class="deployment-card kb-block kb-block--compact"
            >
              <div class="deployment-card__header">
                <strong>v{{ deployment.configVersion }}</strong>
                <el-tag :type="deploymentTag(deployment.status)">
                  {{ deploymentStatus(deployment.status) }}
                </el-tag>
              </div>
              <span class="deployment-card__detail">
                服务：{{ deployment.services.join('、') }}
              </span>
              <span class="deployment-card__detail">原因：{{ deployment.changeReason }}</span>
              <span class="deployment-card__detail">结果码：{{ deployment.errorCode ?? '—' }}</span>
              <el-button
                v-if="deployment.rollbackAvailable && !activeDeployment"
                text
                type="warning"
                @click="rollback(deployment)"
              >
                回滚
              </el-button>
            </article>
            <el-empty v-if="deployments.length === 0" description="暂无发布记录" />
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import type {
  ManagedConfigurationField,
  ManagedConfigurationSecret,
  ProviderStatusResponse,
  SystemConfigurationResponse,
  SystemDeployment,
} from '@nexus-kb/contracts';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';

import { ApiError } from '@/api/client';
import { useBreakpoint } from '@/composables/useBreakpoint';
import {
  createSystemConfiguration,
  deploySystemConfiguration,
  getProviderStatuses,
  getSystemConfiguration,
  getSystemDeployment,
  getSystemDeployments,
  rollbackSystemDeployment,
} from '@/api/system';
import { credentialLabel, providerKindLabels, providerTitle } from './system-presentation';

const result = ref<ProviderStatusResponse | null>(null);
const { isDesktop, isMobile } = useBreakpoint();
const configuration = ref<SystemConfigurationResponse | null>(null);
const deployments = ref<SystemDeployment[]>([]);
const pageContent = ref<HTMLElement | null>(null);
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const changeReason = ref('');
const numericFields = [
  'LLM_TEMPERATURE',
  'LLM_MAX_OUTPUT_TOKENS',
  'LLM_REQUEST_TIMEOUT_MS',
  'LLM_MAX_ATTEMPTS',
  'LLM_RETRY_BASE_DELAY_MS',
  'RERANK_TOP_K',
  'RERANK_REQUEST_TIMEOUT_MS',
  'QUERY_RECALL_TOP_K',
  'QUERY_MAX_DISTANCE',
  'PARSER_REQUEST_TIMEOUT_MS',
  'MAX_DWG_CONVERTED_BYTES',
  'MAX_PARSE_BYTES',
  'MAX_ELEMENTS',
  'MAX_SPREADSHEET_ROWS',
  'MAX_PDF_PAGES',
  'MAX_IMAGE_PIXELS',
  'OCR_CONFIDENCE_WARNING_THRESHOLD',
  'MAX_CAD_ENTITIES',
  'MAX_CAD_INSERT_DEPTH',
  'CAD_PREVIEW_TILE_COST_THRESHOLD',
  'CAD_PREVIEW_TILE_SOURCE_BYTES_THRESHOLD',
  'CAD_PREVIEW_TILE_SIZE',
  'CAD_PREVIEW_MAX_ZOOM',
  'CAD_PREVIEW_METATILE_RADIUS',
  'CAD_PREVIEW_TILE_CACHE_BYTES',
  'CAD_PREVIEW_RENDER_TIMEOUT_SECONDS',
  'CAD_PREVIEW_RENDER_MEMORY_BYTES',
  'DWG_CONVERSION_TIMEOUT_SECONDS',
  'TIKA_REQUEST_TIMEOUT_SECONDS',
  'MAX_TIKA_RESPONSE_BYTES',
  'MAX_ARCHIVE_ENTRIES',
  'MAX_ARCHIVE_UNCOMPRESSED_BYTES',
  'MAX_UPLOAD_BYTES',
  'INGESTION_CONCURRENCY',
  'INGESTION_MAX_ATTEMPTS',
  'INGESTION_RETRY_BASE_DELAY_MS',
  'QUERY_NEIGHBOR_WINDOW',
  'QUERY_MAX_MERGED_CONTEXT_CHARS',
  'QUERY_MAX_LLM_CONTEXT_CHARS',
  'QUERY_MAX_RERANK_INPUT_CHARS',
  'QUERY_USER_RATE_LIMIT_PER_MINUTE',
  'QUERY_TENANT_RATE_LIMIT_PER_MINUTE',
] as const;
type NumericField = (typeof numericFields)[number];
const numericFieldSet = new Set<ManagedConfigurationField>(numericFields);
const form = reactive<Partial<Record<ManagedConfigurationField, string>>>({});
const numericForm = reactive<Partial<Record<NumericField, number>>>({});
const secrets = reactive<Partial<Record<ManagedConfigurationSecret, string>>>({});
let pollingTimer: number | null = null;

const llmProviders = ['none', 'openai', 'google', 'deepseek', 'alibaba', 'custom'] as const;
const terminalStatuses = new Set(['succeeded', 'rolled_back', 'failed']);
const activeDeployment = computed(() =>
  deployments.value.find((deployment) => !terminalStatuses.has(deployment.status)),
);
const publishing = computed(() => saving.value || Boolean(activeDeployment.value));
const publishingText = computed(() =>
  saving.value ? '正在创建并发布运行配置…' : '正在等待服务重建和 readiness 检查…',
);

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const [providers, configurationResult, deploymentResult] = await Promise.all([
      getProviderStatuses(),
      getSystemConfiguration(),
      getSystemDeployments(),
    ]);
    result.value = providers;
    configuration.value = configurationResult;
    deployments.value = deploymentResult.deployments;
    for (const [key, value] of Object.entries(configurationResult.effectiveValues)) {
      const field = key as ManagedConfigurationField;
      if (numericFieldSet.has(field)) numericForm[field as NumericField] = Number(value);
      else form[field] = String(value);
    }
    startPollingIfNeeded();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : 'Provider 配置加载失败';
  } finally {
    loading.value = false;
  }
}

async function saveAndDeploy(): Promise<void> {
  if (!configuration.value || saving.value) return;
  const values: Partial<Record<ManagedConfigurationField, string | number | boolean>> = {};
  for (const field of Object.keys(form) as ManagedConfigurationField[]) {
    const value = form[field];
    if (
      value !== undefined &&
      String(configuration.value.effectiveValues[field] ?? '') !== String(value)
    ) {
      values[field] = value;
    }
  }
  for (const field of numericFields) {
    const value = numericForm[field];
    if (
      value !== undefined &&
      String(configuration.value.effectiveValues[field] ?? '') !== String(value)
    ) {
      values[field] = value;
    }
  }
  const changedSecrets: Partial<Record<ManagedConfigurationSecret, string>> = {};
  for (const field of Object.keys(secrets) as ManagedConfigurationSecret[]) {
    const value = secrets[field];
    if (value) changedSecrets[field] = value;
  }
  if (Object.keys(values).length + Object.keys(changedSecrets).length === 0) {
    ElMessage.warning('没有检测到配置变更');
    return;
  }
  saving.value = true;
  try {
    const version = await createSystemConfiguration({
      values,
      secrets: changedSecrets,
      changeReason: changeReason.value,
    });
    const accepted = await deploySystemConfiguration(version.id);
    deployments.value = [accepted.deployment, ...deployments.value];
    for (const key of Object.keys(secrets) as ManagedConfigurationSecret[]) secrets[key] = '';
    changeReason.value = '';
    ElMessage.success(`配置版本 v${version.version} 已进入发布队列`);
    startPollingIfNeeded();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '配置发布失败');
  } finally {
    saving.value = false;
  }
}

async function rollback(deployment: SystemDeployment): Promise<void> {
  await ElMessageBox.confirm(
    `确认将运行配置从 v${deployment.configVersion} 回滚到 v${deployment.previousVersion}？`,
    '回滚配置',
    {
      type: 'warning',
      confirmButtonText: '确认回滚',
      cancelButtonText: '取消',
    },
  );
  try {
    const accepted = await rollbackSystemDeployment(deployment.id);
    deployments.value = [accepted.deployment, ...deployments.value];
    ElMessage.success('回滚任务已进入队列');
    startPollingIfNeeded();
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? error.message : '回滚失败');
  }
}

function startPollingIfNeeded(): void {
  if (pollingTimer !== null || !activeDeployment.value) return;
  pollingTimer = window.setInterval(() => void pollDeployment(), 2000);
}

async function pollDeployment(): Promise<void> {
  const current = activeDeployment.value;
  if (!current) {
    stopPolling();
    return;
  }
  try {
    const updated = await getSystemDeployment(current.id);
    deployments.value = deployments.value.map((item) => (item.id === updated.id ? updated : item));
    if (terminalStatuses.has(updated.status)) {
      stopPolling();
      await load();
      if (updated.status === 'succeeded') ElMessage.success('配置已生效，readiness 检查通过');
      else if (updated.status === 'rolled_back') ElMessage.warning('readiness 未通过，已自动回滚');
      else ElMessage.error('发布和自动回滚均未成功，请联系运维');
    }
  } catch {
    // API 容器重建期间短暂不可用，保留轮询等待其恢复。
  }
}

function stopPolling(): void {
  if (pollingTimer !== null) window.clearInterval(pollingTimer);
  pollingTimer = null;
}

function deploymentStatus(status: SystemDeployment['status']): string {
  return {
    queued: '排队中',
    running: '发布中',
    succeeded: '已生效',
    rolled_back: '已自动回滚',
    failed: '失败',
  }[status];
}

function deploymentTag(
  status: SystemDeployment['status'],
): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'succeeded') return 'success';
  if (status === 'rolled_back') return 'warning';
  if (status === 'failed') return 'danger';
  return 'info';
}

function deploymentRow(value: unknown): SystemDeployment {
  return value as SystemDeployment;
}

function secretPlaceholder(field: ManagedConfigurationSecret): string {
  return configuration.value?.secretConfigured[field] ? '已配置；留空保持不变' : '尚未配置';
}

onMounted(load);
onUnmounted(stopPolling);
</script>

<style scoped>
.provider-toolbar__title {
  font-size: 17px;
}
.configuration-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--kb-space-4);
  margin-bottom: var(--kb-space-4);
}
.configuration-heading__content {
  display: grid;
  gap: var(--kb-space-1);
}
.configuration-heading__description {
  color: var(--kb-color-text-secondary);
  font-size: 13px;
}
.configuration-form,
.configuration-section {
  display: grid;
  gap: var(--kb-space-4);
}
.configuration-form :deep(.el-form-item) {
  margin: 0;
}
.configuration-form :deep(.el-input-number),
.configuration-form :deep(.el-select) {
  width: 100%;
}
.configuration-editor {
  --configuration-anchor-offset: calc(var(--kb-space-16) + var(--kb-space-12));
  display: grid;
  align-items: start;
  gap: var(--kb-space-5);
  grid-template-columns: 168px minmax(0, 1fr);
}
.configuration-anchor {
  position: sticky;
  top: 0;
  z-index: 3;
  align-self: start;
  min-width: 0;
  padding: var(--kb-space-2);
  background: var(--kb-color-surface);
}
.configuration-section {
  padding-top: var(--kb-space-4);
  border-top: 1px solid var(--kb-color-border);
  scroll-margin-top: var(--configuration-anchor-offset);
}
.configuration-fields {
  display: grid;
  gap: var(--kb-space-4);
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.configuration-actions {
  display: grid;
  align-items: end;
  gap: var(--kb-space-4);
  grid-template-columns: minmax(0, 1fr) auto;
}
.deployment-card-list {
  display: grid;
  gap: var(--kb-layout-gap);
  overflow-y: auto;
  max-height: 360px;
}
.deployment-table {
  width: 100%;
}
.deployment-card {
  display: grid;
  gap: var(--kb-space-2);
}
.deployment-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--kb-layout-gap);
}
.deployment-card__detail {
  overflow-wrap: anywhere;
  color: var(--kb-color-text-secondary);
  font-size: 13px;
}
.embedding-migration-alert {
  flex: 0 0 auto;
  min-height: 52px;
  border-radius: var(--kb-radius-md);
}
.provider-card-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
/* 响应式：紧凑布局（<1280px） */
@media (max-width: 1279px) {
  .provider-toolbar .el-text {
    display: none;
  }
  .configuration-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .configuration-editor {
    --configuration-anchor-offset: var(--kb-space-16);
    grid-template-columns: 1fr;
  }
  .configuration-anchor {
    overflow-x: auto;
    max-width: 100%;
    padding-right: var(--kb-space-2);
    padding-left: var(--kb-space-2);
  }
}

/* 响应式：Mobile（<768px） */
@media (max-width: 767px) {
  .configuration-panel,
  .deployment-panel {
    padding: var(--kb-block-padding);
  }
  .configuration-actions {
    grid-template-columns: 1fr;
  }
  .configuration-heading {
    flex-direction: column;
  }
  .configuration-fields {
    grid-template-columns: 1fr;
  }
  .provider-card-list {
    grid-template-columns: 1fr;
  }
  .configuration-submit {
    width: 100%;
  }
}
</style>
