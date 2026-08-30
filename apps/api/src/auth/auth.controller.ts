import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  authLoginOptionsSchema,
  passwordLoginRequestSchema,
  type AuthLoginOptions,
  type AuthSession,
} from '@nexus-kb/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppConfig } from '../config/app-config';
import { UserDirectoryService } from '../access/user-directory.service';
import { requestIdentity } from './identity';
import { Public } from './public.decorator';
import { PasswordAuthService } from './password-auth.service';
import { ApiException } from '../common/api-exception';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly config: AppConfig,
    private readonly users: UserDirectoryService,
    private readonly passwordAuth: PasswordAuthService,
  ) {}

  @Public()
  @Get('login-options')
  loginOptions(): AuthLoginOptions {
    return authLoginOptionsSchema.parse({
      mode: this.mode(),
      passwordEnabled: this.config.values.PASSWORD_AUTH_ENABLED,
      oidc: this.oidcLoginOptions(),
    });
  }

  @Public()
  @Post('password/login')
  @HttpCode(200)
  async loginWithPassword(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSession> {
    const parsed = passwordLoginRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new ApiException('LOGIN_REQUEST_INVALID', '账号或密码格式不合法', 400);
    const result = await this.passwordAuth.login(
      parsed.data.username,
      parsed.data.password,
      request.ip,
    );
    const identity = await this.users.resolve(result.identity);
    await this.users.observe(identity);
    reply.header('set-cookie', this.passwordAuth.sessionCookie(result.token));
    return this.session(identity);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ loggedOut: true }> {
    await this.passwordAuth.logout(request.headers.cookie);
    reply.header('set-cookie', this.passwordAuth.clearedSessionCookie());
    return { loggedOut: true };
  }

  @Get('session')
  async getSession(@Req() request: FastifyRequest): Promise<AuthSession> {
    const identity = requestIdentity(request);
    await this.users.observe(identity);
    return this.session(identity);
  }

  private session(identity: ReturnType<typeof requestIdentity>): AuthSession {
    return {
      authenticated: true,
      mode: this.mode(),
      identity: {
        ...identity,
        roles: [...identity.roles],
        allowedSensitivities: [...identity.allowedSensitivities],
        capabilities: [...identity.capabilities],
      },
    };
  }

  private mode(): AuthSession['mode'] {
    if (this.config.values.PASSWORD_AUTH_ENABLED) return 'password';
    return this.config.values.AUTH_REQUIRED ? 'oidc' : 'development';
  }

  private oidcLoginOptions(): AuthLoginOptions['oidc'] {
    if (this.mode() !== 'oidc') return null;
    const environment = this.config.values;
    return {
      authorizationEndpoint: environment.OIDC_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: environment.OIDC_TOKEN_ENDPOINT,
      clientId: environment.OIDC_CLIENT_ID,
      redirectUri: environment.OIDC_REDIRECT_URI,
      scopes: [...environment.OIDC_SCOPES_JSON],
    };
  }
}
