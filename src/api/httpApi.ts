import { createRequest } from './http';
import type { SudokuApi } from './types';

export function createHttpApi(baseUrl: string): SudokuApi {
  const request = createRequest(baseUrl);
  const game = (id: string) => `/games/${encodeURIComponent(id)}`;

  return {
    createGame: (req, authToken) => request('POST', '/games', { body: req, authToken }),
    joinGame: (req, authToken) => request('POST', '/games/join', { body: req, authToken }),
    getGame: (id) => request('GET', game(id)),
    submitMove: (id, token, req) => request('POST', `${game(id)}/moves`, { body: req, playerToken: token }),
    expireTurn: (id) => request('POST', `${game(id)}/turn/expire`),
    forfeit: (id, token) => request('POST', `${game(id)}/forfeit`, { playerToken: token }),

    subscribe(id, token, onUpdate, onError) {
      // EventSource cannot set headers, so the token goes in the query string.
      const source = new EventSource(`${baseUrl}${game(id)}/events?token=${encodeURIComponent(token)}`);
      // Messages are bare JSON: { game, events } (no envelope).
      source.addEventListener('update', (e) => onUpdate(JSON.parse((e as MessageEvent<string>).data)));
      // While CONNECTING the browser retries by itself and the server resends the full state. A 401/404
      // on connect is a normal JSON response, which EventSource treats as fatal (CLOSED, no retry).
      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED) onError?.(new Error('Connection to the game was lost'));
      };
      return () => source.close();
    },
  };
}
