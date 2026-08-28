import { Injectable, Optional } from '@nestjs/common';
import { extname } from 'node:path';
import {
  cadPreviewTileRequestSchema,
  cadPreviewTileResponseSchema,
  parseRequestSchema,
  parseResponseSchema,
} from '@nexus-kb/contracts';
import type {
  CadPreviewTileRequest,
  CadPreviewTileResponse,
  ParseRequest,
  ParseResponse,
} from '@nexus-kb/contracts';

import { AppConfig } from '../config/app-config';
import { MetricsService } from '../observability/metrics.service';
import { ParserError } from './parser-error';

const CAD_PREVIEW_INITIALIZATION_TIMEOUT_SECONDS = 180;
const CAD_PREVIEW_CLIENT_TIMEOUT_MARGIN_SECONDS = 10;

export function cadPreviewTileTimeoutMs(renderTimeoutSeconds: number): number {
  return (
    (Math.min(renderTimeoutSeconds * 3, CAD_PREVIEW_INITIALIZATION_TIMEOUT_SECONDS) +
      CAD_PREVIEW_CLIENT_TIMEOUT_MARGIN_SECONDS) *
    1000
  );
}

const SAFE_WORKER_ERROR_CODES = new Set([
  'CAD_ENTITY_LIMIT_EXCEEDED',
  'PARSER_ELEMENT_LIMIT_EXCEEDED',
  'DXF_INVALID_OR_UNSUPPORTED',
  'DWG_VERSION_UNSUPPORTED',
  'DWG_CONVERTED_SIZE_LIMIT_EXCEEDED',
  'DWG_CONVERSION_FAILED',
  'PARSER_EMPTY_RESULT',
  'TIKA_RESPONSE_LIMIT_EXCEEDED',
  'CAD_PREVIEW_TILE_INVALID',
  'CAD_PREVIEW_TILE_TIMEOUT',
  'CAD_PREVIEW_TILE_UNAVAILABLE',
]);

@Injectable()
export class ParserClient {
  constructor(
    private readonly config: AppConfig,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async parse(request: ParseRequest, traceId: string): Promise<ParseResponse> {
    const startedAt = Date.now();
    const validatedRequest = parseRequestSchema.parse(request);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.values.PARSER_REQUEST_TIMEOUT_MS,
    );
    try {
      let response: Response;
      try {
        response = await fetch(new URL('/internal/v1/parse', this.workerUrl(validatedRequest)), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-token': this.config.values.PARSER_INTERNAL_TOKEN,
            'x-trace-id': traceId,
          },
          body: JSON.stringify(validatedRequest),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw new ParserError('timeout', true, { cause: error });
        }
        throw new ParserError('unavailable', true, { cause: error });
      }
      if (!response.ok) throw this.statusError(response);
      try {
        const result = parseResponseSchema.parse(await response.json());
        const expectedPreviewSuffix =
          result.preview?.kind === 'cad_tiles' ? 'cad' : result.preview?.kind;
        if (
          result.preview &&
          result.preview.storageKey !== `${validatedRequest.documentId}.${expectedPreviewSuffix}`
        ) {
          throw new Error('Preview artifact is not bound to the requested document');
        }
        this.metrics?.observeParser('success', Date.now() - startedAt);
        this.metrics?.addParserWarnings(result.warnings);
        return result;
      } catch (error) {
        throw new ParserError('invalid_response', false, { cause: error });
      }
    } catch (error) {
      const normalized =
        error instanceof ParserError
          ? error
          : new ParserError('unavailable', true, { cause: error });
      this.metrics?.observeParser('error', Date.now() - startedAt, normalized.kind);
      throw normalized;
    } finally {
      clearTimeout(timeout);
    }
  }

  async ensureCadPreviewTile(
    request: CadPreviewTileRequest,
    traceId: string,
  ): Promise<CadPreviewTileResponse> {
    const startedAt = Date.now();
    const validatedRequest = cadPreviewTileRequestSchema.parse(request);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      cadPreviewTileTimeoutMs(this.config.values.CAD_PREVIEW_RENDER_TIMEOUT_SECONDS),
    );
    try {
      let response: Response;
      try {
        response = await fetch(
          new URL('/internal/v1/cad-preview/tile', this.config.values.PARSER_WORKER_URL),
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-internal-token': this.config.values.PARSER_INTERNAL_TOKEN,
              'x-trace-id': traceId,
            },
            body: JSON.stringify(validatedRequest),
            signal: controller.signal,
          },
        );
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw new ParserError('timeout', true, {
            cause: error,
            code: 'CAD_PREVIEW_TILE_TIMEOUT',
          });
        }
        throw new ParserError('unavailable', true, {
          cause: error,
          code: 'CAD_PREVIEW_TILE_UNAVAILABLE',
        });
      }
      if (!response.ok) throw this.statusError(response);
      try {
        const result = cadPreviewTileResponseSchema.parse(await response.json());
        const expectedPrefix = `${validatedRequest.documentId}.cad/bundles/`;
        const expectedSuffix = `/tiles/${validatedRequest.zoom}/${validatedRequest.tileX}/${validatedRequest.tileY}.png`;
        if (
          !result.storageKey.startsWith(expectedPrefix) ||
          !result.storageKey.endsWith(expectedSuffix)
        ) {
          throw new Error('CAD preview tile is not bound to the requested document and coordinate');
        }
        this.metrics?.observeCadPreviewTile(
          validatedRequest.zoom,
          result.cacheHit ? 'hit' : 'miss',
          'success',
          Date.now() - startedAt,
        );
        return result;
      } catch (error) {
        throw new ParserError('invalid_response', false, { cause: error });
      }
    } catch (error) {
      this.metrics?.observeCadPreviewTile(
        validatedRequest.zoom,
        'unknown',
        'error',
        Date.now() - startedAt,
      );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private statusError(response: Response): ParserError {
    const status = response.status;
    const workerCode = response.headers.get('x-parser-error-code');
    const safeCode = workerCode && SAFE_WORKER_ERROR_CODES.has(workerCode) ? workerCode : undefined;
    if (status === 401 || status === 403) return new ParserError('authentication', false);
    if ([400, 404, 413, 415, 422].includes(status)) {
      return new ParserError('invalid_request', false, {
        ...(safeCode ? { code: safeCode } : {}),
      });
    }
    if (status === 408 || status === 504) {
      return new ParserError('timeout', true, { ...(safeCode ? { code: safeCode } : {}) });
    }
    if (status === 429 || status >= 500) {
      return new ParserError('unavailable', true, { ...(safeCode ? { code: safeCode } : {}) });
    }
    return new ParserError('invalid_response', false);
  }

  private workerUrl(request: ParseRequest): string {
    return extname(request.storagePath).toLowerCase() === '.dwg'
      ? this.config.values.PARSER_DWG_WORKER_URL
      : this.config.values.PARSER_WORKER_URL;
  }
}
