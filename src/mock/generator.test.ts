import { describe, expect, it } from 'vitest';
import { countSolutions, generatePuzzle } from './generator';

const validUnits = (g: number[][]) => {
  const ok = (cells: number[]) => [...cells].sort().join('') === '123456789';
  for (let i = 0; i < 9; i++) {
    if (!ok(g[i])) return false;
    if (!ok(g.map((row) => row[i]))) return false;
    const br = Math.floor(i / 3) * 3;
    const bc = (i % 3) * 3;
    if (!ok([0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => g[br + r][bc + c])))) return false;
  }
  return true;
};

describe('generatePuzzle', () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    it(`${difficulty}: valid solution, unique, consistent clues`, () => {
      const { puzzle, solution } = generatePuzzle(difficulty);
      expect(validUnits(solution)).toBe(true);
      expect(countSolutions(puzzle.map((r) => r.slice()), 2)).toBe(1);
      puzzle.forEach((row, r) => row.forEach((v, c) => v && expect(v).toBe(solution[r][c])));
    });
  }

  it('gives easier puzzles more clues', () => {
    const clues = (p: number[][]) => p.flat().filter(Boolean).length;
    expect(clues(generatePuzzle('easy').puzzle)).toBeGreaterThan(clues(generatePuzzle('hard').puzzle));
  });
});
