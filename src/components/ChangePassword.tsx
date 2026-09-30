import { useState } from 'react';

interface Props {
  /** Resolves to an error message, or null when the password was changed. */
  onSubmit: (password: string) => Promise<string | null>;
  onDone: () => void;
}

export function ChangePassword({ onSubmit, onDone }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const invalid =
    password.length < 6 || password.length > 72 ? 'Use 6 to 72 characters' : password !== confirm ? 'Passwords do not match' : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const err = await onSubmit(password);
    setBusy(false);
    if (err) setError(err);
    else setSaved(true);
  };

  return (
    <main className="home">
      <h1>Change password</h1>
      {saved ? (
        <>
          <p className="hint">Your password was changed.</p>
          <button className="primary" type="button" onClick={onDone}>
            Back
          </button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) void submit();
          }}
        >
          <div className="field names">
            <label>
              <span>New password</span>
              <input
                type="password"
                value={password}
                autoComplete="new-password"
                placeholder="At least 6 characters"
                required
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              <span>Confirm new password</span>
              <input
                type="password"
                value={confirm}
                autoComplete="new-password"
                required
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          </div>
          {(error || (confirm && invalid)) && (
            <p className="error" role="alert">
              {error ?? invalid}
            </p>
          )}
          <button className="primary" type="submit" disabled={busy || !!invalid}>
            {busy ? 'One moment…' : 'Change password'}
          </button>
          <button className="link" type="button" onClick={onDone}>
            Cancel
          </button>
        </form>
      )}
    </main>
  );
}
