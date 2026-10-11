"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  Field,
  Input,
  Select,
  Skeleton,
} from "@/components/ui";
import { GlassPanel, LuxButton, LuxDialog } from "@/components/luxury";
import { ThemeSelector } from "@/components/ThemeSelector";

interface SettingsShape {
  units?: "metric" | "imperial";
  consents?: Record<string, boolean>;
}

const CONSENT_OPTIONS = [
  {
    key: "marketing_emails",
    label: "Marketing emails",
    hint: "Occasional tips and product news. Never required.",
  },
  {
    key: "analytics",
    label: "Usage analytics",
    hint: "Helps us improve the app. No advertising use.",
  },
];

export default function SettingsPage() {
  const router = useRouter();

  const [settings, setSettings] = useState<SettingsShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Data export
  const [exportState, setExportState] = useState<
    "idle" | "requesting" | "pending" | "ready" | "failed"
  >("idle");
  const [exportUrl, setExportUrl] = useState<string | null>(null);

  // Delete account
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<SettingsShape>("/api/settings")
      .then((data) => {
        if (!cancelled) {
          setSettings({ units: data.units, consents: data.consents ?? {} });
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSettings({ consents: {} });
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function persist(next: SettingsShape) {
    setSaving(true);
    setError(null);
    try {
      await api("/api/settings", { method: "PUT", body: next });
      setSettings(next);
      setNotice("Settings saved ✓");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save settings.");
    } finally {
      setSaving(false);
    }
  }

  function setUnits(units: "metric" | "imperial") {
    persist({ ...settings, units });
  }

  function setConsent(key: string, granted: boolean) {
    persist({
      ...settings,
      consents: { ...(settings?.consents ?? {}), [key]: granted },
    });
  }

  async function requestExport() {
    setExportState("requesting");
    setExportUrl(null);
    try {
      const res = await api<{ id?: string; status?: string }>("/api/data-export", {
        method: "POST",
      });
      const id = res.id;
      if (!id) throw new Error("No export id");
      setExportState("pending");
      // Poll until ready (up to ~60s).
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const status = await api<{ status?: string; fileUrl?: string }>(
          `/api/data-export/${id}`
        );
        if (status.status === "ready" && status.fileUrl) {
          setExportUrl(status.fileUrl);
          setExportState("ready");
          return;
        }
        if (status.status === "failed") break;
      }
      setExportState("failed");
    } catch {
      setExportState("failed");
    }
  }

  async function deleteAccount() {
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await api("/api/account", {
        method: "DELETE",
        body: { password: deletePassword },
      });
      router.push("/?deleted=1");
      router.refresh();
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : "Couldn't delete your account."
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Loading settings">
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="mt-6 h-48" />
        <Skeleton className="mt-4 h-48" />
      </div>
    );
  }

  return (
    <div className="anim-page-enter">
      <h1 className="t-greeting">Settings</h1>
      <p className="t-body mt-1 text-[var(--text-secondary)]">
        Appearance, units, privacy, and your data.
      </p>

      {error && (
        <p
          role="alert"
          className="mb-4 mt-6 rounded-xl px-4 py-3 text-sm"
          style={{
            color: "var(--error)",
            backgroundColor:
              "color-mix(in srgb, var(--error) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error) 38%, transparent)",
          }}
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mb-4 mt-6 rounded-xl px-4 py-3 text-sm"
          style={{
            color: "var(--success)",
            backgroundColor:
              "color-mix(in srgb, var(--success) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--success) 38%, transparent)",
          }}
        >
          {notice}
        </p>
      )}

      {/* Appearance & units */}
      <GlassPanel className="mt-6 p-6">
        <h2 className="t-card-heading">Appearance & units</h2>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <ThemeSelector id="set-theme" label="Theme" />
          <Field label="Units" htmlFor="set-units" hint="Used for display in calculators and forms.">
            <Select
              id="set-units"
              value={settings?.units ?? "metric"}
              onChange={(e) => setUnits(e.target.value as "metric" | "imperial")}
              disabled={saving}
            >
              <option value="metric">Metric (kg, cm)</option>
              <option value="imperial">Imperial (lb, in)</option>
            </Select>
          </Field>
        </div>
      </GlassPanel>

      {/* Privacy consents */}
      <GlassPanel className="mt-4 p-6">
        <h2 className="t-card-heading">Privacy</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          You control what we may use your data for. Changes take effect immediately.
        </p>
        <div className="mt-4 space-y-3">
          {CONSENT_OPTIONS.map((c) => {
            const granted = settings?.consents?.[c.key] ?? false;
            return (
              <div
                key={c.key}
                className="flex items-start justify-between gap-4 rounded-xl border border-[var(--border)] p-4"
                style={{ backgroundColor: "var(--bg-secondary)" }}
              >
                <div>
                  <p className="text-sm font-medium text-[var(--text)]">{c.label}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{c.hint}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={granted}
                  aria-label={c.label}
                  disabled={saving}
                  onClick={() => setConsent(c.key, !granted)}
                  className={`relative inline-flex h-8 min-w-[52px] shrink-0 items-center rounded-full px-1 transition-colors ${
                    granted ? "justify-end" : "justify-start"
                  }`}
                  style={{
                    backgroundColor: granted ? "var(--accent)" : "var(--border)",
                  }}
                >
                  <span className="inline-block h-6 w-6 rounded-full bg-white shadow" />
                </button>
              </div>
            );
          })}
        </div>
      </GlassPanel>

      {/* Data export */}
      <GlassPanel className="mt-4 p-6">
        <h2 className="t-card-heading">Your data</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Download a copy of everything stored about you.
        </p>
        <div className="mt-4">
          {exportState === "ready" && exportUrl ? (
            <a
              href={exportUrl}
              download
              className="anim-press inline-flex min-h-[44px] items-center rounded-xl px-5 font-medium transition-colors"
              style={{ backgroundColor: "var(--accent)", color: "var(--on-accent)" }}
            >
              Download your data
            </a>
          ) : (
            <LuxButton
              variant="secondary"
              onClick={requestExport}
              disabled={exportState === "requesting" || exportState === "pending"}
            >
              {exportState === "requesting" && "Requesting…"}
              {exportState === "pending" && "Preparing your export…"}
              {exportState === "failed" && "Try again"}
              {exportState === "idle" && "Export my data"}
            </LuxButton>
          )}
          {exportState === "failed" && (
            <p role="alert" className="mt-2 text-sm" style={{ color: "var(--error)" }}>
              The export couldn&apos;t be prepared. Please try again later.
            </p>
          )}
        </div>
      </GlassPanel>

      {/* Danger zone */}
      <GlassPanel
        className="mt-4 p-6"
        style={{
          border: "1px solid color-mix(in srgb, var(--error) 45%, transparent)",
        }}
      >
        <h2 className="t-card-heading" style={{ color: "var(--error)" }}>
          Danger zone
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Deleting your account permanently removes your profile, diary, measurements, and all other data. This cannot be undone.
        </p>
        <Button variant="danger" className="mt-4" onClick={() => { setDeleteOpen(true); setDeleteError(null); setDeletePassword(""); setDeleteConfirm(false); }}>
          Delete my account
        </Button>
      </GlassPanel>

      <LuxDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete your account?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={deleteAccount}
              disabled={deleteBusy || !deletePassword || !deleteConfirm}
            >
              {deleteBusy ? "Deleting…" : "Delete permanently"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-secondary)]">
          This permanently deletes your account and all associated data. To confirm, enter your password and check the box below.
        </p>
        {deleteError && (
          <p
            role="alert"
            className="mt-3 rounded-xl px-4 py-3 text-sm"
            style={{
              color: "var(--error)",
              backgroundColor:
                "color-mix(in srgb, var(--error) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--error) 38%, transparent)",
            }}
          >
            {deleteError}
          </p>
        )}
        <div className="mt-4 space-y-3">
          <Field label="Password" htmlFor="del-password" required>
            <Input
              id="del-password"
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
            />
          </Field>
          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-[var(--text)]">
            <input
              type="checkbox"
              checked={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.checked)}
              className="h-5 w-5"
              style={{ accentColor: "var(--error)" }}
            />
            I understand this cannot be undone
          </label>
        </div>
      </LuxDialog>
    </div>
  );
}
