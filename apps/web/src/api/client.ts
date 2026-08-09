import { z } from 'zod';

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
      headers: { Accept: 'application/json', ...init.headers },
      signal: controller.signal,
    });
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
      headers: { Accept: 'text/plain, text/markdown;q=0.9', ...init.headers },
      signal: controller.signal,
    });
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
