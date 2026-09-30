import type { Game, GameEvent } from './types';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_TOKEN'
  | 'GAME_NOT_FOUND'
  | 'JOIN_CODE_NOT_FOUND'
  | 'GAME_FULL'
  | 'GAME_NOT_STARTED'
  | 'GAME_COMPLETED'
  | 'NOT_YOUR_TURN'
  | 'TURN_EXPIRED'
  | 'TURN_NOT_EXPIRED'
  | 'NO_ACTIVE_TURN'
  | 'NOT_ONLINE'
  | 'CELL_NOT_EMPTY'
  // Account endpoints use lowercase codes (register/login), plus a general server failure.
  | 'bad_request'
  | 'conflict'
  | 'invalid_credentials'
  | 'password_mandatory'
  | 'account_not_found'
  | 'internal_server_error'
  | 'INTERNAL_ERROR'
  | 'UNKNOWN';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    message: string,
    /** Current game state, attached to game 409s (`data.game`) so the client can resync without another call. */
    public game?: Game,
    /** Mock only (not in the backend API): lazy changes applied before the error was raised. */
    public events?: GameEvent[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
