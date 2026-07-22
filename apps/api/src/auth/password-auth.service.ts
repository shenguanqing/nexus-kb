import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

import { ApiException } from '../common/api-exception';
import { AppConfig, type Environment } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import type { Identity } from './identity';

const sessionCookieName = 'nexuskb_session';

interface PasswordDigest {
  digest: Buffer;
  salt: Buffer;
}
interface PasswordAccount extends PasswordDigest {
  identity: Identity;
}

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
  private readonly accounts = new Map<string, PasswordAccount>();
  private readonly accountsByIdentity = new Map<string, PasswordAccount>();
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

    const account = this.accounts.get(this.normalizeUsername(username));
    const isValid = await this.verifyPassword(password, account ?? this.fallbackPassword!);
    if (!account || !isValid) {
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
        tenantId: account.identity.tenantId,
        userId: account.identity.userId,
        expiresAt,
      },
    });
    return { identity: account.identity, token, expiresAt };
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
    const account = this.accountsByIdentity.get(this.identityKey(session.tenantId, session.userId));
    if (!account) {
      throw new ApiException('AUTHENTICATION_REQUIRED', '登录已失效，请重新登录', 401);
    }
    return account.identity;
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
    const fallbackSalt = randomBytes(16);
    this.fallbackPassword = {
      salt: fallbackSalt,
      digest: await this.passwordDigest(randomBytes(32).toString('base64url'), fallbackSalt),
    };
    for (const user of this.config.values.PASSWORD_AUTH_USERS_JSON) {
      const salt = randomBytes(16);
      const digest = await this.passwordDigest(user.password, salt);
      const account: PasswordAccount = {
        identity: this.identityFromAccount(user),
        digest,
        salt,
      };
      this.accounts.set(this.normalizeUsername(user.username), account);
      this.accountsByIdentity.set(
        this.identityKey(account.identity.tenantId, account.identity.userId),
        account,
      );
    }
  }

  private identityFromAccount(account: Environment['PASSWORD_AUTH_USERS_JSON'][number]): Identity {
    return {
      tenantId: account.tenantId,
      userId: account.userId,
      department: account.department,
      roles: [...new Set(account.roles)],
      allowedSensitivities: [...new Set(account.allowedSensitivities)],
      capabilities: [...new Set(account.capabilities)],
      defaultSensitivity: account.defaultSensitivity,
    };
  }

  private async verifyPassword(password: string, digestSource: PasswordDigest): Promise<boolean> {
    const digest = await this.passwordDigest(password, digestSource.salt);
    return (
      digest.length === digestSource.digest.length && timingSafeEqual(digest, digestSource.digest)
    );
  }

  private passwordDigest(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scryptCallback(
        password,
        salt,
        64,
        { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
        (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
      );
    });
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

  private identityKey(tenantId: string, userId: string): string {
    return `${tenantId}\u0000${userId}`;
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
