'use client';

import { signIn } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, ChevronDown } from 'lucide-react';
import { BrandMark } from '@/components/shell/BrandMark';
import { DotBot, DotField, type DotBotMode } from '@/components/login/AgentScene';

const KONAMI = [
  'ArrowUp','ArrowUp','ArrowDown','ArrowDown',
  'ArrowLeft','ArrowRight','ArrowLeft','ArrowRight',
  'KeyB','KeyA',
];

export default function LoginPage() {
  const router = useRouter();
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

  const botMode: DotBotMode =
    loading || ssoLoading ? 'loading'
    : error ? 'error'
    : focus === 'password' ? (showPassword ? 'peek' : 'privacy')
    : focus === 'email' ? 'watching'
    : hoverSignIn ? 'happy'
    : 'idle';

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

    // App Router: refresh server session cache, then hard-navigate so the cookie is applied
    router.refresh();
    window.location.assign('/dashboard');
  }

  const field =
    'h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-[15px] text-white outline-none transition placeholder:text-white/30 hover:border-white/20 focus:border-[#8fb4ff] focus:bg-white/[0.06] focus:ring-4 focus:ring-[#8fb4ff]/15';

  return (
    <main
      title="Powered by ALOFT v0.4 · data360.synergymarinegroup.com"
      className="relative flex min-h-screen flex-col overflow-hidden bg-[#0b0a16] text-white"
    >
      <DotField />
      <span aria-hidden className="pointer-events-none absolute left-1/2 top-[38%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#5a7bdc]/20 blur-[120px]" />

      {/* Top bar */}
      <header className="relative flex items-center gap-3 px-6 py-5 sm:px-10">
        <BrandMark size={32} />
        <span className="text-sm font-semibold tracking-tight text-white/90">Synergy Group</span>
        <span className="text-sm text-white/40">Data 360</span>
      </header>

      {/* Centre column */}
      <section className="relative flex flex-1 items-center justify-center px-4 pb-10">
        <div className="w-full max-w-[380px]">
          <div className="flex flex-col items-center text-center">
            <DotBot mode={botMode} size={108} />
            <h1 className="mt-6text-[28px] font-semibold tracking-[-0.02em]">Welcome to Agent Lab</h1>
            <p className="mt-2 text-[15px] text-white/50">Design, stage and operate AI agent pipelines.</p>
          </div>

          <div className="mt-9">
            <button
              type="button"
              onClick={handleSSOLogin}
              onMouseEnter={() => setHoverSignIn(true)}
              onMouseLeave={() => setHoverSignIn(false)}
              disabled={ssoLoading || loading}
              className="flex h-11 w-full items-center justify-center gap-3 rounded-xl bg-white text-[15px] font-semibold text-[#0b0a16] transition hover:bg-white/90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
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
              className="mx-auto mt-5 flex items-center gap-1.5 text-sm text-white/45 transition-colors hover:text-white/80"
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
                  onChange={e => setEmail(e.target.value)}
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
                    onChange={e => setPassword(e.target.value)}
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
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                <div className="mt-1 flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-white/55">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={e => setRememberMe(e.target.checked)}
                      className="h-4 w-4 rounded accent-[#8fb4ff]"
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
                className="mt-5 rounded-xl border border-[#ff6b81]/25 bg-[#ff6b81]/10 px-4 py-3 text-center text-sm text-[#ff9fae]"
              >
                {error}
              </p>
            )}
          </div>
        </div>
      </section>

      <footer className="relative px-6 pb-6 text-center text-xs text-white/30">
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
          className="fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 animate-fade-in rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#0b0a16] shadow-pop"
        >
          Built on Data 360 ALOFT v0.4
        </div>
      )}
    </main>
  );
}
