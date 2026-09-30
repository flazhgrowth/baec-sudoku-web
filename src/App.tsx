import { useEffect, useState } from 'react';
import { GameScreen } from './components/GameScreen';
import { ChangePassword } from './components/ChangePassword';
import { Credits } from './components/Credits';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Login } from './components/Login';
import { useAuth } from './hooks/useAuth';
import { useGame } from './hooks/useGame';

export function App() {
  const auth = useAuth();
  const { game, me, clockOffset, loading, error, feedback, notice, create, join, submit, quit } = useGame(auth.token);
  // Invite links look like /?join=ABC234
  const [inviteCode] = useState(() => new URLSearchParams(location.search).get('join'));

  useEffect(() => {
    if (game && inviteCode) history.replaceState(null, '', location.pathname);
  }, [game, inviteCode]);

  const [changingPassword, setChangingPassword] = useState(false);
  const [showCredits, setShowCredits] = useState(false);

  if (!auth.ready) return null;
  if (showCredits && !game) return <Credits onBack={() => setShowCredits(false)} />;
  if (!auth.user) {
    return (
      <Login
        busy={auth.busy}
        error={auth.error}
        onLogin={auth.login}
        onRegister={auth.register}
        onCredits={() => setShowCredits(true)}
      />
    );
  }

  if (changingPassword && !game) {
    return <ChangePassword onSubmit={auth.changePassword} onDone={() => setChangingPassword(false)} />;
  }
  if (game?.status === 'waiting') return <Lobby game={game} onLeave={quit} />;
  if (game) {
    return (
      <GameScreen
        game={game}
        me={me}
        clockOffset={clockOffset}
        feedback={feedback}
        notice={notice}
        onFill={submit}
        onQuit={quit}
      />
    );
  }
  return (
    <Home
      busy={loading}
      error={error}
      initialCode={inviteCode}
      username={auth.user.username}
      onCreate={create}
      onJoin={join}
      onCredits={() => setShowCredits(true)}
      onChangePassword={() => setChangingPassword(true)}
      onLogout={auth.logout}
    />
  );
}
