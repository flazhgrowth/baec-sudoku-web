import type { Grid } from '../api/types';

/** counts[d] = how many times digit d is on the board (index 0 unused). */
export function countDigits(board: Grid): number[] {
  const counts = Array<number>(10).fill(0);
  for (const row of board) for (const v of row) counts[v]++;
  return counts;
}

export const emptyCells = (board: Grid) => countDigits(board)[0];
