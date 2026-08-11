import { Injectable } from '@nestjs/common';
import type { Prisma, SystemConfigVersion, SystemDeployment } from '@prisma/client';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type {
  DeploymentAgentResult,
  DeploymentService,
  ManagedConfigurationField,
  ManagedConfigurationSecret,
  SystemConfigurationResponse,
  SystemConfigurationUpdateRequest,
  SystemConfigurationVersion as ConfigurationVersionResponse,
  SystemDeployment as DeploymentResponse,
} from '@nexus-kb/contracts';

import { AclPolicy } from '../auth/acl-policy';
import { isAdmin } from '../auth/app-role';
import type { Identity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { OperationalLogger } from '../common/operational-logger';
import { AppConfig, parseEnvironment } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';

const VALUE_FIELDS = [
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_FALLBACK_PROVIDER',
  'LLM_FALLBACK_MODEL',
  'LLM_TEMPERATURE',
  'LLM_MAX_OUTPUT_TOKENS',
  'LLM_REQUEST_TIMEOUT_MS',
  'LLM_MAX_ATTEMPTS',
  'LLM_RETRY_BASE_DELAY_MS',
  'OPENAI_BASE_URL',
  'OPENAI_REGION',
  'GEMINI_BASE_URL',
  'GEMINI_REGION',
  'DEEPSEEK_BASE_URL',
  'DEEPSEEK_REGION',
  'ALIBABA_BASE_URL',
  'ALIBABA_REGION',
  'CUSTOM_BASE_URL',
  'CUSTOM_REGION',
  'RERANK_PROVIDER',
  'RERANK_MODEL',
  'RERANK_BASE_URL',
  'RERANK_REGION',
  'RERANK_TOP_K',
  'RERANK_REQUEST_TIMEOUT_MS',
  'PARSER_REQUEST_TIMEOUT_MS',
  'DWG_CONVERSION_ENABLED',
  'DWG_OUTPUT_VERSION',
  'MAX_DWG_CONVERTED_BYTES',
  'MAX_PARSE_BYTES',
  'MAX_ELEMENTS',
  'MAX_SPREADSHEET_ROWS',
  'MAX_PDF_PAGES',
  'MAX_IMAGE_PIXELS',
  'OCR_LANGUAGES',
  'OCR_CONFIDENCE_WARNING_THRESHOLD',
  'MAX_CAD_ENTITIES',
  'MAX_CAD_INSERT_DEPTH',
  'CAD_TILED_PREVIEW_ENABLED',
  'CAD_PREVIEW_TILE_COST_THRESHOLD',
  'CAD_PREVIEW_TILE_SOURCE_BYTES_THRESHOLD',
  'CAD_PREVIEW_TILE_SIZE',
  'CAD_PREVIEW_MAX_ZOOM',
  'CAD_PREVIEW_METATILE_RADIUS',
  'CAD_PREVIEW_TILE_CACHE_BYTES',
  'CAD_PREVIEW_RENDER_TIMEOUT_SECONDS',
  'CAD_PREVIEW_RENDER_MEMORY_BYTES',
  'DWG_CONVERSION_TIMEOUT_SECONDS',
  'TIKA_ENABLED',
  'TIKA_REQUEST_TIMEOUT_SECONDS',
  'MAX_TIKA_RESPONSE_BYTES',
  'MAX_ARCHIVE_ENTRIES',
  'MAX_ARCHIVE_UNCOMPRESSED_BYTES',
  'MAX_UPLOAD_BYTES',
  'INGESTION_CONCURRENCY',
  'INGESTION_MAX_ATTEMPTS',
  'INGESTION_RETRY_BASE_DELAY_MS',
  'QUERY_ANSWER_MODE',
  'QUERY_RECALL_TOP_K',
  'QUERY_MAX_DISTANCE',
  'QUERY_NEIGHBOR_WINDOW',
  'QUERY_MAX_MERGED_CONTEXT_CHARS',
  'QUERY_MAX_LLM_CONTEXT_CHARS',
  'QUERY_MAX_RERANK_INPUT_CHARS',
  'QUERY_USER_RATE_LIMIT_PER_MINUTE',
  'QUERY_TENANT_RATE_LIMIT_PER_MINUTE',
] as const satisfies readonly ManagedConfigurationField[];

const SECRET_FIELDS = [
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'DASHSCOPE_API_KEY',
  'CUSTOM_API_KEY',
] as const satisfies readonly ManagedConfigurationSecret[];

const INTEGER_LIMITS: Partial<Record<ManagedConfigurationField, readonly [number, number]>> = {
  LLM_MAX_OUTPUT_TOKENS: [1, 65_536],
  LLM_REQUEST_TIMEOUT_MS: [100, 300_000],
  LLM_MAX_ATTEMPTS: [1, 6],
  LLM_RETRY_BASE_DELAY_MS: [1, 10_000],
  RERANK_TOP_K: [1, 100],
  RERANK_REQUEST_TIMEOUT_MS: [100, 300_000],
  PARSER_REQUEST_TIMEOUT_MS: [100, 900_000],
  MAX_DWG_CONVERTED_BYTES: [1, 1_073_741_824],
  MAX_PARSE_BYTES: [1, 1_073_741_824],
  MAX_ELEMENTS: [1, 1_000_000],
  MAX_SPREADSHEET_ROWS: [1, 1_000_000],
  MAX_PDF_PAGES: [1, 5_000],
  MAX_IMAGE_PIXELS: [1, 250_000_000],
  MAX_CAD_ENTITIES: [1, 2_000_000],
  MAX_CAD_INSERT_DEPTH: [1, 32],
  CAD_PREVIEW_TILE_COST_THRESHOLD: [1, 100_000_000],
  CAD_PREVIEW_TILE_SOURCE_BYTES_THRESHOLD: [1, 1_073_741_824],
  CAD_PREVIEW_TILE_SIZE: [256, 1024],
  CAD_PREVIEW_MAX_ZOOM: [1, 12],
  CAD_PREVIEW_METATILE_RADIUS: [0, 2],
  CAD_PREVIEW_TILE_CACHE_BYTES: [1_048_576, 2_147_483_647],
  CAD_PREVIEW_RENDER_TIMEOUT_SECONDS: [5, 600],
  CAD_PREVIEW_RENDER_MEMORY_BYTES: [536_870_912, 8_589_934_592],
  DWG_CONVERSION_TIMEOUT_SECONDS: [1, 1800],
  TIKA_REQUEST_TIMEOUT_SECONDS: [1, 600],
  MAX_TIKA_RESPONSE_BYTES: [1, 268_435_456],
  MAX_ARCHIVE_ENTRIES: [1, 100_000],
  MAX_ARCHIVE_UNCOMPRESSED_BYTES: [1, 1_073_741_824],
  MAX_UPLOAD_BYTES: [1, 1_073_741_824],
  INGESTION_CONCURRENCY: [1, 32],
  INGESTION_MAX_ATTEMPTS: [1, 20],
  INGESTION_RETRY_BASE_DELAY_MS: [100, 60_000],
  QUERY_RECALL_TOP_K: [1, 100],
  QUERY_NEIGHBOR_WINDOW: [0, 3],
  QUERY_MAX_MERGED_CONTEXT_CHARS: [1_000, 100_000],
  QUERY_MAX_LLM_CONTEXT_CHARS: [1_000, 1_000_000],
  QUERY_MAX_RERANK_INPUT_CHARS: [1_000, 1_000_000],
  QUERY_USER_RATE_LIMIT_PER_MINUTE: [1, 1_000],
  QUERY_TENANT_RATE_LIMIT_PER_MINUTE: [1, 100_000],
};

type ManagedEnvironment = Record<string, string>;

@Injectable()
export class SystemConfigurationService {
  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly acl: AclPolicy,
    private readonly logger: OperationalLogger,
  ) {}

  async configuration(identity: Identity): Promise<SystemConfigurationResponse> {
    this.acl.assertCapability(identity, 'system:read');
    const versions = await this.prisma.systemConfigVersion.findMany({
      where: { tenantId: identity.tenantId },
      orderBy: { version: 'desc' },
      take: 20,
    });
    const active = versions.find((version) => version.status === 'active') ?? null;
    const effective = active
      ? this.hydratedEnvironment(active.encryptedConfig)
      : this.initialEnvironment();
    return {
      deploymentAgentAvailable: this.isAvailable(),
      embeddingManagedSeparately: true,
      effectiveValues: this.publicValues(effective),
      secretConfigured: this.secretSummary(effective),
      current: active ? this.versionResponse(active) : null,
      versions: versions.map((version) => this.versionResponse(version)),
    };
  }

  async createVersion(
    request: SystemConfigurationUpdateRequest,
    identity: Identity,
    traceId: string,
  ): Promise<ConfigurationVersionResponse> {
    this.acl.assertCapability(identity, 'system:configure');
    this.assertAdministrator(identity);
    this.assertAvailable();
    const active = await this.activeVersion(identity.tenantId);
    const base = active
      ? this.hydratedEnvironment(active.encryptedConfig)
      : this.initialEnvironment();
    const candidate = { ...base };
    for (const [field, value] of Object.entries(request.values)) {
      candidate[field] = this.validateValue(field as ManagedConfigurationField, value);
    }
    for (const [field, value] of Object.entries(request.secrets)) candidate[field] = value;
    this.validateApplicationEnvironment(candidate);
    const changedKeys = [...Object.keys(request.values), ...Object.keys(request.secrets)].sort();
    const created = await this.prisma.$transaction(async (transaction) => {
      const latest = await transaction.systemConfigVersion.findFirst({
        where: { tenantId: identity.tenantId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = await transaction.systemConfigVersion.create({
        data: {
          id: randomUUID(),
          tenantId: identity.tenantId,
          version: (latest?.version ?? 0) + 1,
          encryptedConfig: this.encrypt(candidate),
          summary: this.summary(candidate),
          changedKeys,
          changeReason: request.changeReason,
          createdBy: identity.userId,
        },
      });
      await transaction.accessAudit.create({
        data: {
          id: randomUUID(),
          tenantId: identity.tenantId,
          actorUserId: identity.userId,
          targetType: 'system_configuration',
          targetId: version.id,
          eventType: 'system_config_version_created',
          before: active ? [String(active.version)] : [],
          after: changedKeys,
          traceId,
        },
      });
      return version;
    });
    return this.versionResponse(created);
  }

  async deployVersion(
    configVersionId: string,
    identity: Identity,
    traceId: string,
  ): Promise<DeploymentResponse> {
    this.acl.assertCapability(identity, 'system:deploy');
    this.assertAdministrator(identity);
    this.assertAvailable();
    const target = await this.prisma.systemConfigVersion.findFirst({
      where: { id: configVersionId, tenantId: identity.tenantId },
    });
    if (!target) throw new ApiException('CONFIG_VERSION_NOT_FOUND', '配置版本不存在', 404);
    if (!['draft', 'failed', 'superseded'].includes(target.status)) {
      throw new ApiException('CONFIG_VERSION_NOT_DEPLOYABLE', '该配置版本不能重复发布', 409);
    }
    const active = await this.activeVersion(identity.tenantId);
    return this.startDeployment(target, active, identity, traceId);
  }

  async listDeployments(identity: Identity): Promise<{ deployments: DeploymentResponse[] }> {
    this.acl.assertCapability(identity, 'system:read');
    const rows = await this.prisma.systemDeployment.findMany({
      where: { tenantId: identity.tenantId },
      include: { configVersion: true, previousConfigVersion: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return { deployments: rows.map((row) => this.deploymentResponse(row)) };
  }

  async deployment(id: string, identity: Identity): Promise<DeploymentResponse> {
    this.acl.assertCapability(identity, 'system:read');
    const row = await this.deploymentRow(id, identity.tenantId);
    if (!row) throw new ApiException('DEPLOYMENT_NOT_FOUND', '发布任务不存在', 404);
    return this.deploymentResponse(row);
  }

  async rollback(id: string, identity: Identity, traceId: string): Promise<DeploymentResponse> {
    this.acl.assertCapability(identity, 'system:deploy');
    this.assertAdministrator(identity);
    this.assertAvailable();
    const source = await this.deploymentRow(id, identity.tenantId);
    if (!source || source.status !== 'succeeded' || !source.previousConfigVersion) {
      throw new ApiException('DEPLOYMENT_ROLLBACK_UNAVAILABLE', '该发布没有可用的回滚版本', 409);
    }
    const current = await this.activeVersion(identity.tenantId);
    return this.startDeployment(source.previousConfigVersion, current, identity, traceId);
  }

  authenticateAgent(token: string | undefined): void {
    const expected = this.config.values.DEPLOYMENT_AGENT_TOKEN;
    if (!expected || !token)
      throw new ApiException('DEPLOYMENT_AGENT_UNAUTHORIZED', '内部凭据无效', 401);
    const left = Buffer.from(expected);
    const right = Buffer.from(token);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new ApiException('DEPLOYMENT_AGENT_UNAUTHORIZED', '内部凭据无效', 401);
    }
  }

  async completeFromAgent(id: string, result: DeploymentAgentResult): Promise<{ accepted: true }> {
    const row = await this.deploymentRow(id);
    if (!row) throw new ApiException('DEPLOYMENT_NOT_FOUND', '发布任务不存在', 404);
    if (!['queued', 'running'].includes(row.status)) return { accepted: true };
    await this.prisma.$transaction(async (transaction) => {
      await transaction.systemDeployment.update({
        where: { id },
        data: {
          status: result.status,
          errorCode: result.errorCode,
          completedAt: new Date(),
          startedAt: row.startedAt ?? new Date(),
        },
      });
      if (result.status === 'succeeded') {
        await transaction.systemConfigVersion.updateMany({
          where: { tenantId: row.tenantId, status: 'active', id: { not: row.configVersionId } },
          data: { status: 'superseded' },
        });
        await transaction.systemConfigVersion.update({
          where: { id: row.configVersionId },
          data: { status: 'active', activatedAt: new Date() },
        });
      } else {
        await transaction.systemConfigVersion.update({
          where: { id: row.configVersionId },
          data: { status: 'failed' },
        });
      }
      await transaction.accessAudit.create({
        data: {
          id: randomUUID(),
          tenantId: row.tenantId,
          actorUserId: row.requestedBy,
          targetType: 'system_deployment',
          targetId: row.id,
          eventType: `system_deployment_${result.status}`,
          before: row.previousConfigVersion ? [String(row.previousConfigVersion.version)] : [],
          after: [String(row.configVersion.version)],
          traceId: row.traceId,
        },
      });
    });
    this.logger.info('system_deployment_completed', {
      traceId: row.traceId,
      tenantId: row.tenantId,
      userId: row.requestedBy,
      status: result.status,
      errorCode: result.errorCode ?? undefined,
    });
    return { accepted: true };
  }

  private async startDeployment(
    target: SystemConfigVersion,
    previous: SystemConfigVersion | null,
    identity: Identity,
    traceId: string,
  ): Promise<DeploymentResponse> {
    const running = await this.prisma.systemDeployment.findFirst({
      where: { tenantId: identity.tenantId, status: { in: ['queued', 'running'] } },
    });
    if (running) throw new ApiException('DEPLOYMENT_ALREADY_RUNNING', '已有配置正在发布', 409);
    const environment = this.hydratedEnvironment(target.encryptedConfig);
    const previousEnvironment = previous
      ? this.hydratedEnvironment(previous.encryptedConfig)
      : this.initialEnvironment();
    const services = this.affectedServices(
      Object.keys(environment).filter((key) => environment[key] !== previousEnvironment[key]),
    );
    const deployment = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.systemDeployment.create({
        data: {
          id: randomUUID(),
          tenantId: identity.tenantId,
          configVersionId: target.id,
          previousConfigVersionId: previous?.id,
          services,
          requestedBy: identity.userId,
          traceId,
          status: 'running',
          startedAt: new Date(),
        },
        include: { configVersion: true, previousConfigVersion: true },
      });
      await transaction.accessAudit.create({
        data: {
          id: randomUUID(),
          tenantId: identity.tenantId,
          actorUserId: identity.userId,
          targetType: 'system_deployment',
          targetId: created.id,
          eventType: 'system_deployment_requested',
          before: previous ? [String(previous.version)] : [],
          after: [String(target.version), ...services],
          traceId,
        },
      });
      return created;
    });
    try {
      const response = await fetch(`${this.config.values.DEPLOYMENT_AGENT_URL}/v1/deployments`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.values.DEPLOYMENT_AGENT_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          deploymentId: deployment.id,
          services,
          environment,
          previousEnvironment,
          callbackUrl: `http://api:3000/v1/internal/deployments/${deployment.id}/result`,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (response.status !== 202) throw new Error(`agent status ${response.status}`);
      return this.deploymentResponse(deployment);
    } catch {
      await this.prisma.systemDeployment.update({
        where: { id: deployment.id },
        data: {
          status: 'failed',
          errorCode: 'DEPLOYMENT_AGENT_UNAVAILABLE',
          completedAt: new Date(),
        },
      });
      throw new ApiException('DEPLOYMENT_AGENT_UNAVAILABLE', '内部部署代理不可用', 503);
    }
  }

  private activeVersion(tenantId: string): Promise<SystemConfigVersion | null> {
    return this.prisma.systemConfigVersion.findFirst({
      where: { tenantId, status: 'active' },
      orderBy: { version: 'desc' },
    });
  }

  private deploymentRow(id: string, tenantId?: string) {
    return this.prisma.systemDeployment.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: { configVersion: true, previousConfigVersion: true },
    });
  }

  private initialEnvironment(): ManagedEnvironment {
    const environment: ManagedEnvironment = {};
    for (const field of VALUE_FIELDS) {
      const value =
        (this.config.values as unknown as Record<string, unknown>)[field] ??
        process.env[field] ??
        this.workerDefault(field);
      environment[field] =
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : this.workerDefault(field);
    }
    for (const field of SECRET_FIELDS) environment[field] = String(process.env[field] ?? '');
    return environment;
  }

  private workerDefault(field: ManagedConfigurationField): string {
    const defaults: Partial<Record<ManagedConfigurationField, string>> = {
      MAX_PARSE_BYTES: '52428800',
      MAX_DWG_CONVERTED_BYTES: '209715200',
      MAX_ELEMENTS: '100000',
      MAX_SPREADSHEET_ROWS: '100000',
      MAX_PDF_PAGES: '500',
      MAX_IMAGE_PIXELS: '40000000',
      OCR_LANGUAGES: 'ch_sim,en',
      OCR_CONFIDENCE_WARNING_THRESHOLD: '0.5',
      MAX_CAD_ENTITIES: '1000000',
      MAX_CAD_INSERT_DEPTH: '8',
      CAD_TILED_PREVIEW_ENABLED: 'true',
      CAD_PREVIEW_TILE_COST_THRESHOLD: '100000',
      CAD_PREVIEW_TILE_SOURCE_BYTES_THRESHOLD: '20971520',
      CAD_PREVIEW_TILE_SIZE: '512',
      CAD_PREVIEW_MAX_ZOOM: '8',
      CAD_PREVIEW_METATILE_RADIUS: '1',
      CAD_PREVIEW_TILE_CACHE_BYTES: '268435456',
      CAD_PREVIEW_RENDER_TIMEOUT_SECONDS: '60',
      CAD_PREVIEW_RENDER_MEMORY_BYTES: '2147483648',
      DWG_CONVERSION_TIMEOUT_SECONDS: '180',
      DWG_OUTPUT_VERSION: 'ACAD2018',
      TIKA_ENABLED: 'true',
      TIKA_REQUEST_TIMEOUT_SECONDS: '120',
      MAX_TIKA_RESPONSE_BYTES: '52428800',
      MAX_ARCHIVE_ENTRIES: '10000',
      MAX_ARCHIVE_UNCOMPRESSED_BYTES: '524288000',
    };
    return defaults[field] ?? '';
  }

  private validateValue(
    field: ManagedConfigurationField,
    value: string | number | boolean,
  ): string {
    const limit = INTEGER_LIMITS[field];
    if (limit) {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(numeric) || numeric < limit[0] || numeric > limit[1]) {
        throw new ApiException('SYSTEM_CONFIG_INVALID', `配置字段 ${field} 不合法`, 400);
      }
      return String(numeric);
    }
    if (
      field === 'DWG_CONVERSION_ENABLED' ||
      field === 'TIKA_ENABLED' ||
      field === 'CAD_TILED_PREVIEW_ENABLED'
    ) {
      if (value !== true && value !== false && value !== 'true' && value !== 'false') {
        throw new ApiException('SYSTEM_CONFIG_INVALID', `配置字段 ${field} 不合法`, 400);
      }
      return String(value);
    }
    if (field === 'DWG_OUTPUT_VERSION') {
      const text = String(value).trim();
      if (!/^ACAD(12|13|14|2000|2004|2007|2010|2013|2018)$/.test(text)) {
        throw new ApiException('SYSTEM_CONFIG_INVALID', `配置字段 ${field} 不合法`, 400);
      }
      return text;
    }
    if (field === 'LLM_TEMPERATURE' || field === 'QUERY_MAX_DISTANCE') {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 2) {
        throw new ApiException('SYSTEM_CONFIG_INVALID', `配置字段 ${field} 不合法`, 400);
      }
      return String(numeric);
    }
    if (field === 'OCR_CONFIDENCE_WARNING_THRESHOLD') {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
        throw new ApiException('SYSTEM_CONFIG_INVALID', `配置字段 ${field} 不合法`, 400);
      }
      return String(numeric);
    }
    const text = String(value).trim();
    if (field === 'OCR_LANGUAGES' && !/^[a-z_]{2,16}(,[a-z_]{2,16}){0,7}$/.test(text)) {
      throw new ApiException('SYSTEM_CONFIG_INVALID', `配置字段 ${field} 不合法`, 400);
    }
    if (text.length > 2048 || /[\r\n\0]/.test(text)) {
      throw new ApiException('SYSTEM_CONFIG_INVALID', `配置字段 ${field} 不合法`, 400);
    }
    return text;
  }

  private validateApplicationEnvironment(candidate: ManagedEnvironment): void {
    try {
      parseEnvironment({ ...process.env, ...candidate });
    } catch {
      throw new ApiException(
        'SYSTEM_CONFIG_INVALID',
        '配置组合校验失败，请检查 Provider、模型、凭据和参数',
        400,
      );
    }
  }

  private affectedServices(changedKeys: string[]): DeploymentService[] {
    const services = new Set<DeploymentService>(['api']);
    if (changedKeys.some((key) => PARSER_RUNTIME_FIELDS.has(key))) {
      services.add('parser-worker');
      services.add('parser-worker-dwg');
    }
    if (changedKeys.some((key) => key.startsWith('RERANK_'))) services.add('reranker-worker');
    return [...services];
  }

  private publicValues(environment: ManagedEnvironment): Record<ManagedConfigurationField, string> {
    return Object.fromEntries(
      VALUE_FIELDS.map((field) => [field, environment[field] ?? '']),
    ) as Record<ManagedConfigurationField, string>;
  }

  private secretSummary(
    environment: ManagedEnvironment,
  ): Record<ManagedConfigurationSecret, boolean> {
    return Object.fromEntries(
      SECRET_FIELDS.map((field) => [field, Boolean(environment[field])]),
    ) as Record<ManagedConfigurationSecret, boolean>;
  }

  private summary(environment: ManagedEnvironment): Prisma.InputJsonValue {
    return {
      values: this.publicValues(environment),
      secretConfigured: this.secretSummary(environment),
    };
  }

  private versionResponse(row: SystemConfigVersion): ConfigurationVersionResponse {
    const summary = row.summary as {
      values?: Record<ManagedConfigurationField, string>;
      secretConfigured?: Record<ManagedConfigurationSecret, boolean>;
    };
    const environment = this.hydratedEnvironment(row.encryptedConfig);
    const values = this.publicValues(environment);
    const secretConfigured = this.secretSummary(environment);
    return {
      id: row.id,
      version: row.version,
      status: row.status as ConfigurationVersionResponse['status'],
      values: { ...values, ...summary.values },
      secretConfigured: { ...secretConfigured, ...summary.secretConfigured },
      changedKeys: this.jsonArray(row.changedKeys),
      changeReason: row.changeReason,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      activatedAt: row.activatedAt?.toISOString() ?? null,
    };
  }

  private deploymentResponse(
    row: SystemDeployment & {
      configVersion: SystemConfigVersion;
      previousConfigVersion: SystemConfigVersion | null;
    },
  ): DeploymentResponse {
    return {
      id: row.id,
      status: row.status as DeploymentResponse['status'],
      services: this.jsonArray(row.services) as DeploymentService[],
      configVersion: row.configVersion.version,
      changeReason: row.configVersion.changeReason,
      previousVersion: row.previousConfigVersion?.version ?? null,
      rollbackAvailable: row.status === 'succeeded' && row.previousConfigVersion !== null,
      errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  private encrypt(environment: ManagedEnvironment): string {
    const key = this.encryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(environment), 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), encrypted].map((value) => value.toString('base64')).join('.');
  }

  private decrypt(payload: string): ManagedEnvironment {
    const [ivValue, tagValue, encryptedValue] = payload.split('.');
    if (!ivValue || !tagValue || !encryptedValue) {
      throw new ApiException('SYSTEM_CONFIG_DECRYPT_FAILED', '配置版本无法读取', 500);
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey(),
        Buffer.from(ivValue, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
      const clear = Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      return JSON.parse(clear) as ManagedEnvironment;
    } catch {
      throw new ApiException('SYSTEM_CONFIG_DECRYPT_FAILED', '配置版本无法读取', 500);
    }
  }

  private hydratedEnvironment(payload: string): ManagedEnvironment {
    return { ...this.initialEnvironment(), ...this.decrypt(payload) };
  }

  private encryptionKey(): Buffer {
    const key = Buffer.from(this.config.values.SYSTEM_CONFIG_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32)
      throw new ApiException('SYSTEM_CONFIG_UNAVAILABLE', '配置发布功能未启用', 503);
    return key;
  }

  private isAvailable(): boolean {
    return Boolean(
      this.config.values.SYSTEM_CONFIG_ENCRYPTION_KEY &&
      this.config.values.DEPLOYMENT_AGENT_URL &&
      this.config.values.DEPLOYMENT_AGENT_TOKEN,
    );
  }

  private assertAvailable(): void {
    if (!this.isAvailable())
      throw new ApiException('SYSTEM_CONFIG_UNAVAILABLE', '配置发布功能未启用', 503);
  }

  private assertAdministrator(identity: Identity): void {
    if (!isAdmin(identity.roles)) {
      throw new ApiException('ADMIN_REQUIRED', '仅管理员可以修改或发布系统配置', 403);
    }
  }

  private jsonArray(value: unknown): string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
  }
}

const PARSER_RUNTIME_FIELDS = new Set<string>([
  'DWG_OUTPUT_VERSION',
  'MAX_DWG_CONVERTED_BYTES',
  'MAX_PARSE_BYTES',
  'MAX_ELEMENTS',
  'MAX_SPREADSHEET_ROWS',
  'MAX_PDF_PAGES',
  'MAX_IMAGE_PIXELS',
  'OCR_LANGUAGES',
  'OCR_CONFIDENCE_WARNING_THRESHOLD',
  'MAX_CAD_ENTITIES',
  'MAX_CAD_INSERT_DEPTH',
  'CAD_TILED_PREVIEW_ENABLED',
  'CAD_PREVIEW_TILE_COST_THRESHOLD',
  'CAD_PREVIEW_TILE_SOURCE_BYTES_THRESHOLD',
  'CAD_PREVIEW_TILE_SIZE',
  'CAD_PREVIEW_MAX_ZOOM',
  'CAD_PREVIEW_METATILE_RADIUS',
  'CAD_PREVIEW_TILE_CACHE_BYTES',
  'CAD_PREVIEW_RENDER_TIMEOUT_SECONDS',
  'CAD_PREVIEW_RENDER_MEMORY_BYTES',
  'DWG_CONVERSION_TIMEOUT_SECONDS',
  'TIKA_ENABLED',
  'TIKA_REQUEST_TIMEOUT_SECONDS',
  'MAX_TIKA_RESPONSE_BYTES',
  'MAX_ARCHIVE_ENTRIES',
  'MAX_ARCHIVE_UNCOMPRESSED_BYTES',
]);
