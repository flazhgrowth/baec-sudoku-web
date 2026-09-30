import { useState } from 'react';
import type { CreateGameRequest, Difficulty, JoinGameRequest } from '../api';

interface Props {
  busy: boolean;
  error: string | null;
  /** Join code from an invite link. */
  initialCode: string | null;
  /** The logged-in account. The server always uses this as your player name. */
  username: string;
  onCreate: (req: CreateGameRequest) => void;
  onJoin: (req: JoinGameRequest) => void;
  onChangePassword: () => void;
  onCredits: () => void;
  onLogout: () => void;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      <div className="segmented">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={o.value === value ? 'on' : ''}
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

type Players = 'single' | 'versus';
type Where = 'local' | 'online';
type Role = 'host' | 'join';

export function Home({ busy, error, initialCode, username, onCreate, onJoin, onChangePassword, onCredits, onLogout }: Props) {
  const invited = initialCode !== null;
  const [players, setPlayers] = useState<Players>(invited ? 'versus' : 'single');
  const [where, setWhere] = useState<Where>(invited ? 'online' : 'local');
  const [role, setRole] = useState<Role>(invited ? 'join' : 'host');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  /** Only for a same-device second player, who has no account. */
  const [guestName, setGuestName] = useState('');
  const [code, setCode] = useState(initialCode ?? '');

  const online = players === 'versus' && where === 'online';
  const joining = online && role === 'join';
  const showGuestName = players === 'versus' && !online;

  const submit = () => {
    if (joining) onJoin({ code: code.trim().toUpperCase() });
    else onCreate({ mode: players, online, difficulty, player_names: showGuestName ? ['', guestName] : undefined });
  };

  return (
    <main className="home">
      <div className="home-head">
        <h1>Sudoku</h1>
        <p className="playing-as">
          {username} ·{' '}
          <button type="button" className="link" onClick={onChangePassword}>
            Password
          </button>{' '}
          ·{' '}
          <button type="button" className="link" onClick={onLogout}>
            Log out
          </button>
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Segmented
          label="Players"
          value={players}
          onChange={setPlayers}
          options={[
            { value: 'single', label: '1 Player' },
            { value: 'versus', label: '2 Players' },
          ]}
        />
        {players === 'versus' && (
          <Segmented
            label="Play"
            value={where}
            onChange={setWhere}
            options={[
              { value: 'local', label: 'Same device' },
              { value: 'online', label: 'Online' },
            ]}
          />
        )}
        {online && (
          <Segmented
            label="Online"
            value={role}
            onChange={setRole}
            options={[
              { value: 'host', label: 'Host a game' },
              { value: 'join', label: 'Join with code' },
            ]}
          />
        )}
        {!joining && (
          <Segmented
            label="Difficulty"
            value={difficulty}
            onChange={setDifficulty}
            options={[
              { value: 'easy', label: 'Easy' },
              { value: 'medium', label: 'Medium' },
              { value: 'hard', label: 'Hard' },
            ]}
          />
        )}
        {(joining || showGuestName) && (
          <div className="field names">
            {joining && (
              <label>
                <span>Join code</span>
                <input
                  className="code-input"
                  value={code}
                  maxLength={6}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ABC234"
                  required
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </label>
            )}
            {showGuestName && (
              <label>
                <span>Player 2 (this device)</span>
                <input value={guestName} maxLength={20} placeholder="Player 2" onChange={(e) => setGuestName(e.target.value)} />
              </label>
            )}
          </div>
        )}
        {players === 'versus' && (
          <ul className="rules">
            <li>Players take turns filling one box. 10 seconds per turn.</li>
            <li>Correct and fast: up to 10 points. Each second costs a point, minimum 1.</li>
            <li>A wrong number is a fault and ends your turn. Three faults and you skip your next two turns.</li>
          </ul>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy || (joining && code.trim().length < 6)}>
          {busy ? 'One moment…' : joining ? 'Join game' : online ? 'Create game' : 'Start game'}
        </button>
      </form>
      <button className="link" type="button" onClick={onCredits}>
        Credits
      </button>
    </main>
  );
}
