'use client';

import { signIn } from 'next-auth/react';
import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { Loader2 } from 'lucide-react';
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
  const theme = useIsDark() ? 'dark' : 'light';
  const [error, setError] = useState('');
  const [ssoLoading, setSsoLoading] = useState(false);
  const [easterEgg, setEasterEgg] = useState(false);
  const [hoverSignIn, setHoverSignIn] = useState(false);
  const botMode: DotBotMode =
    ssoLoading ? 'loading'
    : error ? 'error'
    : hoverSignIn ? 'happy'
    : 'idle';

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
        'Microsoft sign-in failed. Please try again. If it keeps failing, ask your admin to check the server log (.logs/next-auth.log in development).',
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

  return (
    <main
      title="Powered by ALOFT v0.4 · data360.synergymarinegroup.com"
      className="relative flex min-h-screen flex-col overflow-hidden bg-[var(--bg)] text-[rgb(var(--ink))] transition-colors duration-300"
      style={THEME_VARS[theme] as CSSProperties}
    >
      <DotField theme={theme} />
      <span aria-hidden className="pointer-events-none absolute left-1/2 top-[38%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--bloom)] blur-[120px]" />

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
              ambient={false}
              theme={theme}
            />
            <h1 className="mt-2 text-[length:var(--type-kpi-lg-size)] font-semibold tracking-tight">
              Welcome to Agent Lab
            </h1>
            <p className="mt-2 text-[length:var(--type-body-size)] text-[rgb(var(--ink)/0.55)]">Design, stage and operate AI agent pipelines.</p>
          </div>

          <div className="mt-9">
            <button
              type="button"
              onClick={handleSSOLogin}
              onMouseEnter={() => setHoverSignIn(true)}
              onMouseLeave={() => setHoverSignIn(false)}
              disabled={ssoLoading}
              className="flex h-11 w-full items-center justify-center gap-3 rounded-xl bg-[var(--ms-bg)] text-[length:var(--type-body-size)] font-semibold text-[var(--ms-ink)] transition hover:bg-[var(--ms-hover)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
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

            {error && (
              <p
                role="alert"
                className="mt-5 rounded-xl border border-[#ff6b81]/25 bg-[#ff6b81]/10 px-4 py-3 text-center text-size-body text-[var(--bad)]"
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
