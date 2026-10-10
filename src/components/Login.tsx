import { useState } from 'react';
import { isConfigured, signIn } from '../lib/backend';

interface Props {
  onSignedIn: () => void;
  onDemo: () => void;
}

export function Login({ onSignedIn, onDemo }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="login">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const err = await signIn(email.trim(), password);
          setBusy(false);
          if (err) setError(err); else onSignedIn();
        }}
      >
        <img src="/icon.svg" alt="" width={72} height={72} />
        <h1>Grazin' Acres Register</h1>
        {isConfigured ? (
          <>
            <p className="muted">Sign in with the store account. This iPad stays signed in.</p>
            <label className="field"><span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
            </label>
            <label className="field"><span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </label>
            {error && <div className="error">{error}</div>}
            <button type="submit" className="btn btn-lg btn-primary full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </>
        ) : (
          <p className="muted">Not connected to the store database yet (no Supabase key configured).</p>
        )}
        <button type="button" className="btn btn-ghost full" onClick={onDemo}>Try demo with sample products</button>
      </form>
    </div>
  );
}
