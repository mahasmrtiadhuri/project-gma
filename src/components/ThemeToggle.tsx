import type { Theme } from '../hooks/useTheme';

export interface ThemeToggleProps {
  theme: Theme;
  onToggle: () => void;
}

/**
 * Floating sun/moon toggle in the top-right corner. Both icons render
 * stacked and crossfade based on the active theme — no layout shift.
 */
export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={isDark}
      className="gma-press pointer-events-auto absolute right-4 top-[calc(env(safe-area-inset-top,0px)+1rem)] z-[55] flex h-11 w-11 items-center justify-center rounded-full"
      style={{
        background: 'var(--gma-surface)',
        border: '1px solid var(--gma-border)',
        boxShadow: 'var(--gma-shadow-md)',
        color: 'var(--gma-text-primary)',
        backdropFilter: isDark ? 'blur(20px) saturate(160%)' : undefined,
        WebkitBackdropFilter: isDark ? 'blur(20px) saturate(160%)' : undefined,
      }}
    >
      <span className="relative h-5 w-5">
        <SunIcon
          style={{
            opacity: isDark ? 0 : 1,
            transform: isDark ? 'rotate(-45deg) scale(0.6)' : 'rotate(0deg) scale(1)',
            transition: 'opacity 220ms ease, transform 300ms cubic-bezier(0.5,1.6,0.4,1)',
            position: 'absolute',
            inset: 0,
          }}
        />
        <MoonIcon
          style={{
            opacity: isDark ? 1 : 0,
            transform: isDark ? 'rotate(0deg) scale(1)' : 'rotate(45deg) scale(0.6)',
            transition: 'opacity 220ms ease, transform 300ms cubic-bezier(0.5,1.6,0.4,1)',
            position: 'absolute',
            inset: 0,
          }}
        />
      </span>
    </button>
  );
}

function SunIcon({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={style}
    >
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="12" y1="2" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
        <line x1="4.9" y1="4.9" x2="7" y2="7" />
        <line x1="17" y1="17" x2="19.1" y2="19.1" />
        <line x1="4.9" y1="19.1" x2="7" y2="17" />
        <line x1="17" y1="7" x2="19.1" y2="4.9" />
      </g>
    </svg>
  );
}

function MoonIcon({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={style}
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
    </svg>
  );
}
