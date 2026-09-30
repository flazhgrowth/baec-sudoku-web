import { useState } from 'react';
import type { LoginRequest, RegisterRequest } from '../api';

interface Props {
  busy: boolean;
  error: string | null;
  onLogin: (req: LoginRequest) => void;
  onRegister: (req: RegisterRequest) => void;
}

type Tab = 'login' | 'register';

export function Login({ busy, error, onLogin, onRegister }: Props) {
  const [tab, setTab] = useState<Tab>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = () => {
    const req = { username: username.trim(), password };
    if (tab === 'login') onLogin(req);
    else onRegister(req);
  };

  return (
    <main className="home">
      <h1>Sudoku</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset className="field">
          <legend>Account</legend>
          <div className="segmented">
            <button type="button" className={tab === 'login' ? 'on' : ''} aria-pressed={tab === 'login'} onClick={() => setTab('login')}>
              Log in
            </button>
            <button
              type="button"
              className={tab === 'register' ? 'on' : ''}
              aria-pressed={tab === 'register'}
              onClick={() => setTab('register')}
            >
              Sign up
            </button>
          </div>
        </fieldset>
        <div className="field names">
          <label>
            <span>Username</span>
            <input
              value={username}
              maxLength={20}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="3-20 letters, digits, _"
              required
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              placeholder={tab === 'register' ? 'At least 6 characters' : 'Password'}
              required
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>
        {tab === 'register' && (
          <p className="hint">Just a username and password, so your games and scores are yours. No email, no verification.</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? 'One moment…' : tab === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
    </main>
  );
}
