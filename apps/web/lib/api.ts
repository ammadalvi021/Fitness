/**
 * Typed JSON API client for the web app.
 *
 * - Sends JSON and parses JSON responses.
 * - Throws ApiError on non-OK responses with the server's error payload.
 * - On 401, redirects to /login (client-side only, never during SSR).
 */

/** Error thrown for non-2xx API responses. */
export class ApiError extends Error {
  /** HTTP status code. */
  status: number;
  /** Server-provided error code, e.g. "unauthorized". */
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function isClient(): boolean {
  return typeof window !== "undefined";
}

/**
 * Fetch a JSON resource and return the parsed body.
 *
 * @example
 * const me = await api<{ user: User }>("/api/auth/me");
 * await api("/api/diary", { method: "POST", body: { date, kcal } });
 */
export async function api<T>(
  path: string,
  opts: ApiOptions = {}
): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: "same-origin",
  });

  if (res.status === 401 && isClient()) {
    // Session expired / not signed in: send the user to login, preserving
    // the current page so they can come back after signing in.
    const next = encodeURIComponent(
      window.location.pathname + window.location.search
    );
    window.location.href = `/login?next=${next}`;
    // Throw so in-flight callers don't continue with a bogus value.
    throw new ApiError(401, "Not signed in", "unauthorized");
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const data = await res.json();
      if (data && typeof data === "object" && "error" in data) {
        const err = data.error as { code?: string; message?: string };
        if (err.code) code = err.code;
        if (err.message) message = err.message;
      }
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    throw new ApiError(res.status, message, code);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

/** Date string helper: today's date as YYYY-MM-DD in local time. */
export function todayString(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
