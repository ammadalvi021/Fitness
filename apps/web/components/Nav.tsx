"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Apple,
  BookOpen,
  Bot,
  Calculator,
  CalendarDays,
  Camera,
  ChevronDown,
  CircleUserRound,
  Crown,
  Dumbbell,
  Home,
  LayoutDashboard,
  LogOut,
  Settings,
  Target,
  TrendingUp,
  User,
  type LucideIcon,
} from "lucide-react";
import { branding } from "@/lib/site";
import { api } from "@/lib/api";
import { ThemeSelector } from "./ThemeSelector";

/** Nav item definition shared by sidebar and bottom nav. */
interface NavItem {
  href: string;
  label: string;
  /** Lucide icon rendered at a fixed 20px size. */
  icon: LucideIcon;
  /** Exact match, or prefix match for grouped routes. */
  exact?: boolean;
}

/** Mobile bottom nav: the five primary destinations. */
const MOBILE_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Home, exact: true },
  { href: "/nutrition", label: "Nutrition", icon: Apple },
  { href: "/workouts", label: "Workouts", icon: Dumbbell },
  { href: "/scanner", label: "Food Scanner", icon: Camera },
  { href: "/profile", label: "Profile", icon: User, exact: true },
];

/** Desktop sidebar: full navigation including plan-adjacent pages. */
const DESKTOP_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/nutrition", label: "Nutrition", icon: Apple },
  { href: "/nutrition/plans", label: "Meal Plans", icon: CalendarDays },
  { href: "/recipes", label: "Recipes", icon: BookOpen },
  { href: "/scanner", label: "Food Scanner", icon: Camera },
  { href: "/workouts", label: "Workouts", icon: Dumbbell },
  { href: "/progress", label: "Progress", icon: TrendingUp },
  { href: "/coach", label: "AI Coach", icon: Bot },
  { href: "/goals", label: "Goals", icon: Target, exact: true },
  { href: "/calculators", label: "Calculators", icon: Calculator, exact: true },
  { href: "/plans", label: "Plans", icon: Crown, exact: true },
  { href: "/settings", label: "Settings", icon: Settings, exact: true },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

/** Mobile bottom navigation bar (56px touch targets, labels always visible). */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
      style={{
        backgroundColor:
          "color-mix(in srgb, var(--bg-elevated) 92%, transparent)",
      }}
    >
      <ul className="grid grid-cols-5">
        {MOBILE_ITEMS.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 text-[11px] transition-colors ${
                  active
                    ? "font-semibold text-[var(--accent)]"
                    : "font-medium text-[var(--text-secondary)] hover:text-[var(--text)]"
                }`}
              >
                <Icon size={20} aria-hidden="true" strokeWidth={active ? 2.5 : 2} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Account menu: Profile / Settings / Sign out. */
function AccountMenu() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open ]);

  async function signOut() {
    // Same endpoint as the API route: destroys the server session and
    // clears the session cookie. There was previously no UI sign-out; this
    // is the only UI entry point.
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/");
      router.refresh();
    }
  }

  const menuItemClass =
    "flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg-secondary)]";

  return (
    <div ref={menuRef} className="relative">
      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute bottom-full left-0 z-50 mb-2 w-52 rounded-2xl border border-[var(--border)] p-1.5"
          style={{
            backgroundColor: "var(--bg-elevated)",
            boxShadow: "0 16px 40px -12px rgba(0, 0, 0, 0.55)",
          }}
        >
          <Link href="/profile" role="menuitem" className={menuItemClass} onClick={() => setOpen(false)}>
            <User size={20} aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" />
            Profile
          </Link>
          <Link href="/settings" role="menuitem" className={menuItemClass} onClick={() => setOpen(false)}>
            <Settings size={20} aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" />
            Settings
          </Link>
          <div className="my-1.5 h-px bg-[var(--border)]" aria-hidden="true" />
          <button type="button" role="menuitem" onClick={signOut} className={menuItemClass}>
            <LogOut size={20} aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" />
            Sign out
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        title="Account"
        className="touch-target flex h-11 w-11 items-center justify-center rounded-xl text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--accent)]"
      >
        <CircleUserRound size={20} aria-hidden="true" />
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
    </div>
  );
}

/** Desktop sidebar with the full nav tree. */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside
      aria-label="Primary"
      className="hidden w-60 shrink-0 flex-col border-r border-[var(--border)] backdrop-blur-sm md:flex"
      style={{
        backgroundColor:
          "color-mix(in srgb, var(--bg-elevated) 78%, transparent)",
      }}
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={branding.logoPath}
          alt=""
          aria-hidden="true"
          className="h-8 w-8"
        />
        <span className="text-lg font-bold text-[var(--text)]">
          {branding.appName}
        </span>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {DESKTOP_ITEMS.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex min-h-[44px] items-center gap-3 rounded-xl py-2.5 pl-4 pr-3 text-sm transition-colors ${
                    active
                      ? "font-semibold text-[var(--text)]"
                      : "font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text)]"
                  }`}
                >
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full"
                      style={{ backgroundColor: "var(--accent)" }}
                    />
                  )}
                  <Icon
                    size={20}
                    aria-hidden="true"
                    className="shrink-0"
                    strokeWidth={active ? 2.5 : 2}
                    style={active ? { color: "var(--accent)" } : undefined}
                  />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-[var(--border)] p-4">
        <p className="t-meta mb-3">{branding.tagline}</p>
        <div className="flex items-center justify-between">
          <ThemeSelector compact />
          <AccountMenu />
        </div>
      </div>
    </aside>
  );
}
