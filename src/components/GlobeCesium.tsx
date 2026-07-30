"use client";

import { useEffect, useRef, useState } from "react";

export type ImpactOverlay = {
  lat: number;
  lon: number;
  craterKm: number;
  etaISO: string;
  name: string;
  velKps?: number;
  diameterKm?: number;
  massKg?: number;
  energyMT?: number;
};

/** Ease helpers */
const easeInQuad = (t: number) => t * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Sequence timeline (seconds from start) */
const T = {
  meteorStart: 0.9,
  impact: 2.7,
  flashEnd: 3.3,
  ringsEnd: 6.0,
  craterIn: 3.6,
  pulseEnd: 8.0,
};

export default function GlobeCesium({
  className,
  impact,
}: {
  className?: string;
  impact?: ImpactOverlay | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const seqRef = useRef<{ raf: number; entities: any[] } | null>(null);
  const [replayKey, setReplayKey] = useState(0);

  // Build viewer once
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const Cesium = await import("cesium");
        const {
          Viewer,
          UrlTemplateImageryProvider,
          EllipsoidTerrainProvider,
          Cartesian3,
        } = Cesium;

        (window as any).CESIUM_BASE_URL = "/cesium";

        const terrain = new EllipsoidTerrainProvider();
        const imagery = new UrlTemplateImageryProvider({
          url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          minimumLevel: 0,
          maximumLevel: 19,
          credit: "© OpenStreetMap contributors",
        });

        const host = containerRef.current;
        if (!host || disposed) return;

        // Clear stale canvases (HMR/StrictMode)
        host.replaceChildren();

        const creditDiv = document.createElement("div");
        creditDiv.style.display = "none";

        const viewer = new Viewer(host, {
          animation: false,
          timeline: false,
          homeButton: true,
          geocoder: false,
          baseLayerPicker: false,
          navigationHelpButton: true,
          fullscreenButton: false,
          sceneModePicker: true,
          terrainProvider: terrain,
          creditContainer: creditDiv,
          // skip the default Ion layer; OSM tiles are added below
          baseLayer: false,
        } as any);

        try {
          const layer = viewer.imageryLayers.addImageryProvider(imagery);
          // slightly darker, moodier basemap
          layer.brightness = 0.75;
          layer.saturation = 0.85;
        } catch {}

        // Scene tuning
        viewer.scene.globe.depthTestAgainstTerrain = false;
        viewer.scene.requestRenderMode = true;
        viewer.scene.maximumRenderTimeChange = Infinity;
        try {
          viewer.scene.globe.showGroundAtmosphere = true;
        } catch {}

        // Start view
        viewer.camera.setView({
          destination: Cartesian3.fromDegrees(-95, 20, 2.2e7),
        });

        const doResize = () => {
          try {
            viewer.resize();
            viewer.scene.requestRender();
          } catch {}
        };
        requestAnimationFrame(doResize);

        roRef.current?.disconnect();
        roRef.current = new ResizeObserver(doResize);
        roRef.current.observe(host);

        viewerRef.current = { viewer, Cesium, doResize };
      } catch (e) {
        console.error("GlobeCesium init failed:", e);
      }
    })();

    return () => {
      disposed = true;
      roRef.current?.disconnect();
      roRef.current = null;
      stopSequence();
      const ref = viewerRef.current;
      if (ref?.viewer) {
        try {
          ref.viewer.destroy();
        } catch {}
      }
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopSequence() {
    const seq = seqRef.current;
    if (!seq) return;
    cancelAnimationFrame(seq.raf);
    const viewer = viewerRef.current?.viewer;
    if (viewer) {
      for (const ent of seq.entities) {
        try {
          viewer.entities.remove(ent);
        } catch {}
      }
      try {
        viewer.scene.requestRender();
      } catch {}
    }
    seqRef.current = null;
  }

  // Run the impact sequence when the scenario arrives (or on replay).
  // The viewer builds asynchronously, so poll briefly until it is ready.
  useEffect(() => {
    let cancelled = false;
    let poll: number | undefined;

    const tryStart = () => {
      if (cancelled) return;
      const store = viewerRef.current;
      if (!store) {
        poll = window.setTimeout(tryStart, 150);
        return;
      }
      stopSequence();
      if (!impact) {
        store.viewer.scene.requestRender();
        return;
      }
      runImpactSequence(store, impact);
    };
    tryStart();

    return () => {
      cancelled = true;
      if (poll) window.clearTimeout(poll);
      stopSequence();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impact, replayKey]);

  function runImpactSequence(store: any, imp: ImpactOverlay) {
    const { viewer, Cesium } = store;
    const {
      Cartesian3,
      Color,
      LabelStyle,
      ClassificationType,
      Math: CMath,
      HeadingPitchRange,
      BoundingSphere,
      Cartesian2,
      CallbackProperty,
      PolylineGlowMaterialProperty,
      PolylineDashMaterialProperty,
    } = Cesium;

    const { lat, lon, craterKm, name } = imp;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !Number.isFinite(craterKm)
    ) {
      console.warn("[GlobeCesium] Impact payload missing numbers:", imp);
      return;
    }

    // ---- derived sizes ----
    const craterR = Math.max(2500, (craterKm * 1000) / 2);
    const energyMT =
      imp.energyMT ??
      (imp.massKg && imp.velKps
        ? (0.5 * imp.massKg * (imp.velKps * 1000) ** 2) / 4.184e15
        : undefined);
    // heavy-damage blast radius, same nuclear cube-root scaling as the panel;
    // the drawn ring is capped (flat-circle approximation degrades at
    // continental scale) but the label always reports the true radius
    const blastTrueM = energyMT
      ? 4.6 * Math.cbrt(energyMT) * 1000
      : craterR * 12;
    const blastM = Math.min(blastTrueM, 2_500_000);
    const flashMax = Math.max(craterR * 6, 80_000);

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    // ---- geometry helpers ----
    const R = 6378137;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const toDeg = (r: number) => (r * 180) / Math.PI;
    const circle = (radiusM: number, steps = 128, height = 0) => {
      const out: any[] = [];
      const dOverR = radiusM / R;
      const latRad = toRad(lat);
      for (let i = 0; i <= steps; i++) {
        const th = (i / steps) * 2 * Math.PI;
        const dLat = dOverR * Math.sin(th);
        const dLon = (dOverR * Math.cos(th)) / Math.cos(latRad);
        out.push(
          Cartesian3.fromDegrees(lon + toDeg(dLon), lat + toDeg(dLat), height)
        );
      }
      return out;
    };
    const center = Cartesian3.fromDegrees(lon, lat, 0);
    const craterRing = circle(craterR, 180);

    const ents: any[] = [];
    const add = (opts: any) => {
      const e = viewer.entities.add(opts);
      ents.push(e);
      return e;
    };

    const start = performance.now();
    const now = () => (performance.now() - start) / 1000;

    // ================= persistent entities =================

    // Crater fill + outline (fade in at T.impact, pulse afterwards)
    const craterAlpha = () => {
      const t = now();
      if (!reduced && t < T.impact) return 0;
      const fadeIn = reduced
        ? 1
        : clamp01((t - T.impact) / (T.craterIn - T.impact));
      let pulse = 0;
      if (!reduced && t > T.craterIn && t < T.pulseEnd) {
        pulse = 0.12 * Math.sin((t - T.craterIn) * 4.2) ** 2;
      }
      return 0.32 * fadeIn + pulse;
    };
    add({
      name: `Crater • ${name}`,
      polygon: {
        hierarchy: craterRing,
        material: new Cesium.ColorMaterialProperty(
          new CallbackProperty(
            () => Color.ORANGERED.withAlpha(craterAlpha()),
            false
          )
        ),
        classificationType: ClassificationType.TERRAIN,
      },
    });
    add({
      polyline: {
        positions: craterRing,
        clampToGround: true,
        width: 2.5,
        material: new Cesium.ColorMaterialProperty(
          new CallbackProperty(
            () => Color.RED.withAlpha(Math.min(1, craterAlpha() * 3)),
            false
          )
        ),
      },
    });

    // Heavy-blast dashed ring + label (appears with the crater)
    const blastAlpha = () =>
      reduced ? 0.75 : clamp01((now() - T.craterIn) / 1.2) * 0.75;
    add({
      polyline: {
        positions: circle(blastM, 220),
        clampToGround: true,
        width: 2,
        material: new PolylineDashMaterialProperty({
          color: new CallbackProperty(
            () => Color.ORANGE.withAlpha(blastAlpha()),
            false
          ),
          dashLength: 24,
        }),
      },
    });
    add({
      position: Cartesian3.fromDegrees(lon, lat + toDeg(blastM / R), 0),
      label: {
        text: `heavy blast ~${Math.round(blastTrueM / 1000).toLocaleString()} km${
          blastTrueM > blastM ? " (ring truncated)" : ""
        }`,
        font: "12px sans-serif",
        style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: Color.ORANGE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        pixelOffset: new Cartesian2(0, -10),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: new CallbackProperty(() => blastAlpha() > 0.2, false),
      },
    });

    // Ground-zero marker + name
    add({
      position: center,
      point: {
        pixelSize: 8,
        color: Color.RED,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: new CallbackProperty(() => reduced || now() > T.craterIn, false),
      },
      label: {
        text: name,
        font: "12px sans-serif",
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: new CallbackProperty(() => reduced || now() > T.craterIn, false),
      },
    });

    // ================= animated entities (skipped in reduced motion) =================
    if (!reduced) {
      // Meteor: glowing head + trail streaking in from the north-west sky
      const startPos = Cartesian3.fromDegrees(lon - 16, lat + 11, 1_500_000);
      const meteorPos = () => {
        const t = clamp01((now() - T.meteorStart) / (T.impact - T.meteorStart));
        const k = easeInQuad(t);
        return new Cartesian3(
          startPos.x + (center.x - startPos.x) * k,
          startPos.y + (center.y - startPos.y) * k,
          startPos.z + (center.z - startPos.z) * k
        );
      };
      const meteorVisible = () =>
        now() >= T.meteorStart && now() < T.impact + 0.05;
      add({
        position: new CallbackProperty(meteorPos, false),
        point: {
          pixelSize: 16,
          color: Color.fromCssColorString("#ffd9a0"),
          outlineColor: Color.fromCssColorString("#ff6a00"),
          outlineWidth: 4,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: new CallbackProperty(meteorVisible, false),
        },
      });
      add({
        polyline: {
          positions: new CallbackProperty(() => {
            const head = meteorPos();
            const t = clamp01(
              (now() - T.meteorStart) / (T.impact - T.meteorStart)
            );
            const back = Math.max(0, t - 0.22);
            const k = easeInQuad(back);
            const tail = new Cartesian3(
              startPos.x + (center.x - startPos.x) * k,
              startPos.y + (center.y - startPos.y) * k,
              startPos.z + (center.z - startPos.z) * k
            );
            return [tail, head];
          }, false),
          width: 12,
          material: new PolylineGlowMaterialProperty({
            glowPower: 0.28,
            color: Color.fromCssColorString("#ffae5f").withAlpha(0.9),
          }),
          show: new CallbackProperty(meteorVisible, false),
        },
      });

      // Impact flash: white-hot disc that blooms and dies in ~0.6 s.
      // Cesium evaluates the two axes at slightly different wall-clock times,
      // and semiMajorAxis must stay >= semiMinorAxis — so the minor axis
      // reuses the major axis's last computed value. The radius only ever
      // grows, so a stale value is always <= the fresh one, whichever
      // order Cesium evaluates them in.
      let flashR = 1000;
      add({
        ellipse: {
          semiMajorAxis: new CallbackProperty(() => {
            const t = clamp01((now() - T.impact) / (T.flashEnd - T.impact));
            flashR = Math.max(1000, flashMax * easeOutCubic(t));
            return flashR;
          }, false),
          semiMinorAxis: new CallbackProperty(() => flashR, false),
          material: new Cesium.ColorMaterialProperty(
            new CallbackProperty(() => {
              const t = clamp01((now() - T.impact) / (T.flashEnd - T.impact));
              return Color.WHITE.withAlpha(0.95 * (1 - easeInQuad(t)));
            }, false)
          ),
          height: 0,
          show: new CallbackProperty(
            () => now() >= T.impact && now() <= T.flashEnd + 0.1,
            false
          ),
        },
        position: center,
      });

      // Three expanding shockwave rings, staged so one is always in frame:
      // near-crater wave, mid-range wave, and the full blast-radius front
      const RING_COLORS = ["#ffffff", "#ffb347", "#ff5533"];
      const RING_TARGETS = [
        Math.max(craterR * 6, 60_000),
        Math.max(blastM * 0.45, craterR * 10),
        blastM,
      ];
      RING_COLORS.forEach((c, i) => {
        const t0 = T.impact + 0.15 + i * 0.55;
        const dur = T.ringsEnd - T.impact - i * 0.4;
        const ringT = () => clamp01((now() - t0) / dur);
        add({
          polyline: {
            positions: new CallbackProperty(() => {
              const r =
                craterR + (RING_TARGETS[i] - craterR) * easeOutCubic(ringT());
              return circle(r, 128);
            }, false),
            clampToGround: true,
            width: 3.5 - i * 0.75,
            material: new Cesium.ColorMaterialProperty(
              new CallbackProperty(() => {
                const t = ringT();
                return Color.fromCssColorString(c).withAlpha(
                  t <= 0 || t >= 1 ? 0 : 0.85 * (1 - easeInQuad(t))
                );
              }, false)
            ),
            show: new CallbackProperty(() => now() >= t0 && ringT() < 1, false),
          },
        });
      });
    }

    // ================= camera choreography =================
    const wideSphere = new BoundingSphere(
      center,
      Math.max(blastM * 1.5, 1_200_000)
    );
    const craterSphere = new BoundingSphere(
      center,
      Math.max(craterR * 4, blastM * 0.22, 180_000)
    );

    if (reduced) {
      viewer.camera.flyToBoundingSphere(craterSphere, {
        offset: new HeadingPitchRange(
          CMath.toRadians(15),
          -CMath.toRadians(32),
          craterSphere.radius * 2.6
        ),
        duration: 0.9,
      });
    } else {
      // establish wide, then dive into the crater zone as the shockwave spreads
      viewer.camera.flyToBoundingSphere(wideSphere, {
        offset: new HeadingPitchRange(
          CMath.toRadians(0),
          -CMath.toRadians(50),
          wideSphere.radius * 2.4
        ),
        duration: 1.0,
      });
      window.setTimeout(() => {
        if (seqRef.current?.entities !== ents) return; // superseded
        try {
          viewer.camera.flyToBoundingSphere(craterSphere, {
            offset: new HeadingPitchRange(
              CMath.toRadians(18),
              -CMath.toRadians(34),
              craterSphere.radius * 2.6
            ),
            duration: 2.4,
          });
        } catch {}
      }, (T.impact + 0.35) * 1000);
    }

    // ================= render loop =================
    const tick = () => {
      const seq = seqRef.current;
      if (!seq || seq.entities !== ents) return;
      viewer.scene.requestRender();
      if (now() < T.pulseEnd + 0.5) {
        seq.raf = requestAnimationFrame(tick);
      }
    };
    seqRef.current = { raf: requestAnimationFrame(tick), entities: ents };
  }

  return (
    <div
      className={className ?? "relative h-full w-full overflow-hidden"}
      style={{ position: "relative" }}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ position: "relative", overflow: "hidden" }}
      />
      {impact && (
        <button
          onClick={() => setReplayKey((k) => k + 1)}
          className="absolute bottom-4 left-4 z-10 rounded-lg bg-black/60 px-3 py-1.5 text-sm text-white ring-1 ring-white/20 backdrop-blur hover:bg-black/75"
        >
          ☄ Replay impact
        </button>
      )}
    </div>
  );
}
