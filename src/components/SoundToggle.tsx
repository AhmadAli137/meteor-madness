"use client";

import { useEffect, useState } from "react";
import {
  getVolume,
  setSoundEnabled,
  setVolume,
  soundEnabled,
  startAmbient,
  stopAmbient,
} from "@/lib/audio";

type Theme = "home" | "observatory" | "impact" | "globe" | "deflection";

/**
 * 🔊/🔇 toggle + volume slider. Starts the page's ambient theme when sound
 * is on; preference and volume persist across pages (localStorage).
 */
export default function SoundToggle({ theme }: { theme: Theme }) {
  const [on, setOn] = useState(false);
  const [vol, setVol] = useState(0.8);

  useEffect(() => {
    const enabled = soundEnabled();
    setOn(enabled);
    setVol(getVolume());
    if (enabled) startAmbient(theme);
    return () => stopAmbient();
  }, [theme]);

  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-neutral-800/70 px-2 py-1 ring-1 ring-white/10">
      <button
        onClick={() => {
          const next = !on;
          setOn(next);
          setSoundEnabled(next, theme);
        }}
        title={on ? "Sound on — click to mute" : "Sound off — click to enable"}
        aria-label={on ? "Mute sound" : "Enable sound"}
        className="text-sm leading-none"
      >
        {on ? "🔊" : "🔇"}
      </button>
      {on && (
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(vol * 100)}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            setVol(v);
            setVolume(v);
          }}
          className="w-16 accent-emerald-500"
          title="Volume"
          aria-label="Volume"
        />
      )}
    </div>
  );
}
