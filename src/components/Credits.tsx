interface Props {
  onBack: () => void;
}

export function Credits({ onBack }: Props) {
  return (
    <main className="home">
      <h1>Credits</h1>
      <p className="hint">
        Sudoku started with a simple wish: the author, <strong>baeclatant</strong>, wanted to play Sudoku in a browser.
      </p>
      <p className="hint">
        The versus mode came later, and it is thanks to a rather fun conversation with <strong>✨Joko✨</strong>. That chat is
        what made it live.
      </p>
      <button className="primary" type="button" onClick={onBack}>
        Back
      </button>
    </main>
  );
}
