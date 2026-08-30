import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Reflector } from '@nestjs/core';

import { ApiException } from '../common/api-exception';
import { AppConfig } from '../config/app-config';
import type { AuthenticatedRequest, Identity } from './identity';
import { developmentIdentity } from './identity';
import { IS_PUBLIC_ROUTE } from './public.decorator';
import { TOKEN_VERIFIER } from './token-verifier';
import type { TokenVerifier } from './token-verifier';
import { UserDirectoryService } from '../access/user-directory.service';
import { PasswordAuthService } from './password-auth.service';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly config: AppConfig,
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly tokenVerifier: TokenVerifier,
    @Optional() private readonly users?: UserDirectoryService,
    @Optional() private readonly passwordAuth?: PasswordAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>() as AuthenticatedRequest;
    if (this.config.values.PASSWORD_AUTH_ENABLED) {
      if (!this.passwordAuth) {
        throw new ApiException('AUTH_CONFIGURATION_INVALID', '认证服务未正确初始化', 503);
      }
      request.identity = await this.resolve(
        await this.passwordAuth.identityFromCookie(request.headers.cookie),
      );
      return true;
    }
    if (!this.config.values.AUTH_REQUIRED) {
      if (!['development', 'test'].includes(this.config.values.NODE_ENV)) {
        throw new ApiException('AUTH_CONFIGURATION_INVALID', '认证配置不安全', 503);
      }
      request.identity = await this.resolve(developmentIdentity(this.config));
      return true;
    }
    const token = this.bearerToken(request.headers.authorization);
    try {
      request.identity = await this.resolve(await this.tokenVerifier.verify(token));
      return true;
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw new ApiException('TOKEN_INVALID', '身份凭证无效或已过期', 401);
    }
  }

  private async resolve(identity: Identity): Promise<Identity> {
    return this.users ? this.users.resolve(identity) : identity;
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
