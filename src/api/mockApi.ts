import { ApiError } from './errors';
import type { Game, GameEvent, GameUpdate, SudokuApi } from './types';
import {
  authenticate,
  createGame,
  expireTurn,
  forfeit,
  heartbeat,
  joinGame,
  submitMove,
  tick,
  toPublic,
  type StoredGame,
} from '../mock/engine';
import { resolveUserFromToken } from './mockAuthApi';

const STORAGE_KEY = 'sudoku.mock.games';
const CHANNEL = 'sudoku.mock';
const MAX_STORED = 10;
const TICK_MS = 1000;
const HEARTBEAT_EVERY_TICKS = 5;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type Store = Map<string, StoredGame>;
type Listener = (update: GameUpdate) => void;

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/** Shadow copy for environments without localStorage. */
let memory = '[]';

function read(): Store {
  let raw = memory;
  try {
    raw = localStorage.getItem(STORAGE_KEY) ?? memory;
  } catch {
    /* no localStorage */
  }
  return new Map(JSON.parse(raw) as [string, StoredGame][]);
}

function write(games: Store) {
  const newest = [...games.entries()]
    .sort((a, b) => Date.parse(b[1].started_at) - Date.parse(a[1].started_at))
    .slice(0, MAX_STORED);
  games.clear();
  newest.forEach(([id, g]) => games.set(id, g));
  memory = JSON.stringify(newest);
  try {
    localStorage.setItem(STORAGE_KEY, memory);
  } catch {
    /* keep playing from memory */
  }
}

/**
 * In-browser stand-in for the backend. All games live in localStorage, so two tabs of the same
 * browser act as two devices: they share state, and BroadcastChannel plays the role of the SSE stream.
 */
export function createMockApi(): SudokuApi {
  const listeners = new Map<string, Set<Listener>>();
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
  (channel as unknown as { unref?: () => void } | null)?.unref?.();

  const deliver = (update: GameUpdate) => listeners.get(update.game.id)?.forEach((l) => l(update));
  channel?.addEventListener('message', (e: MessageEvent<GameUpdate>) => deliver(e.data));

  const emit = (game: Game, events: GameEvent[]) => {
    if (!events.length) return;
    const update = { game, events };
    deliver(update);
    channel?.postMessage(update);
  };

  const find = (games: Store, id: string) => {
    const game = games.get(id);
    if (!game) throw new ApiError(404, 'GAME_NOT_FOUND', 'Game not found');
    return game;
  };

  /** Runs one operation on a fresh copy of the store, saves it and pushes resulting events to subscribers. */
  function mutate<T extends { game: Game; events: GameEvent[] }>(
    id: string,
    fn: (game: StoredGame, now: number) => T,
  ): T {
    const games = read();
    const game = find(games, id);
    try {
      const result = fn(game, Date.now());
      write(games);
      emit(result.game, result.events);
      return result;
    } catch (e) {
      write(games); // lazy changes (timeouts, forfeits) are kept even when the request errors
      if (e instanceof ApiError && e.game && e.events) emit(e.game, e.events);
      throw e;
    }
  }

  const uniqueCode = (games: Store) => {
    for (;;) {
      const code = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
      if (![...games.values()].some((g) => g.join_code === code)) return code;
    }
  };

  const requireUser = (authToken: string | undefined) => {
    const user = resolveUserFromToken(authToken);
    if (!user) throw new ApiError(401, 'INVALID_TOKEN', 'Missing or invalid auth token');
    return user;
  };

  return {
    async createGame(req, authToken) {
      const hostUser = requireUser(authToken);
      const games = read();
      const now = Date.now();
      const { game, credentials } = createGame(req, now, {
        id: uid(),
        newToken: uid,
        newCode: () => uniqueCode(games),
        hostUser,
      });
      games.set(game.id, game);
      write(games);
      return { game: toPublic(game, now), credentials };
    },

    async joinGame(req, authToken) {
      const guestUser = requireUser(authToken);
      const games = read();
      const code = (req.code ?? '').trim().toUpperCase();
      const target = [...games.values()].find((g) => g.join_code === code && g.status === 'waiting');
      if (!code || !target) throw new ApiError(404, 'JOIN_CODE_NOT_FOUND', 'No open game with that code');
      const { game, credentials } = mutate(target.id, (g, now) => {
        // The guest's name always comes from their account (guestUser), never the request.
        const joined = joinGame(g, undefined, now, uid, guestUser);
        return { ...joined, game: toPublic(g, now) };
      });
      return { game, credentials };
    },

    async getGame(id) {
      const games = read();
      const game = find(games, id);
      const now = Date.now();
      const events = tick(game, now);
      write(games);
      const pub = toPublic(game, now);
      emit(pub, events);
      return pub;
    },

    async submitMove(id, token, req) {
      return mutate(id, (game, now) => submitMove(game, token, req, now));
    },

    async expireTurn(id) {
      return mutate(id, (game, now) => expireTurn(game, now));
    },

    async forfeit(id, token) {
      return mutate(id, (game, now) => forfeit(game, token, now));
    },

    subscribe(id, token, onUpdate, onError) {
      const set = listeners.get(id) ?? new Set<Listener>();
      listeners.set(id, set);
      set.add(onUpdate);

      let ticks = 0;
      const step = (beat: boolean): GameUpdate | null => {
        try {
          const games = read();
          const game = find(games, id);
          const now = Date.now();
          authenticate(game, token);
          if (beat) heartbeat(game, token, now);
          const events = tick(game, now);
          write(games);
          const update = { game: toPublic(game, now), events };
          emit(update.game, events);
          return update;
        } catch (e) {
          onError?.(e instanceof Error ? e : new Error('Connection lost'));
          return null;
        }
      };

      const first = step(true);
      if (first) onUpdate({ game: first.game, events: [] });
      const timer = setInterval(() => step(++ticks % HEARTBEAT_EVERY_TICKS === 0), TICK_MS);

      return () => {
        clearInterval(timer);
        set.delete(onUpdate);
      };
    },
  };
}
