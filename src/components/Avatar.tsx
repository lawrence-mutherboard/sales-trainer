/* eslint-disable @next/next/no-img-element */
// The prospect's portrait, with a soft glow while they are speaking. Falls back to initials.
export function Avatar({
  src,
  name,
  speaking = false,
  size = 96,
}: {
  src: string | null;
  name: string;
  speaking?: boolean;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex flex-col items-center">
      <div
        className={[
          "overflow-hidden rounded-full bg-slate-200 transition-shadow duration-300",
          speaking ? "shadow-[0_0_0_4px_rgba(99,102,241,0.55)]" : "shadow-[0_0_0_2px_rgba(148,163,184,0.5)]",
        ].join(" ")}
        style={{ width: size, height: size }}
      >
        {src ? (
          <img src={src} alt={`AI-generated portrait of ${name}`} width={size} height={size} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-slate-500">{initials}</div>
        )}
      </div>
      {src && <span className="mt-1 text-[10px] text-slate-400">AI-generated fictional person</span>}
    </div>
  );
}
