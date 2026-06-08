export interface DemoWatermarkProps {
  /** True when the URL has `?demo=true`. */
  visible: boolean;
}

/**
 * Subtle bottom-of-stack "DEMO MODE" label at top-left so a viewer of
 * the recorded video can tell at a glance that the on-screen state is
 * scripted rather than the result of live user input.
 *
 * Always rendered when `?demo=true` is in the URL — regardless of
 * whether the START DEMO button has been pressed yet — because the
 * watermark is really about the URL context, not the sequence state.
 */
export function DemoWatermark({ visible }: DemoWatermarkProps) {
  if (!visible) return null;
  return (
    <div
      className="pointer-events-none fixed select-none rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em]"
      style={{
        top: 'max(env(safe-area-inset-top, 0px), 8px)',
        left: '8px',
        zIndex: 250,
        background: 'rgba(220, 38, 38, 0.85)',
        color: '#ffffff',
        fontFamily: 'var(--font-data)',
        boxShadow: '0 2px 8px rgba(220, 38, 38, 0.35)',
      }}
      aria-label="Demo mode active"
    >
      ● Demo Mode
    </div>
  );
}
