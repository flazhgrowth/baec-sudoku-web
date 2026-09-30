import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import type { MoveRequest } from '../api/types';
import {
  createGame,
  DEFAULT_RULES,
  expireTurn,
  forfeit,
  heartbeat,
  joinGame,
  PRESENCE_GRACE_MS,
  scoreForElapsed,
  submitMove,
  tick,
  toPublic,
  type StoredGame,
} from './engine';

const T0 = 1_000_000;

let counter = 0;
const opts = () => ({ id: 'g1', newToken: () => `tok${++counter}`, newCode: () => 'ABC234' });

type Kind = 'single' | 'local' | 'online';
function newGame(kind: Kind = 'local'): StoredGame {
  const req =
    kind === 'single'
      ? ({ mode: 'single', difficulty: 'easy' } as const)
      : ({ mode: 'versus', difficulty: 'easy', online: kind === 'online' } as const);
  return createGame(req, T0, opts()).game;
}

/** Online game with both players seated and the clock at T0. */
function startedOnline(): StoredGame {
  const g = newGame('online');
  joinGame(g, 'Sam', T0, () => 'tok-p2');
  return g;
}

const p1 = (g: StoredGame) => g.tokens.p1;
const p2 = (g: StoredGame) => g.tokens.p2;

/** First empty cell plus its correct value and a definitely-wrong value. */
function target(game: StoredGame) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (game.board[r][c] === 0) {
        const right = game.solution[r][c];
        return { row: r, col: c, right, wrong: right === 9 ? 1 : right + 1 };
      }
    }
  }
  throw new Error('no empty cell');
}

const move = (g: StoredGame, token: string, now: number, wrong = false) => {
  const t = target(g);
  return submitMove(g, token, { row: t.row, col: t.col, value: wrong ? t.wrong : t.right }, now);
};

const turnOf = (g: StoredGame) => g.current_turn?.player_id;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as ApiError).code;
  }
  return 'no error';
};

describe('scoreForElapsed', () => {
  it('maps elapsed time to 10..1 points', () => {
    expect(scoreForElapsed(0)).toBe(10);
    expect(scoreForElapsed(999)).toBe(10);
    expect(scoreForElapsed(1000)).toBe(9);
    expect(scoreForElapsed(5500)).toBe(5);
    expect(scoreForElapsed(9999)).toBe(1);
  });
  it('never drops below the minimum', () => {
    expect(scoreForElapsed(10_999)).toBe(1);
    expect(scoreForElapsed(60_000)).toBe(1);
  });
});

describe('versus turns (same device)', () => {
  it('awards time-based points and passes the turn on a correct fill', () => {
    const g = newGame();
    const t = target(g);
    const res = submitMove(g, p1(g), { row: t.row, col: t.col, value: t.right }, T0 + 2500);
    expect(res.result).toBe('correct');
    expect(res.points).toBe(8);
    expect(res.events[0]).toMatchObject({ type: 'move', player_id: 'p1', result: 'correct', points: 8 });
    expect(g.players[0].score).toBe(8);
    expect(g.board[t.row][t.col]).toBe(t.right);
    expect(turnOf(g)).toBe('p2');
    expect(g.current_turn!.started_at).toBe(new Date(T0 + 2500).toISOString());
  });

  it('identifies the player by token and rejects moves out of turn', () => {
    const g = newGame();
    expect(code(() => move(g, p2(g), T0 + 100))).toBe('NOT_YOUR_TURN');
    expect(code(() => move(g, 'nope', T0 + 100))).toBe('INVALID_TOKEN');
    expect(code(() => submitMove(g, '', { row: 0, col: 0, value: 1 }, T0))).toBe('INVALID_TOKEN');
  });

  it('rejects filling an occupied cell', () => {
    const g = newGame();
    const t = target(g);
    move(g, p1(g), T0 + 100);
    expect(code(() => submitMove(g, p2(g), { row: t.row, col: t.col, value: t.right }, T0 + 200))).toBe('CELL_NOT_EMPTY');
  });

  it('expires a late move, passes the turn and returns the new state', () => {
    const g = newGame();
    const t = target(g);
    try {
      move(g, p1(g), T0 + DEFAULT_RULES.turn_limit_ms);
      expect.unreachable();
    } catch (e) {
      expect((e as ApiError).code).toBe('TURN_EXPIRED');
      expect((e as ApiError).game?.current_turn?.player_id).toBe('p2');
      expect((e as ApiError).events).toEqual([{ type: 'turn_expired', player_id: 'p1' }]);
    }
    expect(g.board[t.row][t.col]).toBe(0);
    expect(g.players[0].faults).toBe(0);
  });

  it('expireTurn only works after the deadline', () => {
    const g = newGame();
    expect(code(() => expireTurn(g, T0 + 9999))).toBe('TURN_NOT_EXPIRED');
    const res = expireTurn(g, T0 + 10_000);
    expect(res.events).toEqual([{ type: 'turn_expired', player_id: 'p1' }]);
    expect(turnOf(g)).toBe('p2');
  });

  it('tick is a no-op before the deadline', () => {
    expect(tick(newGame(), T0 + 5000)).toEqual([]);
  });

  it('bumps the version on every state change', () => {
    const g = newGame();
    const v = g.version;
    tick(g, T0 + 1000);
    expect(g.version).toBe(v);
    move(g, p1(g), T0 + 1500);
    expect(g.version).toBe(v + 1);
    tick(g, T0 + 1500 + 10_000);
    expect(g.version).toBe(v + 2);
  });
});

describe('faults', () => {
  it('a wrong fill scores nothing, adds a fault and ends the turn', () => {
    const g = newGame();
    const t = target(g);
    const res = move(g, p1(g), T0 + 500, true);
    expect(res.result).toBe('incorrect');
    expect(res.points).toBe(0);
    expect(g.board[t.row][t.col]).toBe(0);
    expect(g.players[0]).toMatchObject({ faults: 1, mistakes: 1, score: 0 });
    expect(turnOf(g)).toBe('p2');
  });

  it('three faults cost p1 two turns, then the counter resets', () => {
    const g = newGame();
    let now = T0;
    const fill = (token: string, wrong: boolean) => move(g, token, (now += 100), wrong);

    fill(p1(g), true); // fault 1 -> p2
    fill(p2(g), false);
    fill(p1(g), true); // fault 2 -> p2
    fill(p2(g), false);
    const third = fill(p1(g), true); // fault 3 -> p2, p1 owes 2 turns
    expect(third.events).toContainEqual({ type: 'fault_limit_reached', player_id: 'p1', skip_turns: 2 });
    expect(g.players[0]).toMatchObject({ faults: 3, skip_turns_remaining: 2 });
    expect(turnOf(g)).toBe('p2');

    const a = fill(p2(g), false); // p1 skipped once
    expect(a.events.filter((e) => e.type === 'turn_skipped')).toHaveLength(1);
    expect(turnOf(g)).toBe('p2');
    expect(g.players[0]).toMatchObject({ faults: 3, skip_turns_remaining: 1 });

    const b = fill(p2(g), false); // p1 skipped twice, counter resets
    expect(b.events.filter((e) => e.type === 'turn_skipped')).toHaveLength(1);
    expect(g.players[0]).toMatchObject({ faults: 0, skip_turns_remaining: 0 });
    expect(turnOf(g)).toBe('p2');

    fill(p2(g), false); // p2 has now played 3 in a row; p1 is back
    expect(turnOf(g)).toBe('p1');
  });
});

describe('completion', () => {
  function almostDone(kind: Kind) {
    const g = kind === 'online' ? startedOnline() : newGame(kind);
    const empties: [number, number][] = [];
    g.board.forEach((row, r) => row.forEach((v, c) => v === 0 && empties.push([r, c])));
    const [last, ...rest] = empties;
    for (const [r, c] of rest) g.board[r][c] = g.solution[r][c];
    const req: MoveRequest = { row: last[0], col: last[1], value: g.solution[last[0]][last[1]] };
    return { g, req };
  }

  it('completes a versus game and picks the higher score', () => {
    const { g, req } = almostDone('local');
    g.players[0].score = 12;
    g.players[1].score = 7;
    const res = submitMove(g, p1(g), req, T0 + 1000);
    expect(res.events).toContainEqual({ type: 'game_completed' });
    expect(g.status).toBe('completed');
    expect(g.end_reason).toBe('solved');
    expect(g.current_turn).toBeNull();
    expect(g.winner_id).toBe('p1');
  });

  it('reports a draw with winner_id null', () => {
    const { g, req } = almostDone('local');
    g.players[1].score = 10; // p1 earns 10 on the last fill too
    submitMove(g, p1(g), req, T0 + 500);
    expect(g.winner_id).toBeNull();
  });

  it('single mode has no turns, points or timeout', () => {
    const g = newGame('single');
    expect(g.current_turn).toBeNull();
    const res = move(g, p1(g), T0 + 3_600_000);
    expect(res).toMatchObject({ result: 'correct', points: 0, elapsed_ms: null });
    move(g, p1(g), T0 + 3_600_001, true);
    expect(g.players[0]).toMatchObject({ mistakes: 1, skip_turns_remaining: 0 });
  });
});

describe('validation', () => {
  it('rejects bad input', () => {
    const g = newGame();
    expect(code(() => submitMove(g, p1(g), { row: 9, col: 0, value: 1 }, T0))).toBe('VALIDATION_ERROR');
    expect(code(() => submitMove(g, p1(g), { row: 0, col: 0, value: 0 }, T0))).toBe('VALIDATION_ERROR');
    expect(code(() => createGame({ mode: 'single', difficulty: 'easy', player_names: ['a', 'b'] }, T0, opts()))).toBe('VALIDATION_ERROR');
    expect(code(() => createGame({ mode: 'single', difficulty: 'easy', online: true }, T0, opts()))).toBe('VALIDATION_ERROR');
    expect(code(() => createGame({ mode: 'versus', difficulty: 'easy', online: true, player_names: ['a', 'b'] }, T0, opts()))).toBe('VALIDATION_ERROR');
  });
});

describe('online lobby', () => {
  it('starts waiting with only the host, a join code and one credential', () => {
    const { game, credentials } = createGame({ mode: 'versus', difficulty: 'easy', online: true, player_names: ['Alex'] }, T0, opts());
    expect(game).toMatchObject({ status: 'waiting', join_code: 'ABC234', current_turn: null, online: true });
    expect(game.players.map((p) => p.name)).toEqual(['Alex']);
    expect(credentials).toHaveLength(1);
    expect(credentials[0].player_id).toBe('p1');
  });

  it('cannot be played until someone joins', () => {
    const g = newGame('online');
    expect(code(() => move(g, p1(g), T0 + 100))).toBe('GAME_NOT_STARTED');
    expect(code(() => expireTurn(g, T0 + 60_000))).toBe('GAME_NOT_STARTED');
    expect(tick(g, T0 + 600_000)).toEqual([]); // a lobby never forfeits
  });

  it('joining seats player 2, starts p1\'s turn and clears the code', () => {
    const g = newGame('online');
    const { credentials, events } = joinGame(g, '  Sam ', T0 + 5000, () => 'secret');
    expect(credentials).toEqual([{ player_id: 'p2', token: 'secret' }]);
    expect(events).toEqual([{ type: 'player_joined', player_id: 'p2' }]);
    expect(g).toMatchObject({ status: 'in_progress', join_code: null });
    expect(g.players[1].name).toBe('Sam');
    expect(turnOf(g)).toBe('p1');
    expect(g.current_turn!.started_at).toBe(new Date(T0 + 5000).toISOString());
  });

  it('a second join is refused', () => {
    const g = startedOnline();
    expect(code(() => joinGame(g, 'Eve', T0, () => 'x'))).toBe('GAME_FULL');
    expect(code(() => joinGame(newGame('local'), 'Eve', T0, () => 'x'))).toBe('GAME_FULL');
  });

  it('only the player on turn can move, identified by their own token', () => {
    const g = startedOnline();
    expect(code(() => move(g, p2(g), T0 + 100))).toBe('NOT_YOUR_TURN');
    move(g, p1(g), T0 + 200);
    expect(turnOf(g)).toBe('p2');
  });

  it('never exposes secrets in the public state', () => {
    const json = JSON.stringify(toPublic(startedOnline(), T0));
    expect(json).not.toContain('solution');
    expect(json).not.toContain('tok');
    expect(json).not.toContain('lastSeen');
  });
});

describe('online presence', () => {
  it('flags a player as disconnected after the grace period and back on heartbeat', () => {
    const g = startedOnline();
    let now = T0;
    // p1 keeps beating; p2 goes silent. Keep turns moving so timeouts don't matter here.
    now += PRESENCE_GRACE_MS + 1;
    heartbeat(g, p1(g), now);
    const events = tick(g, now).filter((e) => e.type === 'player_connection');
    expect(events).toEqual([{ type: 'player_connection', player_id: 'p2', connected: false }]);

    const pub = toPublic(g, now);
    expect(pub.players[1]).toMatchObject({ connected: false });
    expect(pub.players[1].forfeit_at).toBe(new Date(T0 + DEFAULT_RULES.disconnect_forfeit_ms).toISOString());
    expect(pub.players[0]).toMatchObject({ connected: true, forfeit_at: null });

    now += 1000;
    heartbeat(g, p2(g), now);
    expect(tick(g, now)).toContainEqual({ type: 'player_connection', player_id: 'p2', connected: true });
    expect(toPublic(g, now).players[1].forfeit_at).toBeNull();
  });

  it('forfeits a player who stays away, and the opponent wins', () => {
    const g = startedOnline();
    const now = T0 + DEFAULT_RULES.disconnect_forfeit_ms;
    heartbeat(g, p1(g), now);
    const events = tick(g, now);
    expect(events).toContainEqual({ type: 'player_forfeited', player_id: 'p2' });
    expect(events).toContainEqual({ type: 'game_completed' });
    expect(g).toMatchObject({ status: 'completed', end_reason: 'forfeit', winner_id: 'p1', current_turn: null });
  });

  it('local games never forfeit', () => {
    const g = newGame('local');
    tick(g, T0 + 3_600_000);
    expect(g.status).toBe('in_progress');
  });

  it('an explicit forfeit ends the game for the opponent', () => {
    const g = startedOnline();
    const res = forfeit(g, p2(g), T0 + 2000);
    expect(res.events).toEqual([{ type: 'player_forfeited', player_id: 'p2' }, { type: 'game_completed' }]);
    expect(res.game).toMatchObject({ status: 'completed', end_reason: 'forfeit', winner_id: 'p1' });
    expect(code(() => forfeit(g, p2(g), T0 + 3000))).toBe('GAME_COMPLETED');
    expect(code(() => move(g, p1(g), T0 + 3000))).toBe('GAME_COMPLETED');
  });

  it('forfeit needs a token, an online game and a started game', () => {
    const g = startedOnline();
    expect(code(() => forfeit(g, 'bad', T0))).toBe('INVALID_TOKEN');
    const local = newGame('local');
    expect(code(() => forfeit(local, p1(local), T0))).toBe('NOT_ONLINE');
    const lobby = newGame('online');
    expect(code(() => forfeit(lobby, p1(lobby), T0))).toBe('GAME_NOT_STARTED');
  });
});
