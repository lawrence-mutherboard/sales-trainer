"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { applyCorrections, type Correction } from "@/lib/voice/corrections";
import type { TurnTimingConfig } from "@/lib/voice/turnTiming";
import { pickAccent } from "@/lib/voice/accent";
import { playRingback, type Ringback } from "@/lib/voice/ring";
import { startAmbience, type Ambience } from "@/lib/voice/ambience";
import { browserVoiceSupported, createVoiceAdapter, type VoiceAdapter, type VoiceMode } from "@/lib/voice";

interface Props {
  sessionId: string;
  interrupted: boolean;
  prospect: { name: string; title: string; company: string; sizeLabel: string; deptLabel: string };
  scenario: { label: string; brief: string; success: string; limitMs: number };
  personality: string;
  portrait: string | null;
  /** Short acknowledgements ("Mm.", "Right.") played if the prospect is slow to answer. */
  fillers: string[];
  /** "whole": speak each reply as one piece (smoother). "sentences": speak sentence by sentence (starts sooner). */
  speakMode: "whole" | "first_then_rest" | "sentences";
  /** How long to wait before deciding the rep has finished speaking (from config/listening.json). */
  turnTiming: TurnTimingConfig;
  /** Fixes for words the speech recognition often mishears (from config/speech_corrections.json). */
  corrections: Correction[];
  /** What the prospect does when the rep goes quiet (from config/silence.json). */
  silence: SilenceConfig;
  /** The ringing before the prospect picks up (from config/call.json). */
  ring: RingConfig;
}

export interface RingConfig {
  enabled: boolean;
  minRings: number;
  maxRings: number;
  volume: number;
  ukPercent: number;
  ambience: { enabled: boolean; volume: number; onlyWithHeadphones: boolean };
}

export interface SilenceConfig {
  enabled: boolean;
  firstMs: number;
  secondMs: number;
  hangupMs: number;
  moods: { first: string; second: string; hangup: string };
  lines: { first: string[]; second: string[]; hangup: string[] };
}

type Phase = "precall" | "connecting" | "live" | "ending" | "scoring";
type Line = { key: number; speaker: "rep" | "prospect"; text: string };
type ReplyPayload = { repText?: string; startedMs?: number; endedMs?: number };
type StreamEvent =
  | { t: "delta"; text: string }
  | { t: "mood"; mood: string | null }
  | { t: "done"; turnId: string; idx: number; endCall: boolean }
  | { t: "error"; message: string; retryable?: boolean; repSaved?: boolean };

const MIN_CHUNK = 25; // characters; avoids speaking tiny one-word chunks
const MIN_FIRST_CHUNK = 12; // the first chunk is allowed to be shorter, so the prospect starts talking sooner
const FILLER_DELAY_MS = 700; // if the reply has not started this long after the rep stops, play a quick "mm" / "right"

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Splits streamed text into sentences. Hold back punctuation at the very end of the buffer until more text arrives. */
function takeSentences(buf: string, final: boolean): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buf;
  const re = /^([\s\S]+?[.!?…]+["')\]]*)(\s+|$)/;
  for (;;) {
    const m = re.exec(rest);
    if (!m) break;
    if (!final && m[2] === "") break;
    sentences.push(m[1].trim());
    rest = rest.slice(m[0].length);
  }
  if (final && rest.trim()) {
    sentences.push(rest.trim());
    rest = "";
  }
  return { sentences, rest };
}

export function CallClient({ sessionId, interrupted, prospect, scenario, personality, portrait, fillers, speakMode, turnTiming, corrections, silence, ring }: Props) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("precall");
  const [lines, setLines] = useState<Line[]>([]);
  const [interim, setInterim] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [mode, setMode] = useState<VoiceMode>("voice");
  const [notice, setNotice] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [typed, setTyped] = useState("");
  const [voiceOk, setVoiceOk] = useState(true);
  const [headphones, setHeadphones] = useState(false);
  const headphonesRef = useRef(false);
  const [ringing, setRinging] = useState(false);
  const ringingRef = useRef(false);
  const ringRef = useRef<Ringback | null>(null);
  const ambienceRef = useRef<Ambience | null>(null);
  /** The prospect's first words wait for this (the ringing) before they are spoken. */
  const gateRef = useRef<Promise<void>>(Promise.resolve());
  /** True while one of the prospect's "are you still there?" lines is being spoken. */
  const nudgeSpeakingRef = useRef(false);

  // Mutable call state lives in refs so async callbacks never see stale values.
  const adapterRef = useRef<VoiceAdapter | null>(null);
  const modeRef = useRef<VoiceMode>("voice");
  const t0Ref = useRef(0);
  const lineKey = useRef(0);
  const busyRef = useRef(false);
  const endedRef = useRef(false);
  const pendingRef = useRef<{ text: string; startedMs: number; endedMs: number } | null>(null);
  const timingsRef = useRef<{ idx: number; startedMs: number; endedMs: number }[]>([]);
  const lastPayloadRef = useRef<ReplyPayload | null>(null);
  const serverHasRepRef = useRef(false);
  // Silence follow-ups: timer, how many have been said since the rep last spoke, and a counter that changes whenever the rep does something.
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceStage = useRef(0);
  const silenceEpoch = useRef(0);
  const latest = useRef<{ armSilence: () => void; cancelSilence: () => void }>({ armSilence: () => {}, cancelSilence: () => {} });
  const unsubsRef = useRef<(() => void)[]>([]);

  const now = useCallback(() => Math.round(performance.now() - t0Ref.current), []);

  useEffect(() => {
    setVoiceOk(browserVoiceSupported());
    try {
      const saved = localStorage.getItem("trainer.headphones") === "1";
      setHeadphones(saved);
      headphonesRef.current = saved;
    } catch {
      /* storage unavailable: fine */
    }
  }, []);

  function changeHeadphones(on: boolean) {
    setHeadphones(on);
    headphonesRef.current = on;
    try {
      localStorage.setItem("trainer.headphones", on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  // Stop the mic and voice if the rep navigates away.
  useEffect(() => {
    return () => {
      latest.current.cancelSilence();
      unsubsRef.current.forEach((u) => u());
      adapterRef.current?.stop();
      ringRef.current?.stop();
      ambienceRef.current?.stop();
    };
  }, []);

  // ---------------- Ending the call ----------------

  const endCall = useCallback(
    async (endedBy: "rep" | "prospect" | "timeout") => {
      if (endedRef.current) return;
      endedRef.current = true;
      setPhase("ending");
      latest.current.cancelSilence();
      const durationMs = now();
      adapterRef.current?.stop();
      ambienceRef.current?.stop();
      ambienceRef.current = null;
      unsubsRef.current.forEach((u) => u());
      unsubsRef.current = [];

      try {
        await fetch(`/api/session/${sessionId}/end`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endedBy, durationMs, timings: timingsRef.current }),
        });
      } catch {
        /* the report page can still trigger scoring */
      }
      setPhase("scoring");
      try {
        await fetch(`/api/session/${sessionId}/score`, { method: "POST" });
      } catch {
        /* the report page shows a retry button */
      }
      router.push(`/report/${sessionId}`);
    },
    [now, router, sessionId],
  );

  // ---------------- Asking the AI prospect for a reply ----------------

  const requestReply: (payload: ReplyPayload, isRetry?: boolean) => Promise<void> = useCallback(
    async (payload: ReplyPayload, isRetry = false) => {
      const adapter = adapterRef.current;
      if (!adapter || endedRef.current) return;

      latest.current.cancelSilence(); // the rep spoke, so any "are you still there?" countdown is over
      busyRef.current = true;
      setThinking(true);
      setNotice(null);
      setRetryable(false);
      if (!isRetry) lastPayloadRef.current = payload;

      // After a server-side failure the rep's turn is already saved, so a retry sends no text.
      const body = isRetry && serverHasRepRef.current ? { nowMs: now(), inputMode: modeRef.current } : { ...payload, nowMs: now(), inputMode: modeRef.current };

      const lineId = ++lineKey.current;
      let started = false;
      let pendingSentence = "";
      let carry = "";
      const spoken: Promise<{ startedMs: number; endedMs: number }>[] = [];
      let endCallRequested = false;
      let doneIdx = -1;

      let mood: string | null = null;
      let fillerTimer: ReturnType<typeof setTimeout> | null = null;

      const speakChunk = (text: string) => {
        if (text.trim()) spoken.push(gateRef.current.then(() => adapter.speak(text.trim(), mood)));
      };

      let wholeReply = "";
      let firstSpoken = false;
      const handleText = (text: string, final: boolean) => {
        if (speakMode === "first_then_rest") {
          // Start speaking after the first sentence, then say the rest as one piece (starts sooner than "whole").
          wholeReply += text;
          if (!firstSpoken) {
            const m = /^([\s\S]+?[.!?…]+["')\]]*)\s+/.exec(wholeReply.trimStart());
            if (m && m[1].length >= MIN_FIRST_CHUNK) {
              speakChunk(m[1]);
              firstSpoken = true;
              wholeReply = wholeReply.trimStart().slice(m[0].length);
            }
          }
          if (final && wholeReply.trim()) {
            speakChunk(wholeReply);
            wholeReply = "";
          }
          return;
        }
        if (speakMode === "whole") {
          // Speak the reply as one piece, so the voice flows like a real sentence-to-sentence delivery.
          wholeReply += text;
          if (final && wholeReply.trim()) {
            speakChunk(wholeReply);
            wholeReply = "";
          }
          return;
        }
        pendingSentence += text;
        const { sentences, rest } = takeSentences(pendingSentence, final);
        pendingSentence = rest;
        for (const s of sentences) {
          carry = carry ? `${carry} ${s}` : s;
          if (carry.length >= (spoken.length === 0 ? MIN_FIRST_CHUNK : MIN_CHUNK)) {
            speakChunk(carry);
            carry = "";
          }
        }
        if (final && carry) {
          speakChunk(carry);
          carry = "";
        }
      };

      // If the reply is slow, a quick "mm" / "right" keeps the call feeling alive (played from audio prepared at call start).
      if (modeRef.current === "voice" && fillers.length > 0 && (payload.repText?.length ?? 0) > 25) {
        fillerTimer = setTimeout(() => {
          if (!started && !endedRef.current) spoken.push(adapter.speak(fillers[Math.floor(Math.random() * fillers.length)]));
        }, FILLER_DELAY_MS);
      }

      try {
        const res = await fetch(`/api/session/${sessionId}/turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          throw Object.assign(new Error(err.error ?? "Couldn't reach the prospect"), { notReached: true });
        }
        if (payload.repText) serverHasRepRef.current = true;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let failed: string | null = null;

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const raw = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!raw) continue;
            const ev = JSON.parse(raw) as StreamEvent;
            if (ev.t === "mood") {
              mood = ev.mood;
            } else if (ev.t === "delta") {
              if (!started) {
                started = true;
                if (fillerTimer) clearTimeout(fillerTimer);
                setThinking(false);
                setLines((l) => [...l, { key: lineId, speaker: "prospect", text: ev.text }]);
              } else {
                setLines((l) => l.map((x) => (x.key === lineId ? { ...x, text: x.text + ev.text } : x)));
              }
              handleText(ev.text, false);
            } else if (ev.t === "done") {
              endCallRequested = ev.endCall;
              doneIdx = ev.idx;
            } else if (ev.t === "error") {
              failed = ev.message;
              if (ev.repSaved === false) serverHasRepRef.current = false;
            }
          }
        }

        if (failed) {
          // Remove any partial text from the screen; the retry regenerates the reply.
          if (started) setLines((l) => l.filter((x) => x.key !== lineId));
          cancelSpokenAudio(adapter);
          setNotice(failed);
          setRetryable(true);
          return;
        }

        handleText("", true);
        serverHasRepRef.current = false;

        // Wait for the prospect to finish talking, then record how long they spoke (for the talk ratio).
        const spans = await Promise.all(spoken);
        if (spans.length && doneIdx >= 0) {
          timingsRef.current.push({
            idx: doneIdx,
            startedMs: Math.min(...spans.map((s) => s.startedMs)),
            endedMs: Math.max(...spans.map((s) => s.endedMs)),
          });
        }
        if (endCallRequested) {
          setTimeout(() => void endCall("prospect"), 800);
          return;
        }
      } catch (err) {
        console.error(err);
        cancelSpokenAudio(adapter);
        const e = err as Error & { notReached?: boolean };
        setNotice(e.message || "Connection problem.");
        setRetryable(true);
        return;
      } finally {
        if (fillerTimer) clearTimeout(fillerTimer);
        busyRef.current = false;
        setThinking(false);
      }

      // Anything the rep said while the prospect was replying gets sent now.
      const queued = pendingRef.current;
      if (queued && !endedRef.current) {
        pendingRef.current = null;
        void requestReply({ repText: queued.text, startedMs: queued.startedMs, endedMs: queued.endedMs });
      } else if (!endedRef.current) {
        latest.current.armSilence(); // the prospect has finished talking: start waiting for the rep
      }
    },
    [endCall, now, sessionId, fillers, speakMode],
  );

  // ---------------- If the rep goes quiet: "Hello?", "Hello?", then hang up ----------------
  // The countdown starts when the prospect finishes talking (or the rep last spoke). Any speech from the rep resets it.

  function cancelSilence() {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
    silenceStage.current = 0;
    silenceEpoch.current += 1;
  }

  function armSilence() {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
    // Typed calls are exempt: typing takes time.
    if (!silence.enabled || modeRef.current !== "voice" || endedRef.current) return;
    const stage = silenceStage.current + 1;
    const delay = stage === 1 ? silence.firstMs : stage === 2 ? silence.secondMs : silence.hangupMs;
    silenceTimer.current = setTimeout(() => void fireNudge(stage), delay);
  }

  async function fireNudge(stage: number) {
    silenceTimer.current = null;
    const adapter = adapterRef.current;
    if (!adapter || endedRef.current || busyRef.current) return;

    // If the rep is talking, or has just finished and their words are still being turned into text, do not nudge them.
    // Look again shortly.
    if (adapter.isUserSpeaking?.() || adapter.isTurnPending?.()) {
      silenceTimer.current = setTimeout(() => void fireNudge(stage), 800);
      return;
    }

    if (ringingRef.current) return;
    const kind = stage === 1 ? "first" : stage === 2 ? "second" : "hangup";
    const pool = silence.lines[kind];
    const text = pool[Math.floor(Math.random() * pool.length)];
    const epoch = silenceEpoch.current;

    busyRef.current = true; // hold any reply off while the prospect is talking
    nudgeSpeakingRef.current = true;
    try {
      // Speak first, then save it to the transcript, so a rep who starts talking at the last moment doesn't leave a phantom line behind.
      const span = await adapter.speak(text, silence.moods[kind]);
      if (span.endedMs > span.startedMs) {
        const res = await fetch(`/api/session/${sessionId}/nudge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`nudge ${res.status}`);
        const { idx } = (await res.json()) as { idx: number };
        setLines((l) => [...l, { key: ++lineKey.current, speaker: "prospect", text }]);
        timingsRef.current.push({ idx, startedMs: span.startedMs, endedMs: span.endedMs });
      }
    } catch (err) {
      console.warn("Silence follow-up failed", err);
      nudgeSpeakingRef.current = false;
      busyRef.current = false;
      return; // give up quietly; the next thing the rep does starts things again
    }
    nudgeSpeakingRef.current = false;
    busyRef.current = false;
    if (endedRef.current || epoch !== silenceEpoch.current) return; // the rep spoke in the meantime

    const queued = pendingRef.current;
    if (queued) {
      pendingRef.current = null;
      void requestReply({ repText: queued.text, startedMs: queued.startedMs, endedMs: queued.endedMs });
      return;
    }
    if (stage >= 3) {
      void endCall("prospect"); // said goodbye after the rep stayed silent
      return;
    }
    silenceStage.current = stage;
    armSilence();
  }
  latest.current = { armSilence, cancelSilence };

  function cancelSpokenAudio(adapter: VoiceAdapter) {
    adapter.cancelSpeech();
  }

  // ---------------- Starting the call ----------------

  const attachAdapter = useCallback(
    async (m: VoiceMode) => {
      unsubsRef.current.forEach((u) => u());
      unsubsRef.current = [];
      adapterRef.current?.stop();

      const adapter = createVoiceAdapter(m);
      adapterRef.current = adapter;
      modeRef.current = m;
      setMode(m);

      unsubsRef.current.push(
        adapter.onInterim((t) => {
          if (ringingRef.current) return; // still ringing: nobody has picked up yet
          setInterim(t);
          if (t) {
            // If the rep starts talking over "are you still there?", the prospect stops and listens.
            if (nudgeSpeakingRef.current) adapter.cancelSpeech();
            // The rep is talking: restart the silence countdown from now.
            latest.current.cancelSilence();
            latest.current.armSilence();
          }
        }),
        adapter.onSpeaking((s) => setSpeaking(s)),
        adapter.onError((message) => {
          setNotice(message);
        }),
        adapter.onUserSpeech((raw) => {
          if (endedRef.current || ringingRef.current) return;
          // Fix words the recogniser often mishears ("bed time" -> "bad time", "motherboard" -> "mutherboard").
          const u = { ...raw, text: applyCorrections(raw.text, corrections) };
          setInterim("");
          setLines((l) => [...l, { key: ++lineKey.current, speaker: "rep", text: u.text }]);
          if (busyRef.current) {
            const p = pendingRef.current;
            pendingRef.current = p
              ? { text: `${p.text} ${u.text}`, startedMs: p.startedMs, endedMs: u.endedMs }
              : { text: u.text, startedMs: u.startedMs, endedMs: u.endedMs };
            return;
          }
          void requestReply({ repText: u.text, startedMs: u.startedMs, endedMs: u.endedMs });
        }),
      );

      await adapter.start({ now, voiceSeed: prospect.name, personality, headphones: headphonesRef.current, turnTiming });
    },
    [now, prospect.name, personality, requestReply, corrections, turnTiming],
  );

  const beginCall = useCallback(
    async (m: VoiceMode) => {
      setPhase("connecting");
      setNotice(null);
      t0Ref.current = performance.now();
      try {
        await attachAdapter(m);
      } catch (e) {
        setPhase("precall");
        setNotice(e instanceof Error ? e.message : "Couldn't start the call.");
        return;
      }
      // Download the short "mm" / "right" fillers in the background so they can play instantly later.
      void adapterRef.current?.prepare(fillers);

      // The phone rings first, as on a real cold call. The prospect's opening line is fetched while it rings, and spoken
      // as soon as they "pick up".
      const rings = ring.enabled && m === "voice";
      if (rings) {
        const count = ring.minRings + Math.floor(Math.random() * (ring.maxRings - ring.minRings + 1));
        const rb = playRingback(pickAccent(prospect.name, ring.ukPercent), count, ring.volume);
        ringRef.current = rb;
        gateRef.current = rb.done;
        ringingRef.current = true;
        setRinging(true);
        void requestReply({});
        await rb.done;
        ringRef.current = null;
        ringingRef.current = false;
        setRinging(false);
      }
      t0Ref.current = performance.now(); // the call clock starts when the prospect picks up
      if (m === "voice" && ring.ambience.enabled && (headphonesRef.current || !ring.ambience.onlyWithHeadphones)) {
        ambienceRef.current = startAmbience(ring.ambience.volume);
      }
      setPhase("live");
      if (!rings) void requestReply({}); // the prospect answers the phone first
    },
    [attachAdapter, requestReply, fillers, ring, prospect.name],
  );

  // Switch to typing during a call (for example if the mic stops working).
  async function switchToTyping() {
    try {
      await attachAdapter("typed");
      setNotice("Switched to typing. Talk time isn't measured for typed calls.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't switch to typing.");
    }
  }

  // ---------------- Timer ----------------

  useEffect(() => {
    if (phase !== "live") return;
    const timer = setInterval(() => {
      const ms = now();
      setElapsed(ms);
      // Hard stop 30s after the time limit, if the prospect isn't mid-reply.
      if (ms >= scenario.limitMs + 30_000 && !busyRef.current) void endCall("timeout");
    }, 500);
    return () => clearInterval(timer);
  }, [phase, now, scenario.limitMs, endCall]);

  // Keep the transcript scrolled to the latest line.
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines, thinking, interim]);

  function sendTyped(e: React.FormEvent) {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    setTyped("");
    (adapterRef.current as unknown as { submit?: (t: string) => void })?.submit?.(text);
  }

  // ---------------- Rendering ----------------

  if (interrupted && phase === "precall") {
    return (
      <div className="mx-auto mt-10 max-w-lg rounded-xl border border-amber-300 bg-amber-50 p-6">
        <h1 className="text-xl font-semibold">This call was interrupted</h1>
        <p className="mt-2 text-slate-700">
          The page was closed or reloaded during the call, and calls can&apos;t be resumed. You can still score what was said so far.
        </p>
        <button
          onClick={() => {
            t0Ref.current = performance.now();
            void endCall("rep");
          }}
          className="mt-4 rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700"
        >
          End call and get my score
        </button>
      </div>
    );
  }

  if (phase === "ending" || phase === "scoring") {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
        <h1 className="mt-6 text-xl font-semibold">{phase === "ending" ? "Hanging up…" : "Scoring your call…"}</h1>
        <p className="mt-2 text-slate-600">This usually takes 20 to 40 seconds. Please keep this page open.</p>
      </div>
    );
  }

  const overTime = elapsed > scenario.limitMs;

  if (phase === "precall" || phase === "connecting") {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold">{scenario.label}</h1>
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-5">
            <Avatar src={portrait} name={prospect.name} size={96} />
            <div>
              <p className="text-sm uppercase tracking-wide text-slate-500">You&apos;re calling</p>
              <p className="mt-1 text-xl font-semibold">{prospect.name}</p>
              <p className="text-slate-700">
                {prospect.title}, {prospect.company}
              </p>
              <p className="text-sm text-slate-500">
                {prospect.sizeLabel} · {prospect.deptLabel}
              </p>
            </div>
          </div>
          <hr className="my-4 border-slate-200" />
          <p className="text-slate-700">{scenario.brief}</p>
          <p className="mt-3 rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
            <strong>To pass:</strong> {scenario.success}
          </p>
          <p className="mt-3 text-sm text-slate-500">Time limit: {fmt(scenario.limitMs)}.</p>
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={headphones} onChange={(e) => changeHeadphones(e.target.checked)} className="mt-1" />
            <span>
              <strong>I&apos;m wearing headphones.</strong> The microphone stays open while the prospect talks, so your first words aren&apos;t lost.
              Leave this off if you use speakers, or the app will hear the prospect.
            </span>
          </label>
        </div>

        {!voiceOk && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Voice calls need Chrome or Edge. You can still practise by typing.
          </p>
        )}
        {notice && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{notice}</p>}

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={() => void beginCall("voice")}
            disabled={!voiceOk || phase === "connecting"}
            className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {phase === "connecting" ? (ringing ? "Ringing…" : "Connecting…") : "Start call (voice)"}
          </button>
          <button
            onClick={() => void beginCall("typed")}
            disabled={phase === "connecting"}
            className="rounded-lg border border-slate-300 bg-white px-6 py-3 font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            Type instead
          </button>
        </div>
      </div>
    );
  }

  // Live call
  const status = thinking ? "Prospect is thinking…" : speaking ? "Prospect is speaking" : mode === "voice" ? "Listening…" : "Your turn";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Avatar src={portrait} name={prospect.name} speaking={speaking} size={64} />
          <div>
            <h1 className="text-xl font-semibold">
              {prospect.name} <span className="font-normal text-slate-500">· {prospect.company}</span>
            </h1>
            <p className="text-sm text-slate-500">{scenario.label}</p>
          </div>
        </div>
        <div className="text-right">
          <p className={`font-mono text-2xl ${overTime ? "text-red-600" : "text-slate-900"}`}>{fmt(elapsed)}</p>
          <p className="text-xs text-slate-500">of {fmt(scenario.limitMs)}</p>
        </div>
      </div>

      <p className="mt-2 text-sm font-medium text-indigo-700" aria-live="polite">
        {status}
      </p>

      <div className="mt-3 h-[26rem] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {lines.length === 0 && <p className="text-slate-400">Waiting for {prospect.name} to pick up…</p>}
        <ul className="space-y-3">
          {lines.map((l) => (
            <li key={l.key} className={l.speaker === "rep" ? "text-right" : "text-left"}>
              <span
                className={[
                  "inline-block max-w-[85%] rounded-2xl px-4 py-2 text-left text-sm",
                  l.speaker === "rep" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-900",
                ].join(" ")}
              >
                {l.text}
              </span>
            </li>
          ))}
          {interim && (
            <li className="text-right">
              <span className="inline-block max-w-[85%] rounded-2xl bg-indigo-100 px-4 py-2 text-left text-sm italic text-indigo-900">
                {interim}
              </span>
            </li>
          )}
        </ul>
        <div ref={bottomRef} />
      </div>

      {notice && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>{notice}</span>
          {retryable && (
            <button
              onClick={() => void requestReply(lastPayloadRef.current ?? {}, true)}
              className="rounded border border-amber-400 px-2 py-0.5 font-medium hover:bg-amber-100"
            >
              Try again
            </button>
          )}
          {mode === "voice" && (
            <button onClick={() => void switchToTyping()} className="rounded border border-amber-400 px-2 py-0.5 font-medium hover:bg-amber-100">
              Switch to typing
            </button>
          )}
        </div>
      )}

      {mode === "typed" && (
        <form onSubmit={sendTyped} className="mt-3 flex gap-2">
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type what you'd say…"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2"
            autoFocus
          />
          <button className="rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700" type="submit">
            Send
          </button>
        </form>
      )}

      <div className="mt-4 flex justify-end">
        <button
          onClick={() => void endCall("rep")}
          className="rounded-lg bg-red-600 px-6 py-3 font-medium text-white hover:bg-red-700"
        >
          Hang up
        </button>
      </div>
    </div>
  );
}
