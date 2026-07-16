import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Reflector } from '@nestjs/core';

import { ApiException } from '../common/api-exception';
import { AppConfig } from '../config/app-config';
import type { AuthenticatedRequest } from './identity';
import { developmentIdentity } from './identity';
import { IS_PUBLIC_ROUTE } from './public.decorator';
import { TOKEN_VERIFIER } from './token-verifier';
import type { TokenVerifier } from './token-verifier';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly config: AppConfig,
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly tokenVerifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>() as AuthenticatedRequest;
    if (!this.config.values.AUTH_REQUIRED) {
      if (!['development', 'test'].includes(this.config.values.NODE_ENV)) {
        throw new ApiException('AUTH_CONFIGURATION_INVALID', '认证配置不安全', 503);
      }
      request.identity = developmentIdentity(this.config);
      return true;
    }
    const token = this.bearerToken(request.headers.authorization);
    try {
      request.identity = await this.tokenVerifier.verify(token);
      return true;
    } catch {
      throw new ApiException('TOKEN_INVALID', '身份凭证无效或已过期', 401);
    }
  }

  private bearerToken(authorization: string | undefined): string {
    if (!authorization) {
      throw new ApiException('AUTHENTICATION_REQUIRED', '需要身份认证', 401);
    }
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
    if (!match?.[1]) throw new ApiException('TOKEN_INVALID', '身份凭证格式不正确', 401);
    return match[1];
  }
}
