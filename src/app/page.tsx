// src/app/page.tsx (Server component wrapper)
import HeroClient from "@/components/HeroClient"; // your client hero

export default function Page() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <HeroClient />
    </main>
  );
}
