// src/components/HeroClient.tsx
"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ReactLenis } from "lenis/react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  animate,
  useScroll,
  useTransform,
} from "framer-motion";
import Link from "next/link";
import { Canvas } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import SoundToggle from "@/components/SoundToggle";

/** All scroll/animation stays in this Client Component */
export default function HeroClient() {
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
    // Warm up bundles so the click feels instant (works in dev too)
    router.prefetch("/observatory");
    router.prefetch("/impact");
    router.prefetch("/deflection");
  }, [router]);

  return (
    // root is truthy only after mount to keep hydration stable
    <ReactLenis root={mounted} options={{ lerp: 0.05 }}>
      <AuroraHero mounted={mounted} />
      <TeamPlanets />
      <div className="fixed bottom-4 right-4 z-50">
        <SoundToggle theme="home" />
      </div>
    </ReactLenis>
  );
}

const COLORS_TOP = ["#13FFAA", "#1E67C6", "#CE84CF", "#DD335C"];

function AuroraHero({ mounted }: { mounted: boolean }) {
  const color = useMotionValue(COLORS_TOP[0]);

  useEffect(() => {
    const controls = animate(color, COLORS_TOP, {
      ease: "easeInOut",
      duration: 10,
      repeat: Infinity,
      repeatType: "mirror",
    });
    return () => controls.stop();
  }, [color]);

  const bg = useMotionTemplate`
    radial-gradient(125% 125% at 50% 0%, #09090C 55%, ${color})
  `;

  return (
    <motion.section
      id="aurora-hero"
      style={{ backgroundImage: bg }}
      className="relative overflow-hidden bg-[#09090C] text-gray-200"
    >
      {/* constrain height but leave breathing room on tall screens */}
      <div className="mx-auto grid min-h-[92svh] w-full max-w-6xl grid-cols-1 px-4 py-16 md:px-6 md:py-24">
        {/* logos */}
        <div className="pointer-events-none absolute left-4 top-4 z-20 flex items-center gap-2 md:left-6 md:top-6">
          <img
            src="/logos/nasa.png"
            alt="NASA"
            className="h-7 w-auto rounded-sm opacity-90"
            draggable={false}
          />
          <img
            src="/logos/uwindsor.png"
            alt="University of Windsor"
            className="h-7 w-auto rounded-sm opacity-90"
            draggable={false}
          />
        </div>

        {/* top-right links */}
        <div className="absolute right-4 top-4 z-20 hidden gap-2 md:flex">
          <Link
            href="/observatory"
            prefetch
            className="rounded-lg bg-emerald-800/30 px-3 py-1.5 text-sm font-medium text-emerald-200 ring-1 ring-emerald-700/50 hover:bg-emerald-700/40 hover:text-emerald-100"
          >
            Observatory
          </Link>
          <Link
            href="/impact"
            prefetch
            className="rounded-lg bg-sky-800/30 px-3 py-1.5 text-sm font-medium text-sky-200 ring-1 ring-sky-700/50 hover:bg-sky-700/40 hover:text-sky-100"
          >
            Impact Simulator
          </Link>
        </div>
        <div className="absolute right-4 top-4 z-20 flex gap-2 md:hidden">
          <Link
            href="/observatory"
            prefetch
            className="rounded-lg bg-emerald-800/30 px-3 py-1.5 text-sm font-medium text-emerald-200 ring-1 ring-emerald-700/50"
          >
            Observatory
          </Link>
          <Link
            href="/impact"
            prefetch
            className="rounded-lg bg-sky-800/30 px-3 py-1.5 text-sm font-medium text-sky-200 ring-1 ring-sky-700/50"
          >
            Impact
          </Link>
        </div>

        {/* HEADLINE + CTAs */}
        <div className="z-10 mx-auto w-full max-w-4xl text-center">
          <div className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full bg-emerald-900/30 px-3 py-1 text-xs text-emerald-200 ring-1 ring-emerald-700/40">
            <span>NASA Space Apps 2025</span>
            <span aria-hidden>•</span>
            <span>🏆 1st Place — Windsor</span>
            <span aria-hidden>•</span>
            <span>🌍 Global Nominee</span>
          </div>

          <h1 className="mt-4 text-4xl font-extrabold md:text-6xl">
            Meteor Madness
          </h1>

          <p className="mx-auto mt-3 max-w-2xl text-white/70 md:mt-4">
            Explore near-Earth objects with an interactive observatory, then
            simulate a hypothetical impact to visualize potential effects.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 md:mt-8">
            <Link
              href="/observatory"
              prefetch
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium ring-1 ring-emerald-500 hover:bg-emerald-600"
            >
              Launch Observatory
            </Link>
            <Link
              href="/impact"
              prefetch
              className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium ring-1 ring-sky-500 hover:bg-sky-600"
            >
              Open Impact Simulator
            </Link>
          </div>
        </div>

        {/* FEATURE CARDS — separated from CTAs with generous spacing */}
        <div className="z-10 mx-auto mt-8 w-full max-w-5xl gap-6 md:mt-12 md:grid md:grid-cols-3">
          <motion.article
            whileHover={{ y: -2 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            className="rounded-xl bg-neutral-900/60 p-5 ring-1 ring-white/10 backdrop-blur-sm md:p-6"
          >
            <h3 className="text-lg font-semibold text-white">Observatory</h3>
            <p className="mt-1 text-sm text-white/70">
              Query NASA NEOs and view heliocentric orbits in 2D/3D. Filter by
              date, size, hazard flags, and inspect closest approaches.
            </p>
            <div className="pt-3">
              <Link
                href="/observatory"
                prefetch
                className="text-sm text-emerald-300 underline underline-offset-4 hover:text-emerald-200"
              >
                Go to Observatory →
              </Link>
            </div>
          </motion.article>

          <motion.article
            whileHover={{ y: -2 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            className="mt-4 rounded-xl bg-neutral-900/60 p-5 ring-1 ring-white/10 backdrop-blur-sm md:mt-0 md:p-6"
          >
            <h3 className="text-lg font-semibold text-white">
              Impact Simulator
            </h3>
            <p className="mt-1 text-sm text-white/70">
              Configure a hypothetical impactor, run a 3D approach, then jump to
              a 3D Earth to see an estimated crater overlay.
            </p>
            <div className="pt-3">
              <Link
                href="/impact"
                prefetch
                className="text-sm text-sky-300 underline underline-offset-4 hover:text-sky-200"
              >
                Go to Impact Simulator →
              </Link>
            </div>
          </motion.article>

          <motion.article
            whileHover={{ y: -2 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            className="mt-4 rounded-xl bg-neutral-900/60 p-5 ring-1 ring-white/10 backdrop-blur-sm md:mt-0 md:p-6"
          >
            <h3 className="text-lg font-semibold text-white">
              Mission: Save Earth
            </h3>
            <p className="mt-1 text-sm text-white/70">
              Deflect the incoming asteroid with a kinetic impactor — tune mass,
              speed, and lead time using DART-style physics.
            </p>
            <div className="pt-3">
              <Link
                href="/deflection"
                prefetch
                className="text-sm text-emerald-300 underline underline-offset-4 hover:text-emerald-200"
              >
                Go to Deflection Lab →
              </Link>
            </div>
          </motion.article>
        </div>

        {/* Scroll hint */}
        <button
          onClick={() =>
            document
              .getElementById("team-planets")
              ?.scrollIntoView({ behavior: "smooth" })
          }
          className="z-10 mx-auto mt-12 flex w-fit flex-col items-center text-white/80 md:mt-16"
          aria-label="Scroll to team section"
        >
          <span className="text-xs tracking-wide">Meet the team</span>
          <motion.span
            className="mt-1 inline-block"
            animate={{ y: [0, 6, 0] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
          >
            ↓
          </motion.span>
        </button>
      </div>

      {/* Starfield (mounted on client) */}
      <div className="absolute inset-0 z-0">
        {mounted ? (
          <Canvas>
            <Stars radius={50} count={2500} factor={4} fade speed={2} />
          </Canvas>
        ) : (
          <div className="h-full w-full" />
        )}
      </div>
    </motion.section>
  );
}

/* -------- Team -------- */
type TeamMember = {
  name: string;
  isLeader?: boolean;
  planetImg: string;
  alt: string;
  links?: { label: string; href: string }[];
};

const TEAM: TeamMember[] = [
  {
    name: "Ahmad Ali",
    isLeader: true,
    planetImg: "/planets/earth.png",
    alt: "Earth",
    links: [{ label: "GitHub", href: "https://github.com/AhmadAli137" }],
  },
  {
    name: "Mohamed EL-Gohary",
    planetImg: "/planets/saturn.png",
    alt: "Saturn",
  },
  {
    name: "Muhammad Bagalagel",
    planetImg: "/planets/jupiter.png",
    alt: "Jupiter",
  },
  {
    name: "Falah Shahid",
    planetImg: "/planets/mars.png",
    alt: "Mars",
  },
  {
    name: "Ahmed Nuur",
    planetImg: "/planets/saturn.png",
    alt: "Saturn",
  },
  {
    name: "Faisal Bagalagel",
    planetImg: "/planets/jupiter.png",
    alt: "Jupiter",
  },
];

/** Deterministic pseudo-random star positions (stable across SSR/hydration). */
function seededStars(count: number) {
  let s = 1337;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const palette = ["#ffffff", "#a7f3d0", "#a5f3fc", "#e9d5ff"];
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    top: rnd() * 100,
    left: rnd() * 100,
    size: 1 + rnd() * 1.8,
    color: palette[Math.floor(rnd() * palette.length)],
    delay: rnd() * 5,
    duration: 2.4 + rnd() * 3.6,
  }));
}

const GALAXY_STARS = seededStars(110);

function GalaxyBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
      {/* nebula glows */}
      <div
        className="mm-nebula h-[420px] w-[420px] bg-emerald-500/10"
        style={{ top: "5%", left: "8%" }}
      />
      <div
        className="mm-nebula h-[520px] w-[520px] bg-indigo-500/10"
        style={{ top: "38%", right: "4%", animationDelay: "-6s" }}
      />
      <div
        className="mm-nebula h-[380px] w-[380px] bg-fuchsia-500/10"
        style={{ bottom: "6%", left: "28%", animationDelay: "-12s" }}
      />

      {/* twinkling stars */}
      {GALAXY_STARS.map((st) => (
        <div
          key={st.id}
          className="mm-star"
          style={{
            top: `${st.top}%`,
            left: `${st.left}%`,
            width: `${st.size}px`,
            height: `${st.size}px`,
            backgroundColor: st.color,
            boxShadow: `0 0 ${st.size * 3}px ${st.color}`,
            animationDelay: `${st.delay}s`,
            animationDuration: `${st.duration}s`,
          }}
        />
      ))}

      {/* shooting stars */}
      <div
        className="mm-shooting-star"
        style={{ top: "12%", right: "6%", animationDelay: "2s" }}
      />
      <div
        className="mm-shooting-star"
        style={{ top: "44%", right: "-2%", animationDelay: "7.5s" }}
      />
      <div
        className="mm-shooting-star"
        style={{ top: "70%", right: "12%", animationDelay: "13s" }}
      />
    </div>
  );
}

function TeamPlanets() {
  return (
    <section id="team-planets" className="mm-galaxy relative overflow-hidden">
      <GalaxyBackdrop />

      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 py-28 md:px-6">
        <header className="mb-10 text-center">
          <h2 className="mm-shimmer-text text-2xl font-bold md:text-4xl">
            Meet the Team
          </h2>
          <p className="mt-2 text-white/60">
            Scroll to explore the crew—each planet marks a teammate.
          </p>
        </header>

        <div className="space-y-16">
          {TEAM.map((m, i) => (
            <TeamRow key={m.name} member={m} flip={i % 2 === 1} />
          ))}
        </div>
      </div>
    </section>
  );
}

function TeamRow({ member, flip }: { member: TeamMember; flip?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [30, -30]);
  const scale = useTransform(scrollYProgress, [0, 1], [1.05, 0.95]);
  const t = useMotionTemplate`translateY(${y}px) scale(${scale})`;

  return (
    <div
      ref={ref}
      className={`grid grid-cols-1 items-center gap-6 md:grid-cols-2 ${
        flip ? "md:[&>*:first-child]:order-2" : ""
      }`}
    >
      <motion.div
        className="relative aspect-square w-full overflow-hidden rounded-full ring-1 ring-white/10 shadow-xl shadow-black/40"
        style={{ transform: t }}
      >
        <img
          src={member.planetImg}
          alt={member.alt}
          className="h-full w-full bg-transparent object-contain"
          draggable={false}
        />
        <div className="pointer-events-none absolute inset-0 rounded-full bg-white/5 mix-blend-overlay" />
      </motion.div>

      <div className="rounded-xl bg-neutral-900/60 p-5 ring-1 ring-white/10">
        <div className="text-xl font-semibold text-white">{member.name}</div>
        {member.isLeader && (
          <div className="mt-1 inline-flex items-center rounded-full bg-emerald-900/40 px-2.5 py-0.5 text-xs text-emerald-300 ring-1 ring-emerald-700/50">
            Team Leader
          </div>
        )}
        {member.links?.length ? (
          <div className="mt-4 flex flex-wrap gap-3">
            {member.links.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="text-sm text-emerald-300 underline underline-offset-4 hover:text-emerald-200"
              >
                {l.label} →
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
