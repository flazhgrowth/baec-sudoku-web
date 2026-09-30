import { useState } from 'react';
import type { Game } from '../api';

export function Lobby({ game, onLeave }: { game: Game; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  const code = game.join_code ?? '';
  const link = `${location.origin}${location.pathname}?join=${code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this link', link);
    }
  };

  return (
    <main className="home lobby">
      <h1>Waiting for opponent</h1>
      <p className="hint">Share this code, or send the link. The game starts as soon as they join.</p>
      <div className="code" aria-label={`Join code ${code.split('').join(' ')}`}>{code}</div>
      <button className="primary" onClick={copy}>{copied ? 'Link copied' : 'Copy invite link'}</button>
      <p className="waiting" role="status">
        <span className="dot" /> {game.players[0].name} is ready · {game.difficulty}
      </p>
      <button className="link" onClick={onLeave}>Cancel</button>
    </main>
  );
}
