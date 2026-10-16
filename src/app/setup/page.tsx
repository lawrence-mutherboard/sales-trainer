import { getSetupOptions } from "@/lib/config/public";
import { SetupForm } from "./SetupForm";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ scenario?: string }> }) {
  const { scenario } = await searchParams;
  return (
    <div>
      <h1 className="text-2xl font-semibold">New practice call</h1>
      <p className="mt-1 text-slate-600">Pick a call type and press Start. Everything else is random unless you choose it, so every call is a new prospect.</p>
      <SetupForm options={getSetupOptions()} initialScenario={scenario} />
    </div>
  );
}
