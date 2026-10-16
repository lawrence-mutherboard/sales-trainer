"use client";

import { useEffect, useRef, useState } from "react";

// "Test microphone" before a call: shows a live level bar and confirms the app can hear you, so a call isn't wasted on the
// wrong microphone or a muted headset. Nothing is recorded or sent anywhere.
export function MicCheck() {
  const [state, setState] = useState<"idle" | "listening" | "heard" | "blocked">("idle");
  const [level, setLevel] = useState(0);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  async function start() {
    stop.current?.();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let loudFrames = 0;
      let raf = 0;
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 8));
        if (rms > 0.03) loudFrames += 1;
        if (loudFrames > 15) setState("heard");
        raf = requestAnimationFrame(tick);
      };
      tick();
      const timeout = setTimeout(() => stop.current?.(), 20_000);
      stop.current = () => {
        cancelAnimationFrame(raf);
        clearTimeout(timeout);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => undefined);
        setLevel(0);
        stop.current = null;
        setState((s) => (s === "listening" ? "idle" : s));
      };
      setState("listening");
    } catch {
      setState("blocked");
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void start()} className="rounded-md border border-slate-300 bg-white px-3 py-1 font-medium hover:bg-slate-100">
          {state === "idle" || state === "blocked" ? "Test microphone" : "Test again"}
        </button>
        <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
          <div className={`h-2 rounded-full transition-[width] duration-75 ${level > 0.25 ? "bg-emerald-500" : "bg-slate-400"}`} style={{ width: `${level * 100}%` }} />
        </div>
        <span className="text-slate-600" aria-live="polite">
          {state === "idle" && "Check the app can hear you before you start."}
          {state === "listening" && "Say a few words…"}
          {state === "heard" && "✓ We can hear you."}
          {state === "blocked" && "The microphone is blocked. Allow it in the address bar."}
        </span>
      </div>
    </div>
  );
}
