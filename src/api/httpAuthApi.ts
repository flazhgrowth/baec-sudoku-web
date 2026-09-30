import { ApiError } from './errors';
import { createRequest } from './http';
import type { AuthApi, AuthSession, User } from './auth';

/** What register and login put in the envelope's `data`. Flat: there is no nested `user`. */
interface AccountData {
  id: string;
  username: string;
  token: string;
  /** Returned but unusable: no endpoint accepts it. */
  refresh_token: string;
}

const toSession = (d: AccountData): AuthSession => ({ user: { id: d.id, username: d.username }, token: d.token });

/** The backend's account messages are empty or inconsistent (it says to key off `code`), so word them here. */
async function friendly<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'conflict') throw new ApiError(e.status, e.code, 'That username is already taken');
    if (e instanceof ApiError && e.code === 'invalid_credentials') throw new ApiError(e.status, e.code, 'Incorrect username or password');
    throw e;
  }
}

export function createHttpAuthApi(baseUrl: string): AuthApi {
  const request = createRequest(baseUrl);

  return {
    register: async (req) => toSession(await friendly(request<AccountData>('POST', '/auth/register', { body: req }))),
    login: async (req) => toSession(await friendly(request<AccountData>('POST', '/auth/login', { body: req }))),
    me: (token) => request<User>('GET', '/auth/me', { authToken: token }),
    logout: (token) => request<void>('POST', '/auth/logout', { authToken: token }),
  };
}
