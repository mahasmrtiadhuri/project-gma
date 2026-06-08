import { useEffect, useRef, useState } from 'react';

export interface DemoIntroOverlayProps {
  /** True from the moment START DEMO is tapped through the end of the
   *  intro hold. App.tsx flips this back to false to begin the fade. */
  visible: boolean;
}

/**
 * Full-screen white overlay shown for the first ~2 s of every demo run.
 * Fades in over 400 ms, holds while `visible` is true, then fades OUT
 * over 800 ms when `visible` flips back to false, after which it
 * fully unmounts.
 *
 * Click-safety: pointer-events-auto ONLY while `visible` is true.
 * During the fade-out and any other "not actively visible" state the
 * overlay is `pointer-events-none` so it cannot swallow taps targeted
 * at the underlying chrome. Earlier versions left the overlay
 * `pointer-events-auto` at opacity 0 and silently blocked every
 * click on the page — fixed here by gating pointer events on the
 * `visible` prop directly.
 *
 * Title typography is plain Inter — large, slightly tightened tracking
 * so it reads as a film card rather than a UI label.
 */
export function DemoIntroOverlay({ visible }: DemoIntroOverlayProps) {
  // Stage timeline: 'hidden' → 'in' → 'out' → 'hidden'.
  // - 'hidden': not rendered at all.
  // - 'in': mounted at opacity-1 (after a one-frame fade-in).
  // - 'out': mounted at opacity-0, transitioning out; unmounted
  //   after the 800 ms transition completes.
  const [stage, setStage] = useState<'hidden' | 'in' | 'out'>('hidden');
  const outTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (visible) {
      // Cancel any pending unmount from a previous run.
      if (outTimerRef.current != null) {
        window.clearTimeout(outTimerRef.current);
        outTimerRef.current = null;
      }
      // Defer one frame so the browser registers the opacity-0 mount
      // style before flipping to opacity-1 — otherwise the fade
      // collapses to an instant appear.
      const raf = requestAnimationFrame(() => setStage('in'));
      return () => cancelAnimationFrame(raf);
    }
    // visible just flipped false. If we were 'in', start the fade-out.
    // If we were already 'hidden', stay there.
    setStage((prev) => (prev === 'in' ? 'out' : 'hidden'));
    if (outTimerRef.current != null) {
      window.clearTimeout(outTimerRef.current);
    }
    outTimerRef.current = window.setTimeout(() => {
      setStage('hidden');
      outTimerRef.current = null;
    }, 800);
  }, [visible]);

  useEffect(
    () => () => {
      if (outTimerRef.current != null) {
        window.clearTimeout(outTimerRef.current);
      }
    },
    [],
  );

  if (stage === 'hidden') return null;

  const isIn = stage === 'in';
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center"
      style={{
        zIndex: 400,
        background: '#ffffff',
        opacity: isIn ? 1 : 0,
        // 400 ms fade-in, 800 ms fade-out (per spec).
        transition: isIn
          ? 'opacity 400ms ease'
          : 'opacity 800ms ease-in-out',
        // Critical: only catch pointer events while actively visible.
        // During the fade-out the user must be able to interact with
        // the map underneath.
        pointerEvents: isIn ? 'auto' : 'none',
      }}
      aria-hidden={!isIn}
      role="presentation"
    >
      <div
        className="px-6 text-center"
        style={{
          opacity: isIn ? 1 : 0,
          transform: isIn ? 'translateY(0)' : 'translateY(8px)',
          transition: isIn
            ? 'opacity 600ms ease 150ms, transform 600ms ease 150ms'
            : 'opacity 600ms ease, transform 600ms ease',
        }}
      >
        <h1
          className="text-3xl font-semibold sm:text-5xl"
          style={{
            color: 'rgb(15, 23, 42)', // slate-900
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          Generative Micro-Climate Architect
        </h1>
        <p
          className="mt-4 text-base sm:text-lg"
          style={{
            color: 'rgb(71, 85, 105)', // slate-600
            fontFamily: "'Inter', system-ui, sans-serif",
            letterSpacing: '0.01em',
          }}
        >
          Routing for how a city feels.
        </p>
      </div>
    </div>
  );
}
