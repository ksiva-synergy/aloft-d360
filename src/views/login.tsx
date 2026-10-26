'use client';

import { signIn } from 'next-auth/react';
import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { useRouter } from '@/lib/navigation';
import { Eye, EyeOff, Loader2, ChevronDown } from 'lucide-react';
import { BrandMark } from '@/components/shell/BrandMark';
import { DotCompanion, DotField, type DotBotMode } from '@/components/login/AgentScene';
import { useIsDark } from '@/hooks/useIsDark';

/**
 * Login colours per theme, as CSS variables on <main>. `--ink` is an "r g b" triple so classes can use any
 * opacity of it, e.g. `text-[rgb(var(--ink)/0.5)]`.
 */
const THEME_VARS = {
  dark: {
    '--bg': '#0b0a16', '--ink': '255 255 255', '--field': 'rgb(255 255 255 / 0.04)', '--field-focus': 'rgb(255 255 255 / 0.06)',
    '--focus': '143 180 255', '--bloom': 'rgb(90 123 220 / 0.2)', '--ms-bg': '#ffffff', '--ms-ink': '#0b0a16',
    '--ms-hover': 'rgb(255 255 255 / 0.9)', '--bad': '#ff9fae',
    '--toast-bg': '#ffffff', '--toast-ink': '#0b0a16', colorScheme: 'dark',
  },
  light: {
    '--bg': '#f4f6fb', '--ink': '15 20 48', '--field': '#ffffff', '--field-focus': '#ffffff',
    '--focus': '79 107 255', '--bloom': 'rgb(143 176 255 / 0.3)', '--ms-bg': '#0f1430', '--ms-ink': '#ffffff',
    '--ms-hover': '#1c2350', '--bad': '#be123c',
    '--toast-bg': '#0f1430', '--toast-ink': '#ffffff', colorScheme: 'light',
  },
} as const;

const KONAMI = [
  'ArrowUp','ArrowUp','ArrowDown','ArrowDown',
  'ArrowLeft','ArrowRight','ArrowLeft','ArrowRight',
  'KeyB','KeyA',
];

export default function LoginPage() {
  const router = useRouter();
  const theme = useIsDark() ? 'dark' : 'light';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [easterEgg, setEasterEgg] = useState(false);
  const [focus, setFocus] = useState<'email' | 'password' | null>(null);
  const [hoverSignIn, setHoverSignIn] = useState(false);
  const [success, setSuccess] = useState(false);
  const [keystrokes, setKeystrokes] = useState(0);

  // Typing in a field takes priority over a lingering error, so Dot looks away for the password.
  const botMode: DotBotMode =
    loading || ssoLoading ? 'loading'
    : success ? 'success'
    : focus === 'password' ? (showPassword ? 'peek' : 'privacy')
    : focus === 'email' ? 'watching'
    : error ? 'error'
    : hoverSignIn ? 'happy'
    : 'idle';

  // "senthil.s@…" → "Senthil", for Dot's greeting
  const localPart = email.split('@')[0].split(/[._\-+0-9]/)[0];
  const firstName = email.includes('@') && localPart.length >= 2
    ? localPart[0].toUpperCase() + localPart.slice(1).toLowerCase()
    : '';

  // Konami code easter egg
  const konamiBuffer = useState<string[]>([])[0];
  const handleKonami = useCallback((e: KeyboardEvent) => {
    konamiBuffer.push(e.code);
    if (konamiBuffer.length > KONAMI.length) konamiBuffer.shift();
    if (konamiBuffer.length === KONAMI.length && konamiBuffer.every((k, i) => k === KONAMI[i])) {
      setEasterEgg(true);
      setTimeout(() => setEasterEgg(false), 4000);
    }
  }, [konamiBuffer]);

  useEffect(() => {
    window.addEventListener('keydown', handleKonami);
    return () => window.removeEventListener('keydown', handleKonami);
  }, [handleKonami]);

  // Surface a denied SSO sign-in reason redirected here by the AzureAD callback.
  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get('error');
    if (err === 'account_link_required') {
      setError('An account with this email already exists and must be linked by an administrator.');
    } else if (err === 'ACCOUNT_SUSPENDED') {
      setError('Your account has been suspended. Please contact your administrator.');
    } else if (err === 'OAuthCallback' || err === 'Callback') {
      setError(
        'Microsoft sign-in failed. Try again, or use Admin login below. If it keeps failing, ask your admin to check the server log (.logs/next-auth.log in development).',
      );
    }
  }, []);

  async function handleSSOLogin() {
    setSsoLoading(true);
    setError('');
    try {
      await signIn('azure-ad', { callbackUrl: '/dashboard' });
    } catch {
      setError('Unable to connect to Azure AD. Please try again.');
      setSsoLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await signIn('credentials', {
      email,
      password,
      rememberMe: rememberMe ? '1' : '0',
      redirect: false,
    });

    if (!result?.ok) {
      if (result?.error === 'ACCOUNT_SUSPENDED') {
        setError('Your account has been suspended. Please contact your administrator.');
      } else {
        setError('Invalid email or password');
      }
      setLoading(false);
      return;
    }

    setSuccess(true);
    // App Router: refresh server session cache, then hard-navigate so the cookie is applied
    router.refresh();
    window.location.assign('/dashboard');
  }

  const field =
    'h-11 w-full rounded-xl border border-[rgb(var(--ink)/0.1)] bg-[var(--field)] px-4 text-[15px] text-[rgb(var(--ink))] outline-none transition placeholder:text-[rgb(var(--ink)/0.35)] hover:border-[rgb(var(--ink)/0.2)] focus:border-[rgb(var(--focus))] focus:bg-[var(--field-focus)] focus:ring-4 focus:ring-[rgb(var(--focus)/0.15)]';

  return (
    <main
      title="Powered by ALOFT v0.4 · data360.synergymarinegroup.com"
      className="relative flex min-h-screen flex-col overflow-hidden bg-[var(--bg)] text-[rgb(var(--ink))] transition-colors duration-300"
      style={THEME_VARS[theme] as CSSProperties}
    >
      <DotField theme={theme} />
      <span aria-hidden className="pointer-events-none absolute left-1/2 top-[38%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--bloom)] blur-[120px]" />

      {/* Top bar */}
      <header className="relative flex h-[var(--shell-header-h,4rem)] items-center gap-3 px-6 sm:px-10">
        <BrandMark size={32} />
        <span className="text-sm font-semibold tracking-tight text-[rgb(var(--ink)/0.9)]">Synergy Group</span>
        <span className="text-sm text-[rgb(var(--ink)/0.45)]">Data 360</span>
      </header>

      {/* Centre column */}
      <section className="relative flex flex-1 items-center justify-center px-4 pb-10">
        <div className="w-full max-w-[380px]">
          <div className="flex flex-col items-center text-center">
            <DotCompanion
              mode={botMode}
              name={firstName}
              keystrokes={keystrokes}
              progress={Math.min(email.length / 22, 1)}
              ambient={false}
              theme={theme}
            />
            <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.02em]">
              Welcome to Agent Lab
            </h1>
            <p className="mt-2 text-[15px] text-[rgb(var(--ink)/0.55)]">Design, stage and operate AI agent pipelines.</p>
          </div>

          <div className="mt-9">
            <button
              type="button"
              onClick={handleSSOLogin}
              onMouseEnter={() => setHoverSignIn(true)}
              onMouseLeave={() => setHoverSignIn(false)}
              disabled={ssoLoading || loading}
              className="flex h-11 w-full items-center justify-center gap-3 rounded-xl bg-[var(--ms-bg)] text-[15px] font-semibold text-[var(--ms-ink)] transition hover:bg-[var(--ms-hover)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {ssoLoading ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" />
              ) : (
                <span className="grid h-[18px] w-[18px] grid-cols-2 gap-px" aria-hidden>
                  <i className="bg-[#f25022]" /><i className="bg-[#7fba00]" /><i className="bg-[#00a4ef]" /><i className="bg-[#ffb900]" />
                </span>
              )}
              {ssoLoading ? 'Redirecting to Microsoft…' : 'Continue with Microsoft'}
            </button>

            <button
              type="button"
              onClick={() => setShowCredentials(!showCredentials)}
              aria-expanded={showCredentials}
              className="mx-auto mt-5 flex items-center gap-1.5 text-sm text-[rgb(var(--ink)/0.5)] transition-colors hover:text-[rgb(var(--ink)/0.85)]"
            >
              Admin login
              <ChevronDown className={`h-4 w-4 transition-transform ${showCredentials ? 'rotate-180' : ''}`} />
            </button>

            {showCredentials && (
              <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3 animate-slide-in-from-top-2">
                <label htmlFor="login-email" className="sr-only">Username</label>
                <input
                  id="login-email"
                  type="email"
                  placeholder="Username"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setKeystrokes(k => k + 1); }}
                  onFocus={() => setFocus('email')}
                  onBlur={() => setFocus(null)}
                  required
                  autoComplete="username"
                  className={field}
                />

                <label htmlFor="login-password" className="sr-only">Password</label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setKeystrokes(k => k + 1); }}
                    onFocus={() => setFocus('password')}
                    onBlur={() => setFocus(null)}
                    required
                    autoComplete="current-password"
                    className={`${field} pr-11`}
                  />
                  <button
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[rgb(var(--ink)/0.45)] transition-colors hover:bg-[rgb(var(--ink)/0.08)] hover:text-[rgb(var(--ink))]"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                <div className="mt-1 flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-[rgb(var(--ink)/0.6)]">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={e => setRememberMe(e.target.checked)}
                      className="h-4 w-4 rounded accent-[rgb(var(--focus))]"
                    />
                    Remember me
                  </label>
                </div>

                <button
                  type="submit"
                  onMouseEnter={() => setHoverSignIn(true)}
                  onMouseLeave={() => setHoverSignIn(false)}
                  disabled={loading}
                  className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#5b6cff] text-[15px] font-semibold text-white shadow-[0_10px_30px_-12px_#5b6cff] transition hover:bg-[#6b7bff] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            )}

            {error && (
              <p
                role="alert"
                className="mt-5 rounded-xl border border-[#ff6b81]/25 bg-[#ff6b81]/10 px-4 py-3 text-center text-sm text-[var(--bad)]"
              >
                {error}
              </p>
            )}
          </div>
        </div>
      </section>

      <footer className="relative px-6 pb-6 text-center text-xs text-[rgb(var(--ink)/0.4)]">
        &copy; 2026 &ndash; Synergy Maritime Pvt. Ltd. · Powered by ALOFT
      </footer>

      {/* Easter egg: invisible in DOM, findable in source */}
      <span style={{ opacity: 0, position: 'absolute', fontSize: 0, pointerEvents: 'none' }} aria-hidden="true">
        data360.synergymarinegroup.com
      </span>

      {/* Konami code toast */}
      {easterEgg && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 animate-fade-in rounded-full bg-[var(--toast-bg)] px-6 py-3 text-sm font-semibold text-[var(--toast-ink)] shadow-pop"
        >
          Built on Data 360 ALOFT v0.4
        </div>
      )}
    </main>
  );
}
