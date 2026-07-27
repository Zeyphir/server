import { useState } from 'react';
import { LockKeyhole, MailCheck, UserPlus } from 'lucide-react';

export function AuthPanel({ onRegister, onVerify, onLogin, pendingVerification, busy, error, storageReady = true }) {
  const [mode, setMode] = useState('register');
  const [form, setForm] = useState({
    pseudo: '',
    uniqueId: '',
    email: '',
    password: '',
    code: ''
  });

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-brand">
          <LockKeyhole size={28} />
          <div>
            <h1>Secure Messenger</h1>
            <p>Messagerie locale, E2EE et appels P2P.</p>
          </div>
        </div>

        {!storageReady && (
          <p className="storage-warning">
            Stockage Electron indisponible : mode navigateur temporaire, les données locales ne seront pas persistées.
          </p>
        )}

        <div className="auth-tabs">
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
            Inscription
          </button>
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Connexion
          </button>
        </div>

        {mode === 'register' && (
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              onRegister(form);
            }}
          >
            <input value={form.pseudo} onChange={(event) => update('pseudo', event.target.value)} placeholder="Pseudo" />
            <input
              value={form.uniqueId}
              onChange={(event) => update('uniqueId', event.target.value)}
              placeholder="Identifiant unique"
            />
            <input value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="Email" />
            <input
              value={form.password}
              onChange={(event) => update('password', event.target.value)}
              placeholder="Mot de passe"
              type="password"
            />
            <button className="primary" disabled={busy}>
              <UserPlus size={18} />
              Créer le compte
            </button>
          </form>
        )}

        {pendingVerification && (
          <form
            className="auth-form verify"
            onSubmit={(event) => {
              event.preventDefault();
              onVerify({ ...form, email: pendingVerification.email || form.email });
            }}
          >
            <p>
              Code envoyé à <strong>{pendingVerification.email}</strong>
              {pendingVerification.devVerificationCode ? ` : ${pendingVerification.devVerificationCode}` : ''}
            </p>
            <input value={form.code} onChange={(event) => update('code', event.target.value)} placeholder="Code email" />
            <button className="primary" disabled={busy}>
              <MailCheck size={18} />
              Vérifier et générer les clés
            </button>
          </form>
        )}

        {mode === 'login' && (
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              onLogin(form);
            }}
          >
            <input value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="Email" />
            <input
              value={form.password}
              onChange={(event) => update('password', event.target.value)}
              placeholder="Mot de passe"
              type="password"
            />
            <button className="primary" disabled={busy}>
              <LockKeyhole size={18} />
              Ouvrir la session locale
            </button>
          </form>
        )}

        {error && <p className="form-error">{error}</p>}
      </section>
    </main>
  );
}