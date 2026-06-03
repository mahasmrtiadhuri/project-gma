import { useEffect, useRef, useState } from 'react';
import {
  loadPlacesLibrary,
  onMapsAuthFailure,
} from '../lib/googleMapsLoader';
import type { RoutePoint } from '../lib/hlciRouter';

export interface PlacePick {
  point: RoutePoint;
  label: string;
}

export interface SearchBarProps {
  origin: PlacePick | null;
  destination: PlacePick | null;
  onOriginChange: (next: PlacePick | null) => void;
  onDestinationChange: (next: PlacePick | null) => void;
  onSwap: () => void;
}

const SEARCH_BOUNDS: google.maps.LatLngBoundsLiteral = {
  south: 40.7,
  west: -74.02,
  north: 40.8,
  east: -73.93,
};

/**
 * Light Google-Maps-style two-field search card. Regular <input> + manual
 * AutocompleteSuggestion dropdown (the PlaceAutocompleteElement web
 * component shipped a white shadow-DOM that couldn't be themed reliably).
 */
export function SearchBar({
  origin,
  destination,
  onOriginChange,
  onDestinationChange,
  onSwap,
}: SearchBarProps) {
  return (
    <div className="pointer-events-auto absolute left-1/2 top-4 z-50 w-[min(460px,92vw)] -translate-x-1/2">
      <div
        className="relative flex flex-col rounded-2xl bg-white p-4"
        style={{
          boxShadow:
            '0 14px 36px rgba(0, 0, 0, 0.10), 0 4px 12px rgba(0, 0, 0, 0.05)',
          border: '1px solid var(--gma-border)',
          overflow: 'visible',
        }}
      >
        <SearchRow
          icon={<OriginDot />}
          field={
            <PlaceField
              value={origin?.label ?? ''}
              placeholder="Your location"
              ariaLabel="Origin"
              onSelect={onOriginChange}
            />
          }
        />

        <div className="h-2.5" />

        <SearchRow
          icon={<DestinationDot />}
          field={
            <PlaceField
              value={destination?.label ?? ''}
              placeholder="Choose destination"
              ariaLabel="Destination"
              onSelect={onDestinationChange}
              onClear={
                destination ? () => onDestinationChange(null) : undefined
              }
            />
          }
        />

        <button
          type="button"
          onClick={onSwap}
          disabled={!origin || !destination}
          aria-label="Swap origin and destination"
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-2 text-[var(--gma-text-secondary)] transition-colors hover:bg-black/5 hover:text-[var(--gma-text-primary)] disabled:opacity-30"
        >
          <SwapIcon />
        </button>
      </div>
    </div>
  );
}

function SearchRow({
  icon,
  field,
}: {
  icon: React.ReactNode;
  field: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 pr-12">
      <div className="flex h-4 w-4 shrink-0 items-center justify-center">
        {icon}
      </div>
      <div className="min-w-0 flex-1">{field}</div>
    </div>
  );
}

// ---------- PlaceField ---------------------------------------------------

interface PlaceFieldProps {
  value: string;
  placeholder: string;
  ariaLabel: string;
  onSelect: (pick: PlacePick) => void;
  onClear?: () => void;
}

const DEBOUNCE_MS = 200;

function PlaceField({
  value,
  placeholder,
  ariaLabel,
  onSelect,
  onClear,
}: PlaceFieldProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const [text, setText] = useState(value);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestionLike[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Keyboard-nav highlight. -1 = nothing highlighted; Enter on -1
  // simply submits the typed text and closes the dropdown. ArrowDown
  // from -1 highlights the first suggestion; ArrowUp from -1 highlights
  // the last (typical autocomplete cycle behavior).
  const [highlightedIdx, setHighlightedIdx] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const placesRef = useRef<PlacesNamespace | null>(null);

  const callbackRef = useRef(onSelect);
  callbackRef.current = onSelect;

  useEffect(() => {
    const unsubscribe = onMapsAuthFailure((reason) => {
      setLoadError(reason.split('\n')[0] ?? reason);
      setReady(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!apiKey) {
      setLoadError('Missing API key');
      return;
    }
    let cancelled = false;
    loadPlacesLibrary(apiKey)
      .then((places) => {
        if (cancelled) return;
        placesRef.current = places as unknown as PlacesNamespace;
        setReady(true);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setText(value);
  }, [value]);

  useEffect(
    () => () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    },
    [],
  );

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setText(next);
    setSuggestions([]);

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }

    const trimmed = next.trim();
    if (!trimmed || !ready || !placesRef.current) {
      setDropdownOpen(false);
      return;
    }

    debounceTimerRef.current = window.setTimeout(() => {
      void fetchSuggestions(trimmed);
    }, DEBOUNCE_MS);
  };

  const fetchSuggestions = async (input: string) => {
    const places = placesRef.current;
    if (!places) return;
    try {
      const result = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        locationBias: SEARCH_BOUNDS,
        includedRegionCodes: ['us'],
      });
      const list = result.suggestions ?? [];
      console.log(
        `[GMA] Autocomplete (${ariaLabel}) "${input}" → ${list.length} suggestion(s)`,
      );
      setSuggestions(list);
      setHighlightedIdx(-1); // reset selection when fresh results arrive
      setDropdownOpen(list.length > 0);
    } catch (error) {
      console.warn(`[GMA] AutocompleteSuggestion failed (${ariaLabel}):`, error);
      setSuggestions([]);
      setHighlightedIdx(-1);
      setDropdownOpen(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Only act on keys when we have something to navigate / commit.
    if (event.key === 'Escape') {
      setDropdownOpen(false);
      setHighlightedIdx(-1);
      inputRef.current?.blur();
      return;
    }
    if (!dropdownOpen || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIdx((idx) =>
        idx + 1 >= suggestions.length ? 0 : idx + 1,
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIdx((idx) =>
        idx <= 0 ? suggestions.length - 1 : idx - 1,
      );
      return;
    }
    if (event.key === 'Enter') {
      const pick =
        highlightedIdx >= 0 && highlightedIdx < suggestions.length
          ? suggestions[highlightedIdx]!
          : suggestions[0]!;
      event.preventDefault();
      void handleSelect(pick);
    }
  };

  const handleSelect = async (suggestion: AutocompleteSuggestionLike) => {
    const prediction = suggestion.placePrediction;
    if (!prediction) return;
    setDropdownOpen(false);
    setSuggestions([]);
    try {
      const place = prediction.toPlace();
      await place.fetchFields({
        fields: ['location', 'displayName', 'formattedAddress'],
      });
      const loc = place.location;
      if (!loc) return;
      const label =
        place.displayName ??
        place.formattedAddress ??
        prediction.text?.text ??
        'Place';
      console.log(`[GMA] Picked (${ariaLabel}):`, {
        lng: loc.lng(),
        lat: loc.lat(),
        label,
      });
      setText(label);
      callbackRef.current({
        point: { lng: loc.lng(), lat: loc.lat() },
        label,
      });
    } catch (error) {
      console.error(`[GMA] place.fetchFields threw (${ariaLabel}):`, error);
    }
  };

  const handleBlur = () => {
    window.setTimeout(() => setDropdownOpen(false), 150);
  };

  const handleFocus = () => {
    if (suggestions.length > 0) setDropdownOpen(true);
  };

  const handleClear = () => {
    setText('');
    setSuggestions([]);
    setDropdownOpen(false);
    onClear?.();
    inputRef.current?.focus();
  };

  const placeholderText = !apiKey
    ? 'Set VITE_GOOGLE_MAPS_API_KEY in .env'
    : loadError
      ? `${loadError} (see console)`
      : !ready
        ? 'Loading…'
        : placeholder;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholderText}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={dropdownOpen}
        aria-controls={`${ariaLabel}-suggestions`}
        aria-activedescendant={
          highlightedIdx >= 0
            ? `${ariaLabel}-suggestion-${highlightedIdx}`
            : undefined
        }
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg px-3.5 py-3 text-base outline-none placeholder:text-[var(--gma-text-muted)]"
        style={{
          background: 'rgba(0, 0, 0, 0.025)',
          color: 'var(--gma-text-primary)',
          border: '1px solid var(--gma-border)',
          fontFamily: 'inherit',
        }}
      />

      {onClear && text && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--gma-text-muted)] hover:bg-black/5 hover:text-[var(--gma-text-primary)]"
        >
          <CloseIcon />
        </button>
      )}

      {dropdownOpen && suggestions.length > 0 && (
        <div
          id={`${ariaLabel}-suggestions`}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl bg-white"
          style={{
            boxShadow: 'var(--gma-shadow-lg)',
            border: '1px solid var(--gma-border)',
          }}
        >
          {suggestions.map((s, i) => {
            const pred = s.placePrediction;
            const main = pred?.mainText?.text ?? pred?.text?.text ?? '';
            const secondary = pred?.secondaryText?.text ?? '';
            const isHighlighted = i === highlightedIdx;
            return (
              <button
                key={pred?.placeId ?? `${main}-${i}`}
                id={`${ariaLabel}-suggestion-${i}`}
                type="button"
                role="option"
                aria-selected={isHighlighted}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlightedIdx(i)}
                onClick={() => void handleSelect(s)}
                className="block w-full border-t px-4 py-2.5 text-left transition-colors first:border-t-0"
                style={{
                  borderColor: 'var(--gma-border)',
                  background: isHighlighted
                    ? 'rgba(0, 0, 0, 0.05)'
                    : 'transparent',
                }}
              >
                <div className="truncate text-sm text-[var(--gma-text-primary)]">
                  {main}
                </div>
                {secondary && (
                  <div className="truncate text-xs text-[var(--gma-text-secondary)]">
                    {secondary}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- icons --------------------------------------------------------

function OriginDot() {
  return (
    <span className="inline-block h-3 w-3 rounded-full border-2 border-[var(--gma-text-secondary)]" />
  );
}

function DestinationDot() {
  return (
    <span
      className="inline-block h-3 w-3 rounded-sm"
      style={{ background: 'var(--gma-accent-sun)' }}
    />
  );
}

function SwapIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 4v16M7 4l-3 3M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3"
        stroke="currentColor"
        strokeWidth="2"
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

// ---------- narrow ambient types -----------------------------------------

interface PlacesNamespace {
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(request: {
      input: string;
      locationBias?: google.maps.LatLngBoundsLiteral;
      includedRegionCodes?: ReadonlyArray<string>;
    }): Promise<{ suggestions?: AutocompleteSuggestionLike[] }>;
  };
}

interface AutocompleteSuggestionLike {
  placePrediction?: PlacePredictionLike;
}

interface PlacePredictionLike {
  placeId?: string;
  text?: { text: string };
  mainText?: { text: string };
  secondaryText?: { text: string };
  toPlace(): PlaceLike;
}

interface PlaceLike {
  fetchFields(opts: { fields: ReadonlyArray<string> }): Promise<unknown>;
  location?: { lng(): number; lat(): number };
  displayName?: string;
  formattedAddress?: string;
}
