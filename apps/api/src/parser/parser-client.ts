import { Injectable } from '@nestjs/common';
import { parseRequestSchema, parseResponseSchema } from '@nexus-kb/contracts';
import type { ParseRequest, ParseResponse } from '@nexus-kb/contracts';

import { AppConfig } from '../config/app-config';
import { ParserError } from './parser-error';

@Injectable()
export class ParserClient {
  constructor(private readonly config: AppConfig) {}

  async parse(request: ParseRequest, traceId: string): Promise<ParseResponse> {
    const validatedRequest = parseRequestSchema.parse(request);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.values.PARSER_REQUEST_TIMEOUT_MS,
    );
    try {
      let response: Response;
      try {
        response = await fetch(
          new URL('/internal/v1/parse', this.config.values.PARSER_WORKER_URL),
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
          throw new ParserError('timeout', true, { cause: error });
        }
        throw new ParserError('unavailable', true, { cause: error });
      }
      if (!response.ok) throw this.statusError(response.status);
      try {
        return parseResponseSchema.parse(await response.json());
      } catch (error) {
        throw new ParserError('invalid_response', false, { cause: error });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private statusError(status: number): ParserError {
    if (status === 401 || status === 403) return new ParserError('authentication', false);
    if ([400, 404, 413, 415, 422].includes(status)) {
      return new ParserError('invalid_request', false);
    }
    if (status === 408 || status === 504) return new ParserError('timeout', true);
    if (status === 429 || status >= 500) return new ParserError('unavailable', true);
    return new ParserError('invalid_response', false);
  }
}
