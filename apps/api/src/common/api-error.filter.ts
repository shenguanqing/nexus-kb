import { ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const response = context.getResponse<FastifyReply>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const code = status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
    const message = status >= 500 ? '服务暂时不可用，请稍后重试' : this.getSafeMessage(exception);

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
}
