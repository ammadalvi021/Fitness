/**
 * StickFigure — SVG rendering of exercise-animation joints.
 *
 * Side view, facing right. Far-side (R) limbs are drawn first, dimmed;
 * near-side (L) limbs use the brand green. Whole-body rotation (`rot`) is
 * applied as an SVG <g> transform about the hips — the FK math stays in
 * the figure's local frame.
 */
import type { SVGProps } from "react";
import type { AnimProp, Joints, Pose, Pt } from "./engine";
import { forearmAngle, HEAD_R } from "./engine";

const BRAND = "#16a34a";
const FAR_STROKE = "#a3a3a3";
const PROP_FILL = "#404040";
const BENCH_FILL = "#d4d4d4";
const MAT_FILL = "#e5e5e5";
const GROUND_STROKE = "#d4d4d4";

function rotatePt(p: Pt, cx: number, cy: number, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function Limb({
  from,
  mid,
  to,
  stroke,
  width,
  opacity,
}: {
  from: Pt;
  mid: Pt;
  to: Pt;
  stroke: string;
  width: number;
  opacity?: number;
}) {
  return (
    <polyline
      points={`${from.x},${from.y} ${mid.x},${mid.y} ${to.x},${to.y}`}
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
    />
  );
}

/** Small dumbbell centered on a hand, aligned with the forearm. */
function Dumbbell({ hand, angleDeg }: { hand: Pt; angleDeg: number }) {
  return (
    <g transform={`rotate(${90 - angleDeg} ${hand.x} ${hand.y})`}>
      <rect
        x={hand.x - 11}
        y={hand.y - 4.5}
        width={22}
        height={9}
        rx={4.5}
        fill={PROP_FILL}
      />
    </g>
  );
}

/** Long bar through both hands (bench press, lat pulldown). */
function Barbell({ handL, handR }: { handL: Pt; handR: Pt }) {
  const dx = handR.x - handL.x;
  const dy = handR.y - handL.y;
  const len = Math.hypot(dx, dy) || 1;
  const ex = (dx / len) * 38;
  const ey = (dy / len) * 38;
  return (
    <line
      x1={handL.x - ex}
      y1={handL.y - ey}
      x2={handR.x + ex}
      y2={handR.y + ey}
      stroke={PROP_FILL}
      strokeWidth={7}
      strokeLinecap="round"
    />
  );
}

export function StickFigure({
  joints,
  pose,
  props,
  svgProps,
}: {
  joints: Joints;
  pose: Pose;
  props?: AnimProp[];
  svgProps?: SVGProps<SVGSVGElement>;
}) {
  const rot = pose.rot ?? 0;
  const hx = joints.hips.x;
  const hy = joints.hips.y;
  const has = (p: AnimProp) => props?.includes(p) ?? false;

  // Bench is world-fixed: position it from the ROTATED torso so it sits
  // under the body whether upright (dip) or lying (press).
  const hipsR = rotatePt(joints.hips, hx, hy, rot);
  const shoulderR = rotatePt(joints.shoulder, hx, hy, rot);
  const benchY = Math.max(hipsR.y, shoulderR.y) + 12;
  const benchX1 = Math.min(hipsR.x, shoulderR.x) - 24;
  const benchX2 = Math.max(hipsR.x, shoulderR.x) + 24;

  const showGround = Math.abs(rot) <= 1 && !has("bench") && !has("mat");

  return (
    <svg viewBox="0 0 200 200" width="100%" height="100%" {...svgProps}>
      {/* World-fixed elements */}
      {showGround && (
        <line x1={30} y1={188} x2={170} y2={188} stroke={GROUND_STROKE} strokeWidth={3} strokeLinecap="round" />
      )}
      {has("mat") && (
        <rect x={42} y={170} width={116} height={9} rx={4.5} fill={MAT_FILL} />
      )}
      {has("bar") && (
        <line x1={58} y1={24} x2={142} y2={24} stroke={PROP_FILL} strokeWidth={6} strokeLinecap="round" />
      )}
      {has("bench") && (
        <rect
          x={benchX1}
          y={benchY - 6}
          width={Math.max(20, benchX2 - benchX1)}
          height={12}
          rx={6}
          fill={BENCH_FILL}
        />
      )}

      {/* Figure (rotates about the hips) */}
      <g transform={`rotate(${rot} ${hx} ${hy})`}>
        {/* Far-side limbs */}
        <Limb from={joints.shoulder} mid={joints.elbowR} to={joints.handR} stroke={FAR_STROKE} width={6} opacity={0.45} />
        <Limb from={joints.hips} mid={joints.kneeR} to={joints.footR} stroke={FAR_STROKE} width={6} opacity={0.45} />
        {/* Torso */}
        <line
          x1={joints.hips.x}
          y1={joints.hips.y}
          x2={joints.shoulder.x}
          y2={joints.shoulder.y}
          stroke={BRAND}
          strokeWidth={8}
          strokeLinecap="round"
        />
        {/* Near-side limbs */}
        <Limb from={joints.hips} mid={joints.kneeL} to={joints.footL} stroke={BRAND} width={7} />
        <Limb from={joints.shoulder} mid={joints.elbowL} to={joints.handL} stroke={BRAND} width={7} />
        {/* Head */}
        <circle cx={joints.head.x} cy={joints.head.y} r={HEAD_R} fill={BRAND} />
        {/* Props that move with the body */}
        {has("dumbbell") && (
          <>
            <Dumbbell hand={joints.handL} angleDeg={forearmAngle(pose, "L")} />
            <Dumbbell hand={joints.handR} angleDeg={forearmAngle(pose, "R")} />
          </>
        )}
        {has("barbell") && <Barbell handL={joints.handL} handR={joints.handR} />}
      </g>
    </svg>
  );
}
