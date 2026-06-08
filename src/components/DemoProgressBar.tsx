export interface DemoProgressBarProps {
  /** True while the scripted demo sequence is running. */
  active: boolean;
  /** Total demo duration in ms — typically 60_000. */
  durationMs: number;
}

/**
 * Thin amber progress line pinned to the very top of the viewport.
 * Fills left → right over the full demo duration via a single CSS
 * width transition that fires the moment `active` flips to true.
 *
 * The `key` prop binding to `active` forces a full remount when the
 * sequence restarts, which guarantees the transition replays from
 * 0 % rather than animating between cached states.
 */
export function DemoProgressBar({ active, durationMs }: DemoProgressBarProps) {
  if (!active) return null;
  return (
    <div
      className="pointer-events-none fixed left-0 right-0 top-0"
      style={{
        zIndex: 350,
        height: '3px',
        background: 'rgba(15, 23, 42, 0.05)',
      }}
      aria-hidden="true"
    >
      <div
        // `key={durationMs}` triggers a remount when caller restarts;
        // the inner div starts at width 0 and animates to 100 % via
        // the inline width transition.
        key={`progress-${durationMs}`}
        ref={(el) => {
          if (!el) return;
          // Force a layout pass before flipping width so the
          // transition fires. requestAnimationFrame is the simplest
          // way to get one frame past the initial mount.
          requestAnimationFrame(() => {
            el.style.width = '100%';
          });
        }}
        style={{
          height: '100%',
          width: '0%',
          background:
            'linear-gradient(90deg, #F59E0B 0%, #FBBF24 100%)',
          transition: `width ${durationMs}ms linear`,
        }}
      />
    </div>
  );
}
