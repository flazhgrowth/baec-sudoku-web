/**
 * Reference implementation of the game rules described in docs/openapi.yaml.
 * Pure functions over a StoredGame; the caller supplies `now` (epoch ms).
 * The backend should behave identically.
 */
import { ApiError } from '../api/errors';
import type {
  CreateGameRequest,
  Credential,
  Difficulty,
  Game,
  GameEvent,
  GameUpdate,
  Grid,
  Mode,
  MoveRequest,
  MoveResponse,
  Player,
  Rules,
} from '../api/types';
import { generatePuzzle, type Rng } from './generator';

export const DEFAULT_RULES: Rules = {
  turn_limit_ms: 10_000,
  max_points: 10,
  min_points: 1,
  fault_limit: 3,
  skip_turns_on_fault_limit: 2,
  disconnect_forfeit_ms: 60_000,
};

/** A player counts as connected while their last sign of life is at most this old. */
export const PRESENCE_GRACE_MS = 15_000;

export type StoredPlayer = Omit<Player, 'connected' | 'forfeit_at'>;

/** A game as the server holds it: the public Game plus secrets and presence bookkeeping. */
export interface StoredGame extends Omit<Game, 'server_time' | 'players'> {
  players: StoredPlayer[];
  solution: Grid;
  /** player_id -> secret token */
  tokens: Record<string, string>;
  /** player_id -> epoch ms of the last heartbeat or authenticated request */
  lastSeen: Record<string, number>;
  /** player_id -> published connection flag (changes only via syncPresence, so the state is deterministic) */
  connected: Record<string, boolean>;
}

/** An authenticated account, as resolved from an auth token. See `docs/openapi.yaml` "Identity". */
export interface AuthUser {
  id: string;
  name: string;
}

export interface CreateOptions {
  id: string;
  newToken: () => string;
  newCode: () => string;
  rng?: Rng;
  /** The account creating the game, if any. Sets `players[0].user_id` and overrides its name. */
  hostUser?: AuthUser;
}

const iso = (ms: number) => new Date(ms).toISOString();
const cloneGrid = (g: Grid): Grid => g.map((row) => row.slice());
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/** 10 points in the first second, one less each further second, never below min_points. */
export function scoreForElapsed(elapsed_ms: number, rules: Rules = DEFAULT_RULES): number {
  const raw = rules.max_points - Math.floor(Math.max(0, elapsed_ms) / 1000);
  return Math.max(rules.min_points, Math.min(rules.max_points, raw));
}

/** Last sign of life, but never earlier than the start (so a stale host doesn't forfeit instantly). */
const seenAt = (game: StoredGame, player_id: string) =>
  Math.max(game.lastSeen[player_id] ?? 0, Date.parse(game.started_at));

export function toPublic(game: StoredGame, now: number): Game {
  const { solution: _s, tokens: _t, lastSeen: _l, connected, players, ...rest } = game;
  const live = game.online && game.status === 'in_progress';
  return JSON.parse(
    JSON.stringify({
      ...rest,
      players: players.map((p) => {
        const isConnected = connected[p.id] ?? true;
        return {
          ...p,
          connected: isConnected,
          forfeit_at: live && !isConnected ? iso(seenAt(game, p.id) + game.rules.disconnect_forfeit_ms) : null,
        };
      }),
      server_time: iso(now),
    }),
  ) as Game;
}

const newPlayer = (id: string, name: string | undefined, fallback: string, user_id: string | null = null): StoredPlayer => ({
  id,
  name: (name ?? '').trim().slice(0, 20) || fallback,
  user_id,
  score: 0,
  faults: 0,
  mistakes: 0,
  skip_turns_remaining: 0,
});

export function createGame(
  req: CreateGameRequest,
  now: number,
  opts: CreateOptions,
): { game: StoredGame; credentials: Credential[] } {
  const modes: Mode[] = ['single', 'versus'];
  const difficulties: Difficulty[] = ['easy', 'medium', 'hard'];
  if (!modes.includes(req.mode)) throw new ApiError(422, 'VALIDATION_ERROR', 'mode must be "single" or "versus"');
  if (!difficulties.includes(req.difficulty)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'difficulty must be "easy", "medium" or "hard"');
  }
  const online = req.online === true;
  if (online && req.mode !== 'versus') {
    throw new ApiError(422, 'VALIDATION_ERROR', 'online games must use mode "versus"');
  }
  const count = req.mode === 'versus' && !online ? 2 : 1;
  const names = req.player_names ?? [];
  if (names.length > count) {
    throw new ApiError(422, 'VALIDATION_ERROR', `player_names must have at most ${count} entries`);
  }

  const players = Array.from({ length: count }, (_, i) => {
    // The host (players[0]) plays as their account when one is attached; its name always wins.
    const host = i === 0 ? opts.hostUser : undefined;
    return newPlayer(`p${i + 1}`, host ? host.name : names[i], `Player ${i + 1}`, host?.id ?? null);
  });
  const { puzzle, solution } = generatePuzzle(req.difficulty, opts.rng);
  const local = req.mode === 'versus' && !online;

  const game: StoredGame = {
    id: opts.id,
    mode: req.mode,
    online,
    difficulty: req.difficulty,
    status: online ? 'waiting' : 'in_progress',
    join_code: online ? opts.newCode() : null,
    puzzle,
    board: cloneGrid(puzzle),
    solution,
    players,
    current_turn: local
      ? { player_id: players[0].id, started_at: iso(now), deadline_at: iso(now + DEFAULT_RULES.turn_limit_ms) }
      : null,
    rules: { ...DEFAULT_RULES },
    started_at: iso(now),
    completed_at: null,
    end_reason: null,
    winner_id: null,
    version: 1,
    tokens: Object.fromEntries(players.map((p) => [p.id, opts.newToken()])),
    lastSeen: Object.fromEntries(players.map((p) => [p.id, now])),
    connected: Object.fromEntries(players.map((p) => [p.id, true])),
  };
  return { game, credentials: players.map((p) => ({ player_id: p.id, token: game.tokens[p.id] })) };
}

/** Adds the second player to an online lobby and starts the game (player 1 moves first). */
export function joinGame(
  game: StoredGame,
  playerName: string | undefined,
  now: number,
  newToken: () => string,
  /** The guest's account, if any. Sets `players[1].user_id` and overrides its name. */
  guestUser?: AuthUser,
): { credentials: Credential[]; events: GameEvent[] } {
  if (!game.online || game.status !== 'waiting') {
    throw new ApiError(409, 'GAME_FULL', 'This game has already started');
  }
  const p2 = newPlayer('p2', guestUser ? guestUser.name : playerName, 'Player 2', guestUser?.id ?? null);
  game.players.push(p2);
  game.tokens[p2.id] = newToken();
  game.lastSeen[p2.id] = now;
  game.connected[p2.id] = true;
  game.status = 'in_progress';
  game.join_code = null;
  game.started_at = iso(now);
  startTurn(game, game.players[0].id, now);
  game.version++;
  return {
    credentials: [{ player_id: p2.id, token: game.tokens[p2.id] }],
    events: [{ type: 'player_joined', player_id: p2.id }],
  };
}

export function authenticate(game: StoredGame, token: string | undefined): StoredPlayer {
  const player = token ? game.players.find((p) => game.tokens[p.id] === token) : undefined;
  if (!player) throw new ApiError(401, 'INVALID_TOKEN', 'Missing or invalid player token');
  return player;
}

/** Records that the player's device is alive. Call from stream heartbeats and authenticated requests. */
export function heartbeat(game: StoredGame, token: string, now: number) {
  game.lastSeen[authenticate(game, token).id] = now;
}

function startTurn(game: StoredGame, player_id: string, now: number) {
  game.current_turn = { player_id, started_at: iso(now), deadline_at: iso(now + game.rules.turn_limit_ms) };
}

/**
 * Hands the turn to the other player, consuming any skipped turns they owe.
 * A player's fault counter resets when their last skipped turn is consumed.
 */
function advanceTurn(game: StoredGame, now: number, events: GameEvent[]) {
  const current = game.current_turn!.player_id;
  let next = game.players.find((p) => p.id !== current)!;
  while (next.skip_turns_remaining > 0) {
    next.skip_turns_remaining--;
    if (next.skip_turns_remaining === 0) next.faults = 0;
    events.push({ type: 'turn_skipped', player_id: next.id });
    next = game.players.find((p) => p.id === current)!;
  }
  startTurn(game, next.id, now);
}

function finish(
  game: StoredGame,
  now: number,
  events: GameEvent[],
  reason: 'solved' | 'forfeit',
  winner_id: string | null,
) {
  game.status = 'completed';
  game.completed_at = iso(now);
  game.current_turn = null;
  game.end_reason = reason;
  game.winner_id = winner_id;
  events.push({ type: 'game_completed' });
}

const isTurnDue = (game: StoredGame, now: number) =>
  game.status === 'in_progress' && game.current_turn !== null && now >= Date.parse(game.current_turn.deadline_at);

/**
 * Applies everything that is due at `now`: connection changes, disconnect forfeits and turn timeouts.
 * A real server runs this from timers; it must also run at the start of every request touching the game.
 */
export function tick(game: StoredGame, now: number): GameEvent[] {
  if (game.status !== 'in_progress') return [];
  const events: GameEvent[] = [];

  if (game.online) {
    for (const p of game.players) {
      const connected = now - seenAt(game, p.id) <= PRESENCE_GRACE_MS;
      if (connected !== game.connected[p.id]) {
        game.connected[p.id] = connected;
        events.push({ type: 'player_connection', player_id: p.id, connected });
      }
    }
    const gone = game.players
      .filter((p) => now - seenAt(game, p.id) >= game.rules.disconnect_forfeit_ms)
      .sort((a, b) => seenAt(game, a.id) - seenAt(game, b.id))[0];
    if (gone) {
      events.push({ type: 'player_forfeited', player_id: gone.id });
      finish(game, now, events, 'forfeit', game.players.find((p) => p.id !== gone.id)!.id);
    }
  }

  if (isTurnDue(game, now)) {
    events.push({ type: 'turn_expired', player_id: game.current_turn!.player_id });
    advanceTurn(game, now, events);
  }

  if (events.length) game.version++;
  return events;
}

function fail(
  status: number,
  code: ApiError['code'],
  message: string,
  game: StoredGame,
  now: number,
  events: GameEvent[] = [],
) {
  return new ApiError(status, code, message, toPublic(game, now), events);
}

export function expireTurn(game: StoredGame, now: number): GameUpdate {
  if (game.status === 'waiting') throw fail(409, 'GAME_NOT_STARTED', 'Waiting for a second player', game, now);
  if (game.status === 'completed') throw fail(409, 'GAME_COMPLETED', 'Game is already completed', game, now);
  if (!game.current_turn) throw fail(409, 'NO_ACTIVE_TURN', 'Single-player games have no turn timer', game, now);
  const events = tick(game, now);
  if (game.status === 'in_progress' && !events.some((e) => e.type === 'turn_expired')) {
    throw fail(409, 'TURN_NOT_EXPIRED', 'The current turn has not expired yet', game, now, events);
  }
  return { game: toPublic(game, now), events };
}

export function forfeit(game: StoredGame, token: string, now: number): GameUpdate {
  const player = authenticate(game, token);
  if (!game.online) throw fail(409, 'NOT_ONLINE', 'Only online games can be forfeited', game, now);
  if (game.status === 'waiting') throw fail(409, 'GAME_NOT_STARTED', 'Waiting for a second player', game, now);
  if (game.status === 'completed') throw fail(409, 'GAME_COMPLETED', 'Game is already completed', game, now);
  const events: GameEvent[] = [{ type: 'player_forfeited', player_id: player.id }];
  finish(game, now, events, 'forfeit', game.players.find((p) => p.id !== player.id)!.id);
  game.version++;
  return { game: toPublic(game, now), events };
}

export function submitMove(game: StoredGame, token: string, req: MoveRequest, now: number): MoveResponse {
  const player = authenticate(game, token);
  if (!isInt(req.row) || req.row < 0 || req.row > 8 || !isInt(req.col) || req.col < 0 || req.col > 8) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'row and col must be integers between 0 and 8');
  }
  if (!isInt(req.value) || req.value < 1 || req.value > 9) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'value must be an integer between 1 and 9');
  }
  if (game.status === 'waiting') throw fail(409, 'GAME_NOT_STARTED', 'Waiting for a second player', game, now);
  if (game.status === 'completed') throw fail(409, 'GAME_COMPLETED', 'Game is already completed', game, now);

  game.lastSeen[player.id] = now;
  const wasDue = isTurnDue(game, now);
  const events = tick(game, now);
  // tick() may have ended the game (disconnect forfeit); TS can't see that through the earlier narrowing.
  if ((game as StoredGame).status === 'completed') {
    throw fail(409, 'GAME_COMPLETED', 'Game is already completed', game, now, events);
  }
  if (wasDue) throw fail(409, 'TURN_EXPIRED', 'Your turn has expired', game, now, events);
  if (game.current_turn && game.current_turn.player_id !== player.id) {
    throw fail(409, 'NOT_YOUR_TURN', 'It is not your turn', game, now, events);
  }
  if (game.board[req.row][req.col] !== 0) {
    throw fail(409, 'CELL_NOT_EMPTY', 'Cell is already filled', game, now, events);
  }

  const versus = game.mode === 'versus';
  const elapsed_ms = game.current_turn ? now - Date.parse(game.current_turn.started_at) : null;
  const correct = game.solution[req.row][req.col] === req.value;
  let points = 0;
  const afterMove: GameEvent[] = [];

  if (correct) {
    game.board[req.row][req.col] = req.value;
    if (versus) {
      points = scoreForElapsed(elapsed_ms!, game.rules);
      player.score += points;
    }
  } else {
    player.faults++;
    player.mistakes++;
    if (versus && player.faults >= game.rules.fault_limit) {
      player.skip_turns_remaining = game.rules.skip_turns_on_fault_limit;
      afterMove.push({ type: 'fault_limit_reached', player_id: player.id, skip_turns: player.skip_turns_remaining });
    }
  }

  events.push(
    {
      type: 'move',
      player_id: player.id,
      row: req.row,
      col: req.col,
      value: req.value,
      result: correct ? 'correct' : 'incorrect',
      points,
    },
    ...afterMove,
  );

  const complete = game.board.every((row, r) => row.every((v, c) => v === game.solution[r][c]));
  if (complete) {
    let winner_id: string | null = null;
    if (versus) {
      const [a, b] = game.players;
      winner_id = a.score === b.score ? null : a.score > b.score ? a.id : b.id;
    }
    finish(game, now, events, 'solved', winner_id);
  } else if (versus) {
    advanceTurn(game, now, events);
  }

  game.version++;
  return { result: correct ? 'correct' : 'incorrect', points, elapsed_ms, game: toPublic(game, now), events };
}
