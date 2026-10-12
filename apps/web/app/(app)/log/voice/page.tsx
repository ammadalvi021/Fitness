"use client";

/**
 * /log/voice — voice food logging (V18 Phase E).
 *
 * Web Speech API -> transcript -> pure parser (lib/voice-parse) -> review
 * screen showing EXACTLY what was parsed (quantities are never invented:
 * unstated quantities are flagged "assumed") -> confirm logs each item via
 * POST /api/diary with a fresh idempotency key.
 *
 * Unparsed chunks are shown for manual entry, never guessed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Check, Mic, MicOff, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import {
  parseVoiceTranscript,
  speechRecognitionSupported,
  type VoiceParsedItem,
} from "@/lib/voice-parse";
import { GlassPanel, LuxBadge, LuxButton } from "@/components/luxury";
import { Input, Select, Skeleton } from "@/components/ui";
import { VerificationBadge } from "@/components/VerificationBadge";
import { mealTypeOptions, todayYMD } from "../../nutrition/_shared";
import type { MealType } from "@fitfusion/core";
import { useSession } from "@/components/session";

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface MatchedItem extends VoiceParsedItem {
  foodName: string;
  verification?: string;
  basis?: string | null;
}

interface FoodHit {
  id: string;
  name: string;
  verification?: string;
  basis?: string | null;
}

async function matchFood(keywords: string): Promise<FoodHit | null> {
  try {
    const data = await api<{ foods?: FoodHit[] }>(
      `/api/foods?q=${encodeURIComponent(keywords)}&limit=5`,
    );
    const foods = Array.isArray(data.foods) ? data.foods : [];
    // Prefer a result whose name actually contains the keyword words.
    const words = keywords.split(/\s+/).filter(Boolean);
    const hit =
      foods.find((f) => words.every((w) => f.name.toLowerCase().includes(w))) ?? foods[0];
    return hit ?? null;
  } catch {
    return null;
  }
}

export default function VoiceLogPage() {
  const session = useSession();
  const searchParams = useSearchParams();
  const ramadanMode = Boolean(
    (session.profile as Record<string, unknown> | null)?.ramadanMode,
  );
  const options = mealTypeOptions(ramadanMode);

  const [supported] = useState(() => speechRecognitionSupported());
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [items, setItems] = useState<MatchedItem[] | null>(null);
  const [unparsed, setUnparsed] = useState<string[]>([]);
  const [matching, setMatching] = useState(false);
  const [mealType, setMealType] = useState<MealType>("lunch");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  // ?meal=sehri deep-link from the Ramadan page.
  useEffect(() => {
    const m = searchParams.get("meal");
    if (m && options.some((o) => o.value === m)) setMealType(m as MealType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopListening = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }, []);

  const runParse = useCallback(async (text: string) => {
    const { parsed, unparsed } = parseVoiceTranscript(text.trim());
    setUnparsed(unparsed);
    if (parsed.length === 0) {
      setItems([]);
      return;
    }
    setMatching(true);
    const matched: MatchedItem[] = [];
    for (const p of parsed) {
      const hit = await matchFood(p.text);
      matched.push({
        ...p,
        foodId: hit?.id,
        foodName: hit?.name ?? p.text,
        verification: hit?.verification,
        basis: hit?.basis ?? null,
        needsReview: !hit || p.quantityInferred,
      });
    }
    setMatching(false);
    setItems(matched);
  }, []);

  const toggleMic = useCallback(() => {
    if (listening) {
      stopListening();
      return;
    }
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    setError(null);
    setDone(null);
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      setTranscript((finalText + interim).trim());
    };
    rec.onerror = (ev) => {
      setError(
        ev.error === "not-allowed"
          ? "Microphone access was blocked. Allow microphone access in your browser to use voice logging."
          : `Speech recognition error: ${ev.error}. You can type what you ate instead.`,
      );
      stopListening();
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      setTranscript((t) => {
        const trimmed = t.trim();
        if (trimmed) void runParse(trimmed);
        return t;
      });
    };
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setError("Could not start speech recognition. You can type what you ate instead.");
      stopListening();
    }
  }, [listening, runParse, stopListening]);

  useEffect(() => () => recRef.current?.stop(), []);

  function updateItem(i: number, patch: Partial<MatchedItem>) {
    setItems((prev) => (prev ? prev.map((it, j) => (j === i ? { ...it, ...patch } : it)) : prev));
  }
  function removeItem(i: number) {
    setItems((prev) => (prev ? prev.filter((_, j) => j !== i) : prev));
  }
  async function rematch(i: number, keywords: string) {
    const hit = await matchFood(keywords);
    updateItem(i, {
      foodId: hit?.id,
      foodName: hit?.name ?? keywords,
      verification: hit?.verification,
      basis: hit?.basis ?? null,
      needsReview: !hit,
    });
  }

  // Manual entry for an unparsed chunk: name + kcal (never guessed).
  const [manualName, setManualName] = useState("");
  const [manualKcal, setManualKcal] = useState("");
  function addManual() {
    const name = manualName.trim();
    const kcal = Number(manualKcal);
    if (!name || !Number.isFinite(kcal) || kcal < 0) {
      setError("Give the item a name and its calories (from the label or a food search).");
      return;
    }
    setError(null);
    setItems((prev) => [
      ...(prev ?? []),
      {
        text: name.toLowerCase(), quantity: 1, unit: "", quantityInferred: true,
        foodName: name, needsReview: false, manualKcal: kcal,
      } as MatchedItem & { manualKcal: number },
    ]);
    setManualName("");
    setManualKcal("");
  }

  async function confirm() {
    if (!items || items.length === 0) return;
    // Honesty gate: an item with no food match and no user-entered calories
    // must not be logged as 0 kcal.
    const missing = items.find(
      (it) => !it.foodId && (it as { manualKcal?: number }).manualKcal == null,
    );
    if (missing) {
      setError(
        `“${missing.foodName}” has no food match — enter its calories in the manual box, change the match, or remove it.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    const date = todayYMD();
    const logged: string[] = [];
    try {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const key = `voice-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
        const manualKcal = (it as { manualKcal?: number }).manualKcal;
        const body: Record<string, unknown> = it.foodId
          ? { date, mealType, foodId: it.foodId, customName: it.foodName, servings: it.quantity }
          : {
              date, mealType, customName: it.foodName, servings: it.quantity,
              kcal: manualKcal ?? 0,
              proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0,
            };
        await api("/api/diary", {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body,
        });
        logged.push(it.foodName);
      }
      setDone(logged);
      setItems(null);
      setUnparsed([]);
      setTranscript("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log some items. Logged so far: " + logged.join(", "));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="anim-page-enter">
      <h1 className="t-greeting">Voice log</h1>
      <p className="t-body mt-1" style={{ color: "var(--text-secondary)" }}>
        Say what you ate — for example, “two rotis and one katori of daal”. Review exactly
        what was heard before anything is logged.
      </p>

      {!supported && (
        <GlassPanel className="mt-4 border p-5" >
          <p className="t-body font-medium">Voice input isn&apos;t supported in this browser</p>
          <p className="t-body mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Speech recognition needs Chrome, Edge, or Safari. You can type what you ate
            below instead — the same parser and review screen apply.
          </p>
        </GlassPanel>
      )}

      {/* Recorder */}
      <GlassPanel className="mt-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <LuxButton
            onClick={toggleMic}
            disabled={!supported}
            aria-pressed={listening}
            aria-label={listening ? "Stop listening" : "Start voice logging"}
          >
            {listening ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
            {listening ? "Stop" : "Tap to speak"}
          </LuxButton>
          <label className="t-meta" htmlFor="voice-meal">Meal</label>
          <Select
            id="voice-meal"
            value={mealType}
            onChange={(e) => setMealType(e.target.value as MealType)}
            className="w-auto"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </div>
        {listening && (
          <p className="t-meta mt-3 animate-pulse" aria-live="polite">Listening… speak now</p>
        )}
        <div className="mt-4">
          <label className="t-meta" htmlFor="voice-transcript">What was heard (editable)</label>
          <textarea
            id="voice-transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={3}
            placeholder="Tap the mic and speak, or type here: two rotis and one katori of daal"
            className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-base text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <LuxButton
            variant="secondary"
            className="mt-2"
            disabled={!transcript.trim() || matching}
            onClick={() => void runParse(transcript)}
          >
            {matching ? "Matching foods…" : "Parse & review"}
          </LuxButton>
        </div>
      </GlassPanel>

      {error && (
        <p role="alert" className="mt-4 rounded-xl px-4 py-3 text-sm"
          style={{ color: "var(--error)", backgroundColor: "color-mix(in srgb, var(--error) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--error) 38%, transparent)" }}>
          {error}
        </p>
      )}

      {done && (
        <GlassPanel className="mt-4 p-5">
          <p className="t-body flex items-center gap-2 font-medium" style={{ color: "var(--success)" }}>
            <Check size={18} aria-hidden="true" /> Logged to {options.find((o) => o.value === mealType)?.label}
          </p>
          <ul className="t-body mt-2 list-disc pl-5 text-sm">
            {done.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </GlassPanel>
      )}

      {/* Review screen */}
      {items !== null && (
        <GlassPanel className="mt-4 p-5">
          <h2 className="t-card-heading">Review — exactly what was parsed</h2>
          <p className="t-meta mt-1 normal-case tracking-normal">
            Nothing is logged until you confirm. Items flagged “check” need your attention.
          </p>
          {matching && <Skeleton className="mt-3 h-16 w-full" />}
          {items.length === 0 && !matching && (
            <p className="t-body mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
              Nothing parseable yet — speak or type what you ate above.
            </p>
          )}
          <ul className="mt-3 space-y-3">
            {items.map((it, i) => (
              <li key={i} className="rounded-xl border p-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-secondary)" }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="t-body font-medium">{it.foodName}</p>
                    <p className="t-meta normal-case tracking-normal">
                      heard as “{it.text}”
                      {it.unit ? ` · ${it.quantity} ${it.unit}${it.quantity === 1 ? "" : "s"}` : ` · ${it.quantity} serving${it.quantity === 1 ? "" : "s"}`}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {it.verification && (
                        <VerificationBadge verification={it.verification} basis={it.basis} />
                      )}
                      {it.quantityInferred && (
                        <LuxBadge tone="warning">
                          <AlertTriangle size={12} aria-hidden="true" /> quantity assumed — check
                        </LuxBadge>
                      )}
                      {!it.foodId && !(it as { manualKcal?: number }).manualKcal && (
                        <LuxBadge tone="warning">
                          <AlertTriangle size={12} aria-hidden="true" /> no food match — check
                        </LuxBadge>
                      )}
                    </div>
                  </div>
                  <button type="button" onClick={() => removeItem(i)} className="shrink-0 rounded-lg p-2" style={{ color: "var(--text-secondary)" }} aria-label={`Remove ${it.foodName}`}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="t-meta" htmlFor={`vq-${i}`}>Qty</label>
                  <Input
                    id={`vq-${i}`}
                    type="number" min={0.25} step={0.25}
                    value={String(it.quantity)}
                    onChange={(e) => updateItem(i, { quantity: Math.max(0.25, Number(e.target.value) || 1), quantityInferred: false })}
                    className="w-20"
                  />
                  <button
                    type="button"
                    className="t-meta underline underline-offset-2"
                    onClick={() => {
                      const kw = window.prompt("Search for a different food match:", it.text);
                      if (kw) void rematch(i, kw);
                    }}
                  >
                    <Pencil size={12} aria-hidden="true" className="mr-1 inline" />
                    Change match
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {unparsed.length > 0 && (
            <div className="mt-4 rounded-xl border border-dashed p-3" style={{ borderColor: "var(--warning)" }}>
              <p className="t-body text-sm font-medium">Couldn&apos;t parse — enter manually:</p>
              <ul className="t-meta mt-1 normal-case tracking-normal">
                {unparsed.map((u, i) => <li key={i}>“{u}”</li>)}
              </ul>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div>
                  <label className="t-meta" htmlFor="voice-manual-name">Food name</label>
                  <Input id="voice-manual-name" value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="e.g. Samosa" className="w-44" />
                </div>
                <div>
                  <label className="t-meta" htmlFor="voice-manual-kcal">Calories (kcal)</label>
                  <Input id="voice-manual-kcal" type="number" min={0} value={manualKcal} onChange={(e) => setManualKcal(e.target.value)} placeholder="e.g. 250" className="w-28" />
                </div>
                <LuxButton variant="secondary" onClick={addManual}>Add item</LuxButton>
              </div>
              <p className="t-meta mt-1 normal-case tracking-normal">Calories are never guessed — enter them from the label or a food search.</p>
            </div>
          )}

          {items.length > 0 && (
            <LuxButton className="mt-4" disabled={busy} onClick={() => void confirm()}>
              {busy ? "Logging…" : `Log ${items.length} item${items.length === 1 ? "" : "s"} to ${options.find((o) => o.value === mealType)?.label}`}
            </LuxButton>
          )}
        </GlassPanel>
      )}
    </div>
  );
}
