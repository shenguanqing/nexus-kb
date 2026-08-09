import { Injectable, Optional } from '@nestjs/common';
import { extname } from 'node:path';
import { parseRequestSchema, parseResponseSchema } from '@nexus-kb/contracts';
import type { ParseRequest, ParseResponse } from '@nexus-kb/contracts';

import { AppConfig } from '../config/app-config';
import { MetricsService } from '../observability/metrics.service';
import { ParserError } from './parser-error';

const SAFE_WORKER_ERROR_CODES = new Set([
  'CAD_ENTITY_LIMIT_EXCEEDED',
  'PARSER_ELEMENT_LIMIT_EXCEEDED',
  'DXF_INVALID_OR_UNSUPPORTED',
  'DWG_VERSION_UNSUPPORTED',
  'DWG_CONVERTED_SIZE_LIMIT_EXCEEDED',
  'DWG_CONVERSION_FAILED',
  'PARSER_EMPTY_RESULT',
  'TIKA_RESPONSE_LIMIT_EXCEEDED',
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
        if (
          result.preview &&
          result.preview.storageKey !== `${validatedRequest.documentId}.${result.preview.kind}`
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

  private statusError(response: Response): ParserError {
    const status = response.status;
    if (status === 401 || status === 403) return new ParserError('authentication', false);
    if ([400, 404, 413, 415, 422].includes(status)) {
      const workerCode = response.headers.get('x-parser-error-code');
      return new ParserError('invalid_request', false, {
        ...(workerCode && SAFE_WORKER_ERROR_CODES.has(workerCode) ? { code: workerCode } : {}),
      });
    }
    if (status === 408 || status === 504) return new ParserError('timeout', true);
    if (status === 429 || status >= 500) return new ParserError('unavailable', true);
    return new ParserError('invalid_response', false);
  }

  private workerUrl(request: ParseRequest): string {
    return extname(request.storagePath).toLowerCase() === '.dwg'
      ? this.config.values.PARSER_DWG_WORKER_URL
      : this.config.values.PARSER_WORKER_URL;
  }
}
