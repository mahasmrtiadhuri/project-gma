export interface AIChatButtonProps {
  visible: boolean;
  onClick: () => void;
}

/**
 * Floating circular FAB that opens the AI chat panel. 52 px amber
 * puck, white sparkle icon, bottom-right of the map. Positioned
 * above where the bottom-right MapViewSwitcher sits on mobile so
 * the two don't collide; on desktop MapViewSwitcher is at top-right
 * via `stackedTopRight` so this just sits in an otherwise empty
 * bottom-right corner of the map area.
 */
export function AIChatButton({ visible, onClick }: AIChatButtonProps) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open AI assistant"
      className="gma-press fixed flex items-center justify-center rounded-full"
      style={{
        right: '16px',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5rem)',
        width: '52px',
        height: '52px',
        zIndex: 95,
        background: 'linear-gradient(135deg, #F59E0B 0%, #EA8000 100%)',
        color: '#ffffff',
        boxShadow:
          '0 10px 24px rgba(245, 158, 11, 0.45), 0 2px 6px rgba(0, 0, 0, 0.12)',
        border: '1px solid rgba(255, 255, 255, 0.35)',
      }}
    >
      <SparkleIcon />
    </button>
  );
}

/**
 * Four-point AI sparkle — a small star with four faint satellite
 * twinkles. Reads as "intelligent assistant" without leaning on a
 * brand mark.
 */
function SparkleIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* Main 4-point star */}
      <path d="M12 3 L13.6 10.4 L21 12 L13.6 13.6 L12 21 L10.4 13.6 L3 12 L10.4 10.4 Z" />
      {/* Small top-right twinkle */}
      <path d="M19 4 L19.6 6.4 L22 7 L19.6 7.6 L19 10 L18.4 7.6 L16 7 L18.4 6.4 Z" opacity="0.7" />
      {/* Small bottom-left twinkle */}
      <path d="M5 16 L5.5 18 L7.5 18.5 L5.5 19 L5 21 L4.5 19 L2.5 18.5 L4.5 18 Z" opacity="0.55" />
    </svg>
  );
}
