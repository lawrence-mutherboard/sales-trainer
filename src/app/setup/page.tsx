import { getSetupOptions } from "@/lib/config/public";
import { SetupForm } from "./SetupForm";

export default function SetupPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">New practice call</h1>
      <p className="mt-1 text-slate-600">Pick your settings. A fresh prospect is generated every time.</p>
      <SetupForm options={getSetupOptions()} />
    </div>
  );
}
