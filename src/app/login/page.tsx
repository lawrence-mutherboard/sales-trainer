import { AuthForm } from "./AuthForm";

const MESSAGES: Record<string, string> = {
  domain: "Only mutherboard.com email addresses can use this app.",
  unconfirmed: "Please confirm your email first. Check your inbox (and spam) for the link, then sign in.",
  auth: "That link didn't work. If you already confirmed your email, just sign in below. Otherwise request a new link.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Sales call practice</h1>
      <p className="mt-2 text-slate-600">
        Hold a voice call with an AI prospect, get scored against the mutherboard rubric, and see exactly how to improve.
      </p>
      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{MESSAGES[error] ?? MESSAGES.auth}</p>
      )}
      <div className="mt-6">
        <AuthForm signOutFirst={error === "domain" || error === "unconfirmed"} />
      </div>
      <p className="mt-6 text-xs text-slate-500">
        Calls are recorded as text transcripts and kept for 90 days. To turn your speech into text, your voice is sent
        to Google&apos;s speech service (through Chrome) and to OpenAI for a more accurate transcript. The prospect&apos;s
        voice is made by ElevenLabs, and the prospect&apos;s words come from Anthropic&apos;s Claude. This app does not store any audio.
      </p>
    </div>
  );
}
