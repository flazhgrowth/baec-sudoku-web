// Mirrors the backend API (baec-portfolio-api/docs/api.md, the source of truth). These are the `data` payloads.

export type Mode = 'single' | 'versus';
export type Difficulty = 'easy' | 'medium' | 'hard';
/** `waiting` = online lobby with only the host, until a second player joins. */
export type GameStatus = 'waiting' | 'in_progress' | 'completed';
export type EndReason = 'solved' | 'forfeit';

/** 9x9 grid, indexed [row][col]. 0 means empty. */
export type Grid = number[][];

export interface Player {
  id: string;
  name: string;
  /** The account playing this seat, if the request that created/joined the game carried a valid auth token. Otherwise null (a guest, e.g. player 2 on a shared device). For a future leaderboard. */
  user_id: string | null;
  score: number;
  /** Faults counted toward the fault limit. Resets to 0 once the skip penalty is served. */
  faults: number;
  /** Total wrong fills over the whole game (never resets). */
  mistakes: number;
  skip_turns_remaining: number;
  /** Online games: whether this player's device is currently connected. Always true otherwise. */
  connected: boolean;
  /** ISO-8601. Set while an online player is disconnected: when they forfeit if they don't return. */
  forfeit_at: string | null;
}

export interface Turn {
  player_id: string;
  /** ISO-8601 */
  started_at: string;
  /** ISO-8601 */
  deadline_at: string;
}

export interface Rules {
  turn_limit_ms: number;
  max_points: number;
  min_points: number;
  fault_limit: number;
  skip_turns_on_fault_limit: number;
  disconnect_forfeit_ms: number;
}

export interface Game {
  id: string;
  mode: Mode;
  /** true = each player joins from their own device via join_code. */
  online: boolean;
  difficulty: Difficulty;
  status: GameStatus;
  /** Only while `waiting`; null once the game has started. */
  join_code: string | null;
  /** Initial clues. Never changes. */
  puzzle: Grid;
  /** Clues plus every correctly filled cell. Wrong fills are never stored. */
  board: Grid;
  /** 1 or 2 players. An online game has only the host while `waiting`. */
  players: Player[];
  /** null in single mode, while waiting, and once the game is completed. */
  current_turn: Turn | null;
  rules: Rules;
  started_at: string;
  completed_at: string | null;
  end_reason: EndReason | null;
  /** Set when a versus game completes with a clear winner; null on a draw. */
  winner_id: string | null;
  /** Increases on every state change. Clients ignore states older than what they hold. */
  version: number;
  /** Server clock at response time, used by the client to correct clock skew. */
  server_time: string;
}

export type GameEvent =
  | {
      type: 'move';
      player_id: string;
      row: number;
      col: number;
      value: number;
      result: 'correct' | 'incorrect';
      points: number;
    }
  | { type: 'turn_expired'; player_id: string }
  | { type: 'turn_skipped'; player_id: string }
  | { type: 'fault_limit_reached'; player_id: string; skip_turns: number }
  | { type: 'player_joined'; player_id: string }
  | { type: 'player_connection'; player_id: string; connected: boolean }
  | { type: 'player_forfeited'; player_id: string }
  | { type: 'game_completed' };

export interface CreateGameRequest {
  mode: Mode;
  difficulty: Difficulty;
  /** Only for versus. Creates a lobby that a second player joins by code. Default false. */
  online?: boolean;
  /** single: 1 name. versus on one device: 2 names. online: the host's name only. */
  player_names?: string[];
}

export interface JoinGameRequest {
  code: string;
}

export interface Credential {
  player_id: string;
  /** Secret. Identifies the player on later calls (X-Player-Token). */
  token: string;
}

/** Returned by create and join. Local games get a credential per player, online games only yours. */
export interface Session {
  game: Game;
  credentials: Credential[];
}

export interface MoveRequest {
  row: number;
  col: number;
  value: number;
}

export interface MoveResponse {
  result: 'correct' | 'incorrect';
  /** Points awarded for this move (0 when incorrect, and always 0 in single mode). */
  points: number;
  /** Time from turn start to this move. null in single mode. */
  elapsed_ms: number | null;
  game: Game;
  events: GameEvent[];
}

/** Response of expire and forfeit, and the payload of each `update` stream message. */
export interface GameUpdate {
  game: Game;
  events: GameEvent[];
}

export type Unsubscribe = () => void;

export interface SudokuApi {
  /**
   * `authToken` identifies the caller's account (see `AuthApi.login`/`register`). The server sets
   * the acting seat's `user_id` to that account and its `name` to the account's username, ignoring
   * any name for that seat in `player_names`.
   */
  createGame(req: CreateGameRequest, authToken: string): Promise<Session>;
  joinGame(req: JoinGameRequest, authToken: string): Promise<Session>;
  getGame(gameId: string): Promise<Game>;
  submitMove(gameId: string, token: string, req: MoveRequest): Promise<MoveResponse>;
  expireTurn(gameId: string): Promise<GameUpdate>;
  forfeit(gameId: string, token: string): Promise<GameUpdate>;
  /** Live updates. The first update is the current state (events: []). */
  subscribe(
    gameId: string,
    token: string,
    onUpdate: (update: GameUpdate) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe;
}
