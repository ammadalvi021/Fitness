/**
 * Exercise animation engine — forward kinematics for a side-view stick figure.
 *
 * Coordinate system: SVG coords (x right, y DOWN), viewBox "0 0 200 200",
 * hips baseline at (100, 118).
 *
 * Angle conventions (degrees):
 * - torso: 0 = upright, positive = lean forward.
 *   shoulderPos = hips + torsoLen * (sin(torso), -cos(torso))
 * - head: tilt added to torso angle for the head offset.
 * - sh (shoulder): 0 = arm hanging down, 90 = horizontal forward, 180 = overhead.
 *   limb dir(θ) = (sin θ, cos θ).
 * - el (elbow): 0 = straight, positive = bend; forearmAngle = shoulderAngle - elbow.
 * - hip: 0 = leg down, positive = thigh forward; dir(α) = (sin α, cos α).
 * - kn (knee): 0 = straight, positive = heel-to-butt; shinAngle = hipAngle - knee.
 * - Suffix L/R for left/right limbs.
 * - dx, dy: translate hips (px). rot: whole-body rotation (degrees) about the
 *   hips — applied as an SVG <g> transform, NOT in the FK math.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Pose {
  torso?: number;
  head?: number;
  shL?: number;
  elL?: number;
  shR?: number;
  elR?: number;
  hipL?: number;
  knL?: number;
  hipR?: number;
  knR?: number;
  dx?: number;
  dy?: number;
  rot?: number;
}

export type EaseKind = "linear" | "easeInOut";

export interface Keyframe {
  /** The pose reached at the END of this segment. */
  pose: Pose;
  /** Milliseconds to travel from the previous keyframe's pose to this one. */
  ms: number;
  ease?: EaseKind;
}

export type AnimProp = "dumbbell" | "barbell" | "bench" | "mat" | "bar";

export interface AnimDef {
  keyframes: Keyframe[];
  props?: AnimProp[];
}

export interface Joints {
  hips: Pt;
  shoulder: Pt;
  head: Pt;
  elbowL: Pt;
  handL: Pt;
  elbowR: Pt;
  handR: Pt;
  kneeL: Pt;
  footL: Pt;
  kneeR: Pt;
  footR: Pt;
}

// Segment lengths (px)
const TORSO_LEN = 52;
const HEAD_R = 11;
const HEAD_OFFSET = 14;
const UPPER_ARM = 30;
const FOREARM = 27;
const THIGH = 33;
const SHIN = 30;
const HIPS_X = 100;
const HIPS_Y = 118;

const D2R = Math.PI / 180;

/** Limb direction for an angle in degrees: (sin θ, cos θ) in SVG coords. */
function dir(deg: number): Pt {
  const r = deg * D2R;
  return { x: Math.sin(r), y: Math.cos(r) };
}

function add(p: Pt, d: Pt, len: number): Pt {
  return { x: p.x + d.x * len, y: p.y + d.y * len };
}

/** All numeric pose fields, in a fixed order. */
const POSE_FIELDS: (keyof Pose)[] = [
  "torso",
  "head",
  "shL",
  "elL",
  "shR",
  "elR",
  "hipL",
  "knL",
  "hipR",
  "knR",
  "dx",
  "dy",
  "rot",
];

/** Fields that are joint angles (validated for sane ranges). */
const ANGLE_FIELDS: (keyof Pose)[] = [
  "torso",
  "head",
  "shL",
  "elL",
  "shR",
  "elR",
  "hipL",
  "knL",
  "hipR",
  "knR",
  "rot",
];

function easeInOutQuad(e: number): number {
  return e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
}

/** Total loop duration in ms. */
export function cycleMs(def: AnimDef): number {
  return def.keyframes.reduce((sum, k) => sum + k.ms, 0);
}

/**
 * Sample the pose at time tMs. The loop is closed by construction: segment i
 * travels from keyframe[(i-1+n)%n].pose to keyframe[i].pose, so t=0 and
 * t=cycle yield the identical pose. Unspecified numeric fields are treated
 * as 0 in BOTH keyframes, so joints return to neutral when not posed —
 * this keeps loops clean.
 */
export function samplePose(def: AnimDef, tMs: number): Pose {
  const n = def.keyframes.length;
  if (n === 0) return {};
  const total = cycleMs(def);
  if (total <= 0) return { ...def.keyframes[n - 1].pose };

  let t = tMs % total;
  if (t < 0) t += total;

  let acc = 0;
  for (let i = 0; i < n; i++) {
    const k = def.keyframes[i];
    const prev = def.keyframes[(i - 1 + n) % n].pose;
    if (t < acc + k.ms || i === n - 1) {
      const raw = k.ms > 0 ? (t - acc) / k.ms : 1;
      const e = Math.min(1, Math.max(0, raw));
      const eased = (k.ease ?? "easeInOut") === "linear" ? e : easeInOutQuad(e);
      const out: Pose = {};
      for (const f of POSE_FIELDS) {
        const a = prev[f] ?? 0;
        const b = k.pose[f] ?? 0;
        const v = a + (b - a) * eased;
        if (v !== 0) out[f] = v;
      }
      return out;
    }
    acc += k.ms;
  }
  return {};
}

/** Forward kinematics: joint pixel positions for a pose. */
export function fk(pose: Pose): Joints {
  const p = (f: keyof Pose): number => pose[f] ?? 0;
  const hips: Pt = { x: HIPS_X + p("dx"), y: HIPS_Y + p("dy") };
  const torso = p("torso");
  // NB: -cos so that torso=0 puts the shoulder ABOVE the hips
  // (spec: shoulderPos = hips + torsoLen*(sin(torso), -cos(torso))).
  const shoulder = add(
    hips,
    { x: Math.sin(torso * D2R), y: -Math.cos(torso * D2R) },
    TORSO_LEN,
  );
  const headAngle = torso + p("head");
  const head = add(shoulder, { x: Math.sin(headAngle * D2R), y: -Math.cos(headAngle * D2R) }, HEAD_OFFSET);

  const arm = (sh: number, el: number): { elbow: Pt; hand: Pt } => {
    const elbow = add(shoulder, dir(sh), UPPER_ARM);
    const hand = add(elbow, dir(sh - el), FOREARM);
    return { elbow, hand };
  };
  const leg = (hip: number, kn: number): { knee: Pt; foot: Pt } => {
    const knee = add(hips, dir(hip), THIGH);
    const foot = add(knee, dir(hip - kn), SHIN);
    return { knee, foot };
  };

  const armL = arm(p("shL"), p("elL"));
  const armR = arm(p("shR"), p("elR"));
  const legL = leg(p("hipL"), p("knL"));
  const legR = leg(p("hipR"), p("knR"));

  return {
    hips,
    shoulder,
    head,
    elbowL: armL.elbow,
    handL: armL.hand,
    elbowR: armR.elbow,
    handR: armR.hand,
    kneeL: legL.knee,
    footL: legL.foot,
    kneeR: legR.knee,
    footR: legR.foot,
  };
}

/** Forearm direction angle (degrees, in dir() convention) for prop rotation. */
export function forearmAngle(pose: Pose, side: "L" | "R"): number {
  const sh = pose[side === "L" ? "shL" : "shR"] ?? 0;
  const el = pose[side === "L" ? "elL" : "elR"] ?? 0;
  return sh - el;
}

/**
 * Validate an animation definition. Returns a list of problem descriptions;
 * empty means the def is OK.
 */
export function validateAnimDef(def: AnimDef): string[] {
  const problems: string[] = [];
  if (!def || !Array.isArray(def.keyframes) || def.keyframes.length < 2) {
    problems.push("need at least 2 keyframes");
    return problems;
  }
  def.keyframes.forEach((k, i) => {
    if (!(k.ms > 0)) problems.push(`keyframe ${i}: ms must be > 0`);
    if (!k.pose || typeof k.pose !== "object") {
      problems.push(`keyframe ${i}: pose missing`);
      return;
    }
    for (const f of ANGLE_FIELDS) {
      const v = k.pose[f];
      if (v !== undefined && !(Math.abs(v) <= 200)) {
        problems.push(`keyframe ${i}: ${f}=${v} out of sane range (|angle| <= 200)`);
      }
    }
    for (const f of ["dx", "dy"] as const) {
      const v = k.pose[f];
      if (v !== undefined && !(Math.abs(v) <= 100)) {
        problems.push(`keyframe ${i}: ${f}=${v} out of sane range (|offset| <= 100)`);
      }
    }
  });
  if (!(cycleMs(def) > 0)) problems.push("total cycle must be > 0");
  return problems;
}

export { HEAD_R };
