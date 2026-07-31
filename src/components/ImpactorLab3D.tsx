"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

/**
 * Impactor Lab — configure a hypothetical asteroid and fly it into Earth.
 *
 * The heliocentric scene is a simplified two-body visualization: Earth on a
 * circular 1 AU orbit, the impactor on an ellipse whose eccentricity is
 * derived from its speed and whose orientation is solved so that it meets
 * Earth exactly at the chosen impact time.
 */

type LabParams = {
  velKps: number;
  years: number;
  months: number;
  days: number;
  diameterKm: number;
  densityKgM3: number;
};

type ImpactSite = {
  lat: number;
  lon: number;
  craterKm: number;
  etaISO: string;
  name: string;
  velKps: number;
  diameterKm: number;
  massKg: number;
  energyMT: number;
};

const AU_TO_SCENE = 1_000_000;
const DEG = Math.PI / 180;

const SUN_RADIUS_AU = 0.12;
const EARTH_RADIUS_AU = 0.03;
const EARTH_DIAMETER_KM = 12_742;
const MIN_IMPACTOR_RADIUS_AU = 0.004;

const EARTH_PERIOD_DAYS = 365.25;
const N_EARTH = (2 * Math.PI) / EARTH_PERIOD_DAYS;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function toMillis(p: LabParams) {
  const days = p.years * 365.25 + p.months * 30 + p.days;
  return days * 86_400_000;
}
function yearFromMs(ms: number) {
  const d = new Date(Date.now() + ms);
  return d.getUTCFullYear();
}
function earthAngleAt(daysFromStart: number) {
  return N_EARTH * daysFromStart;
}
/** Visual heuristic: faster rocks get more eccentric (elongated) orbits. */
function eccFromVel(velKps: number) {
  return clamp(((velKps - 11) / (72 - 11)) * 0.6 + 0.1, 0.05, 0.75);
}
function radialFromEllipse(a: number, e: number, nu: number) {
  return (a * (1 - e * e)) / (1 + e * Math.cos(nu));
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
  // Kepler solve (Newton–Raphson)
  const M = Mdeg * DEG;
  let E = M;
  for (let k = 0; k < 15; k++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const step = f / fp;
    E -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  const cosE = Math.cos(E),
    sinE = Math.sin(E);
  const rAU = aAU * (1 - e * cosE);
  const nu = Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e);
  const xpf = rAU * Math.cos(nu),
    ypf = rAU * Math.sin(nu);
  const x = R11 * xpf + R12 * ypf;
  const y = R21 * xpf + R22 * ypf;
  const z = R31 * xpf + R32 * ypf;
  return { x: x * AU_TO_SCENE, y: y * AU_TO_SCENE, z: z * AU_TO_SCENE };
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
    const rAU = radialFromEllipse(aAU, e, nu);
    const xpf = rAU * Math.cos(nu),
      ypf = rAU * Math.sin(nu);
    const x = (R11 * xpf + R12 * ypf) * AU_TO_SCENE;
    const y = (R21 * xpf + R22 * ypf) * AU_TO_SCENE;
    const z = (R31 * xpf + R32 * ypf) * AU_TO_SCENE;
    pts.push(new Cartesian3(x, y, z));
  }
  return pts;
}

/** Sphere mass from diameter (km) and bulk density (kg/m³). */
function massFromDiameter(diameterKm: number, densityKgM3: number) {
  const r = (diameterKm * 1000) / 2;
  return (4 / 3) * Math.PI * r * r * r * densityKgM3;
}

/** Kinetic energy in megatons of TNT (1 MT ≈ 4.184e15 J). */
function energyMegatons(massKg: number, velKps: number) {
  const v = velKps * 1000;
  return (0.5 * massKg * v * v) / 4.184e15;
}

/**
 * Final crater diameter (km) via simplified pi-group scaling
 * (after Collins, Melosh & Marcus 2005), assuming a 45° impact into
 * competent rock (target density 2500 kg/m³).
 */
function estimateCraterKm(
  diameterKm: number,
  velKps: number,
  densityKgM3: number
) {
  const L = diameterKm * 1000; // impactor diameter (m)
  const v = velKps * 1000; // velocity (m/s)
  const g = 9.81;
  const rhoT = 2500;
  const theta = 45 * DEG;
  const transient =
    1.161 *
    Math.cbrt(densityKgM3 / rhoT) *
    Math.pow(L, 0.78) *
    Math.pow(v, 0.44) *
    Math.pow(g, -0.22) *
    Math.cbrt(Math.sin(theta));
  return (1.25 * transient) / 1000; // final ≈ 1.25 × transient, in km
}

function fmtMass(kg: number) {
  if (!Number.isFinite(kg)) return "—";
  const exp = Math.floor(Math.log10(kg));
  const mant = kg / 10 ** exp;
  return `${mant.toFixed(2)}e${exp} kg`;
}
function fmtEnergy(mt: number) {
  if (!Number.isFinite(mt)) return "—";
  if (mt >= 1e6) return `${(mt / 1e6).toFixed(1)}M MT`;
  if (mt >= 1e3) return `${(mt / 1e3).toFixed(1)}k MT`;
  if (mt >= 1) return `${mt.toFixed(1)} MT`;
  return `${(mt * 1000).toFixed(1)} kT`;
}

export default function ImpactorLab3D() {
  const [params, setParams] = useState<LabParams>({
    velKps: 20,
    years: 1,
    months: 0,
    days: 0,
    diameterKm: 1,
    densityKgM3: 3000,
  });
  const [site, setSite] = useState<{ lat: number; lon: number }>({
    lat: 42,
    lon: -83,
  });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [hasScenario, setHasScenario] = useState(false);

  const [showImpactModal, setShowImpactModal] = useState(false);
  const impactSiteRef = useRef<ImpactSite | null>(null);
  const popupShownRef = useRef(false);
  const hasScenarioRef = useRef(false);

  const msToImpact = useMemo(() => toMillis(params), [params]);

  const [impactYear, setImpactYear] = useState<number | null>(null);
  const [etaStr, setEtaStr] = useState<string>("");

  useEffect(() => {
    setImpactYear(yearFromMs(msToImpact));
    setEtaStr(new Date(Date.now() + msToImpact).toUTCString());
  }, [msToImpact]);

  const impactorName = `impactor-${impactYear ?? "…"}`;
  const massKg = useMemo(
    () => massFromDiameter(params.diameterKm, params.densityKgM3),
    [params.diameterKm, params.densityKgM3]
  );
  const energyMT = useMemo(
    () => energyMegatons(massKg, params.velKps),
    [massKg, params.velKps]
  );
  const craterKm = useMemo(
    () => estimateCraterKm(params.diameterKm, params.velKps, params.densityKgM3),
    [params.diameterKm, params.velKps, params.densityKgM3]
  );

  const holderRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const ents = useRef<{
    sun?: any;
    earth?: any;
    earthOrbit?: any;
    rock?: any;
    rockOrbit?: any;
    impactX?: any;
  }>({});

  // Build the Cesium viewer once
  useEffect(() => {
    (async () => {
      const Cesium = await import("cesium");
      (window as any).CESIUM_BASE_URL = "/cesium";
      const { Viewer, Color, Cartesian3, Cartesian2, LabelStyle } = Cesium;
      if (!holderRef.current || viewerRef.current) return;

      const creditDiv = document.createElement("div");
      creditDiv.style.display = "none";

      const viewer = new Viewer(holderRef.current, {
        animation: true,
        timeline: true,
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
      viewer.scene.backgroundColor = Color.fromCssColorString("#0b0f19");
      (viewer.cesiumWidget.creditContainer as HTMLElement).style.display =
        "none";

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
          width: 1.6,
          material: Color.CYAN.withAlpha(0.85),
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

      // Show the result modal when the sim clock reaches the impact epoch
      const endHandler = () => {
        if (!hasScenarioRef.current || popupShownRef.current) return;
        if (
          Cesium.JulianDate.greaterThanOrEquals(
            viewer.clock.currentTime,
            viewer.clock.stopTime
          )
        ) {
          viewer.clock.shouldAnimate = false;
          popupShownRef.current = true;
          setShowImpactModal(true);

          if (impactSiteRef.current) {
            try {
              sessionStorage.setItem(
                "mm-impact-detail",
                JSON.stringify(impactSiteRef.current)
              );
            } catch {}
          }
        }
      };
      viewer.clock.onTick.addEventListener(endHandler);

      viewerRef.current = { viewer, Cesium, keepRendering, endHandler };
    })();

    return () => {
      const store = viewerRef.current;
      if (!store) return;
      try {
        store.viewer.clock.onTick.removeEventListener(store.keepRendering);
        store.viewer.clock.onTick.removeEventListener(store.endHandler);
        store.viewer.destroy();
      } catch {}
      viewerRef.current = null;
    };
  }, []);

  // reflect play/speed
  useEffect(() => {
    const v = viewerRef.current?.viewer;
    if (!v) return;
    v.clock.multiplier = speed * 86400;
    v.clock.shouldAnimate = playing;
  }, [speed, playing]);

  function clearScenario() {
    const viewer = viewerRef.current?.viewer;
    if (!viewer) return;
    const Cesium = viewerRef.current.Cesium;
    const { Cartesian3, JulianDate, ClockRange } = Cesium;

    const rm = (x: any) => {
      try {
        if (x) viewer.entities.remove(x);
      } catch {}
    };
    rm(ents.current.rock);
    rm(ents.current.rockOrbit);
    rm(ents.current.impactX);
    ents.current.rock =
      ents.current.rockOrbit =
      ents.current.impactX =
        undefined;

    if (ents.current.earth)
      ents.current.earth.position = Cartesian3.fromElements(AU_TO_SCENE, 0, 0);

    const now = JulianDate.now();
    viewer.clock.startTime = now.clone();
    viewer.clock.currentTime = now.clone();
    viewer.clock.stopTime = now.clone();
    viewer.clock.clockRange = ClockRange.CLAMPED;
    viewer.clock.shouldAnimate = false;

    popupShownRef.current = false;
    setShowImpactModal(false);
    impactSiteRef.current = null;
    hasScenarioRef.current = false;
    setHasScenario(false);
    setPlaying(false);
    viewer.scene.requestRender();
  }

  function randomizeSite() {
    setSite({
      lat: Math.round(Math.random() * 120 - 60),
      lon: Math.round(Math.random() * 360 - 180),
    });
  }

  async function createScenario() {
    const store = viewerRef.current;
    if (!store) return;
    const { viewer, Cesium } = store;
    const {
      Cartesian3,
      Cartesian2,
      Color,
      JulianDate,
      SampledPositionProperty,
      HeadingPitchRange,
      Math: CMath,
      BoundingSphere,
      DistanceDisplayCondition,
      LabelStyle,
      ClockRange,
    } = Cesium;

    clearScenario();

    const start = JulianDate.now();
    const stop = JulianDate.addSeconds(
      start,
      msToImpact / 1000,
      new JulianDate()
    );
    const totalDays = JulianDate.secondsDifference(stop, start) / 86400;

    viewer.clock.startTime = start.clone();
    viewer.clock.currentTime = start.clone();
    viewer.clock.stopTime = stop.clone();
    viewer.clock.clockRange = ClockRange.CLAMPED;
    viewer.clock.multiplier = speed * 86400;
    viewer.clock.shouldAnimate = false;
    setPlaying(false);
    popupShownRef.current = false;

    const earthPos = new SampledPositionProperty();
    const earthN = 576;
    for (let i = 0; i <= earthN; i++) {
      const t = JulianDate.addSeconds(
        start,
        (i / earthN) * (msToImpact / 1000),
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

    // Solve the impactor's ellipse so it meets Earth at t = impact
    const e = eccFromVel(params.velKps);
    const thetaImpact = earthAngleAt(totalDays);
    const aAU = (1 * (1 + e * Math.cos(thetaImpact))) / (1 - e * e);
    const nImp = N_EARTH / Math.pow(aAU, 1.5);

    const s = Math.sqrt((1 - e) / (1 + e));
    const tanE2 = Math.tan(thetaImpact / 2) * s;
    const Eimp = 2 * Math.atan(tanE2);
    const Mimp = Eimp - e * Math.sin(Eimp);
    const M0deg = ((Mimp - nImp * totalDays) * 180) / Math.PI;

    const rockPos = new SampledPositionProperty();
    const rockN = 720;
    for (let i = 0; i <= rockN; i++) {
      const t = JulianDate.addSeconds(
        start,
        (i / rockN) * (msToImpact / 1000),
        new JulianDate()
      );
      const d = JulianDate.secondsDifference(t, start) / 86400;
      const Mdeg = M0deg + ((nImp * 180) / Math.PI) * d;
      const p = posFromElements(aAU, e, 0, 0, 0, Mdeg);
      rockPos.addSample(t, new Cartesian3(p.x, p.y, p.z));
    }

    // Visual size: true scale, clamped so the rock stays visible
    const ratioReal = params.diameterKm / EARTH_DIAMETER_KM;
    const rImpAU = clamp(
      Math.max(ratioReal * EARTH_RADIUS_AU, MIN_IMPACTOR_RADIUS_AU),
      0.0025,
      0.9 * EARTH_RADIUS_AU
    );
    const rImp = rImpAU * AU_TO_SCENE;

    const orbitPts = orbitCurvePoints(aAU, e, 0, 0, 0, 720, Cesium);
    ents.current.rockOrbit = viewer.entities.add({
      name: `${impactorName} orbit`,
      polyline: {
        positions: orbitPts,
        width: 1.4,
        material: Color.MAGENTA.withAlpha(0.9),
      },
    });

    ents.current.rock = viewer.entities.add({
      name: impactorName,
      position: rockPos,
      ellipsoid: {
        radii: new Cartesian3(rImp, rImp, rImp),
        material: Color.MAGENTA.withAlpha(0.95),
      } as any,
      point: {
        pixelSize: 8,
        color: Color.MAGENTA,
        outlineColor: Color.BLACK,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: impactorName,
        font: "12px sans-serif",
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        pixelOffset: new Cartesian2(0, -18),
        showBackground: true,
        backgroundColor: Color.fromAlpha(Color.BLACK, 0.45),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new DistanceDisplayCondition(
          0,
          Number.POSITIVE_INFINITY
        ),
      },
    });

    ents.current.impactX = viewer.entities.add({
      name: "Impact point",
      position: new Cartesian3(
        Math.cos(thetaImpact) * AU_TO_SCENE,
        Math.sin(thetaImpact) * AU_TO_SCENE,
        0
      ),
      label: {
        text: "X",
        font: "bold 20px sans-serif",
        fillColor: Color.RED,
        outlineColor: Color.BLACK,
        outlineWidth: 4,
        pixelOffset: new Cartesian2(0, -12),
        showBackground: false,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    const etaISO = new Date(Date.now() + msToImpact).toISOString();
    impactSiteRef.current = {
      lat: site.lat,
      lon: site.lon,
      craterKm,
      etaISO,
      name: impactorName,
      velKps: params.velKps,
      diameterKm: params.diameterKm,
      massKg,
      energyMT,
    };

    const maxAU = Math.max(1, aAU * (1 + e));
    const sphere = BoundingSphere.fromPoints([
      new Cartesian3(maxAU * AU_TO_SCENE, 0, 0),
      new Cartesian3(-maxAU * AU_TO_SCENE, 0, 0),
      new Cartesian3(0, maxAU * AU_TO_SCENE, 0),
      new Cartesian3(0, -maxAU * AU_TO_SCENE, 0),
    ]);
    const offset = new HeadingPitchRange(
      CMath.toRadians(22),
      -CMath.toRadians(28),
      sphere.radius * 3.2
    );
    viewer.camera.flyToBoundingSphere(sphere, { offset, duration: 0 });

    hasScenarioRef.current = true;
    setHasScenario(true);
    viewer.scene.requestRender();
  }

  return (
    <div className="mm-view cesium-show-widgets relative">
      <div ref={holderRef} className="absolute inset-0" />

      <div className="absolute top-3 left-3 z-10 w-[380px] max-w-[92vw] space-y-3 rounded-xl bg-black/60 p-3 ring-1 ring-white/10 backdrop-blur">
        <div className="text-sm font-semibold">Impactor Lab</div>

        <div className="grid grid-cols-[140px_1fr] items-center gap-2 text-xs">
          <label title="Speed at which the asteroid hits Earth. Real impacts range from ~11 km/s (minimum, Earth's escape velocity) to ~72 km/s.">
            Velocity (km/s)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={11}
              max={72}
              step={1}
              value={params.velKps}
              onChange={(e) =>
                setParams((p) => ({ ...p, velKps: Number(e.target.value) }))
              }
              className="w-full"
            />
            <span className="w-8 text-right">{params.velKps}</span>
          </div>

          <label>Time → impact</label>
          <div className="flex gap-2">
            <input
              type="number"
              className="w-16 rounded bg-neutral-800/60 px-2 py-1"
              min={0}
              max={20}
              value={params.years}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  years: clamp(Number(e.target.value) || 0, 0, 20),
                }))
              }
            />
            <span className="self-center">y</span>
            <input
              type="number"
              className="w-16 rounded bg-neutral-800/60 px-2 py-1"
              min={0}
              max={11}
              value={params.months}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  months: clamp(Number(e.target.value) || 0, 0, 11),
                }))
              }
            />
            <span className="self-center">m</span>
            <input
              type="number"
              className="w-16 rounded bg-neutral-800/60 px-2 py-1"
              min={0}
              max={30}
              value={params.days}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  days: clamp(Number(e.target.value) || 0, 0, 30),
                }))
              }
            />
            <span className="self-center">d</span>
          </div>

          <label title="Most known potentially hazardous asteroids are between 0.1 and 10 km across. The Chicxulub impactor was ~10 km.">
            Diameter (km)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0.05}
              max={20}
              step={0.05}
              value={params.diameterKm}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  diameterKm: Number(e.target.value),
                }))
              }
              className="w-full"
            />
            <span className="w-14 text-right">
              {params.diameterKm.toFixed(2)}
            </span>
          </div>

          <label title="Bulk density. ~1500 kg/m³ for rubble piles, ~3000 for stony asteroids, ~8000 for iron.">
            Density (kg/m³)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1000}
              max={8000}
              step={100}
              value={params.densityKgM3}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  densityKgM3: Number(e.target.value),
                }))
              }
              className="w-full"
            />
            <span className="w-14 text-right">{params.densityKgM3}</span>
          </div>

          <div className="col-span-2 -mt-1 grid grid-cols-3 gap-2 text-[11px] text-white/70">
            <div>
              Mass
              <div className="font-mono text-white/90">{fmtMass(massKg)}</div>
            </div>
            <div title="Kinetic energy ½mv², expressed in megatons of TNT. Hiroshima ≈ 0.015 MT.">
              Energy
              <div className="font-mono text-white/90">
                {fmtEnergy(energyMT)}
              </div>
            </div>
            <div title="Final crater diameter from pi-group scaling (Collins et al. 2005), 45° impact into rock.">
              Crater
              <div className="font-mono text-white/90">
                ~{craterKm.toFixed(1)} km
              </div>
            </div>
          </div>

          <label>Impact site</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              className="w-16 rounded bg-neutral-800/60 px-2 py-1"
              min={-90}
              max={90}
              value={site.lat}
              onChange={(e) =>
                setSite((s) => ({
                  ...s,
                  lat: clamp(Number(e.target.value) || 0, -90, 90),
                }))
              }
            />
            <span className="self-center">°N</span>
            <input
              type="number"
              className="w-16 rounded bg-neutral-800/60 px-2 py-1"
              min={-180}
              max={180}
              value={site.lon}
              onChange={(e) =>
                setSite((s) => ({
                  ...s,
                  lon: clamp(Number(e.target.value) || 0, -180, 180),
                }))
              }
            />
            <span className="self-center">°E</span>
            <button
              className="ml-1 rounded bg-neutral-700 px-2 py-1 hover:bg-neutral-600"
              onClick={randomizeSite}
              title="Pick a random impact site"
            >
              🎲
            </button>
          </div>

          <label>Name</label>
          <div className="select-text rounded bg-neutral-800/60 px-2 py-1">
            {`impactor-`}
            <span className="font-mono">
              <time suppressHydrationWarning>{impactYear ?? "…"}</time>
            </span>
          </div>

          <label>Sim speed</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0.2}
              max={20}
              step={0.2}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="w-full"
            />
            <span className="w-10 text-right">{speed.toFixed(1)}×</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            className="rounded bg-emerald-600 px-3 py-1 text-sm hover:bg-emerald-500"
            onClick={createScenario}
          >
            Create / Update
          </button>
          <button
            className="rounded bg-sky-700 px-3 py-1 text-sm hover:bg-sky-600 disabled:opacity-50"
            onClick={() => setPlaying((v) => !v)}
            disabled={!hasScenario}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button
            className="rounded bg-neutral-700 px-3 py-1 text-sm hover:bg-neutral-600 disabled:opacity-50"
            onClick={clearScenario}
            disabled={!hasScenario}
          >
            Clear
          </button>
        </div>

        <div className="text-[11px] opacity-70">
          Impact ETA:{" "}
          <span className="font-mono">
            <time suppressHydrationWarning>{etaStr || "—"}</time>
          </span>
          <div>
            Both bodies animate; the magenta orbit meets Earth at the red “X”.
          </div>
        </div>
      </div>

      {showImpactModal && impactSiteRef.current && (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60" />
          <div className="relative z-10 w-[440px] max-w-[92vw] space-y-3 rounded-xl bg-neutral-900 p-4 ring-1 ring-white/10">
            <div className="text-lg font-semibold">Impact Reached</div>
            <div className="text-sm text-white/80">
              {impactSiteRef.current.name} has reached Earth.
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm text-white/70">
              <div>
                Site
                <div className="font-mono text-white/90">
                  {impactSiteRef.current.lat}°, {impactSiteRef.current.lon}°
                </div>
              </div>
              <div>
                Energy
                <div className="font-mono text-white/90">
                  {fmtEnergy(impactSiteRef.current.energyMT)}
                </div>
              </div>
              <div>
                Crater diameter
                <div className="font-mono text-white/90">
                  ~{impactSiteRef.current.craterKm.toFixed(1)} km
                </div>
              </div>
              <div>
                ETA (UTC)
                <div className="font-mono text-white/90">
                  {impactSiteRef.current.etaISO.slice(0, 10)}
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Link
                className="rounded bg-emerald-600 px-3 py-1 text-sm hover:bg-emerald-500"
                href="/globe"
              >
                View Impact Site →
              </Link>
              <button
                className="rounded bg-neutral-700 px-3 py-1 text-sm hover:bg-neutral-600"
                onClick={() => setShowImpactModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
