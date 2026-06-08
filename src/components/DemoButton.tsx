export interface DemoButtonProps {
  visible: boolean;
  onStart: () => void;
}

/**
 * Floating "START DEMO" CTA pinned to the bottom-center of the
 * viewport when `?demo=true` is in the URL and the demo hasn't
 * started yet. Lives at z-300 — above every other piece of chrome
 * (StartButton at z-200, MapTapPopup at z-71, …) so it can't be
 * obscured by any layout state when the recording rolls.
 */
export function DemoButton({ visible, onStart }: DemoButtonProps) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => {
        console.log('[GMA] Start Demo clicked (floating button)');
        onStart();
      }}
      aria-label="Start the recorded demo sequence"
      className="gma-press-soft pointer-events-auto fixed left-1/2 flex h-14 -translate-x-1/2 items-center justify-center gap-2 rounded-full px-8 text-base font-bold uppercase tracking-[0.2em]"
      style={{
        bottom: 'max(env(safe-area-inset-bottom, 0px), 24px)',
        zIndex: 300,
        background:
          'linear-gradient(135deg, rgb(239, 68, 68) 0%, rgb(220, 38, 38) 100%)',
        color: '#ffffff',
        boxShadow:
          '0 12px 32px rgba(220, 38, 38, 0.45), 0 2px 8px rgba(0, 0, 0, 0.15)',
      }}
    >
      <RecordIcon />
      Start Demo
    </button>
  );
}

function RecordIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="6" />
    </svg>
  );
}
