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
 * Departure/arrival time picker.
 *
 * Mode picker:
 *   Mobile  → invisible native `<select>` overlaid on the pill chrome
 *             so the OS picker handles open/close reliably.
 *   Desktop → custom dropdown anchored under the pill.
 *
 * Date/time picker:
 *   On BOTH platforms, picking 'Leave at' / 'Arrive by' opens a
 *   centered modal containing a native `<input type="datetime-local">`.
 *   The previous inline-panel slide-in is gone — it was overlapping the
 *   route legend on mobile, and the modal pattern matches what users
 *   expect from Google Maps / Apple Maps.
 *
 *   Tapping the pill label while a planned mode is active re-opens the
 *   modal so the user can adjust the time without changing the mode.
 */
export function TimePicker({
  mode,
  plannedTime,
  onChange,
  dayColor,
}: TimePickerProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const accentRgb = `rgb(${dayColor[0]}, ${dayColor[1]}, ${dayColor[2]})`;

  // Crossing the mobile breakpoint resets dropdown state so a leftover
  // `open=true` from desktop doesn't render an orphan dropdown on
  // mobile (mobile uses the native select overlay instead).
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

  // Escape closes the date modal — matches desktop dialog convention.
  useEffect(() => {
    if (!dateModalOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDateModalOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dateModalOpen]);

  const handleModeSelect = (nextMode: TimeMode) => {
    // Always close the desktop dropdown first — keeps it from
    // overlapping the modal it's about to spawn.
    setOpen(false);
    if (nextMode === 'leave-now') {
      onChange(nextMode, null);
      return;
    }
    const seedTime = plannedTime ?? new Date(Date.now() + 30 * 60_000);
    onChange(nextMode, seedTime);
    // Defer to next frame so the dropdown close animation completes
    // before the modal pops in — avoids a 1-frame visual stack.
    requestAnimationFrame(() => setDateModalOpen(true));
  };

  const handleTimeInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (!value) return;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return;
    onChange(mode, parsed);
  };

  // Tapping the pill while a planned mode is active is the user's
  // shortcut to re-edit the planned time without changing the mode.
  // On mobile this is suppressed because the native <select> overlay
  // owns the tap; the user re-edits by picking the same option again.
  const handleTriggerClick = () => {
    if (mode !== 'leave-now') {
      setDateModalOpen(true);
      return;
    }
    setOpen((v) => !v);
  };

  const triggerLabel = formatTriggerLabel(mode, plannedTime);

  return (
    <>
      {/* Desktop-only click-outside backdrop for the mode dropdown. */}
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
            onClick={handleTriggerClick}
            className="gma-card gma-press flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm text-[var(--gma-text-primary)]"
            aria-haspopup={mode === 'leave-now' ? 'listbox' : 'dialog'}
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
            role="listbox"
            aria-label="Choose departure or arrival time"
          >
            <div className="flex flex-col gap-1">
              {MODE_OPTIONS.map((opt) => {
                const active = opt.key === mode;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    role="option"
                    aria-selected={active}
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
          </div>
        )}
      </div>

      {dateModalOpen && (
        <DateTimeModal
          mode={mode === 'arrive-by' ? 'arrive-by' : 'leave-at'}
          plannedTime={plannedTime}
          onChange={handleTimeInput}
          onClose={() => setDateModalOpen(false)}
          accentRgb={accentRgb}
        />
      )}
    </>
  );
}

interface MobileSelectPillProps {
  mode: TimeMode;
  triggerLabel: string;
  onModeSelect: (next: TimeMode) => void;
}

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
        onChange={(event) => onModeSelect(event.target.value as TimeMode)}
        className="absolute inset-0 h-full w-full cursor-pointer rounded-full opacity-0"
        // 16 px prevents iOS Safari from auto-zooming the page when
        // the native picker opens.
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

interface DateTimeModalProps {
  mode: 'leave-at' | 'arrive-by';
  plannedTime: Date | null;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
  accentRgb: string;
}

/**
 * Centered modal containing a native datetime-local input. Replaces
 * the old inline panel that slid in below the pill (which overlapped
 * the route legend on mobile and felt foreign next to the otherwise
 * Google-Maps-style chrome). Backdrop closes on tap, ESC closes via
 * the keydown listener in the parent.
 */
function DateTimeModal({
  mode,
  plannedTime,
  onChange,
  onClose,
  accentRgb,
}: DateTimeModalProps) {
  const title = mode === 'leave-at' ? 'Leave at' : 'Arrive by';
  return (
    <>
      <div
        className="pointer-events-auto fixed inset-0 z-[70]"
        style={{ background: 'rgba(0, 0, 0, 0.45)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Pick ${title} time`}
        className="gma-card gma-pop-in pointer-events-auto fixed left-1/2 top-1/2 z-[71] w-[min(360px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
        style={{ boxShadow: 'var(--gma-shadow-lg)' }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2
            className="text-base font-medium text-[var(--gma-text-primary)]"
            style={{ fontFamily: 'var(--font-data)' }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="gma-press flex h-9 w-9 items-center justify-center rounded-full text-[var(--gma-text-secondary)] hover:bg-[var(--gma-hover-bg)] hover:text-[var(--gma-text-primary)]"
          >
            <CloseIcon />
          </button>
        </div>

        <input
          type="datetime-local"
          value={plannedTime ? dateToLocalString(plannedTime) : ''}
          onChange={onChange}
          autoFocus
          className="h-12 w-full rounded-lg px-3 text-base outline-none"
          style={{
            background: 'var(--gma-input-bg)',
            color: 'var(--gma-text-primary)',
            border: '1px solid var(--gma-input-border)',
            fontFamily: 'var(--font-data)',
            // Same 16 px floor — iOS would zoom on a sub-16 px input.
            fontSize: '16px',
          }}
          aria-label={mode === 'leave-at' ? 'Departure time' : 'Arrival time'}
        />

        <button
          type="button"
          onClick={onClose}
          className="gma-press-soft mt-4 h-11 w-full rounded-xl text-sm font-medium uppercase tracking-wider"
          style={{
            background: accentRgb,
            color: 'var(--gma-text-on-accent)',
            boxShadow: 'var(--gma-glow-amber)',
          }}
        >
          Done
        </button>
      </div>
    </>
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

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
