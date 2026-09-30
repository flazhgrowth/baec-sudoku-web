// Runs the real HTTP clients against a live backend. Skipped unless E2E_BASE_URL is set:
//   E2E_BASE_URL=http://127.0.0.1:12000/ms/sudous/api/v1 npx vitest run src/api/http.e2e.test.ts
import { describe, expect, it } from 'vitest';
import { createHttpApi } from './httpApi';
import { createHttpAuthApi } from './httpAuthApi';
import { ApiError } from './errors';
import type { Game, GameUpdate } from './types';

const BASE = process.env.E2E_BASE_URL;
const suffix = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'hunter2222';

async function fails(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected the call to fail');
}

/** Reads the first `update` message of the SSE stream (EventSource is not in Node). */
async function firstUpdate(gameId: string, token: string): Promise<GameUpdate> {
  const ctl = new AbortController();
  const res = await fetch(`${BASE}/games/${gameId}/events?token=${encodeURIComponent(token)}`, { signal: ctl.signal });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error('stream ended');
    text += new TextDecoder().decode(value);
    const m = text.match(/event: update\ndata: (.*)\n/);
    if (m) {
      ctl.abort();
      return JSON.parse(m[1]);
    }
  }
}

// Register/login hash passwords and the DB may sit behind a tunnel, so allow generous time per test.
describe.skipIf(!BASE)('live backend', { timeout: 60_000 }, () => {
  const auth = createHttpAuthApi(BASE!);
  const api = createHttpApi(BASE!);
  const alice = `al_${suffix}`;
  const bob = `bo_${suffix}`;
  let aliceToken = '';
  let bobToken = '';

  it('registers (lowercased), rejects duplicates and bad input, logs in, resolves me', async () => {
    const a = await auth.register({ username: alice.toUpperCase(), password: PASSWORD });
    expect(a.user.username).toBe(alice);
    aliceToken = a.token;
    bobToken = (await auth.register({ username: bob, password: PASSWORD })).token;

    expect(await fails(auth.register({ username: alice, password: PASSWORD }))).toMatchObject({ status: 409, code: 'conflict' });
    expect(await fails(auth.register({ username: 'a b!', password: PASSWORD }))).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' });
    expect(await fails(auth.login({ username: alice, password: 'wrong-pass' }))).toMatchObject({ status: 401, code: 'invalid_credentials' });

    const login = await auth.login({ username: alice, password: PASSWORD });
    expect(login.user).toMatchObject({ id: a.user.id, username: alice });
    expect(await auth.me(login.token)).toMatchObject({ id: a.user.id, username: alice });
  });

  it('me with a bad token is the shape-C 401', async () => {
    expect(await fails(auth.me('nope'))).toMatchObject({ status: 401, code: 'INVALID_TOKEN' });
    await expect(auth.logout('nope')).resolves.toBeUndefined();
  });

  it('changes the password without a current one; the old token keeps working', async () => {
    expect(await fails(auth.changePassword(aliceToken, ''))).toMatchObject({ status: 400, code: 'password_mandatory' });
    expect(await fails(auth.changePassword('nope', 'whatever123'))).toMatchObject({ status: 401 });
    await auth.changePassword(aliceToken, 'changed-pw-1');
    expect(await fails(auth.login({ username: alice, password: PASSWORD }))).toMatchObject({ code: 'invalid_credentials' });
    await auth.login({ username: alice, password: 'changed-pw-1' });
    expect((await auth.me(aliceToken)).username).toBe(alice);
  });

  it('single game: brute-forces a cell, wrong fills are 200 incorrect, then CELL_NOT_EMPTY', async () => {
    const { game, credentials } = await api.createGame({ mode: 'single', difficulty: 'easy' }, aliceToken);
    expect(game).toMatchObject({ mode: 'single', status: 'in_progress', current_turn: null });
    expect(game.players[0]).toMatchObject({ id: 'p1', name: alice });
    expect(credentials).toHaveLength(1);

    const row = game.puzzle.findIndex((r) => r.includes(0));
    const col = game.puzzle[row].indexOf(0);
    let correct = false;
    for (let v = 1; v <= 9 && !correct; v++) {
      const res = await api.submitMove(game.id, credentials[0].token, { row, col, value: v });
      expect(res.points).toBe(0);
      expect(res.elapsed_ms).toBeNull();
      correct = res.result === 'correct';
      if (correct) expect(res.game.board[row][col]).toBe(v);
    }
    expect(correct).toBe(true);
    expect(await fails(api.submitMove(game.id, credentials[0].token, { row, col, value: 1 }))).toMatchObject({ status: 409, code: 'CELL_NOT_EMPTY' });
    expect(await fails(api.submitMove(game.id, 'bad-token', { row, col, value: 1 }))).toMatchObject({ status: 401, code: 'INVALID_TOKEN' });
    expect(await api.getGame(game.id)).toMatchObject({ id: game.id });
    expect(await fails(api.getGame('01ZZZZZZZZZZZZZZZZZZZZZZZZ'))).toMatchObject({ status: 404, code: 'GAME_NOT_FOUND' });
  });

  it('validation errors: bad mode and bad join code', async () => {
    expect(await fails(api.createGame({ mode: 'coop' as never, difficulty: 'easy' }, aliceToken))).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' });
    expect(await fails(api.createGame({ mode: 'single', difficulty: 'easy' }, 'nope'))).toMatchObject({ status: 401, code: 'INVALID_TOKEN' });
    expect(await fails(api.joinGame({ code: 'ZZZZZZ' }, bobToken))).toMatchObject({ status: 404, code: 'JOIN_CODE_NOT_FOUND' });
  });

  it('same-device versus: two credentials, guest name, NOT_YOUR_TURN carries the game', async () => {
    const { game, credentials } = await api.createGame({ mode: 'versus', difficulty: 'easy', player_names: ['ignored', '  Guest  '] }, aliceToken);
    expect(credentials.map((c) => c.player_id)).toEqual(['p1', 'p2']);
    expect(game.players[1]).toMatchObject({ name: 'Guest', user_id: null });
    expect(game.players[0].user_id).not.toBeNull();
    const row = game.puzzle.findIndex((r) => r.includes(0));
    const col = game.puzzle[row].indexOf(0);
    const err = await fails(api.submitMove(game.id, credentials[1].token, { row, col, value: 1 }));
    expect(err).toMatchObject({ status: 409, code: 'NOT_YOUR_TURN' });
    expect(err.game?.id).toBe(game.id);
    // Turn/expire before the deadline: harmless 409 that carries the current game.
    const early = await fails(api.expireTurn(game.id));
    expect(early).toMatchObject({ status: 409, code: 'TURN_NOT_EXPIRED' });
    expect(early.game?.version).toBeGreaterThanOrEqual(1);
    expect(await fails(api.forfeit(game.id, credentials[0].token))).toMatchObject({ status: 409, code: 'NOT_ONLINE' });
  });

  it('online: host creates a lobby, guest joins by code, SSE, move, forfeit', async () => {
    const host = await api.createGame({ mode: 'versus', difficulty: 'easy', online: true }, aliceToken);
    const code = host.game.join_code!;
    expect(host.game.status).toBe('waiting');
    expect(host.credentials).toHaveLength(1);

    const hostFirst = await firstUpdate(host.game.id, host.credentials[0].token);
    expect(hostFirst.events).toEqual([]);
    expect(hostFirst.game.status).toBe('waiting');

    const guest = await api.joinGame({ code: ` ${code.toLowerCase()} ` }, bobToken);
    expect(guest.credentials).toHaveLength(1);
    expect(guest.credentials[0].player_id).toBe('p2');
    expect(guest.game).toMatchObject({ status: 'in_progress', join_code: null });
    expect(guest.game.players[1].name).toBe(bob);
    expect(guest.game.current_turn?.player_id).toBe('p1');

    const guestFirst = await firstUpdate(host.game.id, guest.credentials[0].token);
    expect(guestFirst.game.version).toBe(guest.game.version);

    const g: Game = guest.game;
    const row = g.puzzle.findIndex((r) => r.includes(0));
    const col = g.puzzle[row].indexOf(0);
    expect(await fails(api.submitMove(g.id, guest.credentials[0].token, { row, col, value: 1 }))).toMatchObject({ code: 'NOT_YOUR_TURN' });
    const move = await api.submitMove(g.id, host.credentials[0].token, { row, col, value: 1 });
    expect(['correct', 'incorrect']).toContain(move.result);
    expect(move.game.version).toBeGreaterThan(g.version);
    expect(move.events[0]).toMatchObject({ type: 'move', player_id: 'p1' });

    const out = await api.forfeit(g.id, guest.credentials[0].token);
    expect(out.events.map((e) => e.type)).toEqual(['player_forfeited', 'game_completed']);
    expect(out.game).toMatchObject({ status: 'completed', end_reason: 'forfeit', winner_id: 'p1' });
    expect(await fails(api.forfeit(g.id, guest.credentials[0].token))).toMatchObject({ status: 409, code: 'GAME_COMPLETED' });
  });
});
