import { Injectable } from '@nestjs/common';
import { parseRequestSchema, parseResponseSchema } from '@nexus-kb/contracts';
import type { ParseRequest, ParseResponse } from '@nexus-kb/contracts';

import { AppConfig } from '../config/app-config';

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
      const response = await fetch(
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
      if (!response.ok) throw new Error(`Parser Worker returned HTTP ${response.status}`);
      return parseResponseSchema.parse(await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }
}
