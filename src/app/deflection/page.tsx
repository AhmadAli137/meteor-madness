"use client";

import dynamic from "next/dynamic";
import TopNav from "@/components/TopNav";

const DeflectionLab3D = dynamic(() => import("@/components/DeflectionLab3D"), {
  ssr: false,
});

export default function DeflectionPage() {
  return (
    <main className="flex h-[100svh] flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <TopNav />
      <div className="min-h-0 flex-1">
        <DeflectionLab3D />
      </div>
    </main>
  );
}
