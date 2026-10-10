import Link from "next/link";
import { branding } from "@/lib/site";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Centered auth shell: logo, card container, back-to-home link. */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 dark:bg-neutral-950">
      <header className="flex items-center justify-between px-4 py-4">
        <Link href="/" aria-label={`${branding.appName} home`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={branding.logoPath} alt={branding.appName} className="h-9" />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 sm:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
