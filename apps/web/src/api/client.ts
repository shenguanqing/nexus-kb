import { z } from 'zod';

import { bearerAccessToken, expireBearerAccessToken } from '@/auth/oidc';

const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), traceId: z.string().optional() }),
});

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly traceId: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: { Accept: 'application/json', ...authorizationHeader(), ...init.headers },
      signal: controller.signal,
    });
    if (response.status === 401) expireBearerAccessToken();
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(payload);
      throw new ApiError(
        response.status,
        parsed.success ? parsed.data.error.code : 'HTTP_ERROR',
        parsed.success ? parsed.data.error.message : '请求失败，请稍后重试',
        parsed.success ? (parsed.data.error.traceId ?? null) : null,
      );
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success)
      throw new ApiError(502, 'INVALID_API_RESPONSE', '服务响应格式不正确', null);
    return parsed.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(504, 'REQUEST_TIMEOUT', '请求超时，请稍后重试', null);
    }
    throw new ApiError(0, 'NETWORK_ERROR', '网络连接失败，请检查连接后重试', null);
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function apiTextRequest(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<string> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'text/plain, text/markdown;q=0.9',
        ...authorizationHeader(),
        ...init.headers,
      },
      signal: controller.signal,
    });
    if (response.status === 401) expireBearerAccessToken();
    const body = await response.text();
    if (!response.ok) {
      let payload: unknown = null;
      try {
        payload = JSON.parse(body) as unknown;
      } catch {
        // A non-JSON upstream error is intentionally reduced to a generic message.
      }
      const parsed = apiErrorSchema.safeParse(payload);
      throw new ApiError(
        response.status,
        parsed.success ? parsed.data.error.code : 'HTTP_ERROR',
        parsed.success ? parsed.data.error.message : '请求失败，请稍后重试',
        parsed.success ? (parsed.data.error.traceId ?? null) : null,
      );
    }
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(504, 'REQUEST_TIMEOUT', '请求超时，请稍后重试', null);
    }
    throw new ApiError(0, 'NETWORK_ERROR', '网络连接失败，请检查连接后重试', null);
  } finally {
    window.clearTimeout(timeout);
  }
}

export function apiUploadRequest<T>(
  path: string,
  body: FormData,
  schema: z.ZodType<T>,
  onProgress: (percentage: number) => void,
  timeoutMs = 120_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', path);
    request.withCredentials = true;
    request.timeout = timeoutMs;
    request.setRequestHeader('Accept', 'application/json');
    const token = bearerAccessToken();
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    request.addEventListener('load', () => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(request.responseText) as unknown;
      } catch {
        // Invalid JSON is reduced to the same safe response error used by fetch requests.
      }
      if (request.status === 401) expireBearerAccessToken();
      if (request.status < 200 || request.status >= 300) {
        const parsedError = apiErrorSchema.safeParse(payload);
        reject(
          new ApiError(
            request.status,
            parsedError.success ? parsedError.data.error.code : 'HTTP_ERROR',
            parsedError.success ? parsedError.data.error.message : '请求失败，请稍后重试',
            parsedError.success ? (parsedError.data.error.traceId ?? null) : null,
          ),
        );
        return;
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        reject(new ApiError(502, 'INVALID_API_RESPONSE', '服务响应格式不正确', null));
        return;
      }
      resolve(parsed.data);
    });
    request.addEventListener('timeout', () => {
      reject(new ApiError(504, 'REQUEST_TIMEOUT', '请求超时，请稍后重试', null));
    });
    request.addEventListener('error', () => {
      reject(new ApiError(0, 'NETWORK_ERROR', '网络连接失败，请检查连接后重试', null));
    });
    request.send(body);
  });
}

function authorizationHeader(): HeadersInit {
  const token = bearerAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
