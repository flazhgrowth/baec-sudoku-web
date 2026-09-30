import { useRef, type KeyboardEvent } from 'react';
import type { Grid } from '../api';
import type { Feedback } from '../hooks/useGame';

export interface Selection {
  row: number;
  col: number;
}

interface Props {
  puzzle: Grid;
  board: Grid;
  selected: Selection | null;
  feedback: Feedback | null;
  onSelect: (sel: Selection) => void;
}

export function Board({ puzzle, board, selected, feedback, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const selectedValue = selected ? board[selected.row][selected.col] : 0;

  const move = (row: number, col: number) => {
    onSelect({ row, col });
    ref.current?.querySelector<HTMLElement>(`[data-r="${row}"][data-c="${col}"]`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!selected) return;
    const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    move(Math.min(8, Math.max(0, selected.row + d[0])), Math.min(8, Math.max(0, selected.col + d[1])));
  };

  return (
    <div className="board" role="grid" aria-label="Sudoku board" ref={ref} onKeyDown={onKeyDown}>
      {board.map((rowValues, r) =>
        rowValues.map((value, c) => {
          const fb = feedback && feedback.row === r && feedback.col === c ? feedback : null;
          const shown = value || (fb && !fb.ok ? fb.value : 0);
          const isSelected = selected?.row === r && selected.col === c;
          const cls = ['cell'];
          if (puzzle[r][c]) cls.push('given');
          if (isSelected) cls.push('selected');
          else if (selected && (selected.row === r || selected.col === c)) cls.push('related');
          if (selectedValue && value === selectedValue && !isSelected) cls.push('same');
          if (c % 3 === 2 && c !== 8) cls.push('edge-r');
          if (r % 3 === 2 && r !== 8) cls.push('edge-b');
          if (fb) cls.push(fb.ok ? 'ok' : 'bad');
          return (
            <button
              key={`${r}-${c}`}
              type="button"
              role="gridcell"
              className={cls.join(' ')}
              data-r={r}
              data-c={c}
              aria-label={`Row ${r + 1}, column ${c + 1}, ${shown ? shown : 'empty'}`}
              aria-selected={isSelected}
              tabIndex={isSelected || (!selected && r === 0 && c === 0) ? 0 : -1}
              onClick={() => onSelect({ row: r, col: c })}
            >
              {shown || ''}
            </button>
          );
        }),
      )}
    </div>
  );
}
