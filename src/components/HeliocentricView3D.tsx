// src/components/HeliocentricView3D.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ApproachRow } from "./HeliocentricView2D";

/* ─────────────────────────────
   Scene constants & helpers
   ───────────────────────────── */
type CesiumModule = typeof import("cesium");

const AU_TO_SCENE = 1_000_000; // schematic units
const AU_KM = 149_597_870.7;
const JD_UNIX_EPOCH = 2440587.5;
const DEG = Math.PI / 180;

// Visual radii (purely for scene readability)
const SUN_RADIUS_SCENE = 120_000;
const EARTH_RADIUS_SCENE = 45_000; // smaller than Sun

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const msToJD = (ms: number) => JD_UNIX_EPOCH + ms / 86_400_000;
const wrapDeg = (d: number) => ((d % 360) + 360) % 360;

// Kepler solve for eccentric anomaly
function solveE(M: number, e: number) {
  let E = M;
  for (let i = 0; i < 15; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const step = f / fp;
    E -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  return E;
}

// Rotate orbital plane (x,y,0) by Rz(O)·Rx(i)·Rz(w) to inertial frame
function rotateOrbitalToECI(
  Cesium: CesiumModule,
  xAU: number,
  yAU: number,
  iDeg: number,
  Odeg: number,
  wDeg: number
) {
  const { Cartesian3 } = Cesium;
  const i = iDeg * DEG,
    O = Odeg * DEG,
    w = wDeg * DEG;
  const cosO = Math.cos(O),
    sinO = Math.sin(O);
  const cosi = Math.cos(i),
    sini = Math.sin(i);
  const cosw = Math.cos(w),
    sinw = Math.sin(w);

  // Rz(w)
  let X = xAU * cosw - yAU * sinw;
  let Y = xAU * sinw + yAU * cosw;
  let Z = 0;

  // Rx(i)
  const X2 = X;
  const Y2 = Y * cosi - Z * sini;
  const Z2 = Y * sini + Z * cosi;

  // Rz(O)
  const X3 = X2 * cosO - Y2 * sinO;
  const Y3 = X2 * sinO + Y2 * cosO;
  const Z3 = Z2;

  return new Cartesian3(X3 * AU_TO_SCENE, Y3 * AU_TO_SCENE, Z3 * AU_TO_SCENE);
}

/* ─── Earth mean elements (same as 2D) ─── */
const EARTH = {
  a: 1.00000011,
  e: 0.01671022,
  iDeg: 0.00005,
  Odeg: -11.26064,
  L0deg: 100.46435,
  nDegPerDay: 0.98564736,
  varpiDeg: 102.94719,
  JD0: 2451545.0,
};
const EARTH_wdeg = EARTH.varpiDeg - EARTH.Odeg;

function earthCartesianAtJD(Cesium: CesiumModule, JDtarget: number) {
  const { Cartesian3 } = Cesium;
  const M0 = wrapDeg(EARTH.L0deg - EARTH.varpiDeg);
  const Mdeg = wrapDeg(M0 + EARTH.nDegPerDay * (JDtarget - EARTH.JD0));
  const E = solveE(Mdeg * DEG, EARTH.e);
  const b = EARTH.a * Math.sqrt(1 - EARTH.e * EARTH.e);
  const xo = EARTH.a * (Math.cos(E) - EARTH.e);
  const yo = b * Math.sin(E);

  const i = EARTH.iDeg * DEG,
    O = EARTH.Odeg * DEG,
    w = EARTH_wdeg * DEG;
  const cosO = Math.cos(O),
    sinO = Math.sin(O);
  const cosi = Math.cos(i),
    sini = Math.sin(i);
  const cosw = Math.cos(w),
    sinw = Math.sin(w);

  // Rz(w)
  let X = xo * cosw - yo * sinw;
  let Y = xo * sinw + yo * cosw;
  let Z = 0;

  // Rx(i)
  const X2 = X;
  const Y2 = Y * cosi - Z * sini;
  const Z2 = Y * sini + Z * cosi;

  // Rz(O)
  const X3 = X2 * cosO - Y2 * sinO;
  const Y3 = X2 * sinO + Y2 * cosO;
  const Z3 = Z2;

  return new Cartesian3(X3 * AU_TO_SCENE, Y3 * AU_TO_SCENE, Z3 * AU_TO_SCENE);
}

/* ─────────────────────────────
   Component
   ───────────────────────────── */
type Props = {
  neos: ApproachRow[] | unknown;
  selectedId?: string;
};

type ViewerStore = {
  viewer: import("cesium").Viewer;
  Cesium: CesiumModule;
  sphere: import("cesium").BoundingSphere;
} | null;

export default function HeliocentricView3D({ neos, selectedId }: Props) {
  const items = useMemo<ApproachRow[]>(
    () => (Array.isArray(neos) ? (neos as ApproachRow[]) : []),
    [neos]
  );

  const holderRef = useRef<HTMLDivElement | null>(null);
  const storeRef = useRef<ViewerStore>(null);

  const [labelsOn, setLabelsOn] = useState(true);
  const [showCA, setShowCA] = useState(true);
  const [caNote, setCaNote] = useState<string | null>(null);

  // Build base scene
  useEffect(() => {
    let mounted = true;

    (async () => {
      const Cesium: CesiumModule = await import("cesium");
      (window as any).CESIUM_BASE_URL = "/cesium";

      const {
        Viewer,
        Cartesian3,
        Color,
        Cartesian2,
        LabelStyle,
        BoundingSphere,
        DistanceDisplayCondition,
        PolylineDashMaterialProperty,
      } = Cesium;

      if (!mounted || !holderRef.current) return;

      holderRef.current.replaceChildren();

      const creditDiv = document.createElement("div");
      creditDiv.style.display = "none";

      const viewer = new Viewer(holderRef.current, {
        animation: false,
        timeline: false,
        homeButton: false,
        sceneModePicker: true,
        baseLayerPicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        geocoder: false,
        creditContainer: creditDiv,
      });

      // Minimal space look
      viewer.scene.globe.show = false;
      (viewer.scene as any).skyAtmosphere = undefined;
      (viewer.scene as any).skyBox = undefined;
      viewer.scene.backgroundColor = Color.fromCssColorString("#0b0f19");
      (viewer.cesiumWidget.creditContainer as HTMLElement).style.display =
        "none";

      // Sun
      viewer.entities.add({
        id: "sun",
        name: "Sun",
        position: Cartesian3.ZERO,
        ellipsoid: {
          radii: new Cartesian3(
            SUN_RADIUS_SCENE,
            SUN_RADIUS_SCENE,
            SUN_RADIUS_SCENE
          ),
          material: Color.fromCssColorString("#ffdd66"),
        },
        label: {
          text: "Sun",
          font: "13px sans-serif",
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          pixelOffset: new Cartesian2(0, -22),
          showBackground: true,
          backgroundColor: Color.fromAlpha(Color.BLACK, 0.55),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new DistanceDisplayCondition(
            0,
            Number.POSITIVE_INFINITY
          ),
        },
      } as any);

      // 1 AU dashed ring (Earth orbit guide)
      const ring: import("cesium").Cartesian3[] = [];
      for (let k = 0; k <= 360; k++) {
        const a = (k / 360) * 2 * Math.PI;
        ring.push(
          new Cartesian3(
            Math.cos(a) * AU_TO_SCENE,
            Math.sin(a) * AU_TO_SCENE,
            0
          )
        );
      }
      viewer.entities.add({
        id: "earth-orbit",
        name: "Earth Orbit (1 AU)",
        polyline: {
          positions: ring,
          width: 1.6,
          material: new PolylineDashMaterialProperty({
            color: Color.fromCssColorString("#60a5fa").withAlpha(0.9),
            dashLength: 12,
          }),
        },
      } as any);

      // Earth at NOW (always visible unless we switch to Earth@CA)
      const nowJD = msToJD(Date.now());
      const earthNow = earthCartesianAtJD(Cesium, nowJD);
      viewer.entities.add({
        id: "earth-now",
        name: "Earth",
        position: earthNow,
        ellipsoid: {
          radii: new Cartesian3(
            EARTH_RADIUS_SCENE,
            EARTH_RADIUS_SCENE,
            EARTH_RADIUS_SCENE
          ),
          material: Color.fromCssColorString("#3b82f6"),
          outline: true,
          outlineColor: Color.fromCssColorString("#1e3a8a"),
          outlineWidth: 1,
        },
        label: labelsOn
          ? {
              text: "Earth",
              font: "12px sans-serif",
              style: LabelStyle.FILL_AND_OUTLINE,
              outlineColor: Color.BLACK,
              outlineWidth: 2,
              pixelOffset: new Cartesian2(0, -18),
              showBackground: true,
              backgroundColor: Color.fromAlpha(Color.BLACK, 0.45),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }
          : undefined,
      } as any);

      // NEOs: orbits + magenta point at CA epoch (if computable)
      let maxAU = 1.2;
      for (const n of items) {
        const od = n.orbital_data;
        if (!od) continue;

        const a = Number(od.semi_major_axis);
        const e = clamp(Number(od.eccentricity), 0, 0.999);
        const iDeg = Number(od.inclination || 0);
        const Odeg = Number(od.ascending_node_longitude || 0);
        const wDeg = Number(od.perihelion_argument || 0);
        if (!Number.isFinite(a) || a <= 0) continue;

        maxAU = Math.max(maxAU, a * (1 + e));
        const b = a * Math.sqrt(1 - e * e);

        const pts: import("cesium").Cartesian3[] = [];
        for (let i = 0; i <= 720; i++) {
          const E = (i / 720) * 2 * Math.PI;
          const xo = a * (Math.cos(E) - e);
          const yo = b * Math.sin(E);
          pts.push(rotateOrbitalToECI(Cesium, xo, yo, iDeg, Odeg, wDeg));
        }
        viewer.entities.add({
          id: `${n.id}-orbit`,
          polyline: {
            positions: pts,
            width: 1.4,
            material: (n.hazardous
              ? Color.fromCssColorString("#ef4444")
              : Color.fromCssColorString("#34d399")
            ).withAlpha(0.9),
          },
        } as any);

        // Try to plot the object's position at its approach epoch
        const M0 = Number(od.mean_anomaly);
        const nDegPerDay = Number(od.mean_motion);
        const epochOscJD = Number(od.epoch_osculation);
        const approachEpoch = n?.approach?.epoch;

        if (
          Number.isFinite(M0) &&
          Number.isFinite(nDegPerDay) &&
          Number.isFinite(epochOscJD) &&
          typeof approachEpoch === "number"
        ) {
          const approachJD = msToJD(approachEpoch);
          const dDays = approachJD - epochOscJD;
          const M_at_CA_deg = wrapDeg(M0 + nDegPerDay * dDays);
          const E = solveE((M_at_CA_deg * Math.PI) / 180, e);
          const xAU = a * (Math.cos(E) - e);
          const yAU = b * Math.sin(E);
          const p = rotateOrbitalToECI(Cesium, xAU, yAU, iDeg, Odeg, wDeg);

          viewer.entities.add({
            id: n.id,
            name: n.name,
            position: p,
            point: {
              pixelSize: 7,
              color: Color.MAGENTA,
              outlineColor: Color.BLACK,
              outlineWidth: 1,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: labelsOn
              ? {
                  text: n.name,
                  font: "11px sans-serif",
                  style: LabelStyle.FILL_AND_OUTLINE,
                  outlineColor: Color.BLACK,
                  outlineWidth: 2,
                  pixelOffset: new Cartesian2(0, -14),
                  showBackground: true,
                  backgroundColor: Color.fromAlpha(Color.BLACK, 0.45),
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                }
              : undefined,
          } as any);
        }
      }

      // Auto-fit camera to system
      const R = maxAU * 1.15 * AU_TO_SCENE;
      const sphere = BoundingSphere.fromPoints([
        new Cartesian3(R, 0, 0),
        new Cartesian3(-R, 0, 0),
        new Cartesian3(0, R, 0),
        new Cartesian3(0, -R, 0),
      ]);
      viewer.camera.flyToBoundingSphere(sphere, { duration: 0 });

      storeRef.current = { viewer, Cesium, sphere };
      setCaNote(null);
    })();

    return () => {
      mounted = false;
      const s = storeRef.current;
      if (s?.viewer && !s.viewer.isDestroyed()) s.viewer.destroy();
      storeRef.current = null;
    };
  }, [items, labelsOn]);

  // Selection adornments (Earth@CA, chord, label) with toggle + explicit notes
  useEffect(() => {
    const s = storeRef.current;
    if (!s) return;
    const { viewer, Cesium } = s;
    const {
      Color,
      PolylineDashMaterialProperty,
      PolylineOutlineMaterialProperty,
      PolylineGlowMaterialProperty, // optional, if you want glow somewhere else
      Cartesian2,
      LabelStyle,
      Cartesian3,
      BoundingSphere,
    } = Cesium;

    // Clear previous selection adornments
    viewer.entities.values
      .filter((e) => String(e.id).startsWith("sel-"))
      .forEach((e) => viewer.entities.remove(e));
    setCaNote(null);

    // Re-show Earth-now by default
    const earthNowEnt = viewer.entities.getById("earth-now");
    if (earthNowEnt) earthNowEnt.show = true;

    if (!showCA) return;
    if (!selectedId) {
      setCaNote("Select a NEO in the sidebar to show closest-approach.");
      return;
    }

    const n = (items as ApproachRow[]).find((x) => x.id === selectedId);
    if (!n?.orbital_data) {
      setCaNote("Closest approach can’t be computed (no orbital data).");
      return;
    }

    const od = n.orbital_data;
    const a = Number(od.semi_major_axis);
    const e = clamp(Number(od.eccentricity), 0, 0.999);
    const iDeg = Number(od.inclination || 0);
    const Odeg = Number(od.ascending_node_longitude || 0);
    const wDeg = Number(od.perihelion_argument || 0);
    const M0 = Number(od.mean_anomaly);
    const nDegPerDay = Number(od.mean_motion);
    const epochOscJD = Number(od.epoch_osculation);
    const approachEpoch = n?.approach?.epoch;

    if (
      !Number.isFinite(a) ||
      !Number.isFinite(e) ||
      !Number.isFinite(M0) ||
      !Number.isFinite(nDegPerDay) ||
      !Number.isFinite(epochOscJD) ||
      typeof approachEpoch !== "number"
    ) {
      setCaNote(
        "Closest approach can’t be computed for this object (missing ephemeris)."
      );
      return;
    }

    const approachJD = msToJD(approachEpoch);
    const dDays = approachJD - epochOscJD;
    const M_at_CA_deg = wrapDeg(M0 + nDegPerDay * dDays);
    const E = solveE((M_at_CA_deg * Math.PI) / 180, e);
    const b = a * Math.sqrt(1 - e * e);
    const xAU = a * (Math.cos(E) - e);
    const yAU = b * Math.sin(E);

    const posNEO = rotateOrbitalToECI(Cesium, xAU, yAU, iDeg, Odeg, wDeg);
    const posEarth = earthCartesianAtJD(Cesium, approachJD);

    // Hide Earth-now, add Earth@CA
    if (earthNowEnt) earthNowEnt.show = false;
    viewer.entities.add({
      id: "sel-earth",
      name: "Earth (CA epoch)",
      position: posEarth,
      ellipsoid: {
        radii: new Cartesian3(
          EARTH_RADIUS_SCENE,
          EARTH_RADIUS_SCENE,
          EARTH_RADIUS_SCENE
        ),
        material: Color.fromCssColorString("#3b82f6"),
        outline: true,
        outlineColor: Color.fromCssColorString("#1e3a8a"),
        outlineWidth: 1,
      },
      label: labelsOn
        ? {
            text: "Earth",
            font: "12px sans-serif",
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            pixelOffset: new Cartesian2(0, -18),
            showBackground: true,
            backgroundColor: Color.fromAlpha(Color.BLACK, 0.45),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }
        : undefined,
    } as any);

    // Miss metrics
    const dX = (posNEO.x - posEarth.x) / AU_TO_SCENE;
    const dY = (posNEO.y - posEarth.y) / AU_TO_SCENE;
    const dZ = (posNEO.z - posEarth.z) / AU_TO_SCENE;
    const miss_AU = Math.sqrt(dX * dX + dY * dY + dZ * dZ);
    const miss_km = miss_AU * AU_KM;
    const miss_LD = miss_km / 384_400;

    // OPTIONAL: CA radius ring around Earth (kept, but you can remove)
    const circlePts: any[] = [];
    const Rscene = miss_AU * AU_TO_SCENE;
    for (let k = 0; k <= 256; k++) {
      const a2 = (k / 256) * Math.PI * 2;
      circlePts.push(
        new Cartesian3(
          posEarth.x + Rscene * Math.cos(a2),
          posEarth.y + Rscene * Math.sin(a2),
          posEarth.z
        )
      );
    }
    viewer.entities.add({
      id: "sel-miss-ring",
      name: "Closest-approach distance",
      polyline: {
        positions: circlePts,
        width: 1.5,
        material: new PolylineDashMaterialProperty({
          color: Color.fromCssColorString("#94a3b8").withAlpha(0.9),
          dashLength: 12,
        }),
      },
    } as any);

    // CA chord Earth → NEO (high-contrast outlined white)
    viewer.entities.add({
      id: "sel-ca-line",
      polyline: {
        positions: [posEarth, posNEO],
        width: 5,
        material: new PolylineOutlineMaterialProperty({
          color: Color.WHITE,
          outlineWidth: 2,
          outlineColor: Color.fromCssColorString("#0b0f19"),
        }),
      },
    } as any);

    // Midpoint label with distances
    const mid = new Cartesian3(
      (posEarth.x + posNEO.x) / 2,
      (posEarth.y + posNEO.y) / 2,
      (posEarth.z + posNEO.z) / 2
    );
    viewer.entities.add({
      id: "sel-ca-label",
      position: mid,
      label: {
        text: `${miss_km.toLocaleString()} km  •  ${miss_AU.toFixed(
          6
        )} AU  •  ${miss_LD.toFixed(2)} LD`,
        font: "12px sans-serif",
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cartesian2(0, -18),
        showBackground: true,
        backgroundColor: Color.fromAlpha(Color.BLACK, 0.6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    } as any);

    // Frame Earth + NEO together
    const distScene = miss_AU * AU_TO_SCENE;
    const pad = Math.max(distScene * 0.6, 1.2 * AU_TO_SCENE);
    const bbox = [
      new Cartesian3(posEarth.x + pad, posEarth.y, posEarth.z),
      new Cartesian3(posEarth.x - pad, posEarth.y, posEarth.z),
      new Cartesian3(posEarth.x, posEarth.y + pad, posEarth.z),
      new Cartesian3(posEarth.x, posEarth.y - pad, posEarth.z),
      posNEO,
    ];
    const sphere = BoundingSphere.fromPoints(bbox);
    viewer.camera.flyToBoundingSphere(sphere, { duration: 0.5 });
  }, [selectedId, items, labelsOn, showCA]);

  // Toolbar actions
  const home = () => {
    const s = storeRef.current;
    if (!s) return;
    s.viewer.camera.flyToBoundingSphere(s.sphere, { duration: 0.4 });

    // Show Earth-now, remove selection adornments
    const earthNowEnt = s.viewer.entities.getById("earth-now");
    if (earthNowEnt) earthNowEnt.show = true;
    s.viewer.entities.values
      .filter((e) => String(e.id).startsWith("sel-"))
      .forEach((e) => s.viewer.entities.remove(e));
    setCaNote(null);
  };
  const zoom = (delta: number) => {
    const s = storeRef.current;
    if (!s) return;
    if (delta < 0) s.viewer.camera.zoomOut(Math.abs(delta));
    else s.viewer.camera.zoomIn(delta);
  };

  return (
    <div className="relative h-full w-full">
      {/* Cesium mounts here and fills its parent via absolute inset-0 */}
      <div ref={holderRef} className="absolute inset-0" />

      {/* Toolbar card (top-right) */}
      <div className="pointer-events-auto absolute right-3 top-3 z-10 rounded-xl border border-white/10 bg-neutral-900/75 p-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={home}
            className="rounded-lg bg-neutral-800/80 px-2 py-1.5 text-sm text-white/90 ring-1 ring-white/10 hover:bg-neutral-700"
            title="Home"
          >
            Home
          </button>
          <button
            onClick={() => zoom(+3.0e6)}
            className="rounded-lg bg-neutral-800/80 px-2 py-1.5 text-sm text-white/90 ring-1 ring-white/10 hover:bg-neutral-700"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => zoom(-3.0e6)}
            className="rounded-lg bg-neutral-800/80 px-2 py-1.5 text-sm text-white/90 ring-1 ring-white/10 hover:bg-neutral-700"
            title="Zoom out"
          >
            −
          </button>
          <button
            onClick={() => setLabelsOn((v) => !v)}
            className="rounded-lg bg-neutral-800/80 px-2 py-1.5 text-sm text-white/90 ring-1 ring-white/10 hover:bg-neutral-700"
            title="Toggle labels"
          >
            Labels: {labelsOn ? "On" : "Off"}
          </button>
          <button
            onClick={() => setShowCA((v) => !v)}
            className="rounded-lg bg-neutral-800/80 px-2 py-1.5 text-sm text-white/90 ring-1 ring-white/10 hover:bg-neutral-700"
            title="Toggle closest-approach adornments"
          >
            CA: {showCA ? "On" : "Off"}
          </button>
        </div>
        <div className="mt-2 text-[11px] text-white/65">
          Drag = orbit • Wheel = zoom • Select a NEO in the sidebar to show CA.
        </div>
      </div>

      {/* (Optional) Legend card (bottom-left) */}
      <div className="pointer-events-none absolute left-3 bottom-3 z-10 rounded-lg border border-white/10 bg-neutral-900/70 px-3 py-2 text-[11px] text-white/80 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-[#ffdd66]" />
            Sun
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-[#3b82f6]" />
            Earth
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-fuchsia-500" />
            NEO @ CA
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            NEO orbit
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-sky-400" />1 AU ring
          </span>
        </div>
      </div>

      {/* CA note banner (top-center) */}
      {caNote && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-md bg-amber-500/90 px-3 py-1.5 text-xs text-black ring-1 ring-black/10">
          {caNote}
        </div>
      )}
    </div>
  );
}
