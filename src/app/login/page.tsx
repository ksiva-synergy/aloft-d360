'use client';

import { signIn } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';

const KONAMI = [
  'ArrowUp','ArrowUp','ArrowDown','ArrowDown',
  'ArrowLeft','ArrowRight','ArrowLeft','ArrowRight',
  'KeyB','KeyA',
];

export default function LoginPage() {
  const [error, setError] = useState('');
  const [ssoLoading, setSsoLoading] = useState(false);
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
        'Microsoft sign-in failed. Please try again or contact your administrator.',
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/synergy-group-logo.jpg"
              alt="Synergy Group"
              width={100}
              height={100}
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
          <p style={{ color: '#6b7280', fontSize: '14px', margin: 0 }}>
            Welcome back! Please login to continue
          </p>
        </div>

        {/* SSO Button */}
        <button
          type="button"
          onClick={handleSSOLogin}
          disabled={ssoLoading}
          style={{
            width: '100%',
            padding: '12px',
            background: ssoLoading ? '#5a6abf' : '#0078d4',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 600,
            fontSize: '15px',
            cursor: ssoLoading ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
          }}
          onMouseEnter={e => { if (!ssoLoading) (e.currentTarget.style.background = '#106ebe'); }}
          onMouseLeave={e => { if (!ssoLoading) (e.currentTarget.style.background = '#0078d4'); }}
        >
          {/* Microsoft logo SVG */}
          <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
            <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
            <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
            <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
          </svg>
          {ssoLoading ? 'Redirecting to Microsoft...' : 'Sign in with Microsoft'}
        </button>

        {/* Error */}
        {error && (
          <p style={{ color: '#dc2626', fontSize: '13px', margin: '16px 0 0', textAlign: 'center' }}>
            {error}
          </p>
        )}
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
        data360.synergymarinegroup.com
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
          Built on Data 360 ALOFT v0.4
        </div>
      )}
    </main>
  );
}
