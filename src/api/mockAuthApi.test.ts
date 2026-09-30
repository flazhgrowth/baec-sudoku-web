import { describe, expect, it } from 'vitest';
import { createMockAuthApi, resolveUserFromToken } from './mockAuthApi';

// Every test picks its own username: the mock's "localStorage" is really a module-level variable
// (see mockAuthApi.ts), so it's shared by every test in this file, not reset between them.

describe('mock AuthApi', () => {
  it('registers, resolves via me(), and logs back in', async () => {
    const auth = createMockAuthApi();
    const registered = await auth.register({ username: 'Alex', password: 'hunter22' });
    expect(registered.user.username).toBe('alex');

    const me = await auth.me(registered.token);
    expect(me).toEqual(registered.user);

    const loggedIn = await auth.login({ username: 'alex', password: 'hunter22' });
    expect(loggedIn.user).toEqual(registered.user);
  });

  it('rejects a duplicate username and bad credentials', async () => {
    const auth = createMockAuthApi();
    await auth.register({ username: 'Blair', password: 'hunter22' });
    await expect(auth.register({ username: 'Blair', password: 'anotherOne' })).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(auth.login({ username: 'Blair', password: 'wrong' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('changePassword swaps the password and keeps the token valid', async () => {
    const auth = createMockAuthApi();
    const { token } = await auth.register({ username: 'Emery', password: 'hunter22' });
    await expect(auth.changePassword(token, '')).rejects.toMatchObject({ code: 'password_mandatory' });
    await expect(auth.changePassword(token, '123')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(auth.changePassword('nope', 'newpass22')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    await auth.changePassword(token, 'newpass22');
    await expect(auth.me(token)).resolves.toMatchObject({ username: 'emery' });
    await expect(auth.login({ username: 'emery', password: 'hunter22' })).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(auth.login({ username: 'emery', password: 'newpass22' })).resolves.toMatchObject({ user: { username: 'emery' } });
  });

  it('logout invalidates the token', async () => {
    const auth = createMockAuthApi();
    const { token } = await auth.register({ username: 'Casey', password: 'hunter22' });
    await auth.logout(token);
    await expect(auth.me(token)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('resolveUserFromToken never throws, and reflects the same store', async () => {
    const auth = createMockAuthApi();
    expect(resolveUserFromToken(undefined)).toBeNull();
    expect(resolveUserFromToken('garbage')).toBeNull();
    const { user, token } = await auth.register({ username: 'Drew', password: 'hunter22' });
    expect(resolveUserFromToken(token)).toEqual({ id: user.id, name: user.username });
  });
});
