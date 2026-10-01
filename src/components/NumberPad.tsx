interface Props {
  counts: number[];
  disabled: boolean;
  onPick: (value: number) => void;
}

/** Digits already placed 9 times stay in the row but are disabled. */
export function NumberPad({ counts, disabled, onPick }: Props) {
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <div className="pad" role="group" aria-label="Number input">
      {digits.map((d) => (
        <button key={d} type="button" className="pad-key" disabled={disabled || counts[d] >= 9} onClick={() => onPick(d)}>
          {d}
        </button>
      ))}
    </div>
  );
}
