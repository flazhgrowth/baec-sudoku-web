import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import {
  getUserByToken,
  hashPassword,
  loginUser,
  logoutUser,
  registerUser,
  type AuthStore,
} from './authEngine';

const T0 = 1_000_000;

let counter = 0;
const opts = () => ({ newId: () => `id${++counter}`, newToken: () => `tok${++counter}`, newSalt: () => `salt${++counter}` });
const emptyStore = (): AuthStore => ({ users: [], tokens: {} });

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as ApiError).code;
  }
  return 'no error';
};

describe('hashPassword', () => {
  it('is deterministic and salt-sensitive', () => {
    expect(hashPassword('hunter2', 'a')).toBe(hashPassword('hunter2', 'a'));
    expect(hashPassword('hunter2', 'a')).not.toBe(hashPassword('hunter2', 'b'));
    expect(hashPassword('hunter2', 'a')).not.toBe(hashPassword('hunter3', 'a'));
  });
});

describe('registerUser', () => {
  it('creates an account and issues a token', () => {
    const store = emptyStore();
    const { user, token } = registerUser(store, { username: 'Alex', password: 'hunter22' }, T0, opts());
    expect(user).toMatchObject({ username: 'alex' });
    expect(user.id).toBeTruthy();
    expect(store.tokens[token]).toBe(user.id);
    expect(store.users[0].passwordHash).not.toBe('hunter22'); // never stored in the clear
  });

  it('rejects a taken username, case-insensitively', () => {
    const store = emptyStore();
    registerUser(store, { username: 'Alex', password: 'hunter22' }, T0, opts());
    expect(code(() => registerUser(store, { username: 'alex', password: 'somethingElse' }, T0, opts()))).toBe(
      'conflict',
    );
  });

  it('validates username and password shape', () => {
    const store = emptyStore();
    expect(code(() => registerUser(store, { username: 'ab', password: 'hunter22' }, T0, opts()))).toBe('VALIDATION_ERROR');
    expect(code(() => registerUser(store, { username: 'has space', password: 'hunter22' }, T0, opts()))).toBe(
      'VALIDATION_ERROR',
    );
    expect(code(() => registerUser(store, { username: 'Alex', password: 'short' }, T0, opts()))).toBe('VALIDATION_ERROR');
  });
});

describe('loginUser', () => {
  it('logs in with the right password and issues a fresh token', () => {
    const store = emptyStore();
    const created = registerUser(store, { username: 'Alex', password: 'hunter22' }, T0, opts());
    const logged = loginUser(store, { username: 'ALEX', password: 'hunter22' }, opts());
    expect(logged.user).toEqual(created.user);
    expect(logged.token).not.toBe(created.token);
    expect(store.tokens[created.token]).toBe(created.user.id); // the old token still works too
    expect(store.tokens[logged.token]).toBe(created.user.id);
  });

  it('gives the same error for an unknown user and a wrong password', () => {
    const store = emptyStore();
    registerUser(store, { username: 'Alex', password: 'hunter22' }, T0, opts());
    expect(code(() => loginUser(store, { username: 'Alex', password: 'wrong-password' }, opts()))).toBe(
      'invalid_credentials',
    );
    expect(code(() => loginUser(store, { username: 'nobody', password: 'hunter22' }, opts()))).toBe('invalid_credentials');
  });
});

describe('getUserByToken / logoutUser', () => {
  it('resolves a valid token and rejects an invalid or missing one', () => {
    const store = emptyStore();
    const { user, token } = registerUser(store, { username: 'Alex', password: 'hunter22' }, T0, opts());
    expect(getUserByToken(store, token)).toEqual(user);
    expect(code(() => getUserByToken(store, 'garbage'))).toBe('INVALID_TOKEN');
    expect(code(() => getUserByToken(store, undefined))).toBe('INVALID_TOKEN');
  });

  it('logout invalidates the token; logging out twice is not an error', () => {
    const store = emptyStore();
    const { token } = registerUser(store, { username: 'Alex', password: 'hunter22' }, T0, opts());
    logoutUser(store, token);
    expect(code(() => getUserByToken(store, token))).toBe('INVALID_TOKEN');
    expect(() => logoutUser(store, token)).not.toThrow();
  });
});
