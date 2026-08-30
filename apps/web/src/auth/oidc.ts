import type { OidcBrowserLogin } from '@nexus-kb/contracts';
import { z } from 'zod';

const TRANSACTION_KEY = 'nexuskb.oidc.pkce';
const TRANSACTION_MAX_AGE_MS = 10 * 60 * 1000;
export const OIDC_SESSION_EXPIRED_EVENT = 'nexuskb:oidc-session-expired';
const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1).max(16_384),
    token_type: z.string().min(1).max(32),
  })
  .passthrough();
const transactionSchema = z
  .object({
    state: z.string().min(43).max(128),
    verifier: z.string().min(43).max(128),
    returnTo: z.string().min(1).max(2048),
    createdAt: z.number().int().positive(),
  })
  .strict();

let accessToken: string | null = null;

export class OidcLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcLoginError';
  }
}

export function bearerAccessToken(): string | null {
  return accessToken;
}

export function setBearerAccessToken(token: string): void {
  accessToken = token;
}

export function clearBearerAccessToken(): void {
  accessToken = null;
}

export function expireBearerAccessToken(): void {
  if (!accessToken) return;
  accessToken = null;
  window.dispatchEvent(new Event(OIDC_SESSION_EXPIRED_EVENT));
}

export async function beginOidcLogin(options: OidcBrowserLogin, returnTo: string): Promise<void> {
  const state = randomBase64Url(32);
  const verifier = randomBase64Url(64);
  const transaction = {
    state,
    verifier,
    returnTo: safeReturnTo(returnTo),
    createdAt: Date.now(),
  };
  try {
    window.sessionStorage.setItem(TRANSACTION_KEY, JSON.stringify(transaction));
  } catch {
    throw new OidcLoginError('浏览器无法安全保存登录校验信息，请检查隐私设置后重试');
  }

  const authorizationUrl = new URL(options.authorizationEndpoint);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', options.clientId);
  authorizationUrl.searchParams.set('redirect_uri', options.redirectUri);
  authorizationUrl.searchParams.set('scope', options.scopes.join(' '));
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('code_challenge', await sha256Base64Url(verifier));
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  window.location.assign(authorizationUrl.toString());
}

export async function completeOidcLogin(
  options: OidcBrowserLogin,
  query: URLSearchParams,
): Promise<{ accessToken: string; returnTo: string }> {
  const transaction = consumeTransaction();
  const state = singleQueryValue(query, 'state');
  const code = singleQueryValue(query, 'code');
  if (query.has('error')) throw new OidcLoginError('身份服务未完成登录，请重试');
  if (!state || !code || state !== transaction.state) {
    throw new OidcLoginError('登录校验失败，请从登录页重新开始');
  }

  const token = await exchangeCode(options, code, transaction.verifier);
  return { accessToken: token, returnTo: transaction.returnTo };
}

function consumeTransaction(): z.infer<typeof transactionSchema> {
  let stored: string | null;
  try {
    stored = window.sessionStorage.getItem(TRANSACTION_KEY);
    window.sessionStorage.removeItem(TRANSACTION_KEY);
  } catch {
    throw new OidcLoginError('浏览器无法读取登录校验信息，请重新开始登录');
  }
  const parsed = transactionSchema.safeParse(stored ? parseJson(stored) : null);
  if (!parsed.success || Date.now() - parsed.data.createdAt > TRANSACTION_MAX_AGE_MS) {
    throw new OidcLoginError('登录校验已过期，请从登录页重新开始');
  }
  return parsed.data;
}

function singleQueryValue(query: URLSearchParams, key: string): string | null {
  const values = query.getAll(key);
  return values.length === 1 && values[0] ? values[0] : null;
}

async function exchangeCode(
  options: OidcBrowserLogin,
  code: string,
  verifier: string,
): Promise<string> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(options.tokenEndpoint, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: options.clientId,
        code,
        redirect_uri: options.redirectUri,
        code_verifier: verifier,
      }),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    const parsed = tokenResponseSchema.safeParse(payload);
    if (!response.ok || !parsed.success || parsed.data.token_type.toLowerCase() !== 'bearer') {
      throw new OidcLoginError('身份服务未能完成登录，请重试');
    }
    return parsed.data.access_token;
  } catch (error) {
    if (error instanceof OidcLoginError) throw error;
    throw new OidcLoginError('无法连接身份服务，请稍后重试');
  } finally {
    window.clearTimeout(timeout);
  }
}

function safeReturnTo(value: string): string {
  return value.startsWith('/') && !value.startsWith('//') ? value : '/ask';
}

function randomBase64Url(length: number): string {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
