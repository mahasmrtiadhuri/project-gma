import { useEffect, useRef, useState } from 'react';

export type ChatRole = 'user' | 'ai';

export interface ChatMessage {
  id: number;
  role: ChatRole;
  text: string;
}

export interface AIChatPanelProps {
  open: boolean;
  onClose: () => void;
  /**
   * Fired when the user (or the demo typewriter) submits text. The
   * parent owns the chat history — push both the user message AND
   * the AI response into `messages` so the panel can render them.
   * Resolution timing controls when `busy` flips back to false.
   */
  onSubmit: (text: string) => Promise<void>;
  /** Append-only chat log displayed in the history area. */
  messages: ChatMessage[];
  /** True while a Gemini call is in flight — disables input + send. */
  busy: boolean;
  /**
   * Demo override: when non-null, the input value is forced to this
   * string instead of the user's typed value. App.tsx drives this
   * during the demo's typewriter step.
   */
  overrideText?: string | null;
}

/**
 * Slides up from the bottom-right of the screen as a 380 × 480 px
 * dark-glass card. Header / scrollable chat history / multi-line
 * input / send button stacked vertically.
 */
export function AIChatPanel({
  open,
  onClose,
  onSubmit,
  messages,
  busy,
  overrideText = null,
}: AIChatPanelProps) {
  const [input, setInput] = useState('');
  const historyRef = useRef<HTMLDivElement | null>(null);

  // Scroll the history to the bottom whenever new messages arrive
  // (or the busy spinner starts) so the latest exchange is in view.
  useEffect(() => {
    if (!historyRef.current) return;
    historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [messages, busy]);

  if (!open) return null;

  const displayedInput = overrideText ?? input;
  const isOverride = overrideText != null;
  const canSubmit = !busy && displayedInput.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const text = displayedInput.trim();
    await onSubmit(text);
    if (!isOverride) setInput('');
  };

  return (
    <div
      role="dialog"
      aria-label="GMA AI assistant"
      className="pointer-events-auto fixed flex flex-col overflow-hidden rounded-2xl"
      style={{
        right: '16px',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        width: 'min(380px, calc(100vw - 32px))',
        height: 'min(480px, calc(100vh - 32px))',
        zIndex: 100,
        background: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(20px) saturate(140%)',
        WebkitBackdropFilter: 'blur(20px) saturate(140%)',
        border: '1px solid rgba(255, 255, 255, 0.10)',
        boxShadow:
          '0 20px 48px rgba(0, 0, 0, 0.45), 0 4px 16px rgba(0, 0, 0, 0.25)',
        color: 'rgba(255, 255, 255, 0.95)',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* ── Header ── */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-4 py-3"
        style={{ borderColor: 'rgba(255, 255, 255, 0.08)' }}
      >
        <div
          className="flex h-7 w-7 items-center justify-center rounded-full"
          style={{
            background: 'linear-gradient(135deg, #F59E0B 0%, #EA8000 100%)',
          }}
          aria-hidden="true"
        >
          <SparkleIcon />
        </div>
        <div className="flex-1 text-sm font-semibold tracking-tight">
          GMA AI Assistant
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI assistant"
          className="gma-press flex h-8 w-8 items-center justify-center rounded-full"
          style={{
            background: 'rgba(255, 255, 255, 0.06)',
            color: 'rgba(255, 255, 255, 0.85)',
          }}
        >
          <CloseIcon />
        </button>
      </div>

      {/* ── Chat history ── */}
      <div
        ref={historyRef}
        className="flex-1 space-y-2 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 && !busy && (
          <div
            className="px-2 py-4 text-center text-xs leading-relaxed"
            style={{ color: 'rgba(255, 255, 255, 0.55)' }}
          >
            Ask me about routing or current conditions —{' '}
            <span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>
              "I'm in a suit, it's hot, slight drizzle, running late"
            </span>
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} role={m.role} text={m.text} />
        ))}
        {busy && <TypingIndicator />}
      </div>

      {/* ── Composer ── */}
      <div
        className="shrink-0 border-t p-3"
        style={{ borderColor: 'rgba(255, 255, 255, 0.08)' }}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={displayedInput}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Tell me about your trip…"
            rows={4}
            disabled={busy || isOverride}
            maxLength={300}
            onKeyDown={(event) => {
              // Enter submits; Shift+Enter inserts a newline.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            className="flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none placeholder:text-white/40 disabled:opacity-60"
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: 'rgba(255, 255, 255, 0.95)',
              minHeight: '88px',
              maxHeight: '120px',
              fontSize: '14px',
              lineHeight: 1.5,
            }}
          />
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            aria-label={busy ? 'Sending…' : 'Send'}
            className="gma-press flex h-10 w-10 shrink-0 items-center justify-center rounded-lg disabled:opacity-40"
            style={{
              background: 'linear-gradient(135deg, #F59E0B 0%, #EA8000 100%)',
              color: '#ffffff',
              boxShadow: '0 4px 12px rgba(245, 158, 11, 0.40)',
            }}
          >
            {busy ? <SmallSpinner /> : <SendIcon />}
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ role, text }: { role: ChatRole; text: string }) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed"
        style={
          isUser
            ? {
                background: 'linear-gradient(135deg, #F59E0B 0%, #EA8000 100%)',
                color: '#ffffff',
                borderBottomRightRadius: '4px',
              }
            : {
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'rgba(255, 255, 255, 0.92)',
                borderBottomLeftRadius: '4px',
              }
        }
      >
        {text}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div
        className="flex items-center gap-1 rounded-2xl px-3.5 py-2.5"
        style={{
          background: 'rgba(255, 255, 255, 0.08)',
          borderBottomLeftRadius: '4px',
        }}
        aria-label="AI is thinking"
      >
        <Dot delay="0ms" />
        <Dot delay="180ms" />
        <Dot delay="360ms" />
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{
        background: 'rgba(255, 255, 255, 0.65)',
        animation: 'gma-typing-dot 1.1s ease-in-out infinite',
        animationDelay: delay,
      }}
    />
  );
}

function SparkleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 3 L13.6 10.4 L21 12 L13.6 13.6 L12 21 L10.4 13.6 L3 12 L10.4 10.4 Z" />
      <path d="M19 4 L19.6 6.4 L22 7 L19.6 7.6 L19 10 L18.4 7.6 L16 7 L18.4 6.4 Z" opacity="0.7" />
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

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
    </svg>
  );
}

function SmallSpinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
