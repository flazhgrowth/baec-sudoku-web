import type { AuthApi } from './auth';
import { changePassword, getUserByToken, loginUser, logoutUser, registerUser, type AuthStore } from '../mock/authEngine';

const STORAGE_KEY = 'sudoku.mock.auth';
const EMPTY: AuthStore = { users: [], tokens: {} };

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
const randomSalt = () => `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
const opts = () => ({ newId: uid, newToken: uid, newSalt: randomSalt });

/** Shadow copy for environments without localStorage. */
let memory = JSON.stringify(EMPTY);

function read(): AuthStore {
  let raw = memory;
  try {
    raw = localStorage.getItem(STORAGE_KEY) ?? memory;
  } catch {
    /* no localStorage */
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AuthStore>;
    return { users: parsed.users ?? [], tokens: parsed.tokens ?? {} };
  } catch {
    return { users: [], tokens: {} };
  }
}

function write(store: AuthStore) {
  memory = JSON.stringify(store);
  try {
    localStorage.setItem(STORAGE_KEY, memory);
  } catch {
    /* keep the session in memory only */
  }
}

/**
 * Resolves an optional auth token to the account behind it, for the game API to attribute a
 * `Player.user_id` and default a name. Returns null for a missing or unknown token rather than
 * throwing — callers that require a valid account (creating or joining a game) turn that into
 * `401 INVALID_TOKEN` themselves.
 */
export function resolveUserFromToken(token: string | undefined): { id: string; name: string } | null {
  if (!token) return null;
  try {
    const user = getUserByToken(read(), token);
    return { id: user.id, name: user.username };
  } catch {
    return null;
  }
}

/** In-browser stand-in for the backend's accounts. Shares localStorage the same way src/api/mockApi.ts does. */
export function createMockAuthApi(): AuthApi {
  return {
    async register(req) {
      const store = read();
      const result = registerUser(store, req, Date.now(), opts());
      write(store);
      return result;
    },

    async login(req) {
      const store = read();
      const result = loginUser(store, req, opts());
      write(store);
      return result;
    },

    async me(token) {
      return getUserByToken(read(), token);
    },

    async changePassword(token, password) {
      const store = read();
      changePassword(store, token, password);
      write(store);
    },

    async logout(token) {
      const store = read();
      logoutUser(store, token);
      write(store);
    },
  };
}
