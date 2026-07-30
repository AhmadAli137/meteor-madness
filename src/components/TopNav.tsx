"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/observatory", label: "Observatory" },
  { href: "/impact", label: "Impactor Lab" },
  { href: "/globe", label: "Impact Site" },
  { href: "/deflection", label: "Mission: Save Earth" },
];

export default function TopNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + "/");

  const linkClass = (active: boolean) =>
    [
      "rounded-lg px-3 py-1.5 text-sm ring-1 transition-colors",
      active
        ? "bg-emerald-600 text-white ring-emerald-500"
        : "bg-neutral-900/70 text-white/85 ring-white/10 hover:bg-neutral-800",
    ].join(" ");

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-2.5 md:px-6">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Meteor <span className="text-emerald-400">Madness</span>
        </Link>

        <nav className="flex items-center gap-2 overflow-x-auto">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={linkClass(isActive(l.href))}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
