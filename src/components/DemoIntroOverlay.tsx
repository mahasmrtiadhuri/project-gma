import { useEffect, useState } from 'react';

export interface DemoIntroOverlayProps {
  /** True from the moment START DEMO is tapped through the end of the
   *  intro fade-out. App.tsx controls this via a setTimeout. */
  visible: boolean;
}

/**
 * Full-screen white overlay shown for the first ~2 s of every demo run.
 * Fades in over 400 ms, holds 1.2 s, fades out over 400 ms. While
 * visible, blocks all pointer interaction so the user can't accidentally
 * drive the map before the scripted sequence takes over.
 *
 * Title typography is plain Inter — large, slightly tightened tracking
 * so it reads as a film card rather than a UI label. Subtitle is the
 * pitch in one breath.
 */
export function DemoIntroOverlay({ visible }: DemoIntroOverlayProps) {
  // Stage transitions: 'hidden' → 'fading-in' → 'visible' → 'fading-out'.
  // Drives the opacity + translate transforms below.
  const [stage, setStage] = useState<'hidden' | 'in' | 'out'>('hidden');

  useEffect(() => {
    if (visible) {
      // Start fade-in immediately on mount.
      setStage('in');
    } else {
      setStage('out');
    }
  }, [visible]);

  if (!visible && stage === 'hidden') return null;

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
