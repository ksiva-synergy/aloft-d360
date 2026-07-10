'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { GOLD, MONO, SERIF, BODY } from '@/lib/foer/foer-tokens';

export function EasterEggs() {
  const [isMounted, setIsMounted] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  // Egg A: Moonwalking with Einstein wordmark hover
  const [wordmarkHoverState, setWordmarkHoverState] = useState<'hidden' | 'showing' | 'fading-out'>('hidden');
  const [wordmarkRect, setWordmarkRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  // Egg B: Einstein Moonwalks
  const [einsteinActive, setEinsteinActive] = useState(false);
  const cooldownRef = useRef(false);
  const wordmarkClicks = useRef<number[]>([]);
  const typedSequence = useRef<string>('');

  // Egg C: Core Memory (gold orb clicks)
  const orbClicks = useRef<Map<HTMLElement, number[]>>(new Map());
  const [coreLabelActive, setCoreLabelActive] = useState(false);
  const [coreLabelPos, setCoreLabelPos] = useState({ top: 0, left: 0 });
  const [washActive, setWashActive] = useState(false);

  // Egg D: Konami Collapse
  const [stampActive, setStampActive] = useState(false);
  const [stampFadeOut, setStampFadeOut] = useState(false);
  const konamiIndex = useRef<number>(0);
  const konamiCode = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];

  // Egg E: 47-0 (harbor hover)
  const [harborHoverState, setHarborHoverState] = useState<'hidden' | 'showing' | 'fading-out'>('hidden');
  const [harborRect, setHarborRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  // DOM element references
  const [shelvesEl, setShelvesEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setIsMounted(true);

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(media.matches);
    const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    media.addEventListener('change', listener);

    return () => {
      media.removeEventListener('change', listener);
    };
  }, []);

  // Audio utility for Egg B
  const playChime = () => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch (e) {
      console.warn('Web Audio API chime failed to play', e);
    }
  };

  // Helper to compute coordinates relative to the nearest [data-foer-theme] dashboard container
  const getRelativeRect = (el: HTMLElement) => {
    const dashboard = document.querySelector('[data-foer-theme]');
    if (!dashboard) {
      const r = el.getBoundingClientRect();
      return { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height };
    }
    const rect = el.getBoundingClientRect();
    const dashRect = dashboard.getBoundingClientRect();
    return {
      left: rect.left - dashRect.left,
      top: rect.top - dashRect.top,
      width: rect.width,
      height: rect.height,
    };
  };

  // Trigger Egg B (Einstein Moonwalks)
  const triggerEinsteinMoonwalk = () => {
    if (cooldownRef.current) return;
    cooldownRef.current = true;
    setEinsteinActive(true);

    playChime();

    // Reset after 4s
    setTimeout(() => {
      setEinsteinActive(false);
    }, 4000);

    // Cooldown 8s
    setTimeout(() => {
      cooldownRef.current = false;
    }, 8000);
  };

  // Trigger Egg C (Core Memory)
  const triggerCoreMemory = (element: HTMLElement) => {
    element.classList.add('foer-core-memory-active');

    const shelvesPanel = document.getElementById('foer-shelves-panel');
    if (shelvesPanel) {
      shelvesPanel.setAttribute('data-wash', 'active');
      setWashActive(true);
    }

    const rel = getRelativeRect(element);
    setCoreLabelPos({
      left: rel.left + rel.width / 2,
      top: rel.top + rel.height + 8,
    });
    setCoreLabelActive(true);

    // Cleanup wash at 1100ms (600ms wash + 500ms return)
    setTimeout(() => {
      if (shelvesPanel) {
        shelvesPanel.removeAttribute('data-wash');
      }
      setWashActive(false);
    }, 1100);

    // Cleanup swell/label at 1500ms
    setTimeout(() => {
      element.classList.remove('foer-core-memory-active');
      setCoreLabelActive(false);
    }, 1500);
  };

  // Trigger Egg D (Konami Collapse)
  const triggerKonamiCollapse = () => {
    const shelvesPanel = document.getElementById('foer-shelves-panel');
    if (!shelvesPanel) return;

    shelvesPanel.setAttribute('data-konami', 'active');

    // Stamp slams in after 800ms
    setTimeout(() => {
      setStampActive(true);
    }, 8000 / 10); // 800ms

    // Stamp fades out after 3.8s total
    setTimeout(() => {
      setStampFadeOut(true);
      if (shelvesPanel) {
        shelvesPanel.setAttribute('data-konami', 'restore');
      }
    }, 3800);

    // Remove stamp and restore
    setTimeout(() => {
      setStampActive(false);
      setStampFadeOut(false);
    }, 4100);

    setTimeout(() => {
      if (shelvesPanel) {
        shelvesPanel.removeAttribute('data-konami');
      }
    }, 4400);
  };

  // Set up listeners for wordmark/harbor/keyboard events
  useEffect(() => {
    if (!isMounted) return;

    let wordmarkEl: HTMLElement | null = null;
    let harborEl: HTMLElement | null = null;

    let wordmarkTimeout: NodeJS.Timeout | null = null;
    let wordmarkDismissTimeout: NodeJS.Timeout | null = null;
    let harborTimeout: NodeJS.Timeout | null = null;

    const onWordmarkEnter = () => {
      if (wordmarkDismissTimeout) {
        clearTimeout(wordmarkDismissTimeout);
        wordmarkDismissTimeout = null;
      }
      wordmarkTimeout = setTimeout(() => {
        if (wordmarkEl) {
          setWordmarkRect(getRelativeRect(wordmarkEl));
          setWordmarkHoverState('showing');
          // Auto dismiss after 6s
          wordmarkDismissTimeout = setTimeout(() => {
            setWordmarkHoverState('fading-out');
            setTimeout(() => setWordmarkHoverState('hidden'), 300);
          }, 6000);
        }
      }, 3000);
    };

    const onWordmarkLeave = () => {
      if (wordmarkTimeout) {
        clearTimeout(wordmarkTimeout);
        wordmarkTimeout = null;
      }
      setWordmarkHoverState('fading-out');
      setTimeout(() => setWordmarkHoverState('hidden'), 300);
    };

    const onWordmarkClick = () => {
      const now = Date.now();
      const clicks = wordmarkClicks.current.filter((t) => now - t < 2000);
      clicks.push(now);
      wordmarkClicks.current = clicks;
      if (clicks.length >= 5) {
        wordmarkClicks.current = [];
        triggerEinsteinMoonwalk();
      }
    };

    const onHarborEnter = () => {
      harborTimeout = setTimeout(() => {
        if (harborEl) {
          setHarborRect(getRelativeRect(harborEl));
          setHarborHoverState('showing');
        }
      }, 2000);
    };

    const onHarborLeave = () => {
      if (harborTimeout) {
        clearTimeout(harborTimeout);
        harborTimeout = null;
      }
      setHarborHoverState('fading-out');
      setTimeout(() => setHarborHoverState('hidden'), 300);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      const key = e.key.toLowerCase();

      // Einstein typed egg sequence
      typedSequence.current = (typedSequence.current + key).slice(-8);
      if (typedSequence.current.endsWith('einstein')) {
        triggerEinsteinMoonwalk();
      }

      // Konami code check
      if (key === konamiCode[konamiIndex.current]) {
        konamiIndex.current++;
        if (konamiIndex.current === konamiCode.length) {
          konamiIndex.current = 0;
          triggerKonamiCollapse();
        }
      } else {
        konamiIndex.current = key === 'arrowup' ? 1 : 0;
      }
    };

    const handleGlobalClick = (e: MouseEvent) => {
      let target = e.target as HTMLElement | null;
      while (target && target !== document.body) {
        if (target.getAttribute('data-rule-type') === 'HARD_RULE') {
          const now = Date.now();
          let clicks = orbClicks.current.get(target) || [];
          clicks = clicks.filter((t) => now - t < 2000);
          clicks.push(now);
          orbClicks.current.set(target, clicks);

          if (clicks.length >= 5) {
            orbClicks.current.set(target, []);
            triggerCoreMemory(target);
          }
          break;
        }
        target = target.parentElement;
      }
    };

    // Poll to bind to elements once they exist in DOM
    const interval = setInterval(() => {
      wordmarkEl = document.getElementById('foer-wordmark');
      harborEl = document.getElementById('foer-harbor-basin');
      const shelves = document.getElementById('foer-shelves-panel');

      if (shelves) {
        setShelvesEl(shelves);
      }

      if (wordmarkEl && harborEl && shelves) {
        clearInterval(interval);

        wordmarkEl.addEventListener('mouseenter', onWordmarkEnter);
        wordmarkEl.addEventListener('mouseleave', onWordmarkLeave);
        wordmarkEl.addEventListener('click', onWordmarkClick);

        harborEl.addEventListener('mouseenter', onHarborEnter);
        harborEl.addEventListener('mouseleave', onHarborLeave);
      }
    }, 100);

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleGlobalClick);

    return () => {
      clearInterval(interval);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleGlobalClick);

      if (wordmarkEl) {
        wordmarkEl.removeEventListener('mouseenter', onWordmarkEnter);
        wordmarkEl.removeEventListener('mouseleave', onWordmarkLeave);
        wordmarkEl.removeEventListener('click', onWordmarkClick);
      }
      if (harborEl) {
        harborEl.removeEventListener('mouseenter', onHarborEnter);
        harborEl.removeEventListener('mouseleave', onHarborLeave);
      }

      if (wordmarkTimeout) clearTimeout(wordmarkTimeout);
      if (wordmarkDismissTimeout) clearTimeout(wordmarkDismissTimeout);
      if (harborTimeout) clearTimeout(harborTimeout);
    };
  }, [isMounted]);

  // Re-read rects on window resize
  useEffect(() => {
    const handleResize = () => {
      const wordmarkEl = document.getElementById('foer-wordmark');
      const harborEl = document.getElementById('foer-harbor-basin');
      if (wordmarkEl) setWordmarkRect(getRelativeRect(wordmarkEl));
      if (harborEl) setHarborRect(getRelativeRect(harborEl));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!isMounted) return null;

  return (
    <>
      {/* Dynamic Keyframes Injection */}
      <style>{`
        /* Moonwalk animation right to left */
        @keyframes moonwalk {
          0% { transform: translateX(0); left: 100%; }
          100% { transform: translateX(0); left: -40px; }
        }

        /* Einstein trail orbs */
        @keyframes orb-trail {
          0% { transform: scale(0); opacity: 0; }
          10% { transform: scale(1.3); opacity: 1; box-shadow: 0 0 16px ${GOLD}; }
          30% { transform: scale(1); opacity: 1; }
          100% { transform: scale(0); opacity: 0; }
        }

        /* Swell animation for clicked core rule orb */
        @keyframes core-memory-swell {
          0% { transform: scale(1); box-shadow: none; }
          26.6% { transform: scale(1.3); box-shadow: 0 0 24px ${GOLD}; }
          66.6% { transform: scale(1.3); box-shadow: 0 0 24px ${GOLD}; }
          100% { transform: scale(1); box-shadow: none; }
        }
        .foer-core-memory-active {
          animation: core-memory-swell 1.5s cubic-bezier(0.25, 1, 0.5, 1) forwards !important;
          z-index: 100 !important;
        }

        /* Gold wash overlay animation on shelves panel */
        @keyframes gold-wash {
          0% { opacity: 0; }
          54.5% { opacity: 0.08; }
          100% { opacity: 0; }
        }

        /* Label slide-fade animation */
        @keyframes fade-in-out {
          0% { opacity: 0; transform: translate(-50%, 6px); }
          15% { opacity: 1; transform: translate(-50%, 0); }
          85% { opacity: 1; transform: translate(-50%, 0); }
          100% { opacity: 0; transform: translate(-50%, -6px); }
        }

        /* Konami stamp overlay animations */
        @keyframes stamp-slam {
          0% { transform: translate(-50%, -50%) scale(2.2); opacity: 0; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
        @keyframes stamp-fade-out {
          0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
        }

        /* Tooltip fade-in / fade-out classes */
        .foer-tooltip-fade-in {
          opacity: 1 !important;
          transform: translateX(-50%) translateY(0) !important;
        }
        .foer-tooltip-fade-out {
          opacity: 0 !important;
          transform: translateX(-50%) translateY(6px) !important;
        }

        /* CSS rules triggered by the Konami collapse states */
        #foer-shelves-panel[data-konami="active"] .foer-orb-wrapper {
          transform: translateY(200px) !important;
          opacity: 0 !important;
          transition: transform 800ms cubic-bezier(0.5, 0, 0.7, 0.2), opacity 800ms ease-out !important;
        }
        #foer-shelves-panel[data-konami="restore"] .foer-orb-wrapper {
          transform: translateY(0) !important;
          opacity: 1 !important;
          transition: transform 600ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 600ms ease-out !important;
        }

        @media (prefers-reduced-motion: reduce) {
          .foer-core-memory-active {
            animation: none !important;
          }
          .foer-wash-overlay {
            animation: none !important;
          }
          #foer-shelves-panel[data-konami="active"] .foer-orb-wrapper {
            transform: none !important;
            opacity: 0 !important;
            transition: none !important;
          }
          #foer-shelves-panel[data-konami="restore"] .foer-orb-wrapper {
            transform: none !important;
            opacity: 1 !important;
            transition: none !important;
          }
        }
      `}</style>

      {/* Egg A: Wordmark Tooltip */}
      {wordmarkHoverState !== 'hidden' && wordmarkRect && (
        <div
          style={{
            position: 'absolute',
            left: wordmarkRect.left + wordmarkRect.width / 2,
            top: wordmarkRect.top + wordmarkRect.height + 8,
            transform: 'translateX(-50%) translateY(6px)',
            maxWidth: '360px',
            width: 'calc(100vw - 32px)',
            background: 'var(--foer-card-bg)',
            border: '1px solid var(--foer-border)',
            borderRadius: '6px',
            padding: '12px 16px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            color: 'var(--foer-text-sec)',
            fontFamily: SERIF,
            fontStyle: 'italic',
            fontSize: '13px',
            lineHeight: 1.45,
            zIndex: 1000,
            pointerEvents: 'none',
            opacity: 0,
            transition: prefersReducedMotion ? 'none' : 'opacity 200ms ease, transform 200ms ease',
          }}
          className={
            wordmarkHoverState === 'showing'
              ? 'foer-tooltip-fade-in'
              : 'foer-tooltip-fade-out'
          }
        >
          FOER — Field-Operational Experience Recall. For Joshua Foer (Moonwalking with Einstein, 2011), who won the 2006 USA Memory Championship the year after he covered it. Say it aloud: it&apos;s also &apos;foyer,&apos; the antechamber between rooms. The title is his mnemonic — to fix &apos;Einstein,&apos; picture him moonwalking.
        </div>
      )}

      {/* Egg B: Einstein Moonwalk Figure and Orbs */}
      {einsteinActive && !prefersReducedMotion && shelvesEl && createPortal(
        <>
          {/* Einstein Figure */}
          <div
            style={{
              position: 'absolute',
              bottom: '16px',
              height: '40px',
              width: '40px',
              zIndex: 40,
              animation: 'moonwalk 4s linear forwards',
              pointerEvents: 'none',
            }}
          >
            <svg width="40" height="40" viewBox="0 0 40 40" style={{ display: 'block' }}>
              {/* Wild hair */}
              <path
                d="M 12 10 Q 8 4 15 6 Q 20 2 24 8 Q 30 4 27 12 Q 32 15 28 20"
                stroke="var(--foer-text-sec)"
                strokeWidth="1.5"
                fill="none"
              />
              {/* Head */}
              <circle
                cx="20"
                cy="14"
                r="5"
                stroke="var(--foer-text-sec)"
                strokeWidth="1.5"
                fill="var(--foer-bg)"
              />
              {/* Torso */}
              <line
                x1="20"
                y1="19"
                x2="20"
                y2="28"
                stroke="var(--foer-text-sec)"
                strokeWidth="1.5"
              />
              {/* Arms in walking pose */}
              <line
                x1="20"
                y1="21"
                x2="14"
                y2="25"
                stroke="var(--foer-text-sec)"
                strokeWidth="1.5"
              />
              <line
                x1="20"
                y1="21"
                x2="26"
                y2="25"
                stroke="var(--foer-text-sec)"
                strokeWidth="1.5"
              />
              {/* Legs in sliding pose */}
              <line
                x1="20"
                y1="28"
                x2="16"
                y2="35"
                stroke="var(--foer-text-sec)"
                strokeWidth="1.5"
              />
              <line
                x1="20"
                y1="28"
                x2="24"
                y2="35"
                stroke="var(--foer-text-sec)"
                strokeWidth="1.5"
              />
            </svg>
          </div>

          {/* 6 Trail Orbs */}
          {[
            { left: '85%', delay: '0.6s' },
            { left: '70%', delay: '1.2s' },
            { left: '55%', delay: '1.8s' },
            { left: '40%', delay: '2.4s' },
            { left: '25%', delay: '3.0s' },
            { left: '10%', delay: '3.6s' },
          ].map((orb, index) => (
            <div
              key={index}
              style={{
                position: 'absolute',
                left: orb.left,
                bottom: '26px',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: GOLD,
                zIndex: 35,
                opacity: 0,
                transform: 'scale(0)',
                animation: `orb-trail 1.5s ease-out forwards`,
                animationDelay: orb.delay,
                pointerEvents: 'none',
              }}
            />
          ))}
        </>,
        shelvesEl
      )}

      {/* Egg C: Core Memory Click wash and label */}
      {washActive && shelvesEl && createPortal(
        <div
          className="foer-wash-overlay"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: GOLD,
            pointerEvents: 'none',
            borderRadius: '6px',
            zIndex: 5,
            animation: prefersReducedMotion ? 'none' : 'gold-wash 1.1s ease-out forwards',
          }}
        />,
        shelvesEl
      )}

      {coreLabelActive && (
        <div
          style={{
            position: 'absolute',
            left: coreLabelPos.left,
            top: coreLabelPos.top,
            transform: 'translateX(-50%)',
            fontFamily: MONO,
            fontSize: '11px',
            color: GOLD,
            zIndex: 200,
            pointerEvents: 'none',
            animation: prefersReducedMotion ? 'none' : 'fade-in-out 1.5s ease forwards',
          }}
        >
          Core memory formed.
        </div>
      )}

      {/* Egg D: Konami Collapse Stamp Overlay */}
      {stampActive && shelvesEl && createPortal(
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'var(--foer-card-bg)',
            border: `1.5px solid ${GOLD}`,
            borderRadius: '6px',
            padding: '24px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            zIndex: 100,
            maxWidth: '90%',
            width: '420px',
            textAlign: 'center',
            fontFamily: BODY,
            fontSize: '16px',
            color: 'var(--foer-text-pri)',
            lineHeight: '1.5',
            animation: prefersReducedMotion
              ? 'none'
              : stampFadeOut
              ? 'stamp-fade-out 300ms ease forwards'
              : 'stamp-slam 300ms cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
          }}
        >
          A single rewrite collapsed{' '}
          <span style={{ fontFamily: MONO, color: GOLD, fontWeight: 500 }}>18,282</span> tokens to{' '}
          <span style={{ fontFamily: MONO, color: GOLD, fontWeight: 500 }}>122</span>. We don&apos;t do that
          here.
        </div>,
        shelvesEl
      )}

      {/* Egg E: Harbor Hover Text */}
      {harborHoverState !== 'hidden' && harborRect && (
        <div
          style={{
            position: 'absolute',
            left: harborRect.left + harborRect.width - 65,
            top: harborRect.top + harborRect.height - 24,
            fontFamily: MONO,
            fontSize: '11px',
            color: 'var(--foer-text-sec)',
            opacity: harborHoverState === 'showing' ? 0.6 : 0,
            transition: prefersReducedMotion ? 'none' : 'opacity 300ms ease-out',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          47–0
        </div>
      )}
    </>
  );
}
