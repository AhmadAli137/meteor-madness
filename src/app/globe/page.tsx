"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import TopNav from "@/components/TopNav";
import type { ImpactOverlay } from "@/components/GlobeCesium";

const GlobeCesium = dynamic(() => import("@/components/GlobeCesium"), {
  ssr: false,
});

function toNum(n: unknown) {
  const v = Number(n);
  return Number.isFinite(v) ? v : undefined;
}

function megatonsFromKE(massKg?: number, velKps?: number) {
  if (!Number.isFinite(massKg!) || !Number.isFinite(velKps!)) return undefined;
  const v = (velKps as number) * 1000;
  const joules = 0.5 * (massKg as number) * v * v;
  return joules / 4.184e15; // 1 MT TNT ≈ 4.184e15 J
}

export default function ImpactGlobePage() {
  const [impact, setImpact] = useState<ImpactOverlay | null>(null);

  // The Impactor Lab stores the scenario in sessionStorage before navigating here
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("mm-impact-detail");
      if (raw) setImpact(JSON.parse(raw));
    } catch {}
  }, []);

  const energyMT = useMemo(
    () =>
      toNum(impact?.energyMT) ??
      megatonsFromKE(toNum(impact?.massKg), toNum(impact?.velKps)),
    [impact?.energyMT, impact?.massKg, impact?.velKps]
  );

  const effects = useMemo(() => {
    if (!energyMT) return null;
    const joules = energyMT * 4.184e15;
    // Heavy-damage blast radius (~5 psi overpressure), nuclear cube-root scaling
    const heavyDamageKm = 4.6 * Math.cbrt(energyMT);
    // Equivalent seismic magnitude (Collins, Melosh & Marcus 2005)
    const seismicMw = 0.67 * Math.log10(joules) - 5.87;
    return { heavyDamageKm, seismicMw };
  }, [energyMT]);

  return (
    <main className="flex min-h-[100svh] flex-col bg-zinc-950 text-zinc-100">
      <TopNav />

      <section className="mx-auto grid w-full max-w-[1400px] flex-1 grid-cols-1 gap-4 px-4 pb-6 pt-4 md:px-6 lg:grid-cols-[1fr_360px]">
        {/* Globe */}
        <div className="min-h-[60svh] overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-white/10 lg:min-h-0">
          <GlobeCesium impact={impact ?? undefined} />
        </div>

        {/* Side panel */}
        <aside className="overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-white/10">
          <div className="border-b border-white/10 p-3">
            <h1 className="text-sm font-semibold">Impact Site</h1>
            <div className="mt-1 text-sm text-white/70">
              Location:&nbsp;
              <span className="font-mono">
                {impact
                  ? `${impact.lat?.toFixed?.(1)}°, ${impact.lon?.toFixed?.(1)}°`
                  : "—"}
              </span>
            </div>
            <div className="text-sm text-white/70">
              ETA (UTC):{" "}
              <span className="font-mono">
                {impact?.etaISO ? impact.etaISO.slice(0, 10) : "—"}
              </span>
            </div>
          </div>

          {!impact && (
            <div className="space-y-3 p-3">
              <p className="text-sm text-white/70">
                No impact scenario loaded yet. Configure one in the Impactor
                Lab first.
              </p>
              <Link
                href="/impact"
                className="block rounded-lg bg-emerald-600 px-3 py-2 text-center text-sm ring-1 ring-emerald-400 hover:bg-emerald-500"
              >
                Open Impactor Lab →
              </Link>
            </div>
          )}

          {impact && (
            <div className="space-y-3 p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-neutral-800/60 p-3 ring-1 ring-white/10">
                  <div className="text-xs text-white/60">Diameter</div>
                  <div className="text-lg font-semibold">
                    {impact.diameterKm ? `${impact.diameterKm} km` : "—"}
                  </div>
                </div>

                <div className="rounded-lg bg-neutral-800/60 p-3 ring-1 ring-white/10">
                  <div className="text-xs text-white/60">Speed</div>
                  <div className="text-lg font-semibold">
                    {impact.velKps ? `${impact.velKps.toFixed(0)} km/s` : "—"}
                  </div>
                </div>

                <div
                  className="rounded-lg bg-neutral-800/60 p-3 ring-1 ring-white/10"
                  title="Kinetic energy ½mv² in megatons of TNT"
                >
                  <div className="text-xs text-white/60">Energy</div>
                  <div className="text-lg font-semibold">
                    {energyMT
                      ? `${Math.round(energyMT).toLocaleString()} MT`
                      : "—"}
                  </div>
                </div>

                <div
                  className="rounded-lg bg-neutral-800/60 p-3 ring-1 ring-white/10"
                  title="Final crater diameter from pi-group scaling (Collins et al. 2005)"
                >
                  <div className="text-xs text-white/60">Crater</div>
                  <div className="text-lg font-semibold">
                    {impact.craterKm
                      ? `~${impact.craterKm.toFixed(1)} km`
                      : "—"}
                  </div>
                </div>
              </div>

              <div className="rounded-lg bg-neutral-800/60 p-3 ring-1 ring-white/10">
                <div className="mb-1 text-sm font-semibold">
                  Estimated Effects
                </div>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {effects && (
                    <>
                      <li>
                        Heavy blast damage within ~
                        {Math.round(effects.heavyDamageKm).toLocaleString()} km
                        of ground zero
                      </li>
                      <li>
                        Equivalent seismic magnitude ≈ M
                        {effects.seismicMw.toFixed(1)}
                      </li>
                    </>
                  )}
                  <li>
                    Tsunami risk if ocean impact; severe ground shaking if
                    inland
                  </li>
                  <li>Wide-area ejecta &amp; thermal radiation possible</li>
                </ul>
                <div className="mt-2 text-[11px] text-white/60">
                  Simplified, educational estimates (nuclear cube-root blast
                  scaling; Collins et al. 2005 seismic coupling).
                </div>
              </div>

              <Link
                href="/deflection"
                className="block rounded-lg bg-emerald-600 px-3 py-2 text-center text-sm ring-1 ring-emerald-400 hover:bg-emerald-500"
              >
                Mission: Save Earth →
              </Link>

              <Link
                href="/impact"
                className="block rounded-lg bg-neutral-700 px-3 py-2 text-center text-sm ring-1 ring-white/10 hover:bg-neutral-600"
              >
                Try a new impact
              </Link>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
