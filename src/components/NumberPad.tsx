interface Props {
  counts: number[];
  disabled: boolean;
  onPick: (value: number) => void;
}

/** Digits already placed 9 times are hidden. */
export function NumberPad({ counts, disabled, onPick }: Props) {
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => counts[d] < 9);
  return (
    <div className="pad" role="group" aria-label="Number input">
      {digits.map((d) => (
        <button key={d} type="button" className="pad-key" disabled={disabled} onClick={() => onPick(d)}>
          {d}
        </button>
      ))}
    </div>
  );
}
