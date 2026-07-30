"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ApproachRow } from "./HeliocentricView2D";

type Props = {
  neos: ApproachRow[];
  loading?: boolean;
  selectedId?: string;                 // focused item (centers the scene)
  onSelect: (id: string) => void;      // focus/center a single NEO
  selectedIds: Set<string>;            // current selection (controlled by parent)
  onSelectionChange: (ids: Set<string>) => void; // emit new selection set
};

type SortKey = "date" | "miss" | "diameter" | "name";
type SortDir = "asc" | "desc";

export default function ObservatorySidebar({
  neos,
  loading,
  selectedId,
  onSelect,
  selectedIds,
  onSelectionChange,
}: Props) {
  // UI state
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [hazOnly, setHazOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [activeIdx, setActiveIdx] = useState<number>(-1);

  // Debounce search input
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 140);
    return () => window.clearTimeout(t);
  }, [q]);

  // Derived / filtered / sorted list
  const list = useMemo<ApproachRow[]>(() => {
    const base = Array.isArray(neos) ? neos : [];

    const filtered = base.filter((n) => {
      if (hazOnly && !n.hazardous) return false;
      if (!debouncedQ) return true;
      const needle = debouncedQ.toLowerCase();
      return (
        n.name.toLowerCase().includes(needle) ||
        n.neo_reference_id.toLowerCase().includes(needle)
      );
    });

    filtered.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "date": {
          const ad = safeDate(a.approach?.date);
          const bd = safeDate(b.approach?.date);
          return (ad - bd) * dir;
        }
        case "miss": {
          const am = isFiniteNumber(a.approach?.miss_km)
            ? a.approach!.miss_km
            : Number.POSITIVE_INFINITY;
          const bm = isFiniteNumber(b.approach?.miss_km)
            ? b.approach!.miss_km
            : Number.POSITIVE_INFINITY;
          return (am - bm) * dir;
        }
        case "diameter": {
          const av = toNumberOrInf(a.dia_km);
          const bv = toNumberOrInf(b.dia_km);
          return (av - bv) * dir;
        }
        case "name":
        default: {
          const an = a.name.toLowerCase();
          const bn = b.name.toLowerCase();
          return (an < bn ? -1 : an > bn ? 1 : 0) * dir;
        }
      }
    });

    return filtered.slice(0, 800);
  }, [neos, debouncedQ, hazOnly, sortKey, sortDir]);

  // keep activeIdx in range
  useEffect(() => {
    if (list.length === 0) setActiveIdx(-1);
    else if (activeIdx >= list.length) setActiveIdx(list.length - 1);
  }, [list.length, activeIdx]);

  // refs for focus & scroll
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Selection helpers (controlled, immutable Set copies)
  const toggleOne = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange(next);
  };

  const allShownSelected = list.length > 0 && list.every((n) => selectedIds.has(n.id));
  const someShownSelected = !allShownSelected && list.some((n) => selectedIds.has(n.id));

  const toggleAllShown = (checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) {
      for (const n of list) next.add(n.id);
    } else {
      for (const n of list) next.delete(n.id);
    }
    onSelectionChange(next);
  };

  // Keyboard navigation on the whole panel
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!list.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min((activeIdx < 0 ? -1 : activeIdx) + 1, list.length - 1);
      setActiveIdx(next);
      rowRefs.current[next]?.focus();
      scrollIntoViewIfNeeded(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = Math.max((activeIdx < 0 ? 0 : activeIdx) - 1, 0);
      setActiveIdx(prev);
      rowRefs.current[prev]?.focus();
      scrollIntoViewIfNeeded(prev);
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      const item = list[activeIdx];
      if (item) onSelect(item.id);
    } else if (e.key === " ") {
      // space toggles checkbox of focused row
      e.preventDefault();
      if (activeIdx >= 0) {
        const item = list[activeIdx];
        if (item) {
          const checked = !selectedIds.has(item.id);
          toggleOne(item.id, checked);
        }
      }
    }
  };

  const scrollIntoViewIfNeeded = (idx: number): void => {
    const c = containerRef.current;
    const r = rowRefs.current[idx];
    if (!c || !r) return;
    const cb = c.getBoundingClientRect();
    const rb = r.getBoundingClientRect();
    if (rb.top < cb.top || rb.bottom > cb.bottom) {
      r.scrollIntoView({ block: "nearest" });
    }
  };

  const shownLabel = loading ? "Loading…" : `${list.length} shown`;

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      role="region"
      aria-label="NEO list and filters"
      onKeyDown={onKeyDown}
    >
      {/* Header / controls */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-neutral-900/95 px-3 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          {/* Select all (shown) */}
          <label className="inline-flex items-center gap-2 rounded-md bg-neutral-800/70 px-2 py-1.5 text-xs ring-1 ring-white/10">
            <input
              type="checkbox"
              checked={allShownSelected}
              ref={(el) => {
                if (el) el.indeterminate = someShownSelected;
              }}
              onChange={(e) => toggleAllShown(e.target.checked)}
              aria-label="Select all shown"
            />
            Select all shown
          </label>

          {/* Search */}
          <div className="relative flex-1">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search NEO name or ID…"
              className="w-full rounded-lg bg-neutral-800/70 px-3 py-2 text-sm text-white ring-1 ring-white/10 placeholder:text-white/40 focus:outline-none focus:ring-emerald-600/60"
              aria-label="Search NEOs"
            />
            {q && (
              <button
                type="button"
                className="absolute right-1.5 top-1.5 rounded-md px-2 py-1 text-[11px] text-white/70 hover:bg-neutral-700/60"
                onClick={() => setQ("")}
                aria-label="Clear search"
                title="Clear"
              >
                ✕
              </button>
            )}
          </div>

          {/* Hazard filter */}
          <button
            type="button"
            onClick={() => setHazOnly((v) => !v)}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm ring-1 ${
              hazOnly
                ? "bg-rose-700/40 text-rose-100 ring-rose-700/60"
                : "bg-neutral-800/70 text-white/85 ring-white/10 hover:bg-neutral-700"
            }`}
            aria-pressed={hazOnly}
            aria-label="Toggle hazardous only"
            title="Show hazardous only"
          >
            Hazard
          </button>

          {/* Sort */}
          <div className="flex items-center gap-1">
            <label className="sr-only" htmlFor="neo-sort">
              Sort by
            </label>
            <select
              id="neo-sort"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-md bg-neutral-800/70 px-2 py-2 text-sm text-white/85 ring-1 ring-white/10 hover:bg-neutral-700 focus:outline-none"
              title="Sort by"
            >
              <option value="date">Date</option>
              <option value="miss">Miss distance</option>
              <option value="diameter">Diameter</option>
              <option value="name">Name</option>
            </select>
            <button
              type="button"
              className="rounded-md bg-neutral-800/70 px-2 py-2 text-sm text-white/85 ring-1 ring-white/10 hover:bg-neutral-700"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              aria-label={`Sort direction: ${sortDir}`}
              title={`Sort direction: ${sortDir}`}
            >
              {sortDir === "asc" ? "↑" : "↓"}
            </button>
          </div>
        </div>

        {/* Counts / status */}
        <div className="mt-2 flex items-center justify-between text-[11px] text-white/60">
          <span>{shownLabel}</span>
          <span className="hidden md:inline">Tip: ↑/↓ move • Enter focus • Space select</span>
        </div>
      </div>

      {/* List (only this scrolls) */}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        role="listbox"
        aria-label="Near-Earth objects"
        style={{ scrollbarGutter: "stable" }}
      >
        {list.map((n, idx) => {
          const active = n.id === selectedId;
          const focused = idx === activeIdx;
          const checked = selectedIds.has(n.id);

          return (
            <button
              key={n.id}
              ref={(el) => {
                rowRefs.current[idx] = el;
              }}
              role="option"
              aria-selected={active}
              tabIndex={0}
              onClick={() => onSelect(n.id)}
              className={[
                "block w-full border-b border-white/5 px-3 py-2 text-left outline-none transition-colors",
                "hover:bg-neutral-800/50 focus:bg-neutral-800/60",
                active ? "bg-emerald-700/30" : "",
                !active && focused ? "ring-1 ring-emerald-600/40" : "",
              ].join(" ")}
              title="Center in view"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <label
                  className="flex items-center gap-2 text-sm text-white"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleOne(n.id, e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${n.name}`}
                  />
                  <span className="truncate font-medium">{n.name}</span>
                </label>

                <span
                  className={`shrink-0 rounded-full px-2 py-[2px] text-[10px] ${
                    n.hazardous
                      ? "bg-rose-600/90 text-white"
                      : "bg-emerald-700/90 text-white"
                  }`}
                >
                  {n.hazardous ? "Hazard" : "Normal"}
                </span>
              </div>

              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-white/70">
                <span className="whitespace-nowrap">
                  {n.approach?.date ? formatDate(n.approach.date) : "—"}
                </span>
                <span className="opacity-40">•</span>
                <span className="whitespace-nowrap">
                  miss{" "}
                  {isFiniteNumber(n.approach?.miss_km)
                    ? formatMiss(n.approach!.miss_km)
                    : "—"}
                </span>
                {isFiniteNumber(n.dia_km) && (
                  <>
                    <span className="opacity-40">•</span>
                    <span className="whitespace-nowrap">
                      Ø ~{" "}
                      {Number(n.dia_km) >= 1
                        ? `${Number(n.dia_km).toFixed(2)} km`
                        : `${Math.max(1, Math.round(Number(n.dia_km) * 1000))} m`}
                    </span>
                  </>
                )}
              </div>

              <div className="mt-0.5 text-[11px] text-white/50">
                ID: {n.neo_reference_id || "—"}
              </div>
            </button>
          );
        })}

        {!loading && list.length === 0 && (
          <div className="grid place-content-center p-6 text-center text-sm text-white/70">
            <div>No objects match your filters.</div>
            <button
              type="button"
              className="mt-2 inline-flex items-center rounded-md bg-neutral-800/70 px-3 py-1.5 text-xs text-white/85 ring-1 ring-white/10 hover:bg-neutral-700"
              onClick={() => {
                setQ("");
                setHazOnly(false);
                setSortKey("date");
                setSortDir("asc");
              }}
            >
              Reset filters
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/* -------------------- helpers -------------------- */

function safeDate(d?: string | number | Date): number {
  if (!d) return Number.POSITIVE_INFINITY;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

function toNumberOrInf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v)
    ? v
    : Number.POSITIVE_INFINITY;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function formatDate(d: string | number | Date): string {
  const dt = new Date(d);
  if (!Number.isFinite(dt.getTime())) return "—";
  const y = dt.getUTCFullYear();
  const m = `${dt.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${dt.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMiss(missKm: number): string {
  const mm = missKm / 1000;
  return `${mm.toFixed(2)} Mm`;
}
