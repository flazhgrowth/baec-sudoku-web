import { describe, expect, it } from 'vitest';
import { createMockApi } from './mockApi';
import { createMockAuthApi } from './mockAuthApi';
import type { GameUpdate } from './types';

/** A fresh, logged-in account. Every game action needs one. */
async function account(username: string) {
  const auth = createMockAuthApi();
  const { user, token } = await auth.register({ username, password: 'hunter22' });
  return { user, token };
}

describe('mock API, online session', () => {
  it('host creates, guest joins by code, and both see each other\'s moves', async () => {
    const api = createMockApi();
    const alex = await account('Alex');
    const sam = await account('Sam');

    const host = await api.createGame({ mode: 'versus', difficulty: 'easy', online: true }, alex.token);
    expect(host.game.status).toBe('waiting');
    expect(host.game.players[0]).toMatchObject({ name: 'alex', user_id: alex.user.id });
    const code = host.game.join_code!;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);

    const hostUpdates: GameUpdate[] = [];
    const stopHost = api.subscribe(host.game.id, host.credentials[0].token, (u) => hostUpdates.push(u));
    expect(hostUpdates[0].game.status).toBe('waiting');

    await expect(api.joinGame({ code: 'ZZZZZZ' }, sam.token)).rejects.toMatchObject({ code: 'JOIN_CODE_NOT_FOUND' });
    await expect(api.joinGame({ code }, 'not-a-real-token')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    const guest = await api.joinGame({ code: code.toLowerCase() }, sam.token);
    expect(guest.game).toMatchObject({ status: 'in_progress', join_code: null });
    expect(guest.game.players[1]).toMatchObject({ name: 'sam', user_id: sam.user.id });
    expect(guest.credentials).toHaveLength(1);
    expect(guest.credentials[0].player_id).toBe('p2');

    // host was told the game started
    const started = hostUpdates.at(-1)!;
    expect(started.game.status).toBe('in_progress');
    expect(started.events).toEqual([{ type: 'player_joined', player_id: 'p2' }]);
    await expect(api.joinGame({ code }, sam.token)).rejects.toMatchObject({ code: 'JOIN_CODE_NOT_FOUND' });

    const guestUpdates: GameUpdate[] = [];
    const stopGuest = api.subscribe(guest.game.id, guest.credentials[0].token, (u) => guestUpdates.push(u));

    const { game } = started;
    const row = game.board.findIndex((r) => r.includes(0));
    const col = game.board[row].indexOf(0);

    await expect(
      api.submitMove(game.id, guest.credentials[0].token, { row, col, value: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_YOUR_TURN' });

    // host plays a (probably wrong) number; either way the guest must hear about it
    const res = await api.submitMove(game.id, host.credentials[0].token, { row, col, value: 1 });
    const seen = guestUpdates.at(-1)!;
    expect(seen.game.version).toBe(res.game.version);
    expect(seen.events[0]).toMatchObject({ type: 'move', player_id: 'p1', row, col, value: 1, result: res.result });
    expect(seen.game.current_turn?.player_id).toBe('p2');

    const bad = await api.forfeit(game.id, guest.credentials[0].token);
    expect(bad.game).toMatchObject({ status: 'completed', winner_id: 'p1', end_reason: 'forfeit' });
    expect(hostUpdates.at(-1)!.game.status).toBe('completed');

    stopHost();
    stopGuest();
  });

  it('rejects an unknown token on subscribe', async () => {
    const api = createMockApi();
    const { token } = await account('Robin');
    const host = await api.createGame({ mode: 'versus', difficulty: 'easy', online: true }, token);
    const errors: Error[] = [];
    const stop = api.subscribe(host.game.id, 'wrong', () => {}, (e) => errors.push(e));
    expect(errors).toHaveLength(1);
    stop();
  });

  it('requires a valid account to create or join a game', async () => {
    const api = createMockApi();
    await expect(api.createGame({ mode: 'single', difficulty: 'easy' }, 'nope')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
    const { token } = await account('Casey');
    const host = await api.createGame({ mode: 'versus', difficulty: 'easy', online: true }, token);
    await expect(api.joinGame({ code: host.game.join_code! }, 'nope')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('a same-device versus game attributes only the host to an account', async () => {
    const api = createMockApi();
    const { user, token } = await account('Jamie');
    const { game } = await api.createGame(
      { mode: 'versus', difficulty: 'easy', player_names: ['ignored for the host', 'Guest Two'] },
      token,
    );
    expect(game.players[0]).toMatchObject({ name: 'jamie', user_id: user.id });
    expect(game.players[1]).toMatchObject({ name: 'Guest Two', user_id: null });
  });
});
