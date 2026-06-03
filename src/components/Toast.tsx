import { useEffect, useState } from 'react';

export interface ToastProps {
  /** When `message` changes to a non-null string, the toast appears for `durationMs`. */
  message: string | null;
  /** Auto-dismiss timeout in ms (default 3000). */
  durationMs?: number;
}

/**
 * Top-center transient notification used to confirm route selection at
 * Start. Fades in on a new message and fades out durationMs later, no
 * dismiss UI. Renders nothing when message is null.
 */
export function Toast({ message, durationMs = 3000 }: ToastProps) {
  const [visible, setVisible] = useState(false);
  const [renderText, setRenderText] = useState<string | null>(null);

  useEffect(() => {
    if (!message) {
      setVisible(false);
      return;
    }
    setRenderText(message);
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), durationMs);
    return () => window.clearTimeout(t);
  }, [message, durationMs]);

  if (!renderText) return null;

  return (
    <div
      className="pointer-events-none absolute left-1/2 top-[calc(env(safe-area-inset-top,0px)+1rem)] z-[60] -translate-x-1/2"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translate(-50%, ${visible ? '0' : '-8px'})`,
        transition: 'opacity 240ms ease, transform 240ms ease',
      }}
      role="status"
      aria-live="polite"
    >
      <div
        className="rounded-2xl bg-white px-5 py-3 text-base"
        style={{
          boxShadow:
            '0 12px 28px rgba(0, 0, 0, 0.15), 0 4px 10px rgba(0, 0, 0, 0.06)',
          border: '1px solid var(--gma-border)',
          color: 'var(--gma-text-primary)',
          fontWeight: 500,
          letterSpacing: '0.01em',
          whiteSpace: 'nowrap',
        }}
      >
        {renderText}
      </div>
    </div>
  );
}
