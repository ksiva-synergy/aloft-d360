'use client';

import { signIn } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

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

    if (result?.error) {
      setError('Invalid email or password');
      setLoading(false);
    } else {
      router.push('/dashboard');
    }
  }

  return (
    <main
      title="Powered by ALOFT v0.4 · spinorlabs.io"
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #4B55C1 0%, #3B6FCA 50%, #5B7FE8 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Inter Tight', sans-serif",
        padding: '24px',
        position: 'relative',
      }}
    >
      {/* Login card */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '16px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          padding: '48px 40px 36px',
          width: '100%',
          maxWidth: '420px',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
            <Image
              src="/synergy-group-logo.png"
              alt="Synergy Group"
              width={88}
              height={88}
              priority
              style={{ objectFit: 'contain' }}
            />
          </div>
          <h1
            style={{
              fontFamily: "'Source Serif 4', Georgia, serif",
              fontSize: '26px',
              fontWeight: 700,
              fontStyle: 'italic',
              color: '#1a1a2a',
              margin: '0 0 6px',
            }}
          >
            Login
          </h1>
          <p
            style={{
              color: '#6b7280',
              fontSize: '14px',
              margin: 0,
            }}
          >
            Welcome back! Please login to continue
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Email */}
          <div>
            <label
              htmlFor="login-email"
              style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}
            >
              Username
            </label>
            <input
              id="login-email"
              type="email"
              placeholder="Enter username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '10px 14px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                fontSize: '14px',
                color: '#1a1a2a',
                background: '#fff',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.target.style.borderColor = '#4B55C1')}
              onBlur={e => (e.target.style.borderColor = '#d1d5db')}
            />
          </div>

          {/* Password */}
          <div>
            <label
              htmlFor="login-password"
              style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}
            >
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '10px 42px 10px 14px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '14px',
                  color: '#1a1a2a',
                  background: '#fff',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => (e.target.style.borderColor = '#4B55C1')}
                onBlur={e => (e.target.style.borderColor = '#d1d5db')}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#9ca3af',
                  fontSize: '13px',
                  padding: '2px',
                }}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Remember Me / Forgot Password */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: '#4B55C1' }}
            >
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                style={{ accentColor: '#4B55C1', width: '14px', height: '14px' }}
              />
              Remember Me
            </label>
            <a
              href="#"
              onClick={e => e.preventDefault()}
              style={{ fontSize: '13px', color: '#4B55C1', textDecoration: 'none' }}
            >
              Forgot Password
            </a>
          </div>

          {/* Error */}
          {error && (
            <p style={{ color: '#dc2626', fontSize: '13px', margin: 0, textAlign: 'center' }}>
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              background: loading ? '#7B82D1' : '#4B55C1',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '15px',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
              marginTop: '4px',
            }}
            onMouseEnter={e => { if (!loading) (e.target as HTMLButtonElement).style.background = '#3B46B0'; }}
            onMouseLeave={e => { if (!loading) (e.target as HTMLButtonElement).style.background = '#4B55C1'; }}
          >
            {loading ? 'Signing in...' : 'Login'}
          </button>
        </form>

        {/* Don't have an account */}
        <p style={{ textAlign: 'center', fontSize: '13px', color: '#6b7280', marginTop: '22px', marginBottom: 0 }}>
          Don&apos;t have an account?{' '}
          <a href="#" onClick={e => e.preventDefault()} style={{ color: '#4B55C1', fontWeight: 600, textDecoration: 'none' }}>
            SIGN UP
          </a>
        </p>
      </div>

      {/* Footer */}
      <p
        style={{
          textAlign: 'center',
          color: 'rgba(255,255,255,0.65)',
          fontSize: '12px',
          marginTop: '32px',
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        &copy; 2026 &ndash; Synergy Maritime Pvt. Ltd.
      </p>

      {/* Easter egg: invisible in DOM, findable in source */}
      <span style={{ opacity: 0, position: 'absolute', fontSize: 0, pointerEvents: 'none' }} aria-hidden="true">
        spinorlabs.io
      </span>

      {/* Konami code toast */}
      {easterEgg && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#0D1B2A',
            color: '#FDB515',
            padding: '12px 24px',
            borderRadius: '8px',
            fontSize: '13px',
            fontFamily: "'IBM Plex Mono', monospace",
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            zIndex: 9999,
            animation: 'fade-in 0.3s ease-out',
          }}
        >
          Built on Spinor Labs ALOFT v0.4
        </div>
      )}
    </main>
  );
}
