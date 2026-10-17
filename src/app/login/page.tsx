'use client';

import { signIn } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Sparkles, Database, Wand2, ShieldCheck, Loader2 } from 'lucide-react';
import { BrandMark } from '@/components/shell/BrandMark';

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
        'Microsoft sign-in failed (often an expired Azure app secret). Use Admin Login below, or ask your admin to rotate AZURE_AD_CLIENT_SECRET.',
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
    'h-12 w-full rounded-xl border-[1.5px] border-[var(--line-2)] bg-[var(--surface-1)] px-4 text-[15px] font-medium text-[var(--ink-1)] outline-none transition-colors placeholder:text-[var(--ink-3)] focus:border-[var(--brand-a)] focus:ring-4 focus:ring-[var(--brand-a-soft)]';

  const highlights = [
    { Icon: Database, title: 'Inspect your data', text: 'Ask questions of governed metrics and see the SQL behind every answer.' },
    { Icon: Wand2, title: 'Teach once, reuse often', text: 'Show an agent a workflow and let it learn the pattern.' },
    { Icon: ShieldCheck, title: 'Govern with confidence', text: 'Roles, policies and a full audit trail built in.' },
  ];

  return (
    <main
      title="Powered by ALOFT v0.4 · data360.synergymarinegroup.com"
      className="relative grid min-h-screen bg-[var(--surface-2)] text-[var(--ink-1)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]"
    >
      {/* Brand panel */}
      <section
        className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col"
        style={{ background: 'linear-gradient(150deg, #1A1540 0%, #2A2251 38%, var(--brand-a-ink) 75%, #2A9BDB 130%)' }}
      >
        <span aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full border-[56px] border-white/10" />
        <span aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-white/10 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <BrandMark size={48} />
          <span className="leading-tight"><span className="block text-lg font-semibold tracking-tight">Synergy Group</span><span className="block text-sm text-white/75">Data 360 · Agent Lab</span></span>
        </div>

        <div className="relative my-auto max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3.5 py-1.5 text-sm font-semibold backdrop-blur">
            <Sparkles className="h-4 w-4" /> Powered by ALOFT
          </span>
          <h2 className="mt-6 text-5xl font-bold leading-[1.1] tracking-[-0.02em]">
            Design, stage and operate AI agent pipelines.
          </h2>
          <ul className="mt-10 space-y-5">
            {highlights.map(({ Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-base font-bold">{title}</span>
                  <span className="block text-[15px] leading-relaxed text-white/85">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-white/80">&copy; 2026 &ndash; Synergy Maritime Pvt. Ltd.</p>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[440px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark size={44} />
            <span className="leading-tight"><span className="block text-lg font-semibold tracking-tight">Synergy Group</span><span className="block text-sm text-[var(--ink-3)]">Data 360 · Agent Lab</span></span>

          </div>

          <div className="rounded-[28px] border border-[var(--line-1)] bg-[var(--surface-1)] p-8 shadow-card sm:p-10">
            <div className="mb-7 flex items-center gap-4">
              <BrandMark size={64} variant="full" />

              <div>
                <h1 className="text-[28px] font-bold tracking-[-0.02em]">Welcome back</h1>
                <p className="text-[15px] text-[var(--ink-3)]">Sign in to continue to Agent Lab</p>
              </div>
            </div>

            {/* SSO */}
            <button
              type="button"
              onClick={handleSSOLogin}
              disabled={ssoLoading || loading}
              className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[var(--brand-a)] text-[15px] font-bold text-white shadow-[0_10px_24px_-10px_var(--brand-a)] transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {ssoLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <span className="grid h-5 w-5 grid-cols-2 gap-px" aria-hidden>
                  <i className="bg-[#f25022]" /><i className="bg-[#7fba00]" /><i className="bg-[#00a4ef]" /><i className="bg-[#ffb900]" />
                </span>
              )}
              {ssoLoading ? 'Redirecting to Microsoft…' : 'Sign in with Microsoft'}
            </button>

            {/* Divider */}
            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-[var(--line-1)]" />
              <button
                type="button"
                onClick={() => setShowCredentials(!showCredentials)}
                aria-expanded={showCredentials}
                className="rounded-full border border-[var(--line-2)] px-4 py-1.5 text-sm font-semibold text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)]"
              >
                {showCredentials ? 'Hide admin login' : 'Admin login'}
              </button>
              <span className="h-px flex-1 bg-[var(--line-1)]" />
            </div>

            {/* Credentials form (collapsible) */}
            {showCredentials && (
              <form onSubmit={handleSubmit} className="flex flex-col gap-5 animate-slide-in-from-top-2">
                <div>
                  <label htmlFor="login-email" className="mb-1.5 block text-sm font-semibold">
                    Username
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    placeholder="Enter username"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="username"
                    className={field}
                  />
                </div>

                <div>
                  <label htmlFor="login-password" className="mb-1.5 block text-sm font-semibold">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className={`${field} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)]"
                    >
                      {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                    </button>
                  </div>
                </div>

                <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-[var(--ink-2)]">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    className="h-[18px] w-[18px] rounded-md accent-[var(--brand-a)]"
                  />
                  Remember me
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--ink-1)] text-[15px] font-bold text-[var(--surface-1)] transition hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            )}

            {/* Error */}
            {error && (
              <p
                role="alert"
                className="mt-5 rounded-xl border border-[var(--bad)]/30 bg-[var(--bad-bg)] px-4 py-3 text-sm font-semibold text-[var(--bad)]"
              >
                {error}
              </p>
            )}
          </div>

          <p className="mt-6 text-center text-sm text-[var(--ink-3)] lg:hidden">
            &copy; 2026 &ndash; Synergy Maritime Pvt. Ltd.
          </p>
        </div>
      </section>

      {/* Easter egg: invisible in DOM, findable in source */}
      <span style={{ opacity: 0, position: 'absolute', fontSize: 0, pointerEvents: 'none' }} aria-hidden="true">
        data360.synergymarinegroup.com
      </span>

      {/* Konami code toast */}
      {easterEgg && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 animate-fade-in rounded-full bg-[var(--ink-1)] px-6 py-3 text-sm font-semibold text-[var(--surface-1)] shadow-pop"
        >
          Built on Data 360 ALOFT v0.4
        </div>
      )}
    </main>
  );
}