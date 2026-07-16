import { ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiException } from './api-exception';
import { ProviderError } from '../providers/embedding/provider-error';
import { VectorStoreError } from '../vector-store/vector-store-error';

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const response = context.getResponse<FastifyReply>();
    const externalStatus =
      typeof exception === 'object' &&
      exception !== null &&
      'statusCode' in exception &&
      typeof exception.statusCode === 'number'
        ? exception.statusCode
        : undefined;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : exception instanceof ProviderError
          ? this.providerStatus(exception)
          : exception instanceof VectorStoreError
            ? this.vectorStoreStatus(exception)
            : externalStatus && externalStatus >= 400 && externalStatus < 500
              ? externalStatus
              : HttpStatus.INTERNAL_SERVER_ERROR;
    const code =
      exception instanceof ApiException
        ? exception.code
        : exception instanceof ProviderError
          ? exception.code
          : exception instanceof VectorStoreError
            ? exception.code
            : this.isUploadLimitError(exception)
              ? 'FILE_TOO_LARGE'
              : status >= 500
                ? 'INTERNAL_ERROR'
                : 'REQUEST_FAILED';
    const message =
      status >= 500
        ? exception instanceof ProviderError
          ? exception.safeMessage
          : exception instanceof VectorStoreError
            ? exception.safeMessage
            : '服务暂时不可用，请稍后重试'
        : this.isUploadLimitError(exception)
          ? '文件超过大小限制'
          : exception instanceof ProviderError
            ? exception.safeMessage
            : exception instanceof VectorStoreError
              ? exception.safeMessage
              : this.getSafeMessage(exception);

    if (status >= 500) request.log.error({ err: exception, traceId: request.id }, 'request failed');
    void response.status(status).send({
      error: { code, message, traceId: request.id },
    });
  }

  private getSafeMessage(exception: unknown): string {
    if (!(exception instanceof HttpException)) return '请求失败';
    const body: unknown = exception.getResponse();
    if (typeof body === 'string') return body;
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = body.message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message))
        return message.filter((value) => typeof value === 'string').join('; ');
    }
    return '请求失败';
  }

  private isUploadLimitError(exception: unknown): boolean {
    return (
      typeof exception === 'object' &&
      exception !== null &&
      'code' in exception &&
      exception.code === 'FST_REQ_FILE_TOO_LARGE'
    );
  }

  private providerStatus(error: ProviderError): number {
    if (error.kind === 'policy_denied') return HttpStatus.FORBIDDEN;
    if (error.kind === 'timeout') return HttpStatus.GATEWAY_TIMEOUT;
    if (error.kind === 'invalid_request' || error.kind === 'invalid_response') {
      return HttpStatus.BAD_GATEWAY;
    }
    return HttpStatus.SERVICE_UNAVAILABLE;
  }

  private vectorStoreStatus(error: VectorStoreError): number {
    if (error.kind === 'invalid_input') return HttpStatus.BAD_REQUEST;
    if (error.kind === 'invalid_response') return HttpStatus.BAD_GATEWAY;
    return HttpStatus.SERVICE_UNAVAILABLE;
  }
}
