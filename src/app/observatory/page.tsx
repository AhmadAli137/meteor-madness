"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import ObservatorySidebar from "@/components/ObservatorySidebar";
import HeliocentricView2D, {
  type ApproachRow,
} from "@/components/HeliocentricView2D";

// Load 3D only on the client; 2D is default
const HeliocentricView3D = dynamic(
  () => import("@/components/HeliocentricView3D"),
  {
    ssr: false,
  }
);

export default function ObservatoryPage() {
  const [data, setData] = useState<ApproachRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View state
  const [view3D, setView3D] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // NEW: selection set (controls what's shown in 2D/3D)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/neos", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!ok) return;
        const items = Array.isArray(json?.items)
          ? (json.items as ApproachRow[])
          : [];
        setData(items);
        // initialize selection to ALL
        setSelectedIds(new Set(items.map((n) => n.id)));
      } catch {
        if (!ok) return;
        setData([]);
        setSelectedIds(new Set());
        setError("Could not load NEO data.");
      } finally {
        if (!ok) return;
        setLoading(false);
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  const neos = useMemo<ApproachRow[]>(
    () => (Array.isArray(data) ? data : []),
    [data]
  );

  // Only show selected items in the scenes
  const displayNeos = useMemo<ApproachRow[]>(
    () => neos.filter((n) => selectedIds.has(n.id)),
    [neos, selectedIds]
  );

  return (
    <main className="relative min-h-[100svh] w-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Top bar */}
      <header className="fixed inset-x-0 top-0 z-20 h-12 px-4">
        <div className="relative flex h-full items-center">
          {/* LEFT: status chip */}
          <div className="flex items-center gap-2">
            {error ? (
              <span className="rounded-full bg-rose-700/70 px-2 py-[2px] text-xs">
                Failed to load NEO data.
              </span>
            ) : (
              <span className="rounded-full bg-emerald-800/60 px-2 py-[2px] text-xs">
                {loading
                  ? "Loading…"
                  : `${displayNeos.length}/${neos.length} shown`}
              </span>
            )}
          </div>

          {/* CENTER: 2D / 3D toggle */}
          <div className="pointer-events-none absolute left-1/2 -translate-x-1/2">
            <div className="pointer-events-auto inline-flex overflow-hidden rounded-md ring-1 ring-white/10">
              <button
                onClick={() => setView3D(false)}
                className={`px-3 py-1.5 text-sm ${
                  !view3D
                    ? "bg-emerald-600 text-white"
                    : "bg-neutral-900/70 text-white/85 hover:bg-neutral-800"
                }`}
                aria-pressed={!view3D}
              >
                2D
              </button>
              <button
                onClick={() => setView3D(true)}
                className={`px-3 py-1.5 text-sm ${
                  view3D
                    ? "bg-emerald-600 text-white"
                    : "bg-neutral-900/70 text-white/85 hover:bg-neutral-800"
                }`}
                aria-pressed={view3D}
              >
                3D
              </button>
            </div>
          </div>

          {/* RIGHT: navigation */}
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/"
              className="rounded-lg bg-neutral-900/70 px-3 py-1.5 text-sm ring-1 ring-white/10 hover:bg-neutral-800"
            >
              Home
            </Link>
            <Link
              href="/impact"
              className="rounded-lg bg-neutral-900/70 px-3 py-1.5 text-sm ring-1 ring-white/10 hover:bg-neutral-800"
            >
              Impactor Lab
            </Link>
            <Link
              href="/deflection"
              className="rounded-lg bg-neutral-900/70 px-3 py-1.5 text-sm ring-1 ring-white/10 hover:bg-neutral-800"
            >
              Mission: Save Earth
            </Link>
          </div>
        </div>
      </header>

      {/* Two-column layout */}
      <section className="grid min-h-[100svh] w-full grid-cols-[360px_minmax(0,1fr)] pt-12">
        {/* Sidebar */}
        <aside className="min-h-0 overflow-hidden bg-neutral-900 ring-1 ring-white/10">
          <div className="flex h-[calc(100svh-48px)] flex-col">
            <ObservatorySidebar
              neos={neos}
              loading={loading}
              selectedId={selectedId ?? undefined}
              onSelect={(id) => setSelectedId(id)}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
            />
          </div>
        </aside>

        {/* Scene */}
        <section className="min-h-0 bg-neutral-900 ring-1 ring-white/10">
          <div className="h-[calc(100svh-48px)] w-full">
            {view3D ? (
              <HeliocentricView3D
                neos={displayNeos}
                selectedId={selectedId ?? undefined}
              />
            ) : (
              <HeliocentricView2D
                neos={displayNeos}
                selectedId={selectedId ?? undefined}
                onSelect={setSelectedId}
              />
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
