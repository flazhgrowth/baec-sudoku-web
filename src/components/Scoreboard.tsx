import type { Game, Player } from '../api';
import { useNow } from '../hooks/useNow';
import { emptyCells } from '../lib/board';

function TurnTimer({ game, clockOffset }: { game: Game; clockOffset: number }) {
  const now = useNow(100) + clockOffset;
  const turn = game.current_turn!;
  const remaining = Math.max(0, Date.parse(turn.deadline_at) - now);
  const pct = Math.min(100, (remaining / game.rules.turn_limit_ms) * 100);
  return (
    <div className="timer" role="timer" aria-label={`${Math.ceil(remaining / 1000)} seconds left`}>
      <div className={`timer-bar${pct < 30 ? ' low' : ''}`} style={{ width: `${pct}%` }} />
      <span className="timer-text">{Math.ceil(remaining / 1000)}s</span>
    </div>
  );
}

function OfflineBadge({ player }: { player: Player }) {
  const now = useNow(1000);
  const secs = Math.max(0, Math.ceil((Date.parse(player.forfeit_at!) - now) / 1000));
  return <span className="badge">offline · forfeits in {secs}s</span>;
}

interface CardProps {
  player: Player;
  index: number;
  game: Game;
  clockOffset: number;
  isMe: boolean;
}

function PlayerCard({ player, index, game, clockOffset, isMe }: CardProps) {
  const active = game.status === 'in_progress' && game.current_turn?.player_id === player.id;
  return (
    <div className={`player p${index + 1}${active ? ' active' : ''}`} aria-current={active ? 'true' : undefined}>
      <div className="player-head">
        <span className="player-name">
          {player.name}
          {isMe && <em className="you"> (you)</em>}
        </span>
        <span className="player-score" aria-label={`${player.score} points`}>{player.score}</span>
      </div>
      <div className="player-meta">
        <span className="pips" aria-label={`${player.faults} of ${game.rules.fault_limit} faults`}>
          {Array.from({ length: game.rules.fault_limit }, (_, i) => (
            <i key={i} className={i < player.faults ? 'pip on' : 'pip'} />
          ))}
        </span>
        {player.skip_turns_remaining > 0 && (
          <span className="badge">skips {player.skip_turns_remaining} more</span>
        )}
        {!player.connected && player.forfeit_at && game.status === 'in_progress' && <OfflineBadge player={player} />}
      </div>
      {active ? <TurnTimer game={game} clockOffset={clockOffset} /> : <div className="timer idle" />}
    </div>
  );
}

function Elapsed({ game }: { game: Game }) {
  const running = game.status === 'in_progress';
  const now = useNow(1000, running);
  const end = game.completed_at ? Date.parse(game.completed_at) : now;
  const secs = Math.max(0, Math.floor((end - Date.parse(game.started_at)) / 1000));
  return <>{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</>;
}

export function Scoreboard({ game, clockOffset, me }: { game: Game; clockOffset: number; me: string | null }) {
  if (game.mode === 'versus') {
    return (
      <div className="scoreboard versus">
        {game.players.map((p, i) => (
          <PlayerCard key={p.id} player={p} index={i} game={game} clockOffset={clockOffset} isMe={p.id === me} />
        ))}
      </div>
    );
  }
  const solo = game.players[0];
  return (
    <div className="scoreboard single">
      <div className="stat"><span>Time</span><b><Elapsed game={game} /></b></div>
      <div className="stat"><span>Mistakes</span><b>{solo.mistakes}</b></div>
      <div className="stat"><span>Left</span><b>{emptyCells(game.board)}</b></div>
    </div>
  );
}
