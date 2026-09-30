import { useEffect, useMemo, useState } from 'react';
import type { Feedback, Notice } from '../hooks/useGame';
import type { Game } from '../api';
import { countDigits } from '../lib/board';
import { Board, type Selection } from './Board';
import { NumberPad } from './NumberPad';
import { Scoreboard } from './Scoreboard';

interface Props {
  game: Game;
  /** Online: the player on this device. null when one device plays everyone. */
  me: string | null;
  clockOffset: number;
  feedback: Feedback | null;
  notice: Notice | null;
  onFill: (row: number, col: number, value: number) => void;
  onQuit: () => void;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function Result({ game, me, onClose }: { game: Game; me: string | null; onClose: () => void }) {
  const winner = game.players.find((p) => p.id === game.winner_id);
  const forfeiter = game.end_reason === 'forfeit' ? game.players.find((p) => p.id !== game.winner_id) : undefined;

  let title: string;
  if (game.mode === 'single') title = 'Solved!';
  else if (!winner) title = "It's a draw";
  else if (me) title = winner.id === me ? 'You win!' : `${winner.name} wins`;
  else title = `${winner.name} wins!`;

  const detail =
    game.mode === 'single'
      ? `${clock(Date.parse(game.completed_at!) - Date.parse(game.started_at))} · ${game.players[0].mistakes} mistakes`
      : [forfeiter && `${forfeiter.name} forfeited`, game.players.map((p) => `${p.name} ${p.score}`).join('  ·  ')]
          .filter(Boolean)
          .join(' — ');

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="result-title">
      <div className="dialog">
        <h2 id="result-title">{title}</h2>
        <p>{detail}</p>
        <button className="primary" autoFocus onClick={onClose}>New game</button>
      </div>
    </div>
  );
}

export function GameScreen({ game, me, clockOffset, feedback, notice, onFill, onQuit }: Props) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const counts = useMemo(() => countDigits(game.board), [game.board]);
  const [visibleNotice, setVisibleNotice] = useState<Notice | null>(null);

  useEffect(() => {
    setVisibleNotice(notice);
    if (!notice) return;
    const id = setTimeout(() => setVisibleNotice(null), 3500);
    return () => clearTimeout(id);
  }, [notice]);

  const inProgress = game.status === 'in_progress';
  const turnPlayer = game.players.find((p) => p.id === game.current_turn?.player_id);
  const myTurn = !game.online || (turnPlayer !== undefined && turnPlayer.id === me);
  const canFill = inProgress && myTurn && selected !== null && game.board[selected.row][selected.col] === 0;

  const prompt = !turnPlayer
    ? ' '
    : game.online
      ? myTurn
        ? 'Your turn: pick a box and a number'
        : `${turnPlayer.name}'s turn`
      : `${turnPlayer.name}, pick a box and a number`;

  const quit = () => {
    if (game.online && inProgress && !window.confirm('Leaving forfeits the game. Quit anyway?')) return;
    onQuit();
  };

  const tag = game.mode === 'single' ? '1 Player' : game.online ? '2 Players · online' : '2 Players';

  return (
    <main className="game">
      <header className="game-head">
        <button className="link" onClick={quit}>← Quit</button>
        <span className="game-tag">{tag} · {game.difficulty}</span>
      </header>

      <Scoreboard game={game} clockOffset={clockOffset} me={me} />

      <p className={`notice ${visibleNotice?.tone ?? ''}`} role="status" aria-live="polite">
        {visibleNotice?.text ?? prompt}
      </p>

      <Board
        puzzle={game.puzzle}
        board={game.board}
        selected={selected}
        feedback={feedback}
        onSelect={setSelected}
      />

      <NumberPad
        counts={counts}
        disabled={!canFill}
        onPick={(v) => selected && onFill(selected.row, selected.col, v)}
      />

      {game.status === 'completed' && <Result game={game} me={me} onClose={onQuit} />}
    </main>
  );
}
