interface Props {
  counts: number[];
  disabled: boolean;
  onPick: (value: number) => void;
}

/** Digits already placed 9 times stay in the row, disabled and shown as a check mark. */
export function NumberPad({ counts, disabled, onPick }: Props) {
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <div className="pad" role="group" aria-label="Number input">
      {digits.map((d) => {
        const done = counts[d] >= 9;
        return (
          <button
            key={d}
            type="button"
            className={done ? "pad-key done" : "pad-key"}
            disabled={disabled || done}
            aria-label={done ? `${d} (all placed)` : String(d)}
            onClick={() => onPick(d)}
          >
            {done ? "✓" : d}
          </button>
        );
      })}
    </div>
  );
}
