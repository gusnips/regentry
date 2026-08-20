import { COMET_GEOMETRY } from "@/shared/logo";

/**
 * The comet-tab in postures. The brand mark is a tab in motion, so the mark
 * *is* the character — no face and no second animal to keep on-model. State
 * lives in two places only: how far the body leans, and what the trail is
 * doing. Everything a panel state needs to say ("parked", "going", "your
 * turn", "stopped", "finished") is one of those two dialled somewhere.
 *
 * Geometry comes from `shared/logo.ts` so the poses and the extension icon
 * stay one object. Color does not: the icon lives on its own deep-field tile,
 * while these sit on the panel's ground and must survive both themes, so the
 * fills are utilities. The body stays the same quiet neutral in every pose —
 * it's the vessel — and the trail carries the light, which keeps the two-light
 * rule intact: emerald when it acts, gold when it wants you, neutral at rest.
 */
export type Pose = "ready" | "resting" | "waiting" | "blocked";

const { tab, dot, trail } = COMET_GEOMETRY;

/** Bottom-center of the body — leaning pivots here, the way a runner's does. */
const PIVOT = "32 30";

/** `ready` is a landscape composition; the others are their own tighter one. */
const READY_ASPECT = 2.8;

/**
 * The three short poses window onto the mark's coordinates rather than
 * inheriting the icon's 48×48 square, because the drawing only ever occupies a
 * band across the middle of it — trail bar at x≈10 through the body's right
 * edge at 41, y 14 through 32. Rendered on the full square they came out as
 * ~13px slivers floating in a third of their own box. Bounds are padded to
 * clear `blocked`'s lean, which swings the body's top-left corner out.
 */
const POSE_VIEWBOX = "8 14 35 18";
const POSE_ASPECT = 35 / 18;

type TrailSpec = { width: number; className: string };

type PoseSpec = {
  lean: number;
  dim?: boolean;
  trails: TrailSpec[];
  dotClass: string;
  dotPulse?: boolean;
};

const EMERALD = "fill-brand-500 dark:fill-brand-400";
const GOLD = "fill-amber-500 dark:fill-amber-400";
const QUIET = "fill-neutral-300 dark:fill-neutral-600";

/*
 * Four postures, and deliberately not more: a `running` comet and a `done` one
 * were drawn and cut, because the only surfaces that could honestly carry them
 * already say the same thing better — the live band has its shimmer and its
 * wash, and the on-page widget has a pulse and a documented one-motion rule.
 * The natural home for a running comet is that widget (`browser/status-widget
 * .ts`), which is background code with its own runtime CSS; adding it there is
 * a deliberate change, not a side effect of a panel pass.
 */
/*
 * Trail widths are held above ~2.5× the bar's own height. Shorter than that
 * and a "trail" is just a dot beside the tab — the first cut used 3–6 and read
 * as punctuation. Length is the secondary cue anyway; lean and color carry the
 * state, which is why `blocked`'s stub can be the shortest without going mute.
 */
const POSES: Record<Exclude<Pose, "ready">, PoseSpec> = {
  // Parked. One trail left over from a run, going nowhere.
  resting: {
    lean: 0,
    trails: [{ width: 8, className: QUIET }],
    dotClass: "fill-neutral-400 dark:fill-neutral-500",
  },
  // Upright, holding station, gold — nothing is wrong, it just needs you.
  // Both bars, so the pose that wants attention is the one closest to the mark.
  waiting: {
    lean: 0,
    trails: [
      { width: 9, className: GOLD },
      { width: 6, className: "fill-amber-400/70 dark:fill-amber-300/70" },
    ],
    dotClass: GOLD,
    dotPulse: true,
  },
  // Braking: leaned back off the direction of travel, trail cut short.
  blocked: {
    lean: -6,
    dim: true,
    trails: [{ width: 5, className: GOLD }],
    dotClass: GOLD,
  },
};

/** The vessel. One fill in every pose — the trail is what changes color. */
function Body({ lean }: { lean: number }) {
  return (
    <path
      d={tab}
      className="fill-neutral-300 dark:fill-neutral-600"
      transform={lean ? `rotate(${lean} ${PIVOT})` : undefined}
    />
  );
}

function Trail({ spec, index }: { spec: TrailSpec; index: number }) {
  return (
    <rect
      x={trail.endX - spec.width}
      y={index === 0 ? trail.nearY : trail.farY}
      width={spec.width}
      height={trail.height}
      rx={trail.rx}
      className={spec.className}
    />
  );
}

/**
 * `ready` is the one pose with somewhere to be: the body parked at the start
 * of a dashed trajectory that runs off to a target it hasn't reached. It is
 * the tagline drawn — you give the goal, it runs the tabs — so it earns the
 * wider canvas and belongs to the empty states that are literally asking for
 * a goal. The dashes march so the route reads as live rather than as a
 * decorative dotted rule.
 */
function ReadyPose({ size, className }: { size: number; className?: string }) {
  return (
    // The canvas hugs the drawing — 112×40 with the body at 2× and filling
    // two thirds of the height. A first pass laid the same parts out on the
    // icon's roomy 48-tall square and the body came out a ~19px smudge at the
    // far left of a mostly-empty box: an illustration you had to look for.
    <svg
      viewBox="0 0 112 40"
      height={size}
      width={size * READY_ASPECT}
      fill="none"
      className={className}
      aria-hidden
    >
      {/* Scaled about the body's own centre, then placed — so the dot rides
          along and stays on the tab instead of being positioned twice. */}
      <g transform="translate(-12 -3.5) translate(32 23.5) scale(2) translate(-32 -23.5)">
        <Body lean={0} />
        <circle cx={dot.cx} cy={dot.cy} r={dot.r} className={EMERALD} />
      </g>
      <path
        d="M 42 20 C 62 20 68 13 86 12"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="2 6"
        className="comet-runway stroke-neutral-300 dark:stroke-neutral-700"
      />
      <circle
        cx="98"
        cy="13"
        r="6"
        strokeWidth="1.75"
        className="stroke-neutral-300 dark:stroke-neutral-700"
      />
      <circle cx="98" cy="13" r="2" className="fill-neutral-300 dark:fill-neutral-700" />
    </svg>
  );
}

/**
 * Sized by HEIGHT; each pose sets its own width from it — `ready` is the wide
 * one at 2.8×, the rest run about 1.9×. Below ~32px tall the trail merges into
 * the body (the threshold that gave the icon set its "small" variant), so keep
 * these at illustration size and reach for `BrandMark` when you need a glyph.
 */
export function CometPose({
  pose,
  size = 48,
  className,
}: {
  pose: Pose;
  size?: number;
  className?: string;
}) {
  if (pose === "ready") return <ReadyPose size={size} className={className} />;

  const spec = POSES[pose];
  return (
    <svg
      viewBox={POSE_VIEWBOX}
      height={size}
      width={size * POSE_ASPECT}
      fill="none"
      className={className}
      aria-hidden
    >
      <g className={spec.dim ? "opacity-75" : undefined}>
        {spec.trails.map((t, i) => (
          <Trail key={i} spec={t} index={i} />
        ))}
        <Body lean={spec.lean} />
        {/* The dot rides the body, so it leans with it — separate element only
            because it needs its own fill and, when waiting, its own pulse. */}
        <g transform={spec.lean ? `rotate(${spec.lean} ${PIVOT})` : undefined}>
          <circle
            cx={dot.cx}
            cy={dot.cy}
            r={dot.r}
            className={`${spec.dotClass} ${spec.dotPulse ? "thinking-dot" : ""}`}
          />
        </g>
      </g>
    </svg>
  );
}
