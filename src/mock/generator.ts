import type { Difficulty, Grid } from '../api/types';

export type Rng = () => number;

const CLUES: Record<Difficulty, number> = { easy: 40, medium: 32, hard: 26 };

const emptyGrid = (): Grid => Array.from({ length: 9 }, () => Array<number>(9).fill(0));
const boxOf = (r: number, c: number) => Math.floor(r / 3) * 3 + Math.floor(c / 3);

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Bitmask solver state: bit d set in rows[r] means digit d is used in row r. */
function masksOf(grid: Grid) {
  const rows = Array<number>(9).fill(0);
  const cols = Array<number>(9).fill(0);
  const boxes = Array<number>(9).fill(0);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const v = grid[r][c];
      if (v) {
        const bit = 1 << v;
        rows[r] |= bit;
        cols[c] |= bit;
        boxes[boxOf(r, c)] |= bit;
      }
    }
  }
  return { rows, cols, boxes };
}

/** Counts solutions of `grid`, stopping once `limit` is reached. Mutates then restores `grid`. */
export function countSolutions(grid: Grid, limit = 2): number {
  const { rows, cols, boxes } = masksOf(grid);
  let found = 0;

  const search = (): void => {
    // Pick the empty cell with the fewest candidates.
    let bestR = -1;
    let bestC = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let r = 0; r < 9 && bestCount > 0; r++) {
      for (let c = 0; c < 9; c++) {
        if (grid[r][c] !== 0) continue;
        const used = rows[r] | cols[c] | boxes[boxOf(r, c)];
        const avail = ~used & 0b1111111110;
        let n = 0;
        for (let m = avail; m; m &= m - 1) n++;
        if (n < bestCount) {
          bestCount = n;
          bestR = r;
          bestC = c;
          bestMask = avail;
          if (n === 0) break;
        }
      }
    }
    if (bestR === -1) {
      found++;
      return;
    }
    for (let d = 1; d <= 9 && found < limit; d++) {
      const bit = 1 << d;
      if (!(bestMask & bit)) continue;
      grid[bestR][bestC] = d;
      rows[bestR] |= bit;
      cols[bestC] |= bit;
      boxes[boxOf(bestR, bestC)] |= bit;
      search();
      grid[bestR][bestC] = 0;
      rows[bestR] &= ~bit;
      cols[bestC] &= ~bit;
      boxes[boxOf(bestR, bestC)] &= ~bit;
    }
  };

  search();
  return found;
}

/** Fills an empty grid with a random valid solution. */
function randomSolution(rng: Rng): Grid {
  const grid = emptyGrid();
  const { rows, cols, boxes } = masksOf(grid);

  const fill = (i: number): boolean => {
    if (i === 81) return true;
    const r = Math.floor(i / 9);
    const c = i % 9;
    const b = boxOf(r, c);
    for (const d of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng)) {
      const bit = 1 << d;
      if ((rows[r] | cols[c] | boxes[b]) & bit) continue;
      grid[r][c] = d;
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
      if (fill(i + 1)) return true;
      grid[r][c] = 0;
      rows[r] &= ~bit;
      cols[c] &= ~bit;
      boxes[b] &= ~bit;
    }
    return false;
  };

  fill(0);
  return grid;
}

/** Generates a puzzle with a unique solution. */
export function generatePuzzle(difficulty: Difficulty, rng: Rng = Math.random) {
  const solution = randomSolution(rng);
  const puzzle = solution.map((row) => row.slice());
  const target = CLUES[difficulty];
  let clues = 81;

  for (const idx of shuffle(Array.from({ length: 81 }, (_, i) => i), rng)) {
    if (clues <= target) break;
    const r = Math.floor(idx / 9);
    const c = idx % 9;
    const keep = puzzle[r][c];
    puzzle[r][c] = 0;
    if (countSolutions(puzzle, 2) === 1) clues--;
    else puzzle[r][c] = keep;
  }

  return { puzzle, solution };
}
