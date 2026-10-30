'use client';

import { signIn } from 'next-auth/react';
import { useState, useEffect, useCallback, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from '@/lib/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { BrandMark } from '@/components/shell/BrandMark';
import { DotCompanion, DotField, type DotBotMode } from '@/components/login/AgentScene';
import { useIsDark } from '@/hooks/useIsDark';

/**
 * Login colours per theme, as CSS variables on <main>. `--ink` is an "r g b" triple so classes can use any
 * opacity of it, e.g. `text-[rgb(var(--ink)/0.5)]`.
 */
const THEME_VARS = {
  dark: {
    '--bg': '#070b18', '--ink': '255 255 255', '--field': 'rgb(255 255 255 / 0.04)', '--field-focus': 'rgb(255 255 255 / 0.06)',
    '--focus': '143 180 255', '--aurora-a': 'rgb(14 165 233 / 0.16)', '--aurora-b': 'rgb(99 102 241 / 0.2)',
    '--card': 'rgb(255 255 255 / 0.035)', '--card-edge': 'rgb(255 255 255 / 0.08)', '--card-shadow': '0 24px 60px -30px rgb(0 0 0 / 0.8)',
    '--ms-bg': '#ffffff', '--ms-ink': '#0b0a16',
    '--ms-hover': 'rgb(255 255 255 / 0.9)', '--bad': '#ff9fae',
    '--toast-bg': '#ffffff', '--toast-ink': '#0b0a16', colorScheme: 'dark',
  },
  light: {
    '--bg': '#fbfcfe', '--ink': '15 20 48', '--field': '#f6f8fc', '--field-focus': '#ffffff',
    '--focus': '79 107 255', '--aurora-a': 'rgb(56 189 248 / 0.22)', '--aurora-b': 'rgb(129 140 248 / 0.2)',
    '--card': 'rgb(255 255 255 / 0.78)', '--card-edge': 'rgb(15 20 48 / 0.07)', '--card-shadow': '0 24px 60px -28px rgb(30 41 79 / 0.22)',
    '--ms-bg': '#0f1430', '--ms-ink': '#ffffff',
    '--ms-hover': '#1c2350', '--bad': '#be123c',
    '--toast-bg': '#0f1430', '--toast-ink': '#ffffff', colorScheme: 'light',
  },
} as const;

const KONAMI = [
  'ArrowUp','ArrowUp','ArrowDown','ArrowDown',
  'ArrowLeft','ArrowRight','ArrowLeft','ArrowRight',
  'KeyB','KeyA',
];

const credentialsUiEnabled = process.env.NEXT_PUBLIC_ENABLE_CREDENTIALS_LOGIN !== 'false';

export default function LoginPage() {
  const router = useRouter();
  const theme = useIsDark() ? 'dark' : 'light';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focusField, setFocusField] = useState<'email' | 'password' | null>(null);
  const [error, setError] = useState('');
  const [ssoLoading, setSsoLoading] = useState(false);
  const [credLoading, setCredLoading] = useState(false);
  const [easterEgg, setEasterEgg] = useState(false);
  const [hoverSignIn, setHoverSignIn] = useState(false);
  const botMode: DotBotMode =
    ssoLoading || credLoading ? 'loading'
    : error ? 'error'
    : focusField === 'password' ? (showPassword ? 'peek' : 'privacy')
    : focusField === 'email' ? 'watching'
    : hoverSignIn ? 'happy'
    : 'idle';

  const fieldClass =
    'h-10 w-full rounded-full border border-[rgb(var(--ink)/0.12)] bg-[var(--field)] px-4 text-[length:var(--type-body-size)] text-[rgb(var(--ink))] outline-none transition placeholder:text-[rgb(var(--ink)/0.45)] hover:border-[rgb(var(--ink)/0.2)] focus:border-[rgb(var(--focus)/0.55)] focus:bg-[var(--field-focus)] focus:ring-2 focus:ring-[rgb(var(--focus)/0.25)] disabled:opacity-60 [&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_var(--field)] [&:-webkit-autofill]:[-webkit-text-fill-color:rgb(var(--ink))]';

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

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get('error');
    if (err === 'account_link_required') {
      setError('An account with this email already exists and must be linked by an administrator.');
    } else if (err === 'ACCOUNT_SUSPENDED') {
      setError('Your account has been suspended. Please contact your administrator.');
    } else if (err === 'OAuthCallback' || err === 'Callback') {
      setError(
        'Microsoft sign-in failed. Try again, or sign in with your username and password below. If it keeps failing, ask your admin to check the server log (.logs/next-auth.log in development).',
      );
    } else if (err === 'CredentialsSignin') {
      setError('Invalid email or password.');
    }
  }, []);

  async function handleCredentialsLogin(e: FormEvent) {
    e.preventDefault();
    setCredLoading(true);
    setError('');
    try {
      const result = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
        callbackUrl: '/dashboard',
      });
      if (result?.error) {
        setError('Invalid email or password.');
        return;
      }
      router.push(result?.url ?? '/dashboard');
    } catch {
      setError('Unable to sign in. Please try again.');
    } finally {
      setCredLoading(false);
    }
  }

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

  return (
    <main
      title="Powered by ALOFT v0.4 · data360.synergymarinegroup.com"
      className="relative flex min-h-screen flex-col overflow-hidden bg-[var(--bg)] text-[rgb(var(--ink))] transition-colors duration-300"
      style={THEME_VARS[theme] as CSSProperties}
    >
      <DotField theme={theme} />
      {/* aurora: two soft corner glows frame the page instead of washing the centre */}
      <span aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-[var(--aurora-a)] blur-[140px]" />
      <span aria-hidden className="pointer-events-none absolute -bottom-48 -right-40 h-[620px] w-[620px] rounded-full bg-[var(--aurora-b)] blur-[150px]" />

      <header className="relative flex h-[var(--shell-header-h,4rem)] items-center gap-3 px-6 sm:px-10">
        <BrandMark size={32} />
        <span className="text-size-body font-semibold tracking-tight text-[rgb(var(--ink)/0.9)]">Synergy Group</span>
        <span className="text-size-body text-[rgb(var(--ink)/0.45)]">Data 360</span>
      </header>

      <section className="relative flex flex-1 items-center justify-center px-4 pb-10">
        <div className="w-full max-w-[380px]">
          <div className="flex flex-col items-center text-center">
            <DotCompanion
              mode={botMode}
              name=""
              keystrokes={0}
              progress={0}
              ambient
              theme={theme}
            />
            <h1 className="mt-2 text-[length:var(--type-kpi-lg-size)] font-semibold tracking-tight">
              Welcome to Agent Lab
            </h1>
            <p className="mt-2 text-[length:var(--type-body-size)] text-[rgb(var(--ink)/0.55)]">Design, stage and operate AI agent pipelines.</p>
          </div>

          <div className="mt-7 rounded-[28px] border border-[var(--card-edge)] bg-[var(--card)] p-6 shadow-[var(--card-shadow)] backdrop-blur-xl">
            <button
              type="button"
              onClick={handleSSOLogin}
              onMouseEnter={() => setHoverSignIn(true)}
              onMouseLeave={() => setHoverSignIn(false)}
              disabled={ssoLoading || credLoading}
              className="flex h-10 w-full items-center justify-center gap-2.5 rounded-full bg-[var(--ms-bg)] text-[length:var(--type-body-size)] font-semibold text-[var(--ms-ink)] shadow-[0_8px_20px_-12px_rgb(var(--ink)/0.5)] transition hover:-translate-y-px hover:bg-[var(--ms-hover)] active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {ssoLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="grid h-4 w-4 grid-cols-2 gap-px" aria-hidden>
                  <i className="bg-[#f25022]" /><i className="bg-[#7fba00]" /><i className="bg-[#00a4ef]" /><i className="bg-[#ffb900]" />
                </span>
              )}
              {ssoLoading ? 'Redirecting to Microsoft…' : 'Continue with Microsoft'}
            </button>

            {credentialsUiEnabled && (
              <>
                <div className="my-5 flex items-center gap-3 text-size-ui text-[rgb(var(--ink)/0.4)]" aria-hidden>
                  <span className="h-px flex-1 bg-[rgb(var(--ink)/0.1)]" />
                  <span className="whitespace-nowrap">or use username &amp; password</span>
                  <span className="h-px flex-1 bg-[rgb(var(--ink)/0.1)]" />
                </div>

                <form onSubmit={handleCredentialsLogin} aria-label="Username and password sign in" className="flex flex-col gap-2.5">
                  <label htmlFor="login-email" className="sr-only">
                    Email
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocusField('email')}
                    onBlur={() => setFocusField(null)}
                    placeholder="Email address"
                    disabled={credLoading || ssoLoading}
                    className={fieldClass}
                  />

                  <label htmlFor="login-password" className="sr-only">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onFocus={() => setFocusField('password')}
                      onBlur={() => setFocusField(null)}
                      placeholder="Password"
                      disabled={credLoading || ssoLoading}
                      className={`${fieldClass} pr-11`}
                    />
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[rgb(var(--ink)/0.4)] transition-colors hover:bg-[rgb(var(--ink)/0.08)] hover:text-[rgb(var(--ink)/0.85)]"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  <button
                    type="submit"
                    onMouseEnter={() => setHoverSignIn(true)}
                    onMouseLeave={() => setHoverSignIn(false)}
                    disabled={credLoading || ssoLoading}
                    className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#0284c7] to-[#4f46e5] text-[length:var(--type-body-size)] font-semibold text-white shadow-[0_8px_22px_-10px_rgb(2_132_199/0.65)] transition hover:-translate-y-px hover:brightness-110 hover:shadow-[0_10px_26px_-10px_rgb(79_70_229/0.7)] active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {credLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    {credLoading ? 'Signing in…' : 'Sign in'}
                  </button>
                </form>
              </>
            )}

            {error && (
              <p
                role="alert"
                className="mt-5 rounded-2xl border border-[#ff6b81]/25 bg-[#ff6b81]/10 px-4 py-3 text-center text-size-body text-[var(--bad)]"
              >
                {error}
              </p>
            )}
          </div>
        </div>
      </section>

      <footer className="relative px-6 pb-6 text-center text-size-ui text-[rgb(var(--ink)/0.4)]">
        &copy; 2026 &ndash; Synergy Maritime Pvt. Ltd. · Powered by ALOFT
      </footer>

      <span style={{ opacity: 0, position: 'absolute', fontSize: 0, pointerEvents: 'none' }} aria-hidden="true">
        data360.synergymarinegroup.com
      </span>

      {easterEgg && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 animate-fade-in rounded-full bg-[var(--toast-bg)] px-6 py-3 text-size-body font-semibold text-[var(--toast-ink)] shadow-pop"
        >
          Built on Data 360 ALOFT v0.4
        </div>
      )}
    </main>
  );
}
