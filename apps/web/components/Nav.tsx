"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { branding } from "@/lib/site";

/** Nav item definition shared by sidebar and bottom nav. */
interface NavItem {
  href: string;
  label: string;
  /** Simple inline glyph (text emoji) — decorative, aria-hidden. */
  icon: string;
  /** Exact match, or prefix match for grouped routes. */
  exact?: boolean;
}

/** Mobile bottom nav: the five primary destinations. */
const MOBILE_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "🏠", exact: true },
  { href: "/nutrition", label: "Nutrition", icon: "🍎" },
  { href: "/workouts", label: "Workouts", icon: "🏋️" },
  { href: "/scanner", label: "Food Scanner", icon: "📷" },
  { href: "/profile", label: "Profile", icon: "👤", exact: true },
];

/** Desktop sidebar: full navigation including plan-adjacent pages. */
const DESKTOP_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "🏠", exact: true },
  { href: "/nutrition", label: "Nutrition", icon: "🍎" },
  { href: "/nutrition/plans", label: "Meal Plans", icon: "🗓️" },
  { href: "/recipes", label: "Recipes", icon: "📖" },
  { href: "/scanner", label: "Food Scanner", icon: "📷" },
  { href: "/workouts", label: "Workouts", icon: "🏋️" },
  { href: "/progress", label: "Progress", icon: "📈" },
  { href: "/coach", label: "AI Coach", icon: "🤖" },
  { href: "/goals", label: "Goals", icon: "🎯", exact: true },
  { href: "/calculators", label: "Calculators", icon: "🧮", exact: true },
  { href: "/plans", label: "Plans", icon: "💎", exact: true },
  { href: "/settings", label: "Settings", icon: "⚙️", exact: true },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

/** Mobile bottom navigation bar (44px+ touch targets, aria-current). */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 md:hidden"
    >
      <ul className="grid grid-cols-5">
        {MOBILE_ITEMS.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                  active
                    ? "text-brand dark:text-green-400"
                    : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                <span aria-hidden="true" className="text-xl leading-none">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Desktop sidebar with the full nav tree. */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside
      aria-label="Primary"
      className="hidden w-60 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 md:flex"
    >
      <div className="flex items-center gap-2 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={branding.logoPath}
          alt=""
          aria-hidden="true"
          className="h-8 w-8"
        />
        <span className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
          {branding.appName}
        </span>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {DESKTOP_ITEMS.map((item) => {
            const active = isActive(pathname, item);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
                    active
                      ? "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-300"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  }`}
                >
                  <span aria-hidden="true" className="w-6 text-center text-lg">
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {branding.tagline}
        </p>
      </div>
    </aside>
  );
}
