export interface RouteLegendProps {
  visible: boolean;
  /**
   * Which gradient + labels to render. 'sun' is the default blue→amber
   * "Shaded ← Sunny" legend; 'wind' renders the emerald→violet
   * "Sheltered ← Windy" legend, matching the wind route-coloring;
   * 'rain' renders the cyan→slate "Sheltered ← Wet" legend.
   *
   * When `mode === 'rain'` and `snow` is true, the palette switches to
   * the snow variant (light blue → deep blue) to match the route
   * polyline coloring.
   */
  mode?: 'sun' | 'wind' | 'rain';
  /** Toggles the snow palette when mode === 'rain'. */
  snow?: boolean;
}

/**
 * Small, unobtrusive heat-map legend for the route polyline. Renders only
 * when a route is on the map. Positioned at top-center under the TimePicker
 * pill — sitting below the bottom RouteSheet would put it behind the
 * sheet (sheet z-index 30, sheet is at the bottom), which is the only
 * vertical band where it would always be visible during route review.
 *
 * Colors match the route polyline scheme — left end is the deepest
 * building-shadow blue, right end is the sunny amber. Tree-canopy and
 * facing-away blues fall between those two endpoints in the gradient.
 */
export function RouteLegend({
  visible,
  mode = 'sun',
  snow = false,
}: RouteLegendProps) {
  if (!visible) return null;
  const variant = pickVariant(mode, snow);

  return (
    <div
      className="pointer-events-none absolute left-1/2 top-[calc(env(safe-area-inset-top,0px)+13.5rem)] z-20 -translate-x-1/2 rounded-full bg-white px-3 py-1.5"
      style={{
        boxShadow: 'var(--gma-shadow-sm)',
        border: '1px solid var(--gma-border)',
      }}
      aria-label={variant.ariaLabel}
    >
      <div className="flex items-center gap-2">
        <span
          className="text-[10px] uppercase tracking-[0.18em]"
          style={{
            color: variant.leftColor,
            fontFamily: 'var(--font-data)',
          }}
        >
          {variant.leftLabel}
        </span>
        <span
          className="block h-2 w-32 rounded-full"
          style={{ background: variant.gradient }}
          aria-hidden="true"
        />
        <span
          className="text-[10px] uppercase tracking-[0.18em]"
          style={{
            color: variant.rightColor,
            fontFamily: 'var(--font-data)',
          }}
        >
          {variant.rightLabel}
        </span>
      </div>
    </div>
  );
}

interface LegendVariant {
  leftLabel: string;
  rightLabel: string;
  leftColor: string;
  rightColor: string;
  gradient: string;
  ariaLabel: string;
}

function pickVariant(
  mode: 'sun' | 'wind' | 'rain',
  snow: boolean,
): LegendVariant {
  if (mode === 'wind') {
    return {
      leftLabel: 'Sheltered',
      rightLabel: 'Windy',
      leftColor: 'rgb(16, 185, 129)', //   emerald-500
      rightColor: 'rgb(168, 85, 247)', //  violet-500
      gradient:
        'linear-gradient(to right, rgb(16, 185, 129), rgb(120, 130, 200), rgb(168, 85, 247))',
      ariaLabel: 'Route wind-exposure legend',
    };
  }
  if (mode === 'rain') {
    if (snow) {
      return {
        leftLabel: 'Sheltered',
        rightLabel: 'Snowy',
        leftColor: 'rgb(99, 158, 235)', //   lighter blue
        rightColor: 'rgb(30, 58, 138)', //    blue-900
        gradient:
          'linear-gradient(to right, rgb(186, 230, 253), rgb(99, 158, 235), rgb(30, 58, 138))',
        ariaLabel: 'Route snow-exposure legend',
      };
    }
    return {
      leftLabel: 'Sheltered',
      rightLabel: 'Wet',
      leftColor: 'rgb(6, 182, 212)', //    cyan-500
      rightColor: 'rgb(71, 85, 105)', //   slate-600
      gradient:
        'linear-gradient(to right, rgb(6, 182, 212), rgb(80, 130, 160), rgb(71, 85, 105))',
      ariaLabel: 'Route rain-exposure legend',
    };
  }
  // mode === 'sun'
  return {
    leftLabel: 'Shaded',
    rightLabel: 'Sunny',
    leftColor: 'rgb(40, 60, 140)', //    deep blue
    rightColor: 'rgb(220, 130, 0)', //   amber-orange
    gradient:
      'linear-gradient(to right, rgb(40, 60, 140), rgb(85, 130, 195), rgb(220, 175, 90), rgb(255, 160, 0))',
    ariaLabel: 'Route sun-exposure legend',
  };
}
