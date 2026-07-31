"use client";

import { useEffect, useState } from "react";
import {
  setSoundEnabled,
  soundEnabled,
  startAmbient,
  stopAmbient,
} from "@/lib/audio";

type Theme = "home" | "observatory" | "impact" | "globe" | "deflection";

/**
 * 🔊/🔇 toggle. Starts the page's ambient theme when sound is on, and keeps
 * the preference across pages (localStorage). Ambient switches theme with
 * the page and stops on unmount navigation.
 */
export default function SoundToggle({
  theme,
  className,
}: {
  theme: Theme;
  className?: string;
}) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const enabled = soundEnabled();
    setOn(enabled);
    if (enabled) startAmbient(theme);
    return () => stopAmbient();
  }, [theme]);

  return (
    <button
      onClick={() => {
        const next = !on;
        setOn(next);
        setSoundEnabled(next, theme);
      }}
      title={on ? "Sound on — click to mute" : "Sound off — click to enable"}
      aria-label={on ? "Mute sound" : "Enable sound"}
      className={
        className ??
        "rounded-lg bg-neutral-800/70 px-2.5 py-1.5 text-sm ring-1 ring-white/10 hover:bg-neutral-700"
      }
    >
      {on ? "🔊" : "🔇"}
    </button>
  );
}
