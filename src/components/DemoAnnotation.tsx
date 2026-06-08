import { useEffect, useState } from 'react';

export interface DemoAnnotationProps {
  /** Text to display. When this changes, the pill re-animates. Null hides. */
  text: string | null;
}

/**
 * White pill that slides up from the bottom, holds, then fades upward.
 * Used by the scripted demo to put a one-line voiceover-style caption
 * on screen at each key moment.
 *
 * Layout: centered horizontally, anchored at 70 % viewport height
 * (visually below the centerline but well above any bottom chrome).
 * White background, slate-800 text, `shadow-lg`, `rounded-full
 * px-6 py-3`. Lives at z-360 — above the progress bar (z-350) but
 * below the intro overlay (z-400) so a fresh demo start covers it.
 */
export function DemoAnnotation({ text }: DemoAnnotationProps) {
  // Stage timeline: 'enter' → 'hold' → 'exit'. Each transition is
  // driven by setTimeouts wiped on text change.
  const [stage, setStage] = useState<'enter' | 'hold' | 'exit'>('exit');
  const [displayed, setDisplayed] = useState<string | null>(null);

  useEffect(() => {
    if (!text) {
      setStage('exit');
      return;
    }
    setDisplayed(text);
    // Mount in the offscreen / 0-opacity start state first so the
    // browser registers the initial style, then on the next frame
    // we transition to the visible 'enter' style.
    setStage('exit');
    const raf = requestAnimationFrame(() => setStage('enter'));
    // Hold for 1.8 s after the 0.3 s slide-in, then exit. Total
    // visible time matches the 2.5 s window the demo script wants.
    const holdTimer = window.setTimeout(() => setStage('hold'), 350);
    const exitTimer = window.setTimeout(() => setStage('exit'), 2_500);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(holdTimer);
      window.clearTimeout(exitTimer);
    };
  }, [text]);

  if (!displayed) return null;
  const isOut = stage === 'exit';

  return (
    <div
      className="pointer-events-none fixed left-1/2"
      style={{
        zIndex: 360,
        top: '70%',
        transform: isOut
          ? 'translate(-50%, -16px)'
          : 'translate(-50%, 0)',
        opacity: isOut ? 0 : 1,
        transition: 'opacity 350ms ease, transform 350ms ease',
      }}
      role="status"
      aria-live="polite"
    >
      <div
        className="rounded-full px-6 py-3 text-base font-medium"
        style={{
          background: '#ffffff',
          color: 'rgb(30, 41, 59)', // slate-800
          boxShadow:
            '0 10px 30px rgba(15, 23, 42, 0.18), 0 4px 12px rgba(15, 23, 42, 0.08)',
          fontFamily: "'Inter', system-ui, sans-serif",
          letterSpacing: '0.005em',
        }}
      >
        {displayed}
      </div>
    </div>
  );
}
