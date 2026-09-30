import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type CreateGameRequest,
  type Credential,
  type Game,
  type GameEvent,
  type JoinGameRequest,
  type Session,
} from '../api';

const SESSION_KEY = 'sudoku.session';
const FEEDBACK_MS = 900;
/** Online: give the server a moment to expire the turn itself before we ask it to. */
const ONLINE_EXPIRE_GRACE_MS = 1500;

export interface Feedback {
  row: number;
  col: number;
  value: number;
  ok: boolean;
  key: number;
}

export interface Notice {
  text: string;
  tone: 'good' | 'bad' | 'info';
  key: number;
}

interface Saved {
  gameId: string;
  credentials: Credential[];
}

// sessionStorage: each browser tab is its own device, which also lets two tabs play each other against the mock.
const saved = {
  get(): Saved | null {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    } catch {
      return null;
    }
  },
  set(value: Saved | null) {
    try {
      if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  },
};

function describe(events: GameEvent[], game: Game): { text: string; tone: Notice['tone'] } | null {
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? 'Player';
  const lines: string[] = [];
  let tone: Notice['tone'] = 'info';
  for (const e of events) {
    switch (e.type) {
      case 'move':
        tone = e.result === 'correct' ? 'good' : 'bad';
        lines.push(
          e.result === 'correct'
            ? e.points > 0
              ? `+${e.points} for ${name(e.player_id)}`
              : 'Correct'
            : `${name(e.player_id)}: wrong number`,
        );
        break;
      case 'turn_expired':
        lines.push(`${name(e.player_id)} ran out of time`);
        break;
      case 'turn_skipped':
        lines.push(`${name(e.player_id)}'s turn was skipped`);
        break;
      case 'fault_limit_reached':
        lines.push(`${name(e.player_id)} hit ${game.rules.fault_limit} faults and skips ${e.skip_turns} turns`);
        break;
      case 'player_joined':
        lines.push(`${name(e.player_id)} joined`);
        break;
      case 'player_connection':
        lines.push(`${name(e.player_id)} ${e.connected ? 'is back' : 'went offline'}`);
        break;
      case 'player_forfeited':
        lines.push(`${name(e.player_id)} forfeited`);
        break;
      case 'game_completed':
        break;
    }
  }
  return lines.length ? { text: lines.join(' · '), tone } : null;
}

export function useGame(authToken: string | null) {
  const [game, setGame] = useState<Game | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  /** server_time - clientTime, so countdowns follow the server clock. */
  const [clockOffset, setClockOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  const seen = useRef<{ id: string; version: number } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(feedbackTimer.current), []);

  const showFeedback = useCallback((fb: Omit<Feedback, 'key'>) => {
    clearTimeout(feedbackTimer.current);
    setFeedback({ ...fb, key: ++seq.current });
    feedbackTimer.current = setTimeout(() => setFeedback(null), FEEDBACK_MS);
  }, []);

  const say = useCallback((text: string, tone: Notice['tone']) => {
    setNotice({ text, tone, key: ++seq.current });
  }, []);

  /**
   * Single entry point for every server state, whether from a response or the live stream.
   * Older states are dropped; events are announced once, by whichever copy arrives first.
   */
  const apply = useCallback(
    (next: Game, events: GameEvent[] = []) => {
      const prev = seen.current;
      const sameGame = prev?.id === next.id;
      if (sameGame && next.version < prev.version) return;
      const isNew = !sameGame || next.version > prev.version;
      seen.current = { id: next.id, version: next.version };

      setClockOffset(Date.parse(next.server_time) - Date.now());
      setGame(next);
      if (next.status === 'completed') saved.set(null);

      if (!isNew) return;
      for (const e of events) if (e.type === 'move') showFeedback({ row: e.row, col: e.col, value: e.value, ok: e.result === 'correct' });
      const n = describe(events, next);
      if (n) say(n.text, n.tone);
    },
    [say, showFeedback],
  );

  const begin = useCallback(
    (session: Session) => {
      seen.current = null;
      setCredentials(session.credentials);
      setNotice(null);
      setFeedback(null);
      saved.set({ gameId: session.game.id, credentials: session.credentials });
      apply(session.game);
    },
    [apply],
  );

  // Resume this tab's previous game, if any.
  useEffect(() => {
    const prev = saved.get();
    if (!prev) {
      setLoading(false);
      return;
    }
    api
      .getGame(prev.gameId)
      .then((g) => {
        if (g.status === 'completed') return saved.set(null);
        setCredentials(prev.credentials);
        apply(g);
      })
      .catch(() => saved.set(null))
      .finally(() => setLoading(false));
  }, [apply]);

  const run = useCallback(
    async (fn: () => Promise<Session>) => {
      setError(null);
      setLoading(true);
      try {
        begin(await fn());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      } finally {
        setLoading(false);
      }
    },
    [begin],
  );

  // authToken is only ever null before login, and the caller (App.tsx) doesn't render anything
  // that could invoke these until login succeeds — but guard anyway rather than send a bad request.
  const create = useCallback(
    (req: CreateGameRequest) => {
      if (authToken) void run(() => api.createGame(req, authToken));
    },
    [run, authToken],
  );
  const join = useCallback(
    (req: JoinGameRequest) => {
      if (authToken) void run(() => api.joinGame(req, authToken));
    },
    [run, authToken],
  );

  const leave = useCallback(() => {
    saved.set(null);
    seen.current = null;
    setGame(null);
    setCredentials([]);
    setNotice(null);
    setFeedback(null);
  }, []);

  /** Online: the one player on this device. Otherwise null (one device plays everyone). */
  const me = game?.online ? credentials[0]?.player_id ?? null : null;
  const tokenOf = (player_id: string | null | undefined) => credentials.find((c) => c.player_id === player_id)?.token;

  const submit = useCallback(
    async (row: number, col: number, value: number) => {
      if (!game || game.status !== 'in_progress' || busy.current) return;
      const acting = game.current_turn?.player_id ?? game.players[0].id;
      if (game.online && acting !== me) return;
      const token = credentials.find((c) => c.player_id === acting)?.token;
      if (!token) return;
      busy.current = true;
      try {
        const res = await api.submitMove(game.id, token, { row, col, value });
        apply(res.game, res.events);
      } catch (e) {
        if (e instanceof ApiError && e.game) {
          apply(e.game);
          say(e.code === 'TURN_EXPIRED' ? 'Time is up. Turn passed.' : e.message, 'info');
        } else {
          say(e instanceof Error ? e.message : 'Something went wrong', 'bad');
        }
      } finally {
        busy.current = false;
      }
    },
    [game, me, credentials, apply, say],
  );

  /** Leaves the game. Quitting a running online game forfeits it. */
  const quit = useCallback(async () => {
    const token = tokenOf(me);
    if (game?.online && game.status === 'in_progress' && token) {
      try {
        await api.forfeit(game.id, token);
      } catch {
        /* the forfeit timer will handle it */
      }
    }
    leave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, me, credentials, leave]);

  // Online: follow the game live.
  const streamToken = game?.online && game.status !== 'completed' ? tokenOf(me) : undefined;
  const streamId = game?.id;
  useEffect(() => {
    if (!streamId || !streamToken) return;
    return api.subscribe(
      streamId,
      streamToken,
      (u) => apply(u.game, u.events),
      (e) => say(e.message, 'bad'),
    );
  }, [streamId, streamToken, apply, say]);

  // Ask the server to expire the turn once its deadline passes (the server also does this itself).
  const turnKey = game?.current_turn ? `${game.id}|${game.current_turn.player_id}|${game.current_turn.started_at}` : null;
  useEffect(() => {
    if (!game?.current_turn) return;
    const { id, online } = game;
    const startedAt = game.current_turn.started_at;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const expire = async () => {
      try {
        const res = await api.expireTurn(id);
        if (!cancelled) apply(res.game, res.events);
      } catch (e) {
        if (cancelled) return;
        if (!(e instanceof ApiError)) return;
        // TURN_NOT_EXPIRED is either "a bit early" (our clock is ahead) or "someone already expired it".
        // Either way the error carries the current game: adopt it, and retry only if it is the same turn.
        if (e.game) apply(e.game);
        const still = e.game?.current_turn;
        if (e.code === 'TURN_NOT_EXPIRED' && still && still.started_at === startedAt) timer = setTimeout(expire, 250);
      }
    };

    const deadline = Date.parse(game.current_turn.deadline_at);
    const wait = Math.max(0, deadline - (Date.now() + clockOffset)) + (online ? ONLINE_EXPIRE_GRACE_MS : 50);
    timer = setTimeout(expire, wait);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Re-arm only when the turn itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey]);

  return { game, me, clockOffset, loading, error, feedback, notice, create, join, submit, quit };
}
