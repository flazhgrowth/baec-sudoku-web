/**
 * Reference implementation of the account rules described in the "Auth" section of
 * the backend API doc: username + password, register with no verification of any kind. Pure
 * functions over an AuthStore; the caller supplies `now` and id/token/salt generators, mirroring
 * src/mock/engine.ts.
 *
 * SECURITY NOTE: `hashPassword` below is a fast, non-cryptographic hash, used only so this
 * in-browser mock doesn't keep raw passwords sitting in localStorage. It is NOT safe. A real
 * backend must hash passwords with bcrypt, argon2 or scrypt — a slow, salted, purpose-built
 * algorithm — and must never log or otherwise persist the plaintext password.
 */
import { ApiError } from '../api/errors';
import type { LoginRequest, RegisterRequest, User } from '../api/auth';

export interface StoredUser {
  id: string;
  /** Always lowercase, like the backend. */
  username: string;
  /** Lowercased, for case-insensitive lookup and uniqueness. */
  usernameKey: string;
  passwordHash: string;
  salt: string;
  created_at: string;
}

export interface AuthStore {
  users: StoredUser[];
  /** token -> user_id */
  tokens: Record<string, string>;
}

export interface AuthOptions {
  newId: () => string;
  newToken: () => string;
  newSalt: () => string;
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 72;

/** Not cryptographically secure. See the file header. */
export function hashPassword(password: string, salt: string): string {
  const input = salt + password;
  let h = 2166136261; // FNV-1a offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // A few extra mixing rounds so short inputs don't map to a near-trivial hash.
  for (let round = 0; round < 1000; round++) h = Math.imul(h ^ (h >>> 15), 2246822519);
  return (h >>> 0).toString(16).padStart(8, '0');
}

const iso = (ms: number) => new Date(ms).toISOString();
const toPublicUser = (u: StoredUser): User => ({ id: u.id, username: u.username, created_at: u.created_at });

function validatePassword(password: unknown) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw new ApiError(422, 'VALIDATION_ERROR', `password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters`);
  }
}

function validate(req: { username: unknown; password: unknown }) {
  if (typeof req.username !== 'string' || !USERNAME_RE.test(req.username)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'username must be 3-20 letters, digits or underscores');
  }
  validatePassword(req.password);
}

export function registerUser(
  store: AuthStore,
  req: RegisterRequest,
  now: number,
  opts: AuthOptions,
): { user: User; token: string } {
  validate(req);
  const usernameKey = req.username.toLowerCase();
  if (store.users.some((u) => u.usernameKey === usernameKey)) {
    throw new ApiError(409, 'conflict', '');
  }
  const salt = opts.newSalt();
  const user: StoredUser = {
    id: opts.newId(),
    username: usernameKey, // the backend stores and returns usernames lowercased
    usernameKey,
    passwordHash: hashPassword(req.password, salt),
    salt,
    created_at: iso(now),
  };
  store.users.push(user);
  const token = opts.newToken();
  store.tokens[token] = user.id;
  return { user: toPublicUser(user), token };
}

export function loginUser(store: AuthStore, req: LoginRequest, opts: AuthOptions): { user: User; token: string } {
  if (typeof req.username !== 'string' || typeof req.password !== 'string' || !req.username || !req.password) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'username and password are required');
  }
  const usernameKey = req.username.toLowerCase();
  const user = store.users.find((u) => u.usernameKey === usernameKey);
  // Same error whether the username is unknown or the password is wrong: don't reveal which.
  if (!user || hashPassword(req.password, user.salt) !== user.passwordHash) {
    throw new ApiError(401, 'invalid_credentials', 'Incorrect username or password');
  }
  const token = opts.newToken();
  store.tokens[token] = user.id;
  return { user: toPublicUser(user), token };
}

export function getUserByToken(store: AuthStore, token: string | undefined): User {
  const user_id = token ? store.tokens[token] : undefined;
  const user = user_id ? store.users.find((u) => u.id === user_id) : undefined;
  if (!user) throw new ApiError(401, 'INVALID_TOKEN', 'Missing or invalid auth token');
  return toPublicUser(user);
}

/** Idempotent: logging out twice, or a token that's already gone, is not an error. */
export function logoutUser(store: AuthStore, token: string) {
  delete store.tokens[token];
}

/** Like the backend: no current password needed, and existing tokens stay valid. */
export function changePassword(store: AuthStore, token: string | undefined, password: string) {
  const user_id = token ? store.tokens[token] : undefined;
  const user = user_id ? store.users.find((u) => u.id === user_id) : undefined;
  if (!user) throw new ApiError(401, 'INVALID_TOKEN', 'Missing or invalid auth token');
  if (typeof password !== 'string' || !password) throw new ApiError(400, 'password_mandatory', 'password is required');
  validatePassword(password);
  user.salt = `${user.salt}~`;
  user.passwordHash = hashPassword(password, user.salt);
}
