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

/**
 * Light departure/arrival time picker — sits under the transport mode
 * pills. Clock-icon trigger pill opens a dropdown with three modes plus a
 * native datetime-local input when a planned-time mode is active.
 */
export function TimePicker({
  mode,
  plannedTime,
  onChange,
  dayColor,
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const accentRgb = `rgb(${dayColor[0]}, ${dayColor[1]}, ${dayColor[2]})`;

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

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
    <div
      ref={wrapperRef}
      className="pointer-events-auto absolute left-1/2 top-[calc(env(safe-area-inset-top,0px)+13.5rem)] z-20 w-[min(300px,calc(100vw-2rem))] -translate-x-1/2"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white px-4 text-sm text-[var(--gma-text-primary)] transition-colors hover:bg-black/[0.02]"
        style={{
          boxShadow: 'var(--gma-shadow-md)',
          border: '1px solid var(--gma-border)',
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <ClockIcon />
        <span style={{ fontFamily: 'var(--font-data)' }}>{triggerLabel}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          className="absolute left-1/2 top-full z-40 mt-2 w-[min(320px,92vw)] -translate-x-1/2 rounded-xl bg-white p-2"
          style={{
            boxShadow: 'var(--gma-shadow-lg)',
            border: '1px solid var(--gma-border)',
          }}
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
                  className="flex min-h-[44px] items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors"
                  style={
                    active
                      ? {
                          background: accentRgb,
                          color: '#ffffff',
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
                  background: 'rgba(0, 0, 0, 0.03)',
                  color: 'var(--gma-text-primary)',
                  border: '1px solid var(--gma-border)',
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
