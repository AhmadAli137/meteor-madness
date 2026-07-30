"use client";

import dynamic from "next/dynamic";
import TopNav from "@/components/TopNav";

const DeflectionLab3D = dynamic(() => import("@/components/DeflectionLab3D"), {
  ssr: false,
});

export default function DeflectionPage() {
  return (
    <main className="min-h-[100svh] bg-zinc-950 text-zinc-100">
      <TopNav />
      <div className="mx-auto max-w-[1400px] px-4 py-4 md:px-6">
        <h1 className="mb-3 text-xl font-semibold">
          Mission: Save Earth — Deflection Lab
        </h1>
        <DeflectionLab3D />
      </div>
    </main>
  );
}
