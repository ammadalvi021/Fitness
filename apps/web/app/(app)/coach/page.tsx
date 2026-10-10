"use client";

/**
 * /coach — AI coach chat.
 *
 * - GET /api/coach/conversations (list), POST /api/coach/conversations (new),
 *   POST /api/coach/conversations/[id]/messages {content} (send)
 * - AI availability comes from GET /api/config (ai.chat). When the coach is
 *   not configured, a graceful setup card is shown instead of fake answers.
 * - Assistant replies render through a safe markdown-lite renderer
 *   (HTML-escaped first, then our own tags only).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  Textarea,
} from "@/components/ui";
import { pickArray, pickObject, toString } from "../workouts/_shared";

interface CoachMessageShape {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
}

interface ConversationShape {
  id: string;
  title?: string | null;
  updatedAt?: string | null;
  messages?: CoachMessageShape[];
}

const QUICK_ACTIONS = [
  "Suggest a high-protein breakfast",
  "How do I fix my squat form?",
  "Why did my weight stall?",
];

const GOAL_LABELS: Record<string, string> = {
  lose: "lose weight",
  maintain: "maintain weight",
  gain: "build muscle",
  improve_fitness: "improve fitness",
  eat_healthier: "eat healthier",
};

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: "sedentary",
  light: "lightly active",
  moderate: "moderately active",
  active: "active",
  very_active: "very active",
};

/* ------------------------- Safe markdown-lite ------------------------- */
/* Escapes all HTML first, then applies a small set of inline/block rules. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineMd(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, "$1<em>$2</em>")
    .replace(/`([^`\n]+)`/g, '<code class="rounded bg-neutral-200/70 px-1 py-0.5 text-[0.85em] dark:bg-neutral-700/70">$1</code>');
}

function markdownLiteToHtml(src: string): string {
  const lines = escapeHtml(src).split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const lvl = Math.min(4, h[1].length + 2);
      out.push(`<h${lvl} class="pt-1 text-[0.95em] font-bold">${inlineMd(h[2])}</h${lvl}>`);
    } else if (ul) {
      if (list !== "ul") {
        closeList();
        out.push('<ul class="list-disc space-y-1 pl-5">');
        list = "ul";
      }
      out.push(`<li>${inlineMd(ul[1])}</li>`);
    } else if (ol) {
      if (list !== "ol") {
        closeList();
        out.push('<ol class="list-decimal space-y-1 pl-5">');
        list = "ol";
      }
      out.push(`<li>${inlineMd(ol[1])}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inlineMd(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

function MessageBubble({ message }: { message: CoachMessageShape }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[75%] ${
          isUser
            ? "bg-brand text-white"
            : "border border-neutral-200 bg-white text-neutral-800 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div
            className="space-y-2"
            dangerouslySetInnerHTML={{ __html: markdownLiteToHtml(message.content) }}
          />
        )}
      </div>
    </div>
  );
}

export default function CoachPage() {
  const [conversations, setConversations] = useState<ConversationShape[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null); // null = unknown yet
  const [aiSetupDismissed, setAiSetupDismissed] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [planGated, setPlanGated] = useState(false);
  const [profileBits, setProfileBits] = useState<string[]>([]);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );

  /* ------------------------------- Load all -------------------------------- */
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [configRes, convRes, profileRes] = await Promise.all([
          api<unknown>("/api/config").catch(() => null),
          api<unknown>("/api/coach/conversations").catch(() => null),
          api<unknown>("/api/profile").catch(() => null),
        ]);
        if (cancelled) return;

        // AI availability: explicit `false` means not configured.
        const chat = (configRes as Record<string, unknown> | null)?.ai as
          | { chat?: unknown }
          | undefined;
        const chatVal = chat?.chat as { configured?: boolean } | boolean | undefined;
        const notConfigured =
          chatVal === false ||
          (typeof chatVal === "object" && chatVal !== null && chatVal.configured === false);
        setAiConfigured(!notConfigured);

        const convs = pickArray<ConversationShape>(convRes, "conversations");
        convs.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
        setConversations(convs);
        if (convs.length && !activeId) setActiveId(convs[0].id);

        const profile = pickObject<Record<string, unknown>>(profileRes, "profile");
        const bits: string[] = [];
        const goal = toString(profile?.goal);
        if (goal) bits.push(`goal: ${GOAL_LABELS[goal] ?? goal}`);
        const activity = toString(profile?.activityLevel);
        if (activity) bits.push(`activity: ${ACTIVITY_LABELS[activity] ?? activity}`);
        const exp = toString(profile?.fitnessExperience);
        if (exp) bits.push(`experience: ${exp}`);
        setProfileBits(bits);
      } catch (e) {
        if (!cancelled)
          setLoadError(e instanceof ApiError ? e.message : "Couldn't load the coach.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [active?.messages?.length, sending]);

  /* --------------------------------- Actions -------------------------------- */
  async function newConversation() {
    try {
      const res = await api<unknown>("/api/coach/conversations", {
        method: "POST",
        body: { title: "New conversation" },
      });
      const conv = pickObject<ConversationShape>(res, "conversation");
      if (conv?.id) {
        setConversations((prev) => [{ ...conv, messages: conv.messages ?? [] }, ...prev]);
        setActiveId(conv.id);
        setDraft("");
      }
    } catch (e) {
      setSendError(e instanceof ApiError ? e.message : "Couldn't start a conversation.");
    }
  }

  function appendMessage(convId: string, msg: CoachMessageShape) {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId ? { ...c, messages: [...(c.messages ?? []), msg] } : c
      )
    );
  }

  async function send(content: string) {
    const text = content.trim();
    if (!text || sending) return;
    let convId = activeId;
    // Auto-create a conversation on first message.
    if (!convId) {
      try {
        const res = await api<unknown>("/api/coach/conversations", {
          method: "POST",
          body: { title: text.slice(0, 48) },
        });
        const conv = pickObject<ConversationShape>(res, "conversation");
        if (!conv?.id) throw new Error("no conversation");
        setConversations((prev) => [{ ...conv, messages: [] }, ...prev]);
        convId = conv.id;
        setActiveId(conv.id);
      } catch {
        setSendError("Couldn't start a conversation. Please try again.");
        return;
      }
    }
    const targetId = convId as string;
    setSendError(null);
    setPlanGated(false);
    setSending(true);
    appendMessage(targetId, {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
    });
    setDraft("");
    try {
      const res = await api<unknown>(`/api/coach/conversations/${targetId}/messages`, {
        method: "POST",
        body: { content: text },
      });
      const rec = res as Record<string, unknown>;
      const reply =
        (rec.message as CoachMessageShape | undefined) ??
        (rec.reply as CoachMessageShape | undefined) ??
        (rec.assistantMessage as CoachMessageShape | undefined);
      if (reply && typeof reply.content === "string") {
        appendMessage(targetId, { role: "assistant", content: reply.content });
      } else if (Array.isArray(rec.messages)) {
        const last = [...(rec.messages as CoachMessageShape[])]
          .reverse()
          .find((m) => m.role === "assistant");
        if (last) appendMessage(targetId, { role: "assistant", content: last.content });
        else throw new Error("empty reply");
      } else if (typeof rec.content === "string") {
        appendMessage(targetId, { role: "assistant", content: rec.content });
      } else {
        throw new Error("empty reply");
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && e.code === "plan_required") {
        setPlanGated(true);
      } else if (
        e instanceof ApiError &&
        (e.code === "ai_not_configured" || e.code === "ai_unavailable")
      ) {
        setAiConfigured(false);
      } else {
        setSendError(
          e instanceof ApiError ? e.message : "The coach didn't reply. Please try again."
        );
      }
    } finally {
      setSending(false);
    }
  }

  const showSetupCard = aiConfigured === false && !aiSetupDismissed;

  /* --------------------------------- Render --------------------------------- */
  return (
    <div>
      <PageHeader
        title="AI Coach"
        subtitle="Ask about training, nutrition, and habits — answers use your profile context."
        actions={<Button onClick={() => void newConversation()}>New conversation</Button>}
      />

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]" aria-label="Loading coach">
          <Skeleton className="h-64" />
          <Skeleton className="h-96" />
        </div>
      ) : loadError ? (
        <EmptyState
          title="Couldn't load the coach"
          message={loadError}
          action={
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Retry
            </Button>
          }
        />
      ) : showSetupCard ? (
        <Card className="mx-auto max-w-2xl border-amber-300 dark:border-amber-800">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            The AI coach isn&apos;t connected yet
          </h2>
          <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
            Coaching answers come from an AI provider configured on the server. To enable it,
            set the <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">AI_API_KEY</code>{" "}
            environment variable (plus optional{" "}
            <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">AI_MODEL</code> /{" "}
            <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">AI_BASE_URL</code>)
            and restart the app — see <strong>README.md</strong> for setup steps.
          </p>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            Until then the coach stays quiet rather than guessing. Your workout library,
            plans, and progress tracking all work without it.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/workouts/library">
              <Button variant="secondary">Browse exercise library</Button>
            </Link>
            <Button variant="ghost" onClick={() => setAiSetupDismissed(true)}>
              Dismiss
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          {/* Conversation list */}
          <Card className="lg:sticky lg:top-4 lg:max-h-[70vh] lg:overflow-y-auto">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Conversations
            </h2>
            {conversations.length === 0 ? (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                No conversations yet — ask your first question below.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(c.id)}
                      aria-current={activeId === c.id ? "true" : undefined}
                      className={`flex min-h-[44px] w-full items-center rounded-xl px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                        activeId === c.id
                          ? "bg-brand/10 font-semibold text-brand"
                          : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      }`}
                    >
                      <span className="truncate">{c.title || "Conversation"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Thread */}
          <Card className="flex min-h-[60vh] flex-col">
            {profileBits.length ? (
              <p className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                <span>Using your {profileBits.join(" · ")}</span>
              </p>
            ) : null}

            {planGated ? (
              <div className="mb-3 rounded-xl border border-amber-300 p-3 text-sm dark:border-amber-800">
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                  The AI coach needs a plan that includes coaching
                </p>
                <p className="mt-1 text-neutral-600 dark:text-neutral-400">
                  Your current plan has reached its coach message limit or doesn&apos;t include
                  the AI coach.{" "}
                  <Link href="/plans" className="font-semibold text-brand underline">
                    View plans
                  </Link>
                </p>
              </div>
            ) : null}

            <div className="flex-1 space-y-3 overflow-y-auto" aria-live="polite" aria-label="Conversation">
              {!active || (active.messages ?? []).length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    {active ? "Start the conversation" : "Ask your AI coach anything"}
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-xs text-neutral-500 dark:text-neutral-400">
                    For example: training tweaks, meal ideas that fit your targets, or help
                    understanding a plateau. The coach can see your goal and activity level.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {QUICK_ACTIONS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => void send(q)}
                        disabled={sending}
                        className="min-h-[44px] rounded-full border border-neutral-300 px-4 text-sm text-neutral-700 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                (active.messages ?? []).map((m, i) => <MessageBubble key={m.id ?? i} message={m} />)
              )}

              {sending ? (
                <div className="flex justify-start" aria-label="Coach is thinking">
                  <div className="w-2/3 max-w-md space-y-2 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-700">
                    <Skeleton className="h-3 w-11/12" />
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ) : null}
              <div ref={threadEndRef} />
            </div>

            {sendError ? (
              <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
                {sendError}
              </p>
            ) : null}

            <form
              className="mt-3 flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              <div className="flex-1">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send(draft);
                    }
                  }}
                  placeholder="Ask about training, nutrition, recovery…"
                  aria-label="Message the AI coach"
                  rows={2}
                  className="min-h-[44px] resize-none"
                />
              </div>
              <Button type="submit" disabled={sending || !draft.trim()} aria-label="Send message">
                {sending ? "Sending…" : "Send"}
              </Button>
            </form>
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              The coach gives general fitness information, not medical advice. If you have a
              medical condition, are pregnant, or are under 18, please consult a qualified
              health professional for personalized guidance.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
