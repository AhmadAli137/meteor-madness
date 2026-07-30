// Builds src/data/neos.sample.json — a real-data fallback for /api/neos.
//
// Uses JPL's keyless APIs:
//   - CAD (close-approach data): upcoming Earth approaches within 0.05 au
//   - SBDB query: Keplerian elements + physical data for all NEOs
// Joined on primary designation. Run `node scripts/build-sample-neos.mjs`
// whenever you want to refresh the bundled sample.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "src", "data", "neos.sample.json");

const AU_KM = 149_597_870.7;
const LIMIT = 250;

function iso(dateStr) {
  // CAD dates look like "2026-Aug-01 12:34"
  const months = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const m = dateStr.match(/^(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${months[m[2]]}-${m[3]}T${m[4]}:${m[5]}:00Z`;
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const today = new Date().toISOString().slice(0, 10);

console.log("[sample] fetching JPL CAD close approaches…");
const cad = await getJSON(
  `https://ssd-api.jpl.nasa.gov/cad.api?date-min=${today}&date-max=%2B365&dist-max=0.05&sort=dist&limit=500`
);
const cadIdx = Object.fromEntries(cad.fields.map((f, i) => [f, i]));

console.log("[sample] fetching JPL SBDB orbital elements for all NEOs…");
const sbdb = await getJSON(
  "https://ssd-api.jpl.nasa.gov/sbdb_query.api?fields=pdes,full_name,pha,H,diameter,e,a,i,om,w,ma,epoch&sb-group=neo"
);
const sIdx = Object.fromEntries(sbdb.fields.map((f, i) => [f, i]));
const byDes = new Map(sbdb.data.map((row) => [String(row[sIdx.pdes]), row]));

const rows = [];
const seen = new Set();
for (const c of cad.data) {
  const des = String(c[cadIdx.des]);
  if (seen.has(des)) continue; // keep only the closest approach per object
  const sb = byDes.get(des);
  if (!sb) continue;
  seen.add(des);

  const a = Number(sb[sIdx.a]);
  if (!Number.isFinite(a) || a <= 0) continue;
  const periodDays = 365.25 * Math.pow(a, 1.5);

  const dateISO = iso(String(c[cadIdx.cd]));
  const missAu = Number(c[cadIdx.dist]);
  const diameter = Number(sb[sIdx.diameter]);
  const H = Number(sb[sIdx.H]);

  // H-magnitude size estimate (albedo 0.14) when no measured diameter
  const diaKm = Number.isFinite(diameter)
    ? diameter
    : Number.isFinite(H)
      ? (1329 / Math.sqrt(0.14)) * Math.pow(10, -0.2 * H)
      : undefined;

  rows.push({
    id: des,
    neo_reference_id: des,
    name: String(sb[sIdx.full_name] ?? des).trim(),
    hm: Number.isFinite(H) ? H : 0,
    dia_km: Number.isFinite(diaKm) ? diaKm : undefined,
    hazardous: sb[sIdx.pha] === "Y",
    approach: {
      epoch: dateISO ? Date.parse(dateISO) : Date.now(),
      date: dateISO ? dateISO.slice(0, 10) : "—",
      miss_km: missAu * AU_KM,
      miss_au: missAu,
      vel_kps: Number(c[cadIdx.v_rel]),
    },
    orbital_data: {
      eccentricity: String(sb[sIdx.e]),
      semi_major_axis: String(a),
      inclination: String(sb[sIdx.i]),
      ascending_node_longitude: String(sb[sIdx.om]),
      perihelion_argument: String(sb[sIdx.w]),
      epoch_osculation: String(sb[sIdx.epoch]),
      mean_anomaly: String(sb[sIdx.ma]),
      mean_motion: String(360 / periodDays),
    },
  });
  if (rows.length >= LIMIT) break;
}

rows.sort((x, y) => x.approach.miss_au - y.approach.miss_au);

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(rows));
console.log(
  `[sample] wrote ${rows.length} NEOs (${cad.data.length} approaches, ${sbdb.data.length} SBDB rows) → ${path.relative(process.cwd(), OUT)}`
);
