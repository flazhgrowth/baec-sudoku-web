import { useCallback, useEffect, useState } from 'react';
import { ApiError, authApi, type LoginRequest, type RegisterRequest, type User } from '../api';

const AUTH_KEY = 'sudoku.auth';

interface Stored {
  user: User;
  token: string;
}

// localStorage, not sessionStorage: being logged in is a browser-wide, reload-surviving thing,
// unlike a single game's session (see hooks/useGame.ts). One consequence: two tabs of the same
// browser share one login, so testing an online game as two different accounts needs two browser
// profiles (or one profile + one incognito window), not just two tabs.
const storage = {
  get(): Stored | null {
    try {
      return JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null');
    } catch {
      return null;
    }
  },
  set(value: Stored | null) {
    try {
      if (value) localStorage.setItem(AUTH_KEY, JSON.stringify(value));
      else localStorage.removeItem(AUTH_KEY);
    } catch {
      /* ignore */
    }
  },
};

export function useAuth() {
  const [state, setState] = useState<Stored | null>(null);
  /** True once the initial restore-from-storage attempt has finished. */
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore a previous login, re-checking the token is still good (an account could have been
  // removed, or a mock localStorage wiped, since the token was issued).
  useEffect(() => {
    const prev = storage.get();
    if (!prev) {
      setReady(true);
      return;
    }
    authApi
      .me(prev.token)
      .then((user) => setState({ user, token: prev.token }))
      .catch((e) => {
        // Only a 401 means the token is bad. A network/server failure must not log the user out.
        if (e instanceof ApiError && e.status === 401) storage.set(null);
        else setState(prev);
      })
      .finally(() => setReady(true));
  }, []);

  const persist = useCallback((next: Stored | null) => {
    setState(next);
    storage.set(next);
  }, []);

  const run = useCallback(
    async (fn: () => Promise<Stored>) => {
      setError(null);
      setBusy(true);
      try {
        persist(await fn());
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Something went wrong');
      } finally {
        setBusy(false);
      }
    },
    [persist],
  );

  const register = useCallback((req: RegisterRequest) => run(() => authApi.register(req)), [run]);
  const login = useCallback((req: LoginRequest) => run(() => authApi.login(req)), [run]);

  const logout = useCallback(() => {
    const token = state?.token;
    persist(null);
    if (token) authApi.logout(token).catch(() => {});
  }, [state, persist]);

  return { user: state?.user ?? null, token: state?.token ?? null, ready, busy, error, register, login, logout };
}
