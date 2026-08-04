import { Injectable, type OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { ApiException } from '../common/api-exception';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { ADMIN_CAPABILITIES, isAdmin, normalizeAppRoles } from './app-role';
import { SENSITIVITIES, type Identity } from './identity';
import {
  createPasswordDigest,
  randomPasswordDigest,
  verifyPasswordDigest,
  type PasswordDigest,
} from './password-digest';

const sessionCookieName = 'nexuskb_session';

interface LoginAttempt {
  count: number;
  resetAt: number;
}

export interface PasswordLoginResult {
  identity: Identity;
  token: string;
  expiresAt: Date;
}

@Injectable()
export class PasswordAuthService implements OnModuleInit {
  private readonly attempts = new Map<string, LoginAttempt>();
  private fallbackPassword: PasswordDigest | null = null;
  private initialization: Promise<void> | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.values.PASSWORD_AUTH_ENABLED) await this.initialize();
  }

  async login(username: string, password: string, clientIp: string): Promise<PasswordLoginResult> {
    this.assertEnabled();
    await this.initialize();
    const attempt = this.currentAttempt(clientIp);
    if (attempt && attempt.count >= this.config.values.PASSWORD_AUTH_MAX_ATTEMPTS) {
      throw new ApiException('LOGIN_RATE_LIMITED', '登录尝试过于频繁，请稍后重试', 429);
    }

    const account = await this.prisma.userDirectoryEntry.findUnique({
      where: { username: this.normalizeUsername(username) },
    });
    const digestSource =
      account?.authSource === 'password' &&
      account.enabled &&
      account.passwordSalt &&
      account.passwordDigest
        ? { salt: Buffer.from(account.passwordSalt), digest: Buffer.from(account.passwordDigest) }
        : this.fallbackPassword!;
    const isValid = await verifyPasswordDigest(password, digestSource);
    if (!account || account.authSource !== 'password' || !account.enabled || !isValid) {
      this.recordFailedAttempt(clientIp);
      throw new ApiException('LOGIN_FAILED', '账号或密码错误', 401);
    }
    this.attempts.delete(clientIp);

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.config.values.PASSWORD_AUTH_SESSION_TTL_SECONDS * 1000,
    );
    await this.prisma.passwordAuthSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await this.prisma.passwordAuthSession.create({
      data: {
        id: randomUUID(),
        tokenHash: this.tokenHash(token),
        tenantId: account.tenantId,
        userId: account.userId,
        expiresAt,
      },
    });
    return { identity: this.identityFromAccount(account), token, expiresAt };
  }

  async identityFromCookie(cookieHeader: string | undefined): Promise<Identity> {
    this.assertEnabled();
    await this.initialize();
    const token = readCookie(cookieHeader, sessionCookieName);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new ApiException('AUTHENTICATION_REQUIRED', '需要登录后继续访问', 401);
    }
    const session = await this.prisma.passwordAuthSession.findUnique({
      where: { tokenHash: this.tokenHash(token) },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      if (session) await this.prisma.passwordAuthSession.deleteMany({ where: { id: session.id } });
      throw new ApiException('AUTHENTICATION_REQUIRED', '登录已过期，请重新登录', 401);
    }
    const account = await this.prisma.userDirectoryEntry.findUnique({
      where: { tenantId_userId: { tenantId: session.tenantId, userId: session.userId } },
    });
    if (!account || account.authSource !== 'password' || !account.enabled) {
      throw new ApiException('AUTHENTICATION_REQUIRED', '登录已失效，请重新登录', 401);
    }
    return this.identityFromAccount(account);
  }

  async logout(cookieHeader: string | undefined): Promise<void> {
    const token = readCookie(cookieHeader, sessionCookieName);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    await this.prisma.passwordAuthSession.deleteMany({
      where: { tokenHash: this.tokenHash(token) },
    });
  }

  sessionCookie(token: string): string {
    const secure = this.config.values.NODE_ENV === 'production' ? '; Secure' : '';
    return `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${this.config.values.PASSWORD_AUTH_SESSION_TTL_SECONDS}${secure}`;
  }

  clearedSessionCookie(): string {
    const secure = this.config.values.NODE_ENV === 'production' ? '; Secure' : '';
    return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
  }

  private async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initializeAccounts();
    }
    await this.initialization;
  }

  private async initializeAccounts(): Promise<void> {
    this.fallbackPassword = await randomPasswordDigest();
    const bootstrap = await this.prisma.passwordAuthBootstrap.findUnique({
      where: { id: 'password-auth-env-bootstrap-v1' },
    });
    if (bootstrap) return;
    for (const user of this.config.values.PASSWORD_AUTH_USERS_JSON) {
      const existing = await this.prisma.userDirectoryEntry.findUnique({
        where: { username: this.normalizeUsername(user.username) },
      });
      const digest = await createPasswordDigest(user.password);
      if (existing) continue;
      const existingIdentity = await this.prisma.userDirectoryEntry.findUnique({
        where: { tenantId_userId: { tenantId: user.tenantId, userId: user.userId } },
      });
      if (existingIdentity) {
        await this.prisma.userDirectoryEntry.update({
          where: { tenantId_userId: { tenantId: user.tenantId, userId: user.userId } },
          data: {
            username: this.normalizeUsername(user.username),
            authSource: 'password',
            passwordSalt: Uint8Array.from(digest.salt),
            passwordDigest: Uint8Array.from(digest.digest),
            enabled: true,
            allowedSensitivities: [...new Set(user.allowedSensitivities)],
            defaultSensitivity: user.defaultSensitivity,
          },
        });
        continue;
      }
      await this.prisma.userDirectoryEntry.create({
        data: {
          tenantId: user.tenantId,
          userId: user.userId,
          username: this.normalizeUsername(user.username),
          department: user.department,
          roles: normalizeAppRoles(user.roles),
          allowedSensitivities: [...new Set(user.allowedSensitivities)],
          defaultSensitivity: user.defaultSensitivity,
          authSource: 'password',
          passwordSalt: Uint8Array.from(digest.salt),
          passwordDigest: Uint8Array.from(digest.digest),
          enabled: true,
          lastAuthenticatedAt: new Date(),
        },
      });
    }
    await this.prisma.passwordAuthBootstrap.create({
      data: { id: 'password-auth-env-bootstrap-v1' },
    });
  }

  private identityFromAccount(account: {
    tenantId: string;
    userId: string;
    department: string;
    roles: unknown;
    managedRoles: unknown;
    allowedSensitivities: unknown;
    defaultSensitivity: string | null;
  }): Identity {
    const roles = normalizeAppRoles(this.stringArray(account.managedRoles ?? account.roles));
    const allowedSensitivities = isAdmin(roles)
      ? [...SENSITIVITIES]
      : this.sensitivities(account.allowedSensitivities);
    return {
      tenantId: account.tenantId,
      userId: account.userId,
      department: account.department,
      roles,
      allowedSensitivities,
      capabilities: isAdmin(roles)
        ? [...ADMIN_CAPABILITIES]
        : ['documents:read', 'documents:write'],
      defaultSensitivity: allowedSensitivities.includes(
        account.defaultSensitivity as Identity['defaultSensitivity'],
      )
        ? (account.defaultSensitivity as Identity['defaultSensitivity'])
        : allowedSensitivities[0]!,
    };
  }

  private currentAttempt(clientIp: string): LoginAttempt | undefined {
    const attempt = this.attempts.get(clientIp);
    if (attempt && attempt.resetAt <= Date.now()) {
      this.attempts.delete(clientIp);
      return undefined;
    }
    return attempt;
  }

  private recordFailedAttempt(clientIp: string): void {
    const current = this.currentAttempt(clientIp);
    this.attempts.set(clientIp, {
      count: (current?.count ?? 0) + 1,
      resetAt:
        current?.resetAt ?? Date.now() + this.config.values.PASSWORD_AUTH_WINDOW_SECONDS * 1000,
    });
  }

  private assertEnabled(): void {
    if (!this.config.values.PASSWORD_AUTH_ENABLED) {
      throw new ApiException('PASSWORD_LOGIN_DISABLED', '当前环境未启用账号密码登录', 404);
    }
  }

  private normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private sensitivities(value: unknown): Identity['allowedSensitivities'] {
    const values = this.stringArray(value).filter(
      (item): item is Identity['allowedSensitivities'][number] =>
        (SENSITIVITIES as readonly string[]).includes(item),
    );
    return values.length > 0 ? [...new Set(values)] : ['internal'];
  }

  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const item of header.split(';')) {
    const [key, ...value] = item.trim().split('=');
    if (key === name) return value.join('=') || null;
  }
  return null;
}
