// Mirrors the account endpoints of the backend API (baec-portfolio-api/docs/api.md, the source of truth).
//
// Deliberately separate from SudokuApi/types.ts: an account (who you are, for the future
// leaderboard) is a different concern from a per-seat game token (which player you are acting as
// in one specific game). A single account can hold both seats of a same-device versus game, but
// only ever gets one token in an online game.

export interface User {
  id: string;
  /** 3-20 letters, digits or underscores. Always lowercase: the server lowercases it on register. */
  username: string;
  /** Only present from `me`; register and login don't return it. */
  created_at?: string;
}

export interface RegisterRequest {
  username: string;
  /** 6-72 characters. No other requirement. */
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

/** From register and login (the backend's flat `{ id, username, token }`, reshaped). Send `token` as `Authorization: Bearer <token>`. */
export interface AuthSession {
  user: User;
  token: string;
}

export interface AuthApi {
  register(req: RegisterRequest): Promise<AuthSession>;
  login(req: LoginRequest): Promise<AuthSession>;
  /** Resolves the account behind a token. Used to restore a session after a reload. */
  me(token: string): Promise<User>;
  logout(token: string): Promise<void>;
}
