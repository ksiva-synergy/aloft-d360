'use client';

import { signIn, useSession } from 'next-auth/react';
import { useState, useEffect, useCallback, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from '@/lib/navigation';
import { Eye, EyeOff, Loader2, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { BrandMark } from '@/components/shell/BrandMark';
import { DotCompanion, type DotBotMode } from '@/components/login/AgentScene';
import { LoginBackdrop } from '@/components/login/LoginBackdrop';
import { LOGIN_COLUMN_MAX_PX } from '@/components/login/layout';
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
    '--cta-from': '#0284c7', '--cta-to': '#4f46e5', '--cta-glow': 'rgb(2 132 199 / 0.65)',
    '--toast-bg': '#ffffff', '--toast-ink': '#0b0a16', colorScheme: 'dark',
  },
  light: {
    // matches the app's day theme ("Sage Studio": sage neutrals + terracotta accent, see globals.css Theme v2)
    '--bg': '#F4F6F1', '--ink': '26 35 28', '--field': '#FFFFFF', '--field-focus': '#FFFFFF',
    '--focus': '168 72 31', '--aurora-a': 'rgb(194 101 58 / 0.14)', '--aurora-b': 'rgb(122 150 110 / 0.18)',
    '--card': '#FFFFFF', '--card-edge': '#E1E6DA', '--card-shadow': '0 24px 60px -28px rgb(26 35 28 / 0.2)',
    '--ms-bg': '#1A231C', '--ms-ink': '#ffffff',
    '--ms-hover': '#2A352C', '--bad': '#B42323',
    '--cta-from': '#A8481F', '--cta-to': '#C2653A', '--cta-glow': 'rgb(168 72 31 / 0.45)',
    '--toast-bg': '#1A231C', '--toast-ink': '#ffffff', colorScheme: 'light',
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
  const { status: sessionStatus, data: sessionData } = useSession();
  const alreadySignedIn =
    sessionStatus === 'authenticated' && !!sessionData?.user?.id && sessionData.error !== 'SessionRevoked';
  const theme = useIsDark() ? 'dark' : 'light';
  const { setTheme } = useTheme();
  const headerBtn =
    'relative grid h-9 w-9 place-items-center rounded-full border border-[rgb(var(--ink)/0.12)] bg-[var(--field)] text-[rgb(var(--ink)/0.7)] transition-[transform,background-color,color,border-color] duration-150 ease-out hover:border-[rgb(var(--ink)/0.22)] hover:text-[rgb(var(--ink))] active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus)/0.45)]';
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
    if (!alreadySignedIn) return;
    const next = new URLSearchParams(window.location.search).get('callbackUrl');
    const dest =
      next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/dashboard';
    router.replace(dest);
  }, [alreadySignedIn, router]);

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get('error');
    if (err === 'account_link_required') {
      setError('An account with this email already exists and must be linked by an administrator.');
    } else if (err === 'ACCOUNT_SUSPENDED') {
      setError('Your account has been suspended. Please contact your administrator.');
    } else if (err === 'session_expired') {
      setError('Your session is no longer valid. Sign in again with Microsoft.');
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

  if (alreadySignedIn) {
    return (
      <div
        role="status"
        className="flex min-h-screen items-center justify-center text-size-body text-[var(--ink-3)]"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        Loading…
      </div>
    );
  }

  return (
    <main
      title="Powered by ALOFT v0.4"
      className="relative flex min-h-screen flex-col overflow-hidden bg-[var(--bg)] text-[rgb(var(--ink))] transition-colors duration-300"
      style={THEME_VARS[theme] as CSSProperties}
    >
      {theme === 'dark' && (
        // night: a fine full-page gradient (deep sapphire top → graphite middle → faint indigo bottom) under the contours
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 70% at 50% 0%, rgba(40,78,160,.30), rgba(40,78,160,0) 60%),' +
              'linear-gradient(170deg, #0b1530 0%, #080d1d 45%, #0a0a20 75%, #120f2e 100%)',
          }}
        />
      )}
      <LoginBackdrop theme={theme} />
      {/* aurora: two soft corner glows frame the page instead of washing the centre */}
      <span aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-[var(--aurora-a)] blur-[140px]" />
      <span aria-hidden className="pointer-events-none absolute -bottom-48 -right-40 h-[620px] w-[620px] rounded-full bg-[var(--aurora-b)] blur-[150px]" />

      <header className="relative flex h-16 items-center gap-3 px-6 sm:px-10">
        <BrandMark size={32} />
        <span className="text-size-body font-semibold tracking-tight text-[rgb(var(--ink)/0.9)]">Synergy Group</span>
        <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? 'Switch to day theme' : 'Switch to night theme'}
          title={theme === 'dark' ? 'Day theme' : 'Night theme'}
          className={headerBtn}
        >
          <Sun
            aria-hidden
            className={`absolute h-4 w-4 transition-[opacity,transform] duration-200 ease-out ${theme === 'dark' ? 'scale-100 rotate-0 opacity-100' : 'scale-50 -rotate-90 opacity-0'}`}
          />
          <Moon
            aria-hidden
            className={`absolute h-4 w-4 transition-[opacity,transform] duration-200 ease-out ${theme === 'dark' ? 'scale-50 rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100'}`}
          />
        </button>
        </div>
      </header>

      <section className="relative flex flex-1 items-center justify-center px-4 pb-10">
        <div className="w-full" style={{ maxWidth: LOGIN_COLUMN_MAX_PX }}>
          <div className="flex flex-col items-center text-center">
            <DotCompanion
              mode={botMode}
              name=""
              keystrokes={0}
              progress={0}
              ambient={false}
              particles={false}
              theme={theme}
            />
            <h1 className="mt-2 text-[length:var(--type-kpi-lg-size)] font-semibold tracking-tight">
              Welcome to Agent Lab
            </h1>
            <p className="mt-2 text-[length:var(--type-body-size)] text-[rgb(var(--ink)/0.55)]">Design, stage and operate AI agent pipelines.</p>
          </div>

          <div className="mt-8 w-full">
            <button
              type="button"
              onClick={handleSSOLogin}
              onMouseEnter={() => setHoverSignIn(true)}
              onMouseLeave={() => setHoverSignIn(false)}
              disabled={ssoLoading || credLoading}
              className="flex h-10 w-full items-center justify-center gap-2.5 rounded-full bg-[var(--ms-bg)] px-4 text-[length:var(--type-body-size)] font-semibold text-[var(--ms-ink)] shadow-[0_8px_20px_-12px_rgb(var(--ink)/0.5)] transition hover:-translate-y-px hover:bg-[var(--ms-hover)] active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
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
                <div
                  className="my-5 grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 text-size-ui text-[rgb(var(--ink)/0.4)]"
                  aria-hidden
                >
                  <span className="h-px bg-[rgb(var(--ink)/0.1)]" />
                  <span className="px-1 text-center leading-snug">or email &amp; password</span>
                  <span className="h-px bg-[rgb(var(--ink)/0.1)]" />
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
                    className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[var(--cta-from)] to-[var(--cta-to)] text-[length:var(--type-body-size)] font-semibold text-white shadow-[0_8px_22px_-10px_var(--cta-glow)] transition hover:-translate-y-px hover:brightness-110 hover:shadow-[0_10px_26px_-10px_var(--cta-glow)] active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
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
                className="mt-5 rounded-2xl border border-[#ff6b81]/25 bg-[#ff6b81]/10 px-4 py-3 text-left text-size-ui leading-relaxed text-[var(--bad)] sm:text-size-body"
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

      {easterEgg && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 animate-fade-in rounded-full bg-[var(--toast-bg)] px-6 py-3 text-size-body font-semibold text-[var(--toast-ink)] shadow-pop"
        >
          Built on ALOFT v0.4
        </div>
      )}
    </main>
  );
}
