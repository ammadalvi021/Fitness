"use client";

/**
 * /log — Log-a-Meal hub.
 *
 * Phase A (Foundation) cards: search, scan photo, barcode, Ghar Ka Khana,
 * snacks & drinks, grocery, restaurants, my meals, order/menu scan.
 * Also surfaces Phase E's voice + repeat logging so no working feature
 * is hidden, and the Ramadan shortcut when Ramadan mode is on.
 */
import Link from "next/link";
import {
  Barcode,
  Camera,
  CookingPot,
  CupSoda,
  History,
  MapPin,
  Mic,
  MoonStar,
  ReceiptText,
  Search,
  ShoppingBasket,
  type LucideIcon,
} from "lucide-react";
import { GlassPanel, LuxButton } from "@/components/luxury";
import { useSession } from "@/components/session";

interface HubCard {
  href: string;
  title: string;
  titleUrdu: string;
  hint: string;
  icon: LucideIcon;
  badge?: string;
}

/** Phase A — the nine Foundation log destinations. */
const CARDS: HubCard[] = [
  {
    href: "/log/search",
    title: "Search food",
    titleUrdu: "کھانا تلاش کریں",
    hint: "Type in English, Urdu, or Roman Urdu",
    icon: Search,
  },
  {
    href: "/scanner",
    title: "Scan meal photo",
    titleUrdu: "کھانے کی تصویر",
    hint: "AI estimates what's on your plate",
    icon: Camera,
  },
  {
    href: "/log/barcode",
    title: "Scan barcode",
    titleUrdu: "بارکوڈ اسکین",
    hint: "Packaged foods, straight from the label",
    icon: Barcode,
  },
  {
    href: "/log/ghar-ka-khana",
    title: "Ghar Ka Khana",
    titleUrdu: "گھر کا کھانا",
    hint: "Roti, daal, karahi, biryani — in katoris & pieces",
    icon: CookingPot,
  },
  {
    href: "/log/search?categoryName=Snacks & Street Food",
    title: "Snacks & Drinks",
    titleUrdu: "اسنیکس اور مشروبات",
    hint: "Chaat, pakoras, chai, lassi, shakes",
    icon: CupSoda,
  },
  {
    href: "/log/grocery",
    title: "Grocery",
    titleUrdu: "کریانہ",
    hint: "Atta, daal, oils, dry fruit — pantry staples",
    icon: ShoppingBasket,
  },
  {
    href: "/log/restaurants",
    title: "Nearby restaurants",
    titleUrdu: "قریبی ریسٹورانٹ",
    hint: "Menus and honest estimates near you",
    icon: MapPin,
  },
  {
    href: "/log/my-meals",
    title: "My Meals",
    titleUrdu: "میرے کھانے",
    hint: "Recent, favourites & your custom recipes",
    icon: History,
  },
  {
    href: "/log/order-scan",
    title: "Scan order / menu",
    titleUrdu: "مینیو اسکین",
    hint: "Point at a menu card or receipt",
    icon: ReceiptText,
  },
];

/** Phase E — kept visible so no working feature is buried. */
const MORE_CARDS: HubCard[] = [
  {
    href: "/log/voice",
    title: "Voice log",
    titleUrdu: "بول کر لکھیں",
    hint: "Speak what you ate — review, then log it",
    icon: Mic,
  },
  {
    href: "/log/repeat",
    title: "Repeat & favourites",
    titleUrdu: "دہرائیں",
    hint: "Re-log yesterday or a saved favourite",
    icon: History,
  },
];

function HubGrid({ cards, showUrdu }: { cards: HubCard[]; showUrdu: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Link
            key={c.href + c.title}
            href={c.href}
            className="anim-press group block min-h-[44px]"
            aria-label={`${c.title} — ${c.hint}`}
          >
            <GlassPanel className="flex h-full items-start gap-4 p-5 transition-transform group-hover:-translate-y-0.5">
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--accent) 14%, transparent)",
                  color: "var(--accent)",
                }}
              >
                <Icon size={24} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-[var(--text)]">{c.title}</span>
                  {c.badge && (
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                      {c.badge}
                    </span>
                  )}
                </span>
                {showUrdu && (
                  <span className="mt-0.5 block text-sm text-[var(--accent)]" lang="ur">
                    {c.titleUrdu}
                  </span>
                )}
                <span className="mt-1 block text-xs text-[var(--text-secondary)]">
                  {c.hint}
                </span>
              </span>
            </GlassPanel>
          </Link>
        );
      })}
    </div>
  );
}

export default function LogHubPage() {
  const session = useSession();
  const profile = (session.profile as Record<string, unknown> | null) ?? null;
  const ramadanMode = Boolean(profile?.ramadanMode);
  // Urdu-script subtitles only when the user chose Urdu. English and
  // Roman Urdu both use the Latin script, so no Urdu text is shown.
  const showUrdu = profile?.language === "ur";

  return (
    <div className="anim-page-enter">
      <h1 className="t-greeting">Log a meal</h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        Nine ways to get it in your diary — pick whatever&apos;s fastest right now.
      </p>

      <div className="mt-6">
        <HubGrid cards={CARDS} showUrdu={showUrdu} />
      </div>

      <h2 className="t-card-heading mt-8">More ways to log</h2>
      <div className="mt-3">
        <HubGrid cards={MORE_CARDS} showUrdu={showUrdu} />
      </div>

      {ramadanMode && (
        <Link href="/ramadan" className="mt-4 block">
          <GlassPanel className="flex items-start gap-4 p-5">
            <MoonStar size={22} aria-hidden="true" style={{ color: "var(--accent)" }} />
            <span>
              <span className="t-card-heading block">Ramadan</span>
              <span className="mt-1 block text-sm text-[var(--text-secondary)]">
                Sehri / Iftar shortcuts, your fasting window, and water tracking.
              </span>
            </span>
          </GlassPanel>
        </Link>
      )}

      {!ramadanMode && (
        <GlassPanel className="mt-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="t-card-heading">Fasting this Ramadan?</h2>
              <p className="t-body mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                Turn on Ramadan mode for Sehri / Iftar meal types and fasting tools.
              </p>
            </div>
            <Link href="/settings">
              <LuxButton variant="secondary">Open settings</LuxButton>
            </Link>
          </div>
        </GlassPanel>
      )}

      <p className="mt-6 text-xs text-[var(--text-secondary)]">
        Every nutrition value shows an <strong>Estimate</strong> or{" "}
        <strong>Verified</strong> badge so you always know what the number is
        based on.
      </p>
    </div>
  );
}
