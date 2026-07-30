"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* ---------------- types ---------------- */
export type ApproachRow = {
  id: string;
  neo_reference_id: string;
  name: string;
  hm: number;
  dia_km?: number;
  hazardous: boolean;
  approach: {
    epoch: number; // ms since epoch
    date: string;
    miss_km: number;
    miss_au: number;
    vel_kps: number;
  };
  orbital_data?: {
    eccentricity?: string;
    semi_major_axis?: string; // AU
    inclination?: string; // deg
    ascending_node_longitude?: string; // Ω deg
    perihelion_argument?: string; // ω deg
    epoch_osculation?: string; // JD
    mean_anomaly?: string; // deg
    mean_motion?: string; // deg/day
    orbit_class?: unknown;
  };
};

type Props = {
  neos: ApproachRow[] | unknown;
  selectedId?: string;
  onSelect?: (id: string) => void;
};

/* --------------- math + astro helpers --------------- */
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const DEG = Math.PI / 180;
const JD_UNIX_EPOCH = 2440587.5; // 1970-01-01
const msToJD = (ms: number) => JD_UNIX_EPOCH + ms / 86_400_000;
const wrapDeg = (d: number) => ((d % 360) + 360) % 360;
const toLD = (km: number) => km / 384_400;

const ZOOM_MIN = 20;
const ZOOM_MAX = 1600;
const ZOOM_STEP = 1.2;

// Kepler solve: M = E − e sin E
function solveE(M: number, e: number) {
  let E = M;
  for (let i = 0; i < 18; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const d = f / fp;
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

/** Rz(Ω)·Rx(i)·Rz(ω) rotation of 2D ellipse point (x,y,0) into ECLIPTIC frame, then project to XY. */
function rotateXY(
  x: number,
  y: number,
  iDeg: number,
  Odeg: number,
  wdeg: number
) {
  const i = iDeg * DEG,
    O = Odeg * DEG,
    w = wdeg * DEG;

  const cosO = Math.cos(O),
    sinO = Math.sin(O);
  const cosi = Math.cos(i),
    sini = Math.sin(i);
  const cosw = Math.cos(w),
    sinw = Math.sin(w);

  // rotate (x,y,0) by w around z
  let X = x * cosw - y * sinw;
  let Y = x * sinw + y * cosw;
  let Z = 0;

  // rotate by i around x
  let X2 = X;
  let Y2 = Y * Math.cos(i) - Z * Math.sin(i);
  let Z2 = Y * Math.sin(i) + Z * Math.cos(i);

  // rotate by O around z
  const X3 = X2 * cosO - Y2 * sinO;
  const Y3 = X2 * sinO + Y2 * cosO;
  // Z3 ignored for 2D
  return { x: X3, y: Y3 };
}

/** AU position in ecliptic XY from osculating elements at a given epoch (JD_target). */
function keplerToXY(opts: {
  a: number; // AU
  e: number;
  iDeg: number;
  Odeg: number;
  wdeg: number;
  M0deg: number; // mean anomaly at JD0
  nDegPerDay: number;
  JD0: number;
  JDtarget: number;
}) {
  const { a, e, iDeg, Odeg, wdeg, M0deg, nDegPerDay, JD0, JDtarget } = opts;
  const Mdeg = wrapDeg(M0deg + nDegPerDay * (JDtarget - JD0));
  const M = Mdeg * DEG;
  const E = solveE(M, clamp(e, 0, 0.999));
  const b = a * Math.sqrt(1 - e * e);
  const xo = a * (Math.cos(E) - e);
  const yo = b * Math.sin(E);
  const p = rotateXY(xo, yo, iDeg, Odeg, wdeg);
  return { x: p.x, y: p.y, rAU: a * (1 - e * Math.cos(E)) };
}

/* --------------- Earth elements (J2000-lite) --------------- */
/** Mean longitude at J2000 (L0), mean motion n, ecc e, incl i, Ω, ϖ → ω */
const EARTH = {
  a: 1.00000011,
  e: 0.01671022,
  iDeg: 0.00005,
  Odeg: -11.26064, // Ω
  L0deg: 100.46435, // mean longitude at J2000 (deg)
  nDegPerDay: 0.98564736, // ~360/365.256
  varpiDeg: 102.94719, // longitude of perihelion (ϖ)
  JD0: 2451545.0, // J2000
};
const EARTH_wdeg = EARTH.varpiDeg - EARTH.Odeg; // ω
function earthM0deg() {
  // M = L - ϖ at JD0
  return wrapDeg(EARTH.L0deg - EARTH.varpiDeg);
}

/* ---------------- component ---------------- */
export default function HeliocentricView2D({
  neos,
  selectedId,
  onSelect,
}: Props) {
  const items = useMemo<ApproachRow[]>(
    () => (Array.isArray(neos) ? (neos as ApproachRow[]) : []),
    [neos]
  );

  // canvas + sizing
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });

  // view state
  const [pxPerAU, setPxPerAU] = useState(220);
  const pxPerAURef = useRef(pxPerAU);
  useEffect(() => void (pxPerAURef.current = pxPerAU), [pxPerAU]);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const offsetRef = useRef(offset);
  useEffect(() => void (offsetRef.current = offset), [offset]);

  // toggles
  const [showLabels, setShowLabels] = useState(true);
  const [showCA, setShowCA] = useState(true);

  // hover + markers for picking
  const [hover, setHover] = useState<{
    id: string;
    x: number;
    y: number;
    mx: number;
    my: number;
  } | null>(null);
  const markersRef = useRef<
    Array<{ id: string; x: number; y: number; r: number }>
  >([]);

  /* --------------- responsive size --------------- */
  useEffect(() => {
    if (!hostRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect;
      if (!r) return;
      setSize((p) => {
        const w = Math.max(260, Math.floor(r.width));
        const h = Math.max(260, Math.floor(r.height));
        return p.w === w && p.h === h ? p : { w, h };
      });
    });
    ro.observe(hostRef.current);
    return () => ro.disconnect();
  }, []);

  /* --------------- fit scale to aphelia --------------- */
  function aphelionAU(od?: ApproachRow["orbital_data"]) {
    if (!od) return 1;
    const a = Number(od.semi_major_axis);
    const e = Number(od.eccentricity);
    if (!isFinite(a) || !isFinite(e)) return 1;
    return a * (1 + e);
  }
  function percentile(sortedVals: number[], p: number) {
    if (!sortedVals.length) return 1;
    const idx = clamp((sortedVals.length - 1) * p, 0, sortedVals.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const t = idx - lo;
    return sortedVals[lo] * (1 - t) + sortedVals[hi] * t;
  }

  const fitToData = () => {
    const aps = items
      .map((it) => aphelionAU(it.orbital_data))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    let maxAU = aps.length ? percentile(aps, 0.9) : 1;
    maxAU = clamp(maxAU, 1.2, 4.0);
    const margin = 0.9;
    const next = clamp(
      (margin * Math.min(size.w, size.h)) / (maxAU * 2),
      ZOOM_MIN,
      ZOOM_MAX
    );
    setOffset({ x: 0, y: 0 });
    setPxPerAU(next);
  };

  useEffect(() => {
    const aps = items
      .map((it) => aphelionAU(it.orbital_data))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    let maxAU = aps.length ? percentile(aps, 0.9) : 1;
    maxAU = clamp(maxAU, 1.2, 4.0);
    const margin = 0.9;
    const next = clamp(
      (margin * Math.min(size.w, size.h)) / (maxAU * 2),
      ZOOM_MIN,
      ZOOM_MAX
    );
    if (Math.abs(next - pxPerAURef.current) > 1e-6) setPxPerAU(next);
  }, [items, size.w, size.h]);

  /* --------------- interactions --------------- */
  // drag / pan
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let dragging = false,
      sx = 0,
      sy = 0,
      baseX = 0,
      baseY = 0;

    const onDown = (e: MouseEvent) => {
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      baseX = offsetRef.current.x;
      baseY = offsetRef.current.y;
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      setOffset({ x: baseX + (e.clientX - sx), y: baseY + (e.clientY - sy) });
    };
    const onUp = () => (dragging = false);

    c.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      c.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // wheel zoom (cursor anchored)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const prev = pxPerAURef.current;
      const next = clamp(prev * factor, ZOOM_MIN, ZOOM_MAX);
      if (next === prev) return;

      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cx = c.width / 2 + offsetRef.current.x;
      const cy = c.height / 2 + offsetRef.current.y;
      const vx = mx - cx;
      const vy = my - cy;
      const ratio = next / prev;
      const nx = cx + vx - vx * ratio;
      const ny = cy + vy - vy * ratio;
      setOffset({ x: nx - c.width / 2, y: ny - c.height / 2 });
      setPxPerAU(next);
      e.preventDefault();
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, []);

  // hover + click picking
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onMove = (e: MouseEvent) => {
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let found: { id: string; x: number; y: number; r: number } | null = null;
      let best = Infinity;
      for (const m of markersRef.current) {
        const d2 = (mx - m.x) ** 2 + (my - m.y) ** 2;
        if (d2 <= (m.r + 6) ** 2 && d2 < best) {
          best = d2;
          found = m;
        }
      }
      if (found) setHover({ id: found.id, x: found.x, y: found.y, mx, my });
      else if (hover) setHover(null);
    };
    const onLeave = () => setHover(null);
    const onClick = () => {
      if (hover?.id && onSelect) onSelect(hover.id);
    };
    c.addEventListener("mousemove", onMove);
    c.addEventListener("mouseleave", onLeave);
    c.addEventListener("click", onClick);
    return () => {
      c.removeEventListener("mousemove", onMove);
      c.removeEventListener("mouseleave", onLeave);
      c.removeEventListener("click", onClick);
    };
  }, [hover, onSelect]);

  /* --------------- drawing --------------- */
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = size.w;
    c.height = size.h;
    const g = c.getContext("2d");
    if (!g) return;

    const cx = c.width / 2 + offset.x;
    const cy = c.height / 2 + offset.y;

    // bg
    const grd = g.createLinearGradient(0, 0, 0, c.height);
    grd.addColorStop(0, "#081014");
    grd.addColorStop(1, "#0a1712");
    g.fillStyle = grd;
    g.fillRect(0, 0, c.width, c.height);

    // sun
    g.fillStyle = "#ffda44";
    g.beginPath();
    g.arc(cx, cy, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffd14a";
    g.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
    g.fillText("Sun", cx + 12, cy + 4);

    // choose epoch for CA computations (selected → hover → median → now)
    let refEpoch: number | null = null;
    if (selectedId)
      refEpoch =
        items.find((n) => n.id === selectedId)?.approach?.epoch ?? null;
    if (refEpoch == null && hover?.id)
      refEpoch = items.find((n) => n.id === hover.id)?.approach?.epoch ?? null;
    if (refEpoch == null) {
      const epochs = items
        .map((n) => n.approach?.epoch)
        .filter((v): v is number => Number.isFinite(v));
      if (epochs.length)
        refEpoch = epochs.sort((a, b) => a - b)[Math.floor(epochs.length / 2)];
    }
    if (refEpoch == null) refEpoch = Date.now();
    const JDt = msToJD(refEpoch);

    // Earth @ JDt
    const earthM0 = earthM0deg();
    const Epos = keplerToXY({
      a: EARTH.a,
      e: EARTH.e,
      iDeg: EARTH.iDeg,
      Odeg: EARTH.Odeg,
      wdeg: EARTH_wdeg,
      M0deg: earthM0,
      nDegPerDay: EARTH.nDegPerDay,
      JD0: EARTH.JD0,
      JDtarget: JDt,
    });
    const ex = cx + Epos.x * pxPerAU;
    const ey = cy + Epos.y * pxPerAU;

    // Draw Earth's orbit ellipse (1 AU ring) correctly rotated
    g.strokeStyle = "rgba(120,165,255,0.55)";
    g.setLineDash([5, 5]);
    g.beginPath();
    const stepsRing = 360;
    for (let k = 0; k <= stepsRing; k++) {
      const Mdeg = (k / stepsRing) * 360;
      // Make an auxiliary E from M (same e)
      const E = solveE(Mdeg * DEG, EARTH.e);
      const b = EARTH.a * Math.sqrt(1 - EARTH.e * EARTH.e);
      const xo = EARTH.a * (Math.cos(E) - EARTH.e);
      const yo = b * Math.sin(E);
      const p = rotateXY(xo, yo, EARTH.iDeg, EARTH.Odeg, EARTH_wdeg);
      const X = cx + p.x * pxPerAU;
      const Y = cy + p.y * pxPerAU;
      if (k === 0) g.moveTo(X, Y);
      else g.lineTo(X, Y);
    }
    g.stroke();
    g.setLineDash([]);

    // Earth marker + label
    g.fillStyle = "#5fb0ff";
    g.beginPath();
    g.arc(ex, ey, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(230,240,255,0.9)";
    g.font = "11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
    g.fillText("Earth", ex + 8, ey - 6);

    markersRef.current = [];

    // diameter scale (for dots)
    const dVals = items
      .map((n) => Number(n.dia_km ?? 0.5))
      .filter((v) => isFinite(v) && v > 0);
    const dMin = dVals.length ? Math.min(...dVals) : 0.2;
    const dMax = dVals.length ? Math.max(...dVals) : 5;
    const diaToPx = (dKm: number) => {
      const sMin = Math.sqrt(Math.max(dMin, 0.05));
      const sMax = Math.sqrt(Math.max(dMax, 0.1));
      const s = Math.sqrt(Math.max(dKm, 0.05));
      const t = (s - sMin) / (sMax - sMin + 1e-6);
      return clamp(3 + 9 * t, 3, 12);
    };

    // Draw each NEO orbit (rotated) + CA marker, then optional CA line to Earth
    for (const n of items) {
      const od = n.orbital_data;
      if (!od) continue;
      const a = Number(od.semi_major_axis);
      const e = Number(od.eccentricity);
      const iDeg = Number(od.inclination ?? 0);
      const Odeg = Number(od.ascending_node_longitude ?? 0);
      const wdeg = Number(od.perihelion_argument ?? 0);
      const M0deg = Number(od.mean_anomaly);
      const nDegPerDay = Number(od.mean_motion);
      const JD0 = Number(od.epoch_osculation);

      if (
        ![a, e, iDeg, Odeg, wdeg, M0deg, nDegPerDay, JD0].every((v) =>
          Number.isFinite(v)
        ) ||
        a <= 0
      ) {
        continue;
      }

      // Orbit path (ellipse rotated)
      const steps = 240;
      g.save();
      g.strokeStyle = n.hazardous
        ? "rgba(244, 63, 94, 0.9)"
        : "rgba(52, 211, 153, 0.9)";
      g.lineWidth = 1.25;
      g.beginPath();
      for (let s = 0; s <= steps; s++) {
        const Mdeg = (s / steps) * 360;
        const E = solveE(Mdeg * DEG, clamp(e, 0, 0.999));
        const b = a * Math.sqrt(1 - e * e);
        const xo = a * (Math.cos(E) - e);
        const yo = b * Math.sin(E);
        const p = rotateXY(xo, yo, iDeg, Odeg, wdeg);
        const X = cx + p.x * pxPerAU;
        const Y = cy + p.y * pxPerAU;
        if (s === 0) g.moveTo(X, Y);
        else g.lineTo(X, Y);
      }
      g.stroke();
      g.restore();

      // Position at CA epoch
      const pos = keplerToXY({
        a,
        e,
        iDeg,
        Odeg,
        wdeg,
        M0deg,
        nDegPerDay,
        JD0,
        JDtarget: msToJD(n.approach?.epoch ?? Date.now()),
      });
      const sx = cx + pos.x * pxPerAU;
      const sy = cy + pos.y * pxPerAU;

      // magenta dot
      const r = diaToPx(Number(n.dia_km ?? 0.5));
      g.shadowColor = "rgba(255, 70, 255, 0.6)";
      g.shadowBlur = 8;
      g.fillStyle = "#ff46ff";
      g.beginPath();
      g.arc(sx, sy, r, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;

      // selection/hover rings
      if (selectedId && n.id === selectedId) {
        g.lineWidth = 2;
        g.strokeStyle = "#ffffff";
        g.stroke();
      } else if (hover?.id === n.id) {
        g.lineWidth = 2;
        g.strokeStyle = "rgba(255,255,255,0.85)";
        g.stroke();
      }

      // label
      if (showLabels || (selectedId && n.id === selectedId)) {
        g.fillStyle = "white";
        g.font =
          "11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
        g.fillText(n.name, sx + 8, sy - 6);
      }

      // CA line + label (Earth→NEO at the same epoch)
      if (showCA) {
        g.strokeStyle = "rgba(255,255,255,0.42)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(ex, ey);
        g.lineTo(sx, sy);
        g.stroke();

        const missKm = Number(n.approach?.miss_km);
        const missAu = Number(n.approach?.miss_au);
        if (Number.isFinite(missKm) && Number.isFinite(missAu)) {
          const midx = (ex + sx) / 2;
          const midy = (ey + sy) / 2;
          const label = `${missKm.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })} km  •  ${missAu.toFixed(5)} AU  •  ${toLD(missKm).toFixed(1)} LD`;
          const pad = 3;
          g.fillStyle = "rgba(0,0,0,0.65)";
          const w = g.measureText(label).width;
          g.fillRect(midx - w / 2 - pad, midy - 18, w + 2 * pad, 14);
          g.fillStyle = "white";
          g.fillText(label, midx - w / 2, midy - 8);
        }
      }

      markersRef.current.push({ id: n.id, x: sx, y: sy, r });
    }
  }, [
    items,
    size.w,
    size.h,
    offset,
    pxPerAU,
    selectedId,
    hover?.id,
    showCA,
    showLabels,
  ]);

  /* --------------- toolbar --------------- */
  const zoomIn = () =>
    setPxPerAU((s) => clamp(s * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX));
  const zoomOut = () =>
    setPxPerAU((s) => clamp(s / ZOOM_STEP, ZOOM_MIN, ZOOM_MAX));

  /* --------------- UI --------------- */
  return (
    <div
      ref={hostRef}
      className="relative h-[calc(100vh-140px)] w-full overflow-hidden md:h-[calc(100vh-130px)]"
    >
      {/* controls */}
      <div className="pointer-events-auto absolute left-3 top-3 z-10 flex flex-col gap-2">
        <div className="rounded-xl border border-white/10 bg-neutral-900/70 p-2 backdrop-blur shadow">
          <div className="grid grid-cols-4 gap-2">
            <ToolBtn label="Home (0)" onClick={fitToData}>
              ⌂
            </ToolBtn>
            <ToolBtn label="Zoom In (+)" onClick={zoomIn}>
              ＋
            </ToolBtn>
            <ToolBtn label="Zoom Out (-)" onClick={zoomOut}>
              －
            </ToolBtn>
            <ToolBtn
              label="Download PNG"
              onClick={() => {
                const c = canvasRef.current;
                if (!c) return;
                const a = document.createElement("a");
                a.href = c.toDataURL("image/png");
                a.download = "heliocentric_orbits.png";
                a.click();
              }}
            >
              ⤓
            </ToolBtn>

            <ToolBtn
              className="col-span-2"
              label={showLabels ? "Hide labels" : "Show labels"}
              onClick={() => setShowLabels((v) => !v)}
            >
              Labels: {showLabels ? "On" : "Off"}
            </ToolBtn>
            <ToolBtn
              className="col-span-2"
              label={showCA ? "Hide CA lines" : "Show CA lines"}
              onClick={() => setShowCA((v) => !v)}
            >
              Closest Approach: {showCA ? "On" : "Off"}
            </ToolBtn>
          </div>

          <div className="mt-2 text-[11px] text-white/65">
            Drag to pan • Wheel/± to zoom • Magenta = NEO at closest approach •
            Earth’s ring = rotated 1 AU ellipse • Line = Earth→NEO at CA (km •
            AU • LD)
          </div>
        </div>
      </div>

      {/* canvas */}
      <canvas
        ref={canvasRef}
        className="block h-full w-full rounded-xl border border-white/10 bg-black/40 ring-1 ring-white/10"
      />
    </div>
  );
}

/* ----------- small UI helper ----------- */
function ToolBtn({
  children,
  onClick,
  label,
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={[
        "rounded-lg px-2 py-1.5 text-sm",
        "bg-neutral-800/80 text-white/90 ring-1 ring-white/10",
        "hover:bg-neutral-700 focus:outline-none focus:ring-emerald-600/50",
        "transition-colors",
        className,
      ].join(" ")}
    >
      {children}
    </button>
  );
}
