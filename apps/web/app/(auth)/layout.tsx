import Link from "next/link";
import { branding } from "@/lib/site";
import { ThemeSelector } from "@/components/ThemeSelector";
import { GlassPanel } from "@/components/luxury";

/** Centered auth shell: logo, glass card, back-to-home link. */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)]">
      <header className="flex items-center justify-between px-4 py-4">
        <Link href="/" aria-label={`${branding.appName} home`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={branding.logoPath} alt={branding.appName} className="h-9" />
        </Link>
        <ThemeSelector compact />
      </header>
      <main className="anim-page-enter flex flex-1 items-center justify-center px-4 pb-12">
        <GlassPanel className="w-full max-w-md p-6 sm:p-8">
          {children}
        </GlassPanel>
      </main>
    </div>
  );
}
