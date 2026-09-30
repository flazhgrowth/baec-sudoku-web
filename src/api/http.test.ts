import { describe, expect, it } from 'vitest';
import { decode } from './http';
import { ApiError } from './errors';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = async (res: Response) => decode(res).then(() => null, (e: ApiError) => e);

describe('decode: the backend\'s three response shapes', () => {
  it('shape A success: unwraps data from the envelope', async () => {
    const res = json(201, { code: 'success', message: 'Success', data: { id: 'x' }, servertime: 1 });
    expect(await decode(res)).toEqual({ id: 'x' });
  });

  it('shape A error: code and message come from the envelope', async () => {
    const e = await fail(json(422, { code: 'VALIDATION_ERROR', message: 'bad mode', data: null, servertime: 1 }));
    expect(e).toMatchObject({ status: 422, code: 'VALIDATION_ERROR', message: 'bad mode' });
    expect(e?.game).toBeUndefined();
  });

  it('shape A 409: carries the current game from data.game', async () => {
    const game = { id: 'g1', version: 7 };
    const e = await fail(json(409, { code: 'NOT_YOUR_TURN', message: 'nope', data: { game }, servertime: 1 }));
    expect(e).toMatchObject({ status: 409, code: 'NOT_YOUR_TURN', game });
  });

  it('shape A error with an empty message (register conflict) gets a non-empty fallback message', async () => {
    const e = await fail(json(409, { code: 'conflict', message: '', data: null, servertime: 1 }));
    expect(e?.code).toBe('conflict');
    expect(e?.message).not.toBe('');
  });

  it('shape B: a bare body is returned as is', async () => {
    const me = { id: 'u1', username: 'alice', created_at: '2026-09-30T15:13:28.009991Z' };
    expect(await decode(json(200, me))).toEqual(me);
  });

  it('shape C: account-token 401 is { error: { code, message } }', async () => {
    const e = await fail(json(401, { error: { code: 'INVALID_TOKEN', message: 'Missing or invalid account token' } }));
    expect(e).toMatchObject({ status: 401, code: 'INVALID_TOKEN', message: 'Missing or invalid account token' });
  });

  it('204 has no body', async () => {
    expect(await decode(new Response(null, { status: 204 }))).toBeUndefined();
  });

  it('a non-JSON 404 (unknown route) becomes an UNKNOWN ApiError, not a parse crash', async () => {
    const e = await fail(new Response('404 page not found', { status: 404 }));
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 404, code: 'UNKNOWN' });
  });

  it('an empty 405 becomes an UNKNOWN ApiError', async () => {
    expect(await fail(new Response(null, { status: 405 }))).toMatchObject({ status: 405, code: 'UNKNOWN' });
  });
});
