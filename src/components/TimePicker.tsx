import { useEffect, useRef, useState } from 'react';
import type { RGB } from '../lib/daylight';

export type TimeMode = 'leave-now' | 'leave-at' | 'arrive-by';

export interface TimePickerProps {
  mode: TimeMode;
  plannedTime: Date | null;
  onChange: (mode: TimeMode, plannedTime: Date | null) => void;
  dayColor: RGB;
}

const MODE_OPTIONS: ReadonlyArray<{ key: TimeMode; label: string }> = [
  { key: 'leave-now', label: 'Leave now' },
  { key: 'leave-at', label: 'Leave at' },
  { key: 'arrive-by', label: 'Arrive by' },
];

const MOBILE_QUERY = '(max-width: 639px)';

/**
 * Hook that tracks whether the viewport is mobile-sized (<640 px). We
 * use this to pick between the custom desktop dropdown and a native
 * <select> on mobile — native selects are the only reliably-dismissable
 * dropdown UI across mobile browsers (iOS Safari especially mishandles
 * synthetic backdrop close handlers).
 */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const handler = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

/**
 * Departure/arrival time picker — sits under the transport mode pills.
 *
 * Desktop (≥640 px): clock-icon trigger pill opens a custom dropdown
 * with three modes plus a native datetime-local input when a
 * planned-time mode is active.
 *
 * Mobile (<640 px): the same pill chrome is rendered, but an invisible
 * native <select> is overlaid on top so taps trigger the OS-native
 * picker (the iOS spinner wheel / Android dropdown). The datetime
 * input renders directly under the pill instead of inside a dropdown.
 * This sidesteps the iOS Safari quirk where the previous custom
 * dropdown's backdrop close handler was unreliable and the dropdown
 * options ended up stuck over the route legend.
 */
export function TimePicker({
  mode,
  plannedTime,
  onChange,
  dayColor,
}: TimePickerProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const accentRgb = `rgb(${dayColor[0]}, ${dayColor[1]}, ${dayColor[2]})`;

  // Force-close the desktop dropdown when the viewport flips to mobile
  // (and vice-versa). Otherwise `open` could be true after a resize and
  // briefly render a dropdown the mobile branch doesn't manage.
  useEffect(() => {
    if (isMobile) setOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!open || isMobile) return;
    const handleDismiss = (event: Event) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDismiss);
    document.addEventListener('touchstart', handleDismiss, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleDismiss);
      document.removeEventListener('touchstart', handleDismiss);
    };
  }, [open, isMobile]);

  const handleModeSelect = (nextMode: TimeMode) => {
    if (nextMode === 'leave-now') {
      onChange(nextMode, null);
      return;
    }
    const seedTime = plannedTime ?? new Date(Date.now() + 30 * 60_000);
    onChange(nextMode, seedTime);
  };

  const handleTimeInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (!value) return;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return;
    onChange(mode, parsed);
  };

  const triggerLabel = formatTriggerLabel(mode, plannedTime);
  const showTimeInput = mode === 'leave-at' || mode === 'arrive-by';

  return (
    <>
      {/* Desktop-only backdrop. Mobile uses a native <select> which
       * handles its own dismiss via the OS picker, so no backdrop is
       * needed (and shouldn't be rendered — it would intercept taps
       * meant for the map). */}
      {open && !isMobile && (
        <button
          type="button"
          aria-label="Close time picker"
          onClick={() => setOpen(false)}
          className="pointer-events-auto fixed inset-0 z-[19] cursor-default bg-transparent"
        />
      )}
      <div
        ref={wrapperRef}
        className="pointer-events-auto absolute left-1/2 top-[calc(env(safe-area-inset-top,0px)+15.5rem)] z-20 w-[min(300px,calc(100vw-2rem))] -translate-x-1/2"
      >
        {isMobile ? (
          <MobileSelectPill
            mode={mode}
            triggerLabel={triggerLabel}
            onModeSelect={handleModeSelect}
          />
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="gma-card gma-press flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm text-[var(--gma-text-primary)]"
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <ClockIcon />
            <span style={{ fontFamily: 'var(--font-data)' }}>{triggerLabel}</span>
            <ChevronIcon open={open} />
          </button>
        )}

        {open && !isMobile && (
          <div
            className="gma-card gma-pop-in absolute left-1/2 top-full z-40 mt-2 w-[min(320px,92vw)] -translate-x-1/2 rounded-xl p-2"
            style={{ boxShadow: 'var(--gma-shadow-lg)' }}
            role="dialog"
            aria-label="Choose departure or arrival time"
          >
            <div className="flex flex-col gap-1">
              {MODE_OPTIONS.map((opt) => {
                const active = opt.key === mode;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => handleModeSelect(opt.key)}
                    className="gma-press flex min-h-[44px] items-center justify-between rounded-lg px-3 py-2 text-sm"
                    style={
                      active
                        ? {
                            background: accentRgb,
                            color: 'var(--gma-text-on-accent)',
                          }
                        : { color: 'var(--gma-text-primary)' }
                    }
                  >
                    <span>{opt.label}</span>
                    {active && <CheckIcon />}
                  </button>
                );
              })}
            </div>

            {showTimeInput && (
              <div
                className="mt-2 border-t pt-2"
                style={{ borderColor: 'var(--gma-border)' }}
              >
                <input
                  type="datetime-local"
                  value={plannedTime ? dateToLocalString(plannedTime) : ''}
                  onChange={handleTimeInput}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={{
                    background: 'var(--gma-input-bg)',
                    color: 'var(--gma-text-primary)',
                    border: '1px solid var(--gma-input-border)',
                    fontFamily: 'var(--font-data)',
                  }}
                  aria-label={
                    mode === 'leave-at' ? 'Departure time' : 'Arrival time'
                  }
                />
              </div>
            )}
          </div>
        )}

        {/* Mobile: when the user picks "Leave at" or "Arrive by" via the
         * native select, the datetime input slides in under the pill so
         * they can adjust the planned time. Tapping it opens the OS-native
         * datetime picker — no custom dropdown UI involved. */}
        {isMobile && showTimeInput && (
          <div
            className="gma-card gma-pop-in mt-2 rounded-xl p-2"
            style={{ boxShadow: 'var(--gma-shadow-md)' }}
          >
            <input
              type="datetime-local"
              value={plannedTime ? dateToLocalString(plannedTime) : ''}
              onChange={handleTimeInput}
              className="h-11 w-full rounded-lg px-3 text-sm outline-none"
              style={{
                background: 'var(--gma-input-bg)',
                color: 'var(--gma-text-primary)',
                border: '1px solid var(--gma-input-border)',
                fontFamily: 'var(--font-data)',
              }}
              aria-label={
                mode === 'leave-at' ? 'Departure time' : 'Arrival time'
              }
            />
          </div>
        )}
      </div>
    </>
  );
}

interface MobileSelectPillProps {
  mode: TimeMode;
  triggerLabel: string;
  onModeSelect: (next: TimeMode) => void;
}

/**
 * Mobile pill: a visible "trigger" element that matches the desktop
 * design, with a transparent native <select> stretched on top to catch
 * the tap. The OS-native picker reads the <option> list directly, and
 * the OS owns dismiss, so the broken backdrop close path is gone.
 */
function MobileSelectPill({
  mode,
  triggerLabel,
  onModeSelect,
}: MobileSelectPillProps) {
  return (
    <div className="relative">
      <div
        className="gma-card flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm text-[var(--gma-text-primary)]"
        aria-hidden="true"
      >
        <ClockIcon />
        <span style={{ fontFamily: 'var(--font-data)' }}>{triggerLabel}</span>
        <ChevronIcon open={false} />
      </div>
      <select
        value={mode}
        onChange={(event) =>
          onModeSelect(event.target.value as TimeMode)
        }
        // Stretched over the visible pill, fully transparent. Native
        // picker fires on tap. `font-size: 16px` prevents iOS Safari
        // from auto-zooming when the select gets focus.
        className="absolute inset-0 h-full w-full cursor-pointer rounded-full opacity-0"
        style={{ fontSize: '16px' }}
        aria-label="Choose departure or arrival time"
      >
        {MODE_OPTIONS.map((opt) => (
          <option key={opt.key} value={opt.key}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function formatTriggerLabel(
  mode: TimeMode,
  plannedTime: Date | null,
): string {
  if (mode === 'leave-now') return 'Leave now';
  if (!plannedTime) return mode === 'leave-at' ? 'Leave at…' : 'Arrive by…';
  const timeStr = plannedTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return mode === 'leave-at' ? `Leave at ${timeStr}` : `Arrive by ${timeStr}`;
}

function dateToLocalString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 7v5l3 2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{
        transform: open ? 'rotate(180deg)' : 'none',
        transition: 'transform 200ms',
      }}
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12l5 5L20 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
