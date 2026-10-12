'use client';

/**
 * /log/barcode — packaged-product barcode lookup & logging.
 *
 * - Numeric entry + camera scanning via the BarcodeDetector API (graceful
 *   manual fallback; the camera button never dead-ends).
 * - Product detail card with photo (attributed), quantity selector,
 *   per-serving / per-100g toggle, ingredients, allergens.
 * - Honest not-found state + manual label-entry fallback (source 'user_label').
 * - Every nutrition display renders <VerificationBadge> and OFF attribution:
 *   OFF is crowdsourced third-party data — always 'estimate', never verified.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Barcode,
  Camera,
  CameraOff,
  Check,
  Keyboard,
  Loader2,
  PackageSearch,
  PencilLine,
  Plus,
  ScanLine,
  TriangleAlert,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { VerificationBadge } from '@/components/VerificationBadge';
import { GlassPanel, LuxBadge, LuxButton } from '@/components/luxury';
import { Input, Select } from '@/components/ui';
import type { NormalizedProduct, OffNutrients, OffQuality } from '@/lib/openfoodfacts';
import {
  availableQuantityKinds,
  resolveQuantity,
  type QuantityKind,
  type QuantitySelection,
} from '@/lib/barcode-quantity';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface ApiProduct extends NormalizedProduct {
  verification: 'estimate';
  verificationBasis: string;
  attribution: string;
}

interface FoodSaved {
  id: string;
  name: string;
  brand: string | null;
  servingSize: number;
  servingUnit: string;
  perServing: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
  };
  source: string;
  verification: string;
  verificationBasis: string | null;
  barcode: string | null;
}

type Phase = 'entry' | 'scanning' | 'loading' | 'result' | 'notfound' | 'error';

const MEAL_OPTIONS = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'morning_snack', label: 'Morning snack' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'afternoon_snack', label: 'Afternoon snack' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'extra', label: 'Extra' },
];

const NUTRIENT_ROWS: { key: keyof OffNutrients; label: string; unit: string }[] = [
  { key: 'kcal', label: 'Energy', unit: 'kcal' },
  { key: 'proteinG', label: 'Protein', unit: 'g' },
  { key: 'carbsG', label: 'Carbs', unit: 'g' },
  { key: 'fatG', label: 'Fat', unit: 'g' },
  { key: 'fiberG', label: 'Fiber', unit: 'g' },
  { key: 'sugarG', label: 'Sugar', unit: 'g' },
  { key: 'saltG', label: 'Salt', unit: 'g' },
];

const QUALITY_COPY: Record<OffQuality, { tone: 'success' | 'warning' | 'error'; label: string }> = {
  complete: { tone: 'success', label: 'Complete nutrition data' },
  partial: { tone: 'warning', label: 'Partial nutrition data' },
  minimal: { tone: 'error', label: 'Very limited nutrition data' },
};

const QUANTITY_LABELS: Record<QuantityKind, string> = {
  serving: '1 serving',
  whole_pack: 'Whole pack',
  half_pack: 'Half pack',
  custom_grams: 'Custom grams',
  custom_servings: 'Custom servings',
};

/* BarcodeDetector is not in all TS DOM libs — declare the shape we use. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetector(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return typeof w.BarcodeDetector === 'function' ? w.BarcodeDetector : null;
}

function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function fmt(v: number | null, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function BarcodePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('entry');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [product, setProduct] = useState<ApiProduct | null>(null);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);

  const detectorSupported = getBarcodeDetector() !== null;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const scanActiveRef = useRef(false);

  const stopScan = useCallback(() => {
    scanActiveRef.current = false;
    if (scanTimerRef.current !== null) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setPhase((p) => (p === 'scanning' ? 'entry' : p));
  }, []);

  useEffect(() => stopScan, [stopScan]);

  const lookup = useCallback(async (barcode: string) => {
    const digits = barcode.replace(/[\s-]/g, '');
    if (!/^[0-9]{8,14}$/.test(digits)) {
      setMessage('Enter a barcode of 8–14 digits.');
      setPhase('entry');
      return;
    }
    setPhase('loading');
    setMessage(null);
    setProduct(null);
    try {
      const res = await api<{ found: boolean; product?: ApiProduct; message?: string }>(
        `/api/products/barcode/${encodeURIComponent(digits)}`,
      );
      if (res.found && res.product) {
        setProduct(res.product);
        setPhase('result');
      } else {
        setNotFoundCode(digits);
        setPhase('notfound');
      }
    } catch (e) {
      setMessage(
        e instanceof ApiError ? e.message : 'Lookup failed — check your connection and try again.',
      );
      setPhase('error');
    }
  }, []);

  const startScan = useCallback(async () => {
    const Detector = getBarcodeDetector();
    // Never a dead button: if the API is missing we say so and stay manual.
    if (!Detector) {
      setMessage('Camera scanning is not supported on this device — type the barcode instead.');
      return;
    }
    setPhase('scanning');
    setMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new Detector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_128'],
      });
      scanActiveRef.current = true;
      scanTimerRef.current = window.setInterval(async () => {
        if (!scanActiveRef.current || !videoRef.current) return;
        try {
          const results = await detector.detect(videoRef.current);
          const hit = results.find((r) => r.rawValue && /^[0-9]{8,14}$/.test(r.rawValue));
          if (hit) {
            const value = hit.rawValue;
            stopScan();
            setCode(value);
            await lookup(value);
          }
        } catch {
          // Transient frame errors are fine — keep scanning.
        }
      }, 500);
    } catch {
      stopScan();
      setMessage('Could not open the camera — check permission, or type the barcode instead.');
      setPhase('entry');
    }
  }, [lookup, stopScan]);

  return (
    <div
      className="anim-page-enter mx-auto flex w-full max-w-2xl flex-col gap-4 pb-24"
      style={{ color: 'var(--text)' }}
    >
      <header className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Back"
          onClick={() => router.back()}
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ border: '1px solid var(--border)', color: 'var(--text)' }}
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-semibold">Scan barcode</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Packaged products · Open Food Facts
          </p>
        </div>
      </header>

      {phase === 'entry' && (
        <EntryCard
          code={code}
          setCode={setCode}
          onLookup={() => lookup(code)}
          onScan={startScan}
          detectorSupported={detectorSupported}
          message={message}
        />
      )}

      {phase === 'scanning' && (
        <GlassPanel className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <ScanLine size={18} /> Point at a barcode
            </h2>
            <LuxButton variant="ghost" onClick={stopScan}>
              Cancel
            </LuxButton>
          </div>
          <video
            ref={videoRef}
            className="mt-3 aspect-[4/3] w-full rounded-xl bg-black object-cover"
            playsInline
            muted
          />
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Hold the barcode inside the frame — it scans automatically.
          </p>
        </GlassPanel>
      )}

      {phase === 'loading' && (
        <GlassPanel className="flex items-center gap-3 p-6">
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
          <p>Looking up product…</p>
        </GlassPanel>
      )}

      {phase === 'error' && (
        <GlassPanel className="p-6 text-center">
          <TriangleAlert size={28} className="mx-auto" style={{ color: 'var(--error)' }} />
          <p className="mt-2 font-medium">Something went wrong</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {message ?? 'Try again.'}
          </p>
          <LuxButton className="mt-4" onClick={() => setPhase('entry')}>
            Back to entry
          </LuxButton>
        </GlassPanel>
      )}

      {phase === 'result' && product && (
        <ProductDetail
          product={product}
          onReset={() => {
            setProduct(null);
            setCode('');
            setPhase('entry');
          }}
        />
      )}

      {phase === 'notfound' && notFoundCode && (
        <NotFoundState
          code={notFoundCode}
          onRetry={() => setPhase('entry')}
          onSaved={() => setPhase('entry')}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Entry card                                                          */
/* ------------------------------------------------------------------ */

function EntryCard({
  code,
  setCode,
  onLookup,
  onScan,
  detectorSupported,
  message,
}: {
  code: string;
  setCode: (c: string) => void;
  onLookup: () => void;
  onScan: () => void;
  detectorSupported: boolean;
  message: string | null;
}) {
  return (
    <GlassPanel className="p-4">
      <label htmlFor="barcode-input" className="text-sm font-medium">
        Barcode
      </label>
      <div className="mt-2 flex gap-2">
        <Input
          id="barcode-input"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9\s-]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onLookup();
          }}
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 3017620422003"
          className="flex-1"
        />
        <LuxButton onClick={onLookup} disabled={!code.trim()}>
          <Barcode size={18} /> Look up
        </LuxButton>
      </div>
      {message && (
        <p className="mt-2 text-sm" style={{ color: 'var(--warning)' }}>
          {message}
        </p>
      )}
      <div className="mt-3">
        {detectorSupported ? (
          <LuxButton variant="secondary" onClick={onScan} className="w-full">
            <Camera size={18} /> Use camera
          </LuxButton>
        ) : (
          <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <CameraOff size={16} />
            Camera scanning isn&apos;t supported on this device — manual entry works fine.
          </p>
        )}
      </div>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Product detail                                                      */
/* ------------------------------------------------------------------ */

function ProductDetail({ product, onReset }: { product: ApiProduct; onReset: () => void }) {
  const [qtyKind, setQtyKind] = useState<QuantityKind>('serving');
  const [customGrams, setCustomGrams] = useState('');
  const [customServings, setCustomServings] = useState('');
  const [basis, setBasis] = useState<'serving' | 'per100g'>('serving');
  const [mealType, setMealType] = useState('lunch');
  const [showIngredients, setShowIngredients] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const kinds = availableQuantityKinds(product);
  const selection: QuantitySelection = {
    kind: qtyKind,
    value:
      qtyKind === 'custom_grams'
        ? Number(customGrams) || 0
        : qtyKind === 'custom_servings'
          ? Number(customServings) || 0
          : undefined,
  };
  const resolved = resolveQuantity(product, selection);
  const quality = QUALITY_COPY[product.quality];

  const tableNutrients: OffNutrients | null =
    basis === 'serving' ? product.perServing : product.per100g;
  const tableLabel = basis === 'serving' ? 'per serving' : 'per 100 g';

  const addToDiary = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Save (idempotent on barcode) so the diary logs a real Food row.
      const savedRes = await api<{ food: FoodSaved }>(`/api/products/save`, {
        method: 'POST',
        body: { mode: 'off', barcode: product.barcode },
      });
      await api(`/api/diary`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          date: todayYMD(),
          mealType,
          foodId: savedRes.food.id,
          servings: resolved.servings,
        },
      });
      setSaved(`Logged ${resolved.label} of ${savedRes.food.name} as ${mealType.replace('_', ' ')}.`);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Could not add to diary.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <GlassPanel className="p-4">
        <div className="flex gap-4">
          {product.imageUrl ? (
            <figure className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={product.imageUrl}
                alt={product.name}
                className="h-28 w-28 rounded-xl object-contain"
                style={{ border: '1px solid var(--border)', backgroundColor: '#fff' }}
                loading="lazy"
              />
              <figcaption
                className="mt-1 max-w-28 text-[10px] leading-tight"
                style={{ color: 'var(--text-secondary)' }}
              >
                {product.attribution}
              </figcaption>
            </figure>
          ) : (
            <div
              className="flex h-28 w-28 shrink-0 items-center justify-center rounded-xl"
              style={{ border: '1px solid var(--border)' }}
            >
              <PackageSearch size={32} style={{ color: 'var(--text-secondary)' }} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-tight">{product.name}</h2>
            {product.brand && (
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {product.brand}
              </p>
            )}
            {product.packSize && (
              <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                Pack: {product.packSize}
              </p>
            )}
            {product.servingSize !== null && (
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Serving: {fmt(product.servingSize, 2)} {product.servingUnit}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <LuxBadge tone={quality.tone}>{quality.label}</LuxBadge>
              {product.nutriscore && (
                <LuxBadge tone="neutral">Nutri-Score {product.nutriscore.toUpperCase()}</LuxBadge>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <VerificationBadge verification={product.verification} basis={product.verificationBasis} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Source: Open Food Facts (crowdsourced)
          </span>
        </div>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {product.attribution} · Checked {new Date(product.lastChecked).toLocaleDateString()}
          {product.derivedPerServing && ' · per-serving values derived from per-100 g'}
        </p>
      </GlassPanel>

      <GlassPanel className="p-4">
        <h3 className="text-base font-semibold">How much?</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setQtyKind(k)}
              className="rounded-full px-3 py-1.5 text-sm"
              style={{
                border: `1px solid ${qtyKind === k ? 'var(--accent)' : 'var(--border)'}`,
                backgroundColor:
                  qtyKind === k ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
                color: 'var(--text)',
              }}
              aria-pressed={qtyKind === k}
            >
              {QUANTITY_LABELS[k]}
            </button>
          ))}
        </div>
        {qtyKind === 'custom_grams' && (
          <div className="mt-2 flex items-center gap-2">
            <Input
              type="number"
              min={0}
              value={customGrams}
              onChange={(e) => setCustomGrams(e.target.value)}
              placeholder="Grams"
              inputMode="decimal"
              className="w-32"
            />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              grams
            </span>
          </div>
        )}
        {qtyKind === 'custom_servings' && (
          <div className="mt-2 flex items-center gap-2">
            <Input
              type="number"
              min={0}
              step={0.5}
              value={customServings}
              onChange={(e) => setCustomServings(e.target.value)}
              placeholder="Servings"
              inputMode="decimal"
              className="w-32"
            />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              servings
            </span>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <p className="text-sm font-medium">
            {resolved.label}
            {resolved.nutrients ? ` · ${fmt(resolved.nutrients.kcal, 0)} kcal` : ''}
          </p>
          <div className="flex gap-1 text-xs" role="group" aria-label="Nutrition basis">
            {(['serving', 'per100g'] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBasis(b)}
                className="rounded-full px-2.5 py-1"
                style={{
                  border: `1px solid ${basis === b ? 'var(--accent)' : 'var(--border)'}`,
                  color: 'var(--text)',
                }}
                aria-pressed={basis === b}
              >
                {b === 'serving' ? 'Per serving' : 'Per 100 g'}
              </button>
            ))}
          </div>
        </div>

        {tableNutrients ? (
          <dl className="mt-2 divide-y text-sm" style={{ borderColor: 'var(--border)' }}>
            {NUTRIENT_ROWS.map(({ key, label, unit }) => (
              <div key={key} className="flex items-center justify-between py-1.5">
                <dt style={{ color: 'var(--text-secondary)' }}>
                  {label} <span className="text-xs">({tableLabel})</span>
                </dt>
                <dd className="font-medium">
                  {tableNutrients[key] !== null ? `${fmt(tableNutrients[key])} ${unit}` : '—'}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-2 text-sm" style={{ color: 'var(--warning)' }}>
            Open Food Facts has no {tableLabel} nutrition for this product — switch basis or check
            the label yourself.
          </p>
        )}
        <div className="mt-2">
          <VerificationBadge verification={product.verification} basis={product.verificationBasis} />
        </div>
      </GlassPanel>

      {(product.ingredients || product.allergens.length > 0) && (
        <GlassPanel className="p-4">
          <button
            type="button"
            onClick={() => setShowIngredients((v) => !v)}
            className="flex w-full items-center justify-between text-left"
            aria-expanded={showIngredients}
          >
            <span className="text-base font-semibold">Ingredients & allergens</span>
            <span style={{ color: 'var(--text-secondary)' }}>{showIngredients ? '−' : '+'}</span>
          </button>
          {showIngredients && (
            <div className="mt-2 text-sm">
              {product.ingredients && <p>{product.ingredients}</p>}
              {product.allergens.length > 0 && (
                <p className="mt-2">
                  <span className="font-medium">Allergens: </span>
                  {product.allergens.join(', ')}
                </p>
              )}
            </div>
          )}
        </GlassPanel>
      )}

      <GlassPanel className="p-4">
        <h3 className="text-base font-semibold">Add to diary</h3>
        <div className="mt-2">
          <Select value={mealType} onChange={(e) => setMealType(e.target.value)}>
            {MEAL_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
        {saved ? (
          <p className="mt-3 flex items-center gap-2 text-sm" style={{ color: 'var(--success)' }}>
            <Check size={16} /> {saved}
          </p>
        ) : (
          <LuxButton
            className="mt-3 w-full"
            onClick={addToDiary}
            disabled={saving || !resolved.nutrients}
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
            {saving ? 'Adding…' : `Add ${resolved.label} to diary`}
          </LuxButton>
        )}
        {!resolved.nutrients && !saved && (
          <p className="mt-2 text-sm" style={{ color: 'var(--warning)' }}>
            Can&apos;t log this product — there are no nutrition numbers to log.
          </p>
        )}
        {saveError && (
          <p className="mt-2 text-sm" style={{ color: 'var(--error)' }}>
            {saveError}
          </p>
        )}
      </GlassPanel>

      <LuxButton variant="ghost" onClick={onReset}>
        <Keyboard size={16} /> Scan another barcode
      </LuxButton>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Not found + manual label fallback                                   */
/* ------------------------------------------------------------------ */

function NotFoundState({
  code,
  onRetry,
  onSaved,
}: {
  code: string;
  onRetry: () => void;
  onSaved: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <GlassPanel className="p-6 text-center">
        <PackageSearch size={32} className="mx-auto" style={{ color: 'var(--text-secondary)' }} />
        <h2 className="mt-2 text-lg font-semibold">No product found for this barcode</h2>
        <p className="mt-1 font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
          {code}
        </p>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Open Food Facts doesn&apos;t list this product yet. You can read the label and enter the
          nutrition yourself — we&apos;ll never guess values for you.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <LuxButton onClick={() => setShowForm((v) => !v)}>
            <PencilLine size={18} /> Enter label details manually
          </LuxButton>
          <LuxButton variant="ghost" onClick={onRetry}>
            Try another barcode
          </LuxButton>
        </div>
      </GlassPanel>
      {showForm && <ManualLabelForm barcode={code} onSaved={onSaved} />}
    </div>
  );
}

function ManualLabelForm({ barcode, onSaved }: { barcode: string; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [servingSize, setServingSize] = useState('');
  const [servingUnit, setServingUnit] = useState('g');
  const [kcal, setKcal] = useState('');
  const [proteinG, setProteinG] = useState('');
  const [carbsG, setCarbsG] = useState('');
  const [fatG, setFatG] = useState('');
  const [fiberG, setFiberG] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const num = (v: string, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };

  const submit = async () => {
    if (!name.trim() || !servingSize || !kcal) {
      setError('Name, serving size, and calories are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/api/products/save`, {
        method: 'POST',
        body: {
          mode: 'manual_label',
          name: name.trim(),
          brand: brand.trim() || null,
          servingSize: Number(servingSize),
          servingUnit,
          kcal: num(kcal),
          proteinG: num(proteinG),
          carbsG: num(carbsG),
          fatG: num(fatG),
          fiberG: num(fiberG),
          barcode,
        },
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <GlassPanel className="p-6 text-center">
        <Check size={28} className="mx-auto" style={{ color: 'var(--success)' }} />
        <p className="mt-2 font-medium">Saved — you can now find it in food search and log it.</p>
        <div className="mt-2 flex justify-center">
          <VerificationBadge verification="estimate" basis="Manually entered by the user from the product label." />
        </div>
        <LuxButton className="mt-4" onClick={onSaved}>
          Done
        </LuxButton>
      </GlassPanel>
    );
  }

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    opts?: { type?: string; required?: boolean },
  ) => (
    <label className="flex flex-col gap-1 text-sm">
      <span>
        {label} {opts?.required && <span style={{ color: 'var(--error)' }}>*</span>}
      </span>
      <Input
        type={opts?.type ?? 'text'}
        value={value}
        onChange={(e) => set(e.target.value)}
        inputMode={opts?.type === 'number' ? 'decimal' : undefined}
        min={opts?.type === 'number' ? 0 : undefined}
      />
    </label>
  );

  return (
    <GlassPanel className="p-4">
      <h3 className="text-base font-semibold">Read it from the label</h3>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
        Copy the nutrition panel exactly — leave anything you can&apos;t read blank.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {field('Product name', name, setName, { required: true })}
        {field('Brand', brand, setBrand)}
        {field('Serving size', servingSize, setServingSize, { type: 'number', required: true })}
        <label className="flex flex-col gap-1 text-sm">
          <span>Serving unit</span>
          <Select value={servingUnit} onChange={(e) => setServingUnit(e.target.value)}>
            {['g', 'ml', 'piece', 'serving', 'cup', 'tbsp', 'tsp'].map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </label>
        {field('Calories (kcal)', kcal, setKcal, { type: 'number', required: true })}
        {field('Protein (g)', proteinG, setProteinG, { type: 'number' })}
        {field('Carbs (g)', carbsG, setCarbsG, { type: 'number' })}
        {field('Fat (g)', fatG, setFatG, { type: 'number' })}
        {field('Fiber (g)', fiberG, setFiberG, { type: 'number' })}
      </div>
      <div className="mt-3">
        <VerificationBadge verification="estimate" basis="Manually entered by the user from the product label." />
      </div>
      {error && (
        <p className="mt-2 text-sm" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
      <LuxButton className="mt-3 w-full" onClick={submit} disabled={saving}>
        {saving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
        {saving ? 'Saving…' : 'Save product'}
      </LuxButton>
    </GlassPanel>
  );
}
