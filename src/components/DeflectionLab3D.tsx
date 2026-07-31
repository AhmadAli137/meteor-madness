"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Mission: Save Earth — Deflection Lab.
 *
 * Kinetic-impactor deflection: Δv = β·m·v_rel / M (momentum transfer with
 * enhancement factor β). The resulting miss distance uses the standard
 * along-track drift approximation (≈ 3·Δv·t_lead) — the same principle that
 * made NASA's DART mission effective with a tiny Δv and a long lead time.
 *
 * The 3D scene exaggerates the orbit change (Visual gain) so a mm/s-scale Δv
 * is visible at solar-system scale; the physics numbers are always true.
 */

type ImpactCarryover = {
  lat: number;
  lon: number;
  craterKm: number;
  etaISO: string;
  name: string;
  velKps?: number;
  diameterKm?: number;
  massKg?: number;
};

type ImpactorParams = {
  impactorMassKg: number;
  impactorRelSpeedKps: number;
  beta: number;
  phiDeg: number; // 0 = prograde, 180 = retrograde
  burnDays: number; // lead time before encounter
};

type AsteroidParams = {
  diameterKm: number;
  density: number; // kg/m^3
  speedKps: number; // heliocentric speed scale (used to infer e)
};

const AU_TO_SCENE = 1_000_000;
const DEG = Math.PI / 180;
const SUN_RADIUS_AU = 0.12;
const EARTH_RADIUS_AU = 0.03;
const EARTH_PERIOD_DAYS = 365.25;
const N_EARTH = (2 * Math.PI) / EARTH_PERIOD_DAYS;

// success threshold: comfortably clear of Earth (~2.4 Earth radii)
const SAFE_MISS_KM = 15_000;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function toMillis(years: number, months: number, days: number) {
  const d = years * 365.25 + months * 30 + days;
  return d * 86_400_000;
}
function earthAngleAt(daysFromStart: number) {
  return N_EARTH * daysFromStart;
}
function eccFromVel(velKps: number) {
  return clamp(((velKps - 11) / (72 - 11)) * 0.6 + 0.1, 0.05, 0.75);
}
function massFromDiameter(diameterKm: number, density = 3000) {
  const r = (diameterKm * 1000) / 2;
  return (4 / 3) * Math.PI * r * r * r * density;
}
function solveKepler(M: number, e: number) {
  let E = M;
  for (let k = 0; k < 15; k++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const step = f / fp;
    E -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  return E;
}
function posFromElements(
  aAU: number,
  e: number,
  iDeg: number,
  OmegaDeg: number,
  omegaDeg: number,
  Mdeg: number
) {
  const i = iDeg * DEG,
    O = OmegaDeg * DEG,
    w = omegaDeg * DEG;
  const cO = Math.cos(O),
    sO = Math.sin(O);
  const ci = Math.cos(i),
    si = Math.sin(i);
  const cw = Math.cos(w),
    sw = Math.sin(w);

  const R11 = cO * cw - sO * sw * ci;
  const R12 = -cO * sw - sO * cw * ci;
  const R21 = sO * cw + cO * sw * ci;
  const R22 = -sO * sw + cO * cw * ci;
  const R31 = sw * si;
  const R32 = cw * si;

  const M = Mdeg * DEG;
  const E = solveKepler(M, e);
  const cosE = Math.cos(E),
    sinE = Math.sin(E);
  const rAU = aAU * (1 - e * cosE);
  const nu = Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e);
  const xpf = rAU * Math.cos(nu),
    ypf = rAU * Math.sin(nu);
  const x = R11 * xpf + R12 * ypf;
  const y = R21 * xpf + R22 * ypf;
  const z = R31 * xpf + R32 * ypf;
  return { x: x * AU_TO_SCENE, y: y * AU_TO_SCENE, z: z * AU_TO_SCENE, nu };
}
function orbitCurvePoints(
  aAU: number,
  e: number,
  iDeg: number,
  OmegaDeg: number,
  omegaDeg: number,
  samples: number,
  Cesium: any
) {
  const { Cartesian3 } = Cesium ?? {};
  if (!Cartesian3) return [];
  const i = iDeg * DEG,
    O = OmegaDeg * DEG,
    w = omegaDeg * DEG;
  const cO = Math.cos(O),
    sO = Math.sin(O);
  const ci = Math.cos(i),
    si = Math.sin(i);
  const cw = Math.cos(w),
    sw = Math.sin(w);

  const R11 = cO * cw - sO * sw * ci;
  const R12 = -cO * sw - sO * cw * ci;
  const R21 = sO * cw + cO * sw * ci;
  const R22 = -sO * sw + cO * cw * ci;
  const R31 = sw * si;
  const R32 = cw * si;

  const pts: any[] = [];
  const N = Math.max(64, Math.min(2048, samples ?? 720));
  for (let k = 0; k <= N; k++) {
    const nu = (k / N) * 2 * Math.PI;
    const rAU = (aAU * (1 - e * e)) / (1 + e * Math.cos(nu));
    const xpf = rAU * Math.cos(nu),
      ypf = rAU * Math.sin(nu);
    const x = (R11 * xpf + R12 * ypf) * AU_TO_SCENE;
    const y = (R21 * xpf + R22 * ypf) * AU_TO_SCENE;
    const z = (R31 * xpf + R32 * ypf) * AU_TO_SCENE;
    pts.push(new Cartesian3(x, y, z));
  }
  return pts;
}

function LabSlider({
  label,
  display,
  hint,
  title,
  min,
  max,
  step,
  value,
  onChange,
  disabled,
}: {
  label: string;
  display: string;
  hint?: string;
  title?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div title={title} className={disabled ? "opacity-50" : ""}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-white/80">{label}</span>
        <span className="font-mono text-white">{display}</span>
      </div>
      <input
        type="range"
        className="mt-1 w-full accent-emerald-500"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      />
      {hint && (
        <div className="mt-0.5 text-[10px] leading-snug text-white/45">
          {hint}
        </div>
      )}
    </div>
  );
}

export default function DeflectionLab3D() {
  const carry = useMemo<ImpactCarryover | null>(() => {
    try {
      const raw = sessionStorage.getItem("mm-impact-detail");
      if (!raw) return null;
      return JSON.parse(raw) as ImpactCarryover;
    } catch {
      return null;
    }
  }, []);

  const [encounterTime, setEncounterTime] = useState({
    years: 1,
    months: 0,
    days: 0,
  });
  const msToEncounter = useMemo(
    () =>
      toMillis(encounterTime.years, encounterTime.months, encounterTime.days),
    [encounterTime]
  );

  const [asteroid, setAsteroid] = useState<AsteroidParams>(() => ({
    diameterKm: carry?.diameterKm ?? 1,
    density: 3000,
    speedKps: carry?.velKps ?? 20,
  }));

  const [useCarry, setUseCarry] = useState<boolean>(!!carry);

  const [I, setI] = useState<ImpactorParams>({
    impactorMassKg: 5e5,
    impactorRelSpeedKps: 10,
    beta: 2.0,
    phiDeg: 15,
    burnDays: 180,
  });

  // Visual exaggeration exponent: orbits drawn with Δa scaled by 10^x
  const [visExp, setVisExp] = useState<number>(5);

  const massAstKg = useMemo(
    () =>
      useCarry && carry?.massKg
        ? carry.massKg
        : massFromDiameter(asteroid.diameterKm, asteroid.density),
    [useCarry, carry?.massKg, asteroid.diameterKm, asteroid.density]
  );

  // Kinetic impactor momentum transfer: Δv = β·m·v_rel / M
  const deltaV_true_kps = useMemo(
    () =>
      (I.beta * I.impactorMassKg * I.impactorRelSpeedKps) /
      Math.max(1, massAstKg),
    [I.beta, I.impactorMassKg, I.impactorRelSpeedKps, massAstKg]
  );

  const deltaV_tangent_kps = useMemo(
    () => deltaV_true_kps * Math.cos(I.phiDeg * DEG),
    [deltaV_true_kps, I.phiDeg]
  );

  // TRUE miss distance from along-track drift: Δs ≈ 3·Δv·t_lead.
  // Independent of the visual exaggeration below.
  const missKm = useMemo(() => {
    const dv_mps = Math.abs(deltaV_tangent_kps) * 1000;
    const t_s = clamp(I.burnDays, 0, 36500) * 86400;
    return (3 * dv_mps * t_s) / 1000;
  }, [deltaV_tangent_kps, I.burnDays]);

  const holderRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const ents = useRef<{
    sun?: any;
    earth?: any;
    earthOrbit?: any;
    rockOrig?: any;
    rockNew?: any;
    orbitOrig?: any;
    orbitNew?: any;
    earthAtT?: any;
    impulseVec?: any;
    impactor?: any;
    impactorPath?: any;
    burnFlash?: any;
    rockGhost?: any;
  }>({});

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  // Sim epoch of the intercept burn — drives the auto slow-mo around it
  const burnRef = useRef<{ burnJD: any; windowSec: number } | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [simProg, setSimProg] = useState<{ date: string; frac: number }>({
    date: "—",
    frac: 0,
  });

  const [resultOpen, setResultOpen] = useState(false);
  const [resultSuccess, setResultSuccess] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const Cesium = await import("cesium");
      (window as any).CESIUM_BASE_URL = "/cesium";

      const { Viewer, Color, Cartesian3, Cartesian2, LabelStyle } = Cesium;

      if (!holderRef.current || viewerRef.current) return;

      const creditDiv = document.createElement("div");
      creditDiv.style.display = "none";

      const viewer = new Viewer(holderRef.current, {
        animation: false,
        timeline: false,
        homeButton: true,
        sceneModePicker: true,
        baseLayerPicker: false,
        navigationHelpButton: true,
        fullscreenButton: false,
        geocoder: false,
        creditContainer: creditDiv,
        // globe is hidden — skip the default Ion imagery layer entirely
        baseLayer: false,
      } as any);

      viewer.scene.requestRenderMode = true;
      viewer.scene.globe.show = false;
      (viewer.scene as any).skyAtmosphere = undefined;
      (viewer.scene as any).skyBox = undefined;
      // Cesium renders the real Sun/Moon by default — at accelerated sim time
      // they whip around the scene as bright distracting balls
      try {
        (viewer.scene as any).sun.show = false;
      } catch {}
      try {
        (viewer.scene as any).moon.show = false;
      } catch {}
      viewer.scene.backgroundColor = Color.fromCssColorString("#0b0f19");
      (viewer.cesiumWidget.creditContainer as HTMLElement).style.display =
        "none";

      // Default wheel zoom is unusable here: the whole scene (1 AU = 1e6 m)
      // sits inside the WGS84 ellipsoid Cesium bases its zoom rate on.
      // Replace it with simple distance-from-origin zoom.
      viewer.scene.screenSpaceCameraController.enableZoom = false;
      const canvas = viewer.scene.canvas as HTMLCanvasElement;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const cam = viewer.camera;
        const dist = Cartesian3.magnitude(cam.position);
        const factor = e.deltaY < 0 ? 0.85 : 1.18;
        const next = clamp(dist * factor, 0.25 * AU_TO_SCENE, 15 * AU_TO_SCENE);
        const dir = Cartesian3.normalize(cam.position, new Cartesian3());
        cam.position = Cartesian3.multiplyByScalar(
          dir,
          next,
          new Cartesian3()
        );
        viewer.scene.requestRender();
      };
      canvas.addEventListener("wheel", onWheel, { passive: false });

      viewer.homeButton.viewModel.command.beforeExecute.addEventListener(
        (e: any) => {
          e.cancel = true;
          viewer.camera.flyTo({
            destination: new Cartesian3(0, 0, 3.4 * AU_TO_SCENE),
            duration: 0.6,
          });
        }
      );

      ents.current.sun = viewer.entities.add({
        name: "Sun",
        position: Cartesian3.ZERO,
        ellipsoid: {
          radii: new Cartesian3(
            SUN_RADIUS_AU * AU_TO_SCENE,
            SUN_RADIUS_AU * AU_TO_SCENE,
            SUN_RADIUS_AU * AU_TO_SCENE
          ),
          material: Color.fromCssColorString("#ffdd66"),
        } as any,
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
        },
      });

      const circlePts = Array.from({ length: 360 }, (_, k) => {
        const a = (k / 360) * 2 * Math.PI;
        return new Cartesian3(
          Math.cos(a) * AU_TO_SCENE,
          Math.sin(a) * AU_TO_SCENE,
          0
        );
      });
      ents.current.earthOrbit = viewer.entities.add({
        name: "Earth Orbit",
        polyline: {
          positions: circlePts,
          width: 1.3,
          material: Color.CYAN.withAlpha(0.45),
        },
      });

      ents.current.earth = viewer.entities.add({
        name: "Earth",
        position: Cartesian3.fromElements(AU_TO_SCENE, 0, 0),
        // Billboard, not ellipsoid: Cesium's dynamic-geometry path (needed
        // for the animated position) drops image materials on ellipsoids
        billboard: {
          image: "/planets/earth.png",
          sizeInMeters: true,
          width: EARTH_RADIUS_AU * AU_TO_SCENE * 2,
          height: EARTH_RADIUS_AU * AU_TO_SCENE * 2,
        } as any,
        label: {
          text: "Earth",
          font: "12px sans-serif",
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          pixelOffset: new Cartesian2(0, -20),
          showBackground: true,
          backgroundColor: Color.fromAlpha(Color.BLACK, 0.45),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      viewer.camera.setView({
        destination: new Cartesian3(0, 0, 3.4 * AU_TO_SCENE),
      });
      viewer.clock.multiplier = 86400;
      viewer.clock.shouldAnimate = false;

      const keepRendering = () => viewer.scene.requestRender();
      viewer.clock.onTick.addEventListener(keepRendering);

      // Throttled mirror of the sim clock into React (drives the scrubber)
      let lastUi = 0;
      const uiTick = () => {
        const nowMs = performance.now();
        if (nowMs - lastUi < 200) return;
        lastUi = nowMs;
        const c = viewer.clock;
        const total = Cesium.JulianDate.secondsDifference(
          c.stopTime,
          c.startTime
        );
        const cur = Cesium.JulianDate.secondsDifference(
          c.currentTime,
          c.startTime
        );
        const frac = total > 0 ? clamp(cur / total, 0, 1) : 0;
        setSimProg({
          date: Cesium.JulianDate.toDate(c.currentTime)
            .toISOString()
            .slice(0, 10),
          frac,
        });
      };
      viewer.clock.onTick.addEventListener(uiTick);

      // Bullet-time around the intercept burn: when playing fast, slow the
      // clock while the sim passes the burn so the deflection is readable
      const slowmo = () => {
        const info = burnRef.current;
        if (!info || !viewer.clock.shouldAnimate) return;
        const base = speedRef.current * 86400;
        if (speedRef.current <= 2) {
          viewer.clock.multiplier = base;
          return;
        }
        const dt = Math.abs(
          Cesium.JulianDate.secondsDifference(
            viewer.clock.currentTime,
            info.burnJD
          )
        );
        viewer.clock.multiplier =
          dt < info.windowSec ? Math.max(base * 0.15, 0.5 * 86400) : base;
      };
      viewer.clock.onTick.addEventListener(slowmo);

      viewerRef.current = {
        viewer,
        Cesium,
        keepRendering,
        uiTick,
        slowmo,
        canvas,
        onWheel,
      };
      setViewerReady(true);
    })();

    return () => {
      const store = viewerRef.current;
      if (!store) return;
      try {
        store.canvas?.removeEventListener("wheel", store.onWheel);
        store.viewer.clock.onTick.removeEventListener(store.keepRendering);
        store.viewer.clock.onTick.removeEventListener(store.uiTick);
        store.viewer.clock.onTick.removeEventListener(store.slowmo);
        store.viewer.destroy();
      } catch {}
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function scrubTo(frac: number) {
    const store = viewerRef.current;
    if (!store) return;
    const { viewer, Cesium } = store;
    const total = Cesium.JulianDate.secondsDifference(
      viewer.clock.stopTime,
      viewer.clock.startTime
    );
    viewer.clock.currentTime = Cesium.JulianDate.addSeconds(
      viewer.clock.startTime,
      frac * total,
      new Cesium.JulianDate()
    );
    viewer.scene.requestRender();
  }

  useEffect(() => {
    speedRef.current = speed;
    const v = viewerRef.current?.viewer;
    if (!v) return;
    v.clock.multiplier = speed * 86400;
    v.clock.shouldAnimate = playing;
  }, [speed, playing]);

  // (Re)build the scene whenever inputs change
  useEffect(() => {
    const store = viewerRef.current;
    if (!store) return;
    const { viewer, Cesium } = store;
    const {
      Cartesian3,
      Cartesian2,
      Color,
      JulianDate,
      SampledPositionProperty,
      LabelStyle,
      Math: CMath,
      HeadingPitchRange,
      BoundingSphere,
      ClockRange,
      PolylineGlowMaterialProperty,
      PolylineDashMaterialProperty,
      TimeInterval,
      TimeIntervalCollection,
    } = Cesium;

    // Entity availability helper (sim-time window an entity exists in)
    const avail = (a: any, b: any) =>
      new TimeIntervalCollection([new TimeInterval({ start: a, stop: b })]);

    // Glowing trail behind a moving body — makes the animation readable
    const trail = (color: any, widthPx = 7, alpha = 0.85) => ({
      resolution: Math.max(3600, msToEncounter / 1000 / 600),
      width: widthPx,
      leadTime: 0,
      trailTime: (msToEncounter / 1000) * 0.3,
      material: new PolylineGlowMaterialProperty({
        glowPower: 0.25,
        color: color.withAlpha(alpha),
      }),
    });

    const rm = (x: any) => {
      try {
        if (x) viewer.entities.remove(x);
      } catch {}
    };
    rm(ents.current.rockOrig);
    rm(ents.current.rockNew);
    rm(ents.current.orbitOrig);
    rm(ents.current.orbitNew);
    rm(ents.current.earthAtT);
    rm(ents.current.impulseVec);
    rm(ents.current.impactor);
    rm(ents.current.impactorPath);
    rm(ents.current.burnFlash);
    rm(ents.current.rockGhost);
    ents.current.rockOrig =
      ents.current.rockNew =
      ents.current.orbitOrig =
      ents.current.orbitNew =
      ents.current.earthAtT =
      ents.current.impulseVec =
      ents.current.impactor =
      ents.current.impactorPath =
      ents.current.burnFlash =
      ents.current.rockGhost =
        undefined;

    const start = JulianDate.now();
    const stop = JulianDate.addSeconds(
      start,
      msToEncounter / 1000,
      new JulianDate()
    );
    const totalDays = Math.max(
      1 / 24,
      JulianDate.secondsDifference(stop, start) / 86400
    );
    const burnDays = clamp(I.burnDays, 0, totalDays - 1e-3);
    const tBurn = JulianDate.addDays(
      start,
      totalDays - burnDays,
      new JulianDate()
    );

    viewer.clock.startTime = start.clone();
    viewer.clock.currentTime = start.clone();
    viewer.clock.stopTime = stop.clone();
    viewer.clock.clockRange = ClockRange.CLAMPED;
    viewer.clock.shouldAnimate = false;

    const earthPos = new SampledPositionProperty();
    const earthN = 576;
    for (let i = 0; i <= earthN; i++) {
      const t = JulianDate.addSeconds(
        start,
        (i / earthN) * (msToEncounter / 1000),
        new JulianDate()
      );
      const d = JulianDate.secondsDifference(t, start) / 86400;
      const th = earthAngleAt(d);
      earthPos.addSample(
        t,
        new Cartesian3(
          Math.cos(th) * AU_TO_SCENE,
          Math.sin(th) * AU_TO_SCENE,
          0
        )
      );
    }
    if (ents.current.earth) ents.current.earth.position = earthPos;

    // original orbit sizing
    const thetaImpact = earthAngleAt(totalDays);
    const e0 = eccFromVel(asteroid.speedKps);
    const a0AU = (1 * (1 + e0 * Math.cos(thetaImpact))) / (1 - e0 * e0);
    const n0 = N_EARTH / Math.pow(a0AU, 1.5);

    const s = Math.sqrt((1 - e0) / (1 + e0));
    const tanE2 = Math.tan(thetaImpact / 2) * s;
    const Eimp = 2 * Math.atan(tanE2);
    const Mimp = Eimp - e0 * Math.sin(Eimp);
    const M0deg = ((Mimp - n0 * totalDays) * 180) / Math.PI;

    // Original path
    const posOrig = new SampledPositionProperty();
    const rockN = 900;
    for (let i = 0; i <= rockN; i++) {
      const t = JulianDate.addSeconds(
        start,
        (i / rockN) * (msToEncounter / 1000),
        new JulianDate()
      );
      const d = JulianDate.secondsDifference(t, start) / 86400;
      const Mdeg = M0deg + ((n0 * 180) / Math.PI) * d;
      const p0 = posFromElements(a0AU, e0, 0, 0, 0, Mdeg);
      posOrig.addSample(t, new Cartesian3(p0.x, p0.y, p0.z));
    }
    // Before the burn: the one real asteroid, vivid magenta
    ents.current.rockOrig = viewer.entities.add({
      name: "Asteroid",
      availability: avail(start, tBurn),
      position: posOrig,
      point: {
        pixelSize: 9,
        color: Color.MAGENTA,
        outlineColor: Color.BLACK,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      path: trail(Color.MAGENTA) as any,
      label: {
        text: "asteroid",
        font: "11px sans-serif",
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        pixelOffset: new Cartesian2(0, -16),
        showBackground: true,
        backgroundColor: Color.fromAlpha(Color.BLACK, 0.45),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // After the burn: a translucent ghost continues on the undeflected
    // course toward the predicted impact, so the divergence is obvious
    ents.current.rockGhost = viewer.entities.add({
      name: "Asteroid (ghost, no deflection)",
      availability: avail(tBurn, stop),
      position: posOrig,
      point: {
        pixelSize: 7,
        color: Color.MAGENTA.withAlpha(0.35),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      path: trail(Color.MAGENTA, 4, 0.3) as any,
      label: {
        text: "ghost — if not deflected",
        font: "10px sans-serif",
        fillColor: Color.MAGENTA.withAlpha(0.7),
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    const orbit0Pts = orbitCurvePoints(a0AU, e0, 0, 0, 0, 1024, Cesium);
    ents.current.orbitOrig = viewer.entities.add({
      polyline: {
        positions: orbit0Pts,
        width: 1.2,
        material: new PolylineDashMaterialProperty({
          color: Color.MAGENTA.withAlpha(0.35),
          dashLength: 16,
        }),
      },
    });

    // Deflected orbit — Δa/a from true Δv, exaggerated by 10^visExp for
    // visibility (the physics readouts never use this).
    const frac_true = (2 * deltaV_tangent_kps) / Math.max(0.1, asteroid.speedKps);
    const frac_vis = clamp(frac_true * Math.pow(10, visExp), -0.5, 0.5);

    const a1AU = a0AU * (1 + frac_vis);
    const e1 = clamp(e0, 0.01, 0.95);
    const n1 = N_EARTH / Math.pow(a1AU, 1.5);

    const dBurn = JulianDate.secondsDifference(tBurn, start) / 86400;
    const Mdeg_burn = M0deg + ((n0 * 180) / Math.PI) * dBurn;
    const pBurn = posFromElements(a0AU, e0, 0, 0, 0, Mdeg_burn);
    const nuBurn = pBurn.nu;
    const E1 =
      2 * Math.atan(Math.tan(nuBurn / 2) * Math.sqrt((1 - e1) / (1 + e1)));
    const M1_burn = E1 - e1 * Math.sin(E1);
    const M0deg1 = (M1_burn * 180) / Math.PI - ((n1 * 180) / Math.PI) * dBurn;

    const posNew = new SampledPositionProperty();
    for (let i = 0; i <= rockN; i++) {
      const t = JulianDate.addSeconds(
        start,
        (i / rockN) * (msToEncounter / 1000),
        new JulianDate()
      );
      const d = JulianDate.secondsDifference(t, start) / 86400;
      if (Cesium.JulianDate.lessThanOrEquals(t, tBurn)) {
        const Mdeg = M0deg + ((n0 * 180) / Math.PI) * d;
        const pp = posFromElements(a0AU, e0, 0, 0, 0, Mdeg);
        posNew.addSample(t, new Cartesian3(pp.x, pp.y, pp.z));
      } else {
        const Mdeg = M0deg1 + ((n1 * 180) / Math.PI) * d;
        const pp = posFromElements(a1AU, e1, 0, 0, 0, Mdeg);
        posNew.addSample(t, new Cartesian3(pp.x, pp.y, pp.z));
      }
    }
    ents.current.rockNew = viewer.entities.add({
      name: "Asteroid (deflected)",
      // The deflected track only exists once the interceptor has hit —
      // before the burn there is just one asteroid
      availability: avail(tBurn, stop),
      position: posNew,
      point: {
        pixelSize: 9,
        color: Color.LIME,
        outlineColor: Color.BLACK,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      path: trail(Color.LIME) as any,
      label: {
        text: "deflected",
        font: "11px sans-serif",
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        pixelOffset: new Cartesian2(0, -16),
        showBackground: true,
        backgroundColor: Color.fromAlpha(Color.BLACK, 0.45),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    const orbit1Pts = orbitCurvePoints(a1AU, e1, 0, 0, 0, 1024, Cesium);
    ents.current.orbitNew = viewer.entities.add({
      polyline: {
        positions: orbit1Pts,
        width: 1.2,
        material: new PolylineDashMaterialProperty({
          color: Color.LIME.withAlpha(0.4),
          dashLength: 16,
        }),
      },
    });

    // Predicted impact point (where the undeflected asteroid meets Earth)
    ents.current.earthAtT = viewer.entities.add({
      position: new Cartesian3(
        Math.cos(thetaImpact) * AU_TO_SCENE,
        Math.sin(thetaImpact) * AU_TO_SCENE,
        0
      ),
      label: {
        text: "✖ predicted impact",
        font: "bold 13px sans-serif",
        fillColor: Color.fromCssColorString("#fb7185"),
        outlineColor: Color.BLACK,
        outlineWidth: 4,
        pixelOffset: new Cartesian2(0, 24),
        showBackground: true,
        backgroundColor: Color.fromAlpha(Color.BLACK, 0.55),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // impulse vector & impactor approach line
    const burnPos = new Cartesian3(pBurn.x, pBurn.y, pBurn.z);
    const eps = 0.02 * AU_TO_SCENE;
    const tangent = new Cartesian3(-pBurn.y, pBurn.x, 0);
    const tlen = Math.hypot(tangent.x, tangent.y, tangent.z) || 1;
    const sign = Math.sign(Math.cos(I.phiDeg * DEG)) || 1;
    const tx = (tangent.x / tlen) * eps * sign;
    const ty = (tangent.y / tlen) * eps * sign;
    const tip = new Cartesian3(pBurn.x + tx, pBurn.y + ty, pBurn.z);
    ents.current.impulseVec = viewer.entities.add({
      availability: avail(tBurn, stop),
      polyline: {
        positions: [burnPos, tip],
        width: 3,
        material: Color.YELLOW.withAlpha(0.9),
      },
    });

    // Intercept flash — appears the moment the interceptor hits
    const flashStop = JulianDate.addDays(tBurn, 8, new JulianDate());
    ents.current.burnFlash = viewer.entities.add({
      availability: avail(tBurn, flashStop),
      position: burnPos,
      label: {
        text: "💥 intercept!",
        font: "bold 15px sans-serif",
        fillColor: Color.YELLOW,
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.BLACK,
        outlineWidth: 4,
        pixelOffset: new Cartesian2(0, -20),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // Tell the clock where the burn is so playback slows around it
    burnRef.current = { burnJD: tBurn.clone(), windowSec: 4 * 86400 };

    // Launch the interceptor from Earth's position at mission start — keeps
    // it in the camera frame and tells the right story
    const startVec = new Cartesian3(AU_TO_SCENE, 0, 0);
    const impactorPos = new SampledPositionProperty();
    impactorPos.addSample(start, startVec);
    impactorPos.addSample(tBurn, burnPos);
    ents.current.impactorPath = viewer.entities.add({
      polyline: {
        positions: [startVec, burnPos],
        width: 1,
        material: new PolylineDashMaterialProperty({
          color: Color.YELLOW.withAlpha(0.35),
          dashLength: 12,
        }),
      },
    });
    ents.current.impactor = viewer.entities.add({
      name: "Interceptor",
      // the interceptor is destroyed at the burn
      availability: avail(start, tBurn),
      position: impactorPos,
      point: {
        pixelSize: 7,
        color: Color.YELLOW,
        outlineColor: Color.BLACK,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      path: trail(Color.YELLOW, 5) as any,
      label: {
        text: "🚀 interceptor",
        font: "11px sans-serif",
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cartesian2(0, -34),
        showBackground: true,
        backgroundColor: Color.fromAlpha(Color.BLACK, 0.45),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // Frame camera
    const maxAU = Math.max(1, a0AU * (1 + e0), a1AU * (1 + e1));
    const sphere = BoundingSphere.fromPoints([
      new Cartesian3(maxAU * AU_TO_SCENE, 0, 0),
      new Cartesian3(-maxAU * AU_TO_SCENE, 0, 0),
      new Cartesian3(0, maxAU * AU_TO_SCENE, 0),
      new Cartesian3(0, -maxAU * AU_TO_SCENE, 0),
    ]);
    const offset = new HeadingPitchRange(
      CMath.toRadians(22),
      -CMath.toRadians(28),
      sphere.radius * 2.3
    );
    viewer.camera.flyToBoundingSphere(sphere, { offset, duration: 0 });
    // The control panel covers the left ~30% of the screen — slide the
    // camera left so the orbit system sits in the open space to the right
    viewer.camera.moveLeft(sphere.radius * 0.3);

    viewer.scene.requestRender();
  }, [
    asteroid.speedKps,
    asteroid.diameterKm,
    asteroid.density,
    I.impactorMassKg,
    I.impactorRelSpeedKps,
    I.beta,
    I.phiDeg,
    I.burnDays,
    msToEncounter,
    visExp,
    deltaV_tangent_kps,
    viewerReady,
  ]);

  function evaluateMission() {
    if (!Number.isFinite(missKm)) return;
    setResultSuccess(missKm >= SAFE_MISS_KM);
    setResultOpen(true);
  }

  const disableAsteroid = useCarry && !!carry;

  // Mission status derived from the true miss distance
  const EARTH_RADIUS_KM = 6371;
  const status: "hit" | "close" | "safe" =
    missKm >= SAFE_MISS_KM
      ? "safe"
      : missKm >= EARTH_RADIUS_KM
        ? "close"
        : "hit";
  const statusText = {
    hit: "☄ DIRECT HIT",
    close: "⚠ TOO CLOSE",
    safe: "✓ EARTH IS SAFE",
  }[status];
  const statusMsg = {
    hit: "The asteroid still strikes Earth. Push harder or strike earlier.",
    close: "Deflected — but inside the safety margin. Almost there.",
    safe: "The asteroid misses comfortably. Mission parameters look good.",
  }[status];
  const statusTextColor = {
    hit: "text-rose-400",
    close: "text-amber-300",
    safe: "text-emerald-400",
  }[status];
  const statusBarColor = {
    hit: "bg-rose-500",
    close: "bg-amber-400",
    safe: "bg-emerald-500",
  }[status];
  const statusChip = {
    hit: "bg-rose-900/70 text-rose-200 ring-rose-500/50",
    close: "bg-amber-900/70 text-amber-200 ring-amber-500/50",
    safe: "bg-emerald-900/70 text-emerald-200 ring-emerald-500/50",
  }[status];
  // bar scaled so the success threshold sits at 75% of its width
  const barPct = Math.min(100, (missKm / (SAFE_MISS_KM / 0.75)) * 100);

  const leadDisplay = `${I.burnDays.toLocaleString()} d${
    I.burnDays >= 365 ? ` ≈ ${(I.burnDays / 365.25).toFixed(1)} y` : ""
  }`;

  return (
    <div className="relative h-full min-h-[560px] w-full overflow-hidden">
      <div ref={holderRef} className="absolute inset-0" />

      <div className="absolute top-3 left-3 z-10 max-h-[calc(100%-24px)] w-[440px] max-w-[92vw] overflow-y-auto rounded-xl bg-black/70 ring-1 ring-white/10 backdrop-blur">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
          <div className="text-sm font-semibold">🛡 Mission: Save Earth</div>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${statusChip}`}
          >
            {statusText}
          </span>
        </div>

        {/* Live miss-distance gauge */}
        <div className="border-b border-white/10 px-4 py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-widest text-white/50">
              Predicted miss distance
            </span>
            <span className="text-[10px] text-white/50">
              goal ≥ {SAFE_MISS_KM.toLocaleString()} km
            </span>
          </div>
          <div
            className={`mt-0.5 text-3xl font-bold tabular-nums ${statusTextColor}`}
          >
            {Math.round(missKm).toLocaleString()}{" "}
            <span className="text-base font-medium text-white/60">km</span>
          </div>
          <div className="relative mt-2 h-2.5 rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-300 ${statusBarColor}`}
              style={{ width: `${barPct}%` }}
            />
            <div
              className="absolute -bottom-[3px] -top-[3px] w-[2px] rounded bg-white/70"
              style={{ left: "75%" }}
              title={`Success threshold: ${SAFE_MISS_KM.toLocaleString()} km`}
            />
          </div>
          <div className={`mt-1.5 text-[11px] ${statusTextColor}`}>
            {statusMsg}
          </div>
        </div>

        {/* The threat */}
        <div className="border-b border-white/10 px-4 py-3">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-white/50">
            The threat
          </div>

          {carry && useCarry ? (
            <div className="flex items-center justify-between rounded-lg bg-neutral-800/70 px-3 py-2 ring-1 ring-white/10">
              <div className="text-xs">
                <div className="font-mono text-rose-300">{carry.name}</div>
                <div className="mt-0.5 text-white/60">
                  Ø {carry.diameterKm ?? "?"} km • {carry.velKps ?? "?"} km/s •{" "}
                  {massAstKg.toExponential(1)} kg
                </div>
              </div>
              <button
                className="rounded bg-neutral-700 px-2 py-1 text-[11px] hover:bg-neutral-600"
                onClick={() => setUseCarry(false)}
              >
                Customize
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {carry && (
                <button
                  className="text-[11px] text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
                  onClick={() => setUseCarry(true)}
                >
                  ← Use {carry.name} from the Impactor Lab
                </button>
              )}
              <LabSlider
                label="Asteroid diameter"
                display={`${asteroid.diameterKm.toFixed(2)} km`}
                min={0.05}
                max={20}
                step={0.05}
                value={asteroid.diameterKm}
                onChange={(v) =>
                  setAsteroid((s) => ({ ...s, diameterKm: v }))
                }
              />
              <LabSlider
                label="Density"
                title="~1500 kg/m³ rubble pile, ~3000 stony, ~8000 iron"
                display={`${asteroid.density} kg/m³`}
                min={1000}
                max={8000}
                step={100}
                value={asteroid.density}
                onChange={(v) => setAsteroid((s) => ({ ...s, density: v }))}
              />
              <LabSlider
                label="Orbital speed"
                display={`${asteroid.speedKps} km/s`}
                min={11}
                max={72}
                step={1}
                value={asteroid.speedKps}
                onChange={(v) => setAsteroid((s) => ({ ...s, speedKps: v }))}
              />
            </div>
          )}

          <div className="mt-2.5 flex items-center gap-2 text-xs">
            <span className="text-white/70">Hits Earth in</span>
            <input
              type="number"
              className="w-14 rounded bg-neutral-800/70 px-2 py-1 text-center"
              min={0}
              max={20}
              value={encounterTime.years}
              onChange={(e) =>
                setEncounterTime((s) => ({
                  ...s,
                  years: clamp(Number(e.target.value) || 0, 0, 20),
                }))
              }
            />
            <span className="text-white/50">y</span>
            <input
              type="number"
              className="w-14 rounded bg-neutral-800/70 px-2 py-1 text-center"
              min={0}
              max={11}
              value={encounterTime.months}
              onChange={(e) =>
                setEncounterTime((s) => ({
                  ...s,
                  months: clamp(Number(e.target.value) || 0, 0, 11),
                }))
              }
            />
            <span className="text-white/50">m</span>
            <input
              type="number"
              className="w-14 rounded bg-neutral-800/70 px-2 py-1 text-center"
              min={0}
              max={30}
              value={encounterTime.days}
              onChange={(e) =>
                setEncounterTime((s) => ({
                  ...s,
                  days: clamp(Number(e.target.value) || 0, 0, 30),
                }))
              }
            />
            <span className="text-white/50">d</span>
          </div>
        </div>

        {/* Your mission */}
        <div className="border-b border-white/10 px-4 py-3">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-white/50">
            Your mission — kinetic impactor
          </div>
          <div className="space-y-2.5">
            <LabSlider
              label="Strike early — lead time"
              hint="More lead time = more drift from the same nudge. Early detection wins."
              display={leadDisplay}
              min={0}
              max={3650}
              step={5}
              value={I.burnDays}
              onChange={(v) => setI((s) => ({ ...s, burnDays: v }))}
            />
            <LabSlider
              label="Impactor mass"
              title="DART was ~570 kg; heavy-lift missions could deliver a few tonnes."
              display={`${(I.impactorMassKg / 1000).toLocaleString(undefined, {
                maximumFractionDigits: 1,
              })} t`}
              min={500}
              max={1e7}
              step={500}
              value={I.impactorMassKg}
              onChange={(v) => setI((s) => ({ ...s, impactorMassKg: v }))}
            />
            <LabSlider
              label="Impact speed (relative)"
              display={`${I.impactorRelSpeedKps} km/s`}
              min={1}
              max={30}
              step={0.5}
              value={I.impactorRelSpeedKps}
              onChange={(v) =>
                setI((s) => ({ ...s, impactorRelSpeedKps: v }))
              }
            />
            <LabSlider
              label="Aim — push direction φ"
              hint="0° pushes along the orbit (most effective); 90° wastes the shot."
              display={`${I.phiDeg}°`}
              min={0}
              max={180}
              step={5}
              value={I.phiDeg}
              onChange={(v) => setI((s) => ({ ...s, phiDeg: v }))}
            />
          </div>

          {/* Advanced */}
          <details className="mt-2.5 rounded-lg bg-neutral-900/60 ring-1 ring-white/10">
            <summary className="cursor-pointer select-none px-3 py-1.5 text-[11px] text-white/60 hover:text-white/80">
              Advanced (β, visual gain)
            </summary>
            <div className="space-y-2.5 px-3 pb-3 pt-1">
              <LabSlider
                label="Momentum factor β"
                title="Momentum enhancement from impact ejecta. DART measured β ≈ 2.2–4.9 at Dimorphos."
                display={I.beta.toFixed(1)}
                min={1}
                max={5}
                step={0.1}
                value={I.beta}
                onChange={(v) => setI((s) => ({ ...s, beta: v }))}
              />
              <LabSlider
                label="Visual gain (cosmetic)"
                hint="Exaggerates the drawn orbit change only — never the physics numbers."
                display={`10^${visExp.toFixed(1)}`}
                min={0}
                max={7}
                step={0.5}
                value={visExp}
                onChange={setVisExp}
              />
            </div>
          </details>
        </div>

        {/* Actions */}
        <div className="space-y-2 px-4 py-3">
          <button
            className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold ring-1 ring-emerald-400 hover:bg-emerald-500"
            onClick={evaluateMission}
          >
            🚀 Evaluate Mission
          </button>
          {/* Sim transport: play, scrubber, date */}
          <div className="flex items-center gap-2 text-xs">
            <button
              className="shrink-0 rounded bg-sky-800/80 px-3 py-1 ring-1 ring-sky-500/40 hover:bg-sky-700"
              onClick={() => setPlaying((v) => !v)}
            >
              {playing ? "⏸ Pause" : "▶ Play"}
            </button>
            <input
              type="range"
              className="min-w-0 flex-1 accent-emerald-500"
              min={0}
              max={1000}
              step={1}
              value={Math.round(simProg.frac * 1000)}
              onChange={(e) => scrubTo(Number(e.target.value) / 1000)}
              title="Scrub the simulation"
            />
            <span className="shrink-0 font-mono text-[10px] text-white/60">
              {simProg.date}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[10px] text-white/50">Speed</span>
            <input
              type="range"
              className="w-24 accent-sky-400"
              min={0.2}
              max={20}
              step={0.2}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              title="Simulation speed"
            />
            <span className="w-10 text-white/60">{speed.toFixed(1)}×</span>
            <span className="ml-auto text-[11px] text-white/50">
              Δv ≈ {(deltaV_true_kps * 1e6).toFixed(2)} mm/s
            </span>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/60">
            <span>
              <span className="text-fuchsia-400">●</span> asteroid / ghost if
              not deflected
            </span>
            <span>
              <span className="text-lime-400">●</span> deflected
            </span>
            <span>
              <span className="text-cyan-300">●</span> Earth
            </span>
            <span>
              <span className="text-yellow-300">●</span> interceptor
            </span>
            <span>
              <span className="text-rose-400">✖</span> predicted impact
            </span>
          </div>
          <div className="text-[10px] leading-relaxed text-white/45">
            Orbit change is visually exaggerated; the miss distance always uses
            the true Δv (along-track drift ≈ 3·Δv·t — the DART principle).
          </div>
        </div>
      </div>

      {resultOpen && resultSuccess !== null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setResultOpen(false)}
          />
          <div
            className={`relative z-10 w-[440px] max-w-[92vw] space-y-4 rounded-2xl bg-neutral-900 p-6 text-center ring-2 ${
              resultSuccess ? "ring-emerald-500/60" : "ring-rose-500/60"
            }`}
          >
            <div className="text-5xl">{resultSuccess ? "🌍✅" : "☄️💥"}</div>
            <div
              className={`text-2xl font-bold ${
                resultSuccess ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {resultSuccess ? "Earth is Safe!" : "Impact Not Averted"}
            </div>

            <div
              className={`text-3xl font-bold tabular-nums ${
                resultSuccess ? "text-emerald-300" : "text-rose-300"
              }`}
            >
              {Math.round(missKm).toLocaleString()}{" "}
              <span className="text-base font-medium text-white/60">
                km miss distance
              </span>
            </div>
            <div className="text-xs text-white/50">
              success threshold {SAFE_MISS_KM.toLocaleString()} km
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg bg-neutral-800/70 px-2 py-2 ring-1 ring-white/10">
                <div className="text-white/50">Δv delivered</div>
                <div className="mt-0.5 font-mono text-white">
                  {(deltaV_true_kps * 1e6).toFixed(2)} mm/s
                </div>
              </div>
              <div className="rounded-lg bg-neutral-800/70 px-2 py-2 ring-1 ring-white/10">
                <div className="text-white/50">Lead time</div>
                <div className="mt-0.5 font-mono text-white">
                  {I.burnDays.toLocaleString()} d
                </div>
              </div>
              <div className="rounded-lg bg-neutral-800/70 px-2 py-2 ring-1 ring-white/10">
                <div className="text-white/50">β</div>
                <div className="mt-0.5 font-mono text-white">
                  {I.beta.toFixed(1)}
                </div>
              </div>
            </div>

            {!resultSuccess && (
              <div className="rounded-lg bg-rose-950/40 px-3 py-2 text-left text-xs leading-relaxed text-rose-100/80 ring-1 ring-rose-500/30">
                <span className="font-semibold">Mission debrief:</span> strike
                earlier (more lead time), send a heavier or faster impactor, or
                aim closer to prograde (φ → 0°). Small nudges succeed when they
                come early — that&apos;s the DART lesson.
              </div>
            )}

            <div className="flex justify-center gap-2 pt-1">
              <button
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                  resultSuccess
                    ? "bg-emerald-600 ring-1 ring-emerald-400 hover:bg-emerald-500"
                    : "bg-rose-600 ring-1 ring-rose-400 hover:bg-rose-500"
                }`}
                onClick={() => setResultOpen(false)}
              >
                {resultSuccess ? "Debrief complete" : "Adjust & retry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
