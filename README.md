# ☄️ Meteor Madness

**Interactive asteroid impact visualization & mitigation simulator** — built for the
[NASA Space Apps Challenge 2025 "Meteor Madness" challenge](https://www.spaceappschallenge.org/2025/challenges/meteor-madness/).

> 🏆 **1st Place — Windsor, Ontario (local event)** &nbsp;•&nbsp; 🌍 **Global Nominee** — Team CRG, October 4–5, 2025

A hypothetical near-Earth asteroid, *Impactor-2025*, is on a collision course with
Earth. Can you understand the threat — and stop it? Meteor Madness turns real NASA
near-Earth-object data into an explorable story: browse real asteroids, fly a
hypothetical impactor into Earth, inspect the consequences on a 3D globe, then
attempt to save the planet with a DART-style kinetic impactor.

*(This repository is a refined, post-hackathon version of the
[original 48-hour submission](https://github.com/AhmadAli137/meteor-madness-nasa).)*

---

## Features

### 🔭 Observatory — `/observatory`
Browse ~250 real near-Earth objects fetched live from
[NASA's NeoWs API](https://api.nasa.gov/), sorted by closest approach.
Search, filter (hazardous-only), sort, and toggle between an interactive **2D
orbit map** and a **3D heliocentric view** built from each asteroid's actual
Keplerian orbital elements.

### 💥 Impactor Lab — `/impact`
Design your own *Impactor-2025*: set velocity (11–72 km/s), diameter
(0.05–20 km), bulk density, impact site, and time-to-impact. The lab solves an
elliptical orbit that meets Earth exactly at the chosen impact epoch and
animates both bodies on a mission clock. Live readouts show the derived
**mass**, **kinetic energy (TNT megatons)**, and **crater diameter**.

### 🌍 Impact Site — `/globe`
The scenario carries over to a CesiumJS 3D globe with OpenStreetMap imagery:
crater footprint drawn to scale at the impact site, plus estimated effects —
heavy-blast-damage radius (nuclear cube-root scaling) and **equivalent seismic
magnitude** (Collins–Melosh–Marcus energy coupling).

### 🛡️ Mission: Save Earth — `/deflection`
A playable deflection scenario. Tune a kinetic impactor's mass, relative speed,
momentum-enhancement factor β, burn angle, and — most importantly — **lead
time**, then evaluate the mission. Small asteroids can be deflected with an
early strike; a 10-km planet-killer cannot. Just like real planetary defense.

---

## The science (simplified, but honest)

| Model | Approach |
|---|---|
| Orbits | Keplerian elements + Newton–Raphson solution of Kepler's equation |
| Impact energy | E = ½mv², reported in megatons of TNT |
| Crater size | Pi-group scaling (after Collins, Melosh & Marcus 2005), 45° impact into rock |
| Seismic magnitude | M ≈ 0.67·log₁₀(E) − 5.87 (Collins et al. 2005) |
| Blast radius | Nuclear cube-root overpressure scaling |
| Deflection | Kinetic impactor Δv = β·m·v_rel / M; miss distance ≈ 3·Δv·t_lead (along-track drift — the DART principle) |

Each lab visually exaggerates orbit changes where a real mm/s Δv would be
invisible at solar-system scale — but the physics readouts always use the true
numbers, and the UI says which is which.

## Tech stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **CesiumJS** — 3D heliocentric scenes & the Earth globe
- **Three.js / React Three Fiber** — landing-page starfield & 2D orbit map
- **Tailwind CSS 4**, **Framer Motion**, **Lenis** smooth scrolling
- **NASA NeoWs API** via a server-side route handler (`/api/neos`)

## Getting started

```bash
npm install       # also copies Cesium's static assets into public/cesium
npm run dev
```

Open http://localhost:3000.

**Optional:** get a free NASA API key at [api.nasa.gov](https://api.nasa.gov)
and drop it in `.env.local` (see `.env.example`) — otherwise the app uses
NASA's shared `DEMO_KEY`, which has tight rate limits.

```bash
NASA_API_KEY=your_key_here
```

## Deploying (Vercel)

The repo is Vercel-ready (`vercel.json`, `postinstall` Cesium asset copy):

1. Import the repo at [vercel.com/new](https://vercel.com/new)
2. Add the `NASA_API_KEY` environment variable
3. Deploy — no other configuration needed

## Data & attribution

- [NASA NeoWs (Near Earth Object Web Service)](https://api.nasa.gov/) — asteroid orbital elements, sizes, close approaches
- [OpenStreetMap](https://www.openstreetmap.org/copyright) — globe imagery tiles
- [CesiumJS](https://cesium.com/platform/cesiumjs/) — open-source 3D geospatial engine
- Crater/seismic scaling after Collins, Melosh & Marcus (2005), *Earth Impact Effects Program*

## Team CRG

Built in 48 hours at the University of Windsor for NASA Space Apps 2025 by
**Ahmad Ali** ([@AhmadAli137](https://github.com/AhmadAli137)) and Team CRG.

> NASA does not endorse this project; it was built with publicly available NASA data for the Space Apps Challenge.
