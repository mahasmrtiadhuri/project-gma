import { useEffect, useState } from 'react';

export interface DemoIntroOverlayProps {
  /** True from the moment START DEMO is tapped through the end of the
   *  intro fade-out. App.tsx controls this via a setTimeout. */
  visible: boolean;
}

/**
 * Full-screen white overlay shown for the first ~2 s of every demo run.
 * Fades in over 400 ms, holds, fades out over 400 ms. Blocks pointer
 * interaction ONLY while actually visible — during fade-out and when
 * not in use it returns null entirely so it never traps clicks.
 *
 * Prior bug: the overlay's initial `useEffect` set stage to 'out'
 * even when `visible` was false on mount. The early-return guard
 * `!visible && stage === 'hidden'` then no longer matched, so the
 * overlay rendered invisibly at `opacity: 0` BUT with `pointer-
 * events-auto fixed inset-0 z-400`, swallowing every click on the
 * page (including the Start Demo button itself). The fix below
 * unmounts whenever `visible` is false — there's no fade-out
 * animation any more, but the cinematic intro lands the same way:
 * a clean cut to the map after the 2 s title hold.
 */
export function DemoIntroOverlay({ visible }: DemoIntroOverlayProps) {
  const [stage, setStage] = useState<'hidden' | 'in'>('hidden');

  useEffect(() => {
    if (!visible) {
      setStage('hidden');
      return;
    }
    // Defer the opacity transition by one frame so the browser
    // registers the initial opacity-0 mount style before flipping
    // to opacity-1 — otherwise the fade-in collapses to an instant
    // appear.
    const raf = requestAnimationFrame(() => setStage('in'));
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-auto fixed inset-0 flex flex-col items-center justify-center"
      style={{
        zIndex: 400,
        background: '#ffffff',
        opacity: stage === 'in' ? 1 : 0,
        transition: 'opacity 400ms ease',
      }}
      aria-hidden={!visible}
      role="presentation"
    >
      <div
        className="px-6 text-center"
        style={{
          opacity: stage === 'in' ? 1 : 0,
          transform: stage === 'in' ? 'translateY(0)' : 'translateY(8px)',
          transition:
            'opacity 600ms ease 150ms, transform 600ms ease 150ms',
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
