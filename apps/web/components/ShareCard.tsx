"use client";

/**
 * V20 Feature 7 — Shareable progress cards.
 *
 * Renders 1080×1350 (Instagram-friendly portrait) luxury progress cards on a
 * canvas, styled after the user's active theme via the theme→palette map.
 * Cards render ONLY from the user's real records — the data-selection logic
 * in lib/share-card.ts guarantees unavailable variants never zero-fill.
 *
 * Share flow: `navigator.share` with files when the browser supports it,
 * gracefully falling back to a PNG download.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Share2, Download, Trophy } from "lucide-react";
import { GlassPanel, LuxButton } from "./luxury";
import { useTheme } from "./ThemeProvider";
import {
  cardEyebrow,
  cardHeadline,
  cardSubline,
  describeCardAvailability,
  variantLabel,
  type ShareCardData,
  type ShareCardVariant,
  type WeightPoint,
} from "@/lib/share-card";
import { paletteForTheme, type CardPalette } from "./share-card-palette";

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

/* ------------------------------------------------------------------ */
/* Canvas helpers                                                      */
/* ------------------------------------------------------------------ */

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Draw text with manual letter tracking, horizontally centered at cx. */
function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  trackingPx: number
): void {
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total =
    widths.reduce((a, b) => a + b, 0) + trackingPx * Math.max(0, chars.length - 1);
  let x = cx - total / 2;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  chars.forEach((ch, i) => {
    ctx.fillText(ch, x, y);
    x += widths[i] + trackingPx;
  });
  ctx.textAlign = prevAlign;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(trial).width <= maxWidth || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

/** Small rotated-square ornament. */
function diamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = color;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Card painter                                                        */
/* ------------------------------------------------------------------ */

/** Minimal canvas surface accepted by paintCardToCanvas (real or stubbed). */
export interface CardCanvasLike {
  width: number;
  height: number;
  getContext: (kind: "2d") => CanvasRenderingContext2D | null;
}

/**
 * Size the canvas to CARD_WIDTH×CARD_HEIGHT and paint the card into it.
 * Returns false when no 2D context is available.
 */
export function paintCardToCanvas(
  canvas: CardCanvasLike,
  data: ShareCardData,
  palette: CardPalette
): boolean {
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  drawShareCard(ctx, data, palette);
  return true;
}

/**
 * Paint the card into a 2D context. The canvas must be CARD_WIDTH×CARD_HEIGHT
 * (or scaled). Deterministic: identical data + palette ⇒ identical card.
 */
export function drawShareCard(
  ctx: CanvasRenderingContext2D,
  data: ShareCardData,
  palette: CardPalette
): void {
  const W = CARD_WIDTH;
  const H = CARD_HEIGHT;
  const cx = W / 2;

  // Background.
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, H);

  // Top accent glow.
  const glow = ctx.createRadialGradient(cx, 160, 40, cx, 160, 560);
  glow.addColorStop(0, hexToRgba(palette.accent, 0.12));
  glow.addColorStop(1, hexToRgba(palette.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Hairline double frame.
  ctx.strokeStyle = hexToRgba(palette.accent, 0.5);
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, W - 72, H - 72);
  ctx.strokeStyle = hexToRgba(palette.accent, 0.22);
  ctx.lineWidth = 1;
  ctx.strokeRect(50, 50, W - 100, H - 100);

  // Ornament above the eyebrow.
  diamond(ctx, cx, 148, 12, palette.accent);

  // Eyebrow (variant name, tracked small caps).
  ctx.fillStyle = palette.accent;
  ctx.font = '600 36px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  drawTrackedText(ctx, cardEyebrow(data).toUpperCase(), cx, 224, 14);

  // Headline (serif, wrapped, centered).
  ctx.fillStyle = palette.text;
  ctx.font = '700 96px Georgia, "Times New Roman", serif';
  const lines = wrapLines(ctx, cardHeadline(data), W - 200);
  const lineHeight = 114;
  const firstBaseline = 380;
  lines.forEach((line, i) => {
    ctx.fillText(line, cx, firstBaseline + i * lineHeight);
  });

  // Subline.
  ctx.fillStyle = palette.textSecondary;
  ctx.font = '400 38px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(cardSubline(data), cx, firstBaseline + lines.length * lineHeight - 20);

  // Variant visual band.
  if (data.variant === "weight" && data.points.length >= 2) {
    drawWeightSparkline(ctx, data.points, palette);
  } else {
    drawMedallion(ctx, data, palette);
  }

  // Divider with center diamond.
  const dy = 1022;
  ctx.strokeStyle = hexToRgba(palette.accent, 0.4);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 190, dy);
  ctx.lineTo(cx - 34, dy);
  ctx.moveTo(cx + 34, dy);
  ctx.lineTo(cx + 190, dy);
  ctx.stroke();
  diamond(ctx, cx, dy, 14, palette.accent);

  // Footer wordmark.
  ctx.fillStyle = palette.accent;
  ctx.font = '600 52px system-ui, -apple-system, "Segoe UI", sans-serif';
  drawTrackedText(ctx, "FitFusion AI", cx, 1150, 10);
  ctx.fillStyle = palette.textSecondary;
  ctx.font = 'italic 400 30px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText("Rendered from my own logs", cx, 1208);
}

function drawWeightSparkline(
  ctx: CanvasRenderingContext2D,
  points: WeightPoint[],
  palette: CardPalette
): void {
  const x0 = 110;
  const x1 = CARD_WIDTH - 110;
  const y0 = 660;
  const y1 = 920;
  const kgs = points.map((p) => p.kg);
  let min = Math.min(...kgs);
  let max = Math.max(...kgs);
  if (max - min < 0.5) {
    min -= 0.25;
    max += 0.25;
  }
  const n = points.length;
  const px = (i: number) => x0 + ((x1 - x0) * i) / (n - 1);
  const py = (kg: number) => y1 - ((y1 - y0) * (kg - min)) / (max - min);

  // Area fill under the line.
  const fill = ctx.createLinearGradient(0, y0, 0, y1);
  fill.addColorStop(0, hexToRgba(palette.accent, 0.35));
  fill.addColorStop(1, hexToRgba(palette.accent, 0.02));
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = px(i);
    const y = py(p.kg);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(px(n - 1), y1);
  ctx.lineTo(px(0), y1);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  // Trend line.
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = px(i);
    const y = py(p.kg);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 7;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  // Endpoint dots + labels.
  const label = (i: number, text: string, anchor: CanvasTextAlign) => {
    const x = px(i);
    const y = py(points[i].kg);
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fillStyle = palette.accent;
    ctx.fill();
    ctx.fillStyle = palette.textSecondary;
    ctx.font = '600 26px system-ui, -apple-system, "Segoe UI", sans-serif';
    const prev = ctx.textAlign;
    ctx.textAlign = anchor;
    ctx.fillText(text, anchor === "left" ? x + 22 : x - 22, y - 18);
    ctx.textAlign = prev;
  };
  label(0, "START", "left");
  label(n - 1, "NOW", "right");

  // Axis caption.
  ctx.fillStyle = palette.textSecondary;
  ctx.font = '400 28px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("weigh-ins over time", CARD_WIDTH / 2, y1 + 52);
}

function drawMedallion(
  ctx: CanvasRenderingContext2D,
  data: ShareCardData,
  palette: CardPalette
): void {
  const cx = CARD_WIDTH / 2;
  const cy = 786;
  const r = 168;

  // Rings.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 16, 0, Math.PI * 2);
  ctx.strokeStyle = hexToRgba(palette.accentMuted, 0.6);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Inner disc.
  const disc = ctx.createRadialGradient(cx, cy - 40, 20, cx, cy, r - 16);
  disc.addColorStop(0, hexToRgba(palette.accent, 0.14));
  disc.addColorStop(1, hexToRgba(palette.accent, 0.02));
  ctx.beginPath();
  ctx.arc(cx, cy, r - 16, 0, Math.PI * 2);
  ctx.fillStyle = disc;
  ctx.fill();

  // Number (shrinks to fit).
  let value: string;
  let caption: string;
  if (data.variant === "streak") {
    value = String(data.days);
    caption = data.days === 1 ? "DAY" : "DAYS";
  } else if (data.variant === "milestone") {
    value =
      data.kind === "kcal" ? data.count.toLocaleString("en-US") : String(data.count);
    caption =
      data.kind === "workouts"
        ? data.count === 1
          ? "WORKOUT"
          : "WORKOUTS"
        : data.kind === "days"
          ? "DAYS LOGGED"
          : "KCAL TRACKED";
  } else {
    value = Math.abs(data.deltaKg).toFixed(1);
    caption = "KG";
  }

  let size = 150;
  ctx.textAlign = "center";
  ctx.fillStyle = palette.text;
  while (size > 64) {
    ctx.font = `700 ${size}px Georgia, "Times New Roman", serif`;
    if (ctx.measureText(value).width <= r * 1.5) break;
    size -= 8;
  }
  ctx.fillText(value, cx, cy + size * 0.32);

  ctx.fillStyle = palette.textSecondary;
  const captionLen = caption.length;
  const captionSize = captionLen > 8 ? 24 : 28;
  const captionTrack = captionLen > 8 ? 4 : 8;
  ctx.font = `600 ${captionSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  drawTrackedText(ctx, caption, cx, cy + 96, captionTrack);
}

/* ------------------------------------------------------------------ */
/* Share section (Progress page entry point)                           */
/* ------------------------------------------------------------------ */

export interface ShareSectionProps {
  weights: WeightPoint[];
  /** Per-day nutrition from /api/progress: { date, kcal }. */
  nutritionDays: Array<{ date: string; kcal: number }>;
  /** Dates of completed workouts (YYYY-MM-DD or ISO). */
  workoutDays: string[];
  /** Label for the milestone timeframe, e.g. "last 90 days". */
  timeframeLabel?: string;
}

export function ShareSection({
  weights,
  nutritionDays,
  workoutDays,
  timeframeLabel = "last 90 days",
}: ShareSectionProps) {
  const { resolvedTheme } = useTheme();
  const palette = useMemo(() => paletteForTheme(resolvedTheme), [resolvedTheme]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const availability = useMemo(() => {
    const activeDays = new Set<string>();
    for (const n of nutritionDays) {
      if (typeof n.date === "string" && n.date) activeDays.add(n.date.slice(0, 10));
    }
    for (const d of workoutDays) {
      if (typeof d === "string" && d) activeDays.add(d.slice(0, 10));
    }
    const loggedDays = nutritionDays.filter((n) => n.kcal > 0).length;
    const totalKcal = nutritionDays.reduce((a, n) => a + (n.kcal > 0 ? n.kcal : 0), 0);
    const workoutCount = new Set(
      workoutDays.filter((d) => typeof d === "string").map((d) => d.slice(0, 10))
    ).size;
    return describeCardAvailability({
      weights,
      activeDays: [...activeDays],
      workoutCount,
      loggedDays,
      totalKcal,
      timeframeLabel,
    });
  }, [weights, nutritionDays, workoutDays, timeframeLabel]);

  const firstAvailable = availability.find((a) => a.data)?.variant ?? null;
  const [selected, setSelected] = useState<ShareCardVariant | null>(firstAvailable);
  const selectedData: ShareCardData | null =
    availability.find((a) => a.variant === selected)?.data ?? null;

  // Keep the selection valid when availability changes.
  useEffect(() => {
    if (!selected || !availability.find((a) => a.variant === selected)?.data) {
      setSelected(firstAvailable);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstAvailable]);

  // Paint the preview whenever the card or theme changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedData) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawShareCard(ctx, selectedData, palette);
  }, [selectedData, palette]);

  const paintFresh = (): HTMLCanvasElement | null => {
    const canvas = document.createElement("canvas");
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx || !selectedData) return null;
    drawShareCard(ctx, selectedData, palette);
    return canvas;
  };

  const downloadCard = () => {
    const canvas = paintFresh();
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `fitfusion-${selected ?? "progress"}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus("Card downloaded — check your downloads folder.");
  };

  const shareCard = async () => {
    const canvas = paintFresh();
    if (!canvas) return;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png")
    );
    if (!blob) {
      downloadCard();
      return;
    }
    const file = new File([blob], `fitfusion-${selected ?? "progress"}.png`, {
      type: "image/png",
    });
    const nav = navigator as Navigator & {
      canShare?: (data: { files?: File[] }) => boolean;
    };
    try {
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "My FitFusion AI progress",
          text: selectedData ? cardHeadline(selectedData) : undefined,
        });
        setStatus(null);
        return;
      }
    } catch (err) {
      // User cancelled the share sheet: stay silent. Anything else: fall back.
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
    downloadCard();
    setStatus("Sharing isn't supported here — downloaded the PNG instead.");
  };

  const unavailable = availability.filter((a) => !a.data);

  return (
    <GlassPanel className="p-6">
      <h2 className="t-card-heading flex items-center gap-2">
        <Share2 size={18} aria-hidden="true" style={{ color: "var(--accent)" }} />
        Share your progress
      </h2>
      <p className="t-meta mb-4">
        Cards render only from your real logs — unavailable ones unlock as you keep logging.
      </p>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Card variant">
        {availability.map(({ variant, data, needsNote }) => (
          <LuxButton
            key={variant}
            variant={selected === variant ? "primary" : "ghost"}
            className="px-4"
            disabled={!data}
            aria-pressed={selected === variant}
            title={!data && needsNote ? needsNote : variantLabel(variant)}
            onClick={() => setSelected(variant)}
          >
            {variantLabel(variant)}
          </LuxButton>
        ))}
      </div>

      {unavailable.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {unavailable.map(({ variant, needsNote }) => (
            <li key={variant} className="t-meta flex items-start gap-2">
              <Trophy size={14} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }} />
              <span>
                <strong>{variantLabel(variant)}:</strong> {needsNote}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {selectedData ? (
        <div className="mt-5 flex flex-col items-center gap-4">
          <canvas
            ref={canvasRef}
            width={CARD_WIDTH}
            height={CARD_HEIGHT}
            className="w-full max-w-[320px] rounded-xl shadow-2xl"
            style={{ aspectRatio: `${CARD_WIDTH} / ${CARD_HEIGHT}` }}
            role="img"
            aria-label={`Shareable progress card: ${cardHeadline(selectedData)}`}
          />
          <div className="flex flex-wrap justify-center gap-3">
            <LuxButton variant="primary" onClick={downloadCard} className="flex items-center gap-2">
              <Download size={16} aria-hidden="true" />
              Download PNG
            </LuxButton>
            <LuxButton variant="secondary" onClick={() => void shareCard()} className="flex items-center gap-2">
              <Share2 size={16} aria-hidden="true" />
              Share
            </LuxButton>
          </div>
          {status ? (
            <p className="t-meta text-center" role="status">
              {status}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="t-body mt-5 py-6 text-center" style={{ color: "var(--text-secondary)" }}>
          Nothing shareable yet — log weigh-ins, meals, and workouts and your first card will appear here.
        </p>
      )}
    </GlassPanel>
  );
}
