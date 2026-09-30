import { ApiError, type ApiErrorCode } from './errors';
import type { Game } from './types';

// The backend (baec-portfolio-api/docs/api.md) answers in three shapes, see its section 3:
//   A  envelope  { code, message, data, servertime }   most endpoints; the game of a 409 is at data.game
//   B  bare      the resource itself                    GET /auth/me and each SSE message
//   C  error     { error: { code, message } }           account-token 401s only
// plus 204 with no body, and non-JSON 404/405 for unknown routes.

interface Envelope {
  code: string;
  message: string;
  data: unknown;
  servertime: number;
}

const fallback = (res: Response) => res.statusText || `Request failed (HTTP ${res.status})`;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Decodes any backend response into its payload, or throws an ApiError. */
export async function decode<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;

  const body: unknown = await res.json().catch(() => undefined);

  if (isObject(body) && isObject(body.error)) {
    const { code, message } = body.error as { code?: string; message?: string };
    throw new ApiError(res.status, (code ?? 'UNKNOWN') as ApiErrorCode, message || fallback(res));
  }

  if (isObject(body) && 'servertime' in body) {
    const env = body as unknown as Envelope;
    if (res.ok) return env.data as T;
    const game = isObject(env.data) ? (env.data.game as Game | undefined) : undefined;
    throw new ApiError(res.status, (env.code || 'UNKNOWN') as ApiErrorCode, env.message || fallback(res), game);
  }

  if (res.ok) return body as T;
  throw new ApiError(res.status, 'UNKNOWN', fallback(res));
}

export interface RequestOptions {
  body?: unknown;
  /** Account token, sent as `Authorization: Bearer`. */
  authToken?: string;
  /** Player token, sent as `X-Player-Token`. */
  playerToken?: string;
}

export function createRequest(baseUrl: string) {
  return async function request<T>(method: 'GET' | 'POST' | 'PUT', path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.authToken) headers['Authorization'] = `Bearer ${opts.authToken}`;
    if (opts.playerToken) headers['X-Player-Token'] = opts.playerToken;

    let res: Response;
    try {
      res = await fetch(baseUrl + path, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch {
      throw new ApiError(0, 'UNKNOWN', 'Cannot reach the server');
    }
    return decode<T>(res);
  };
}
