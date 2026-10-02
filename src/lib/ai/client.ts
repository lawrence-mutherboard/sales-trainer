import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";

// One shared client. It reads ANTHROPIC_API_KEY from the environment (server only).
// If the key is not tied to a workspace in the Anthropic Console, also set ANTHROPIC_WORKSPACE_ID so requests say which one to use.
let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  client ??= new Anthropic(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : undefined);
  return client;
}

export type BetaStreamParams = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];

/**
 * Server-side refusal fallback. If a safety classifier declines a request, the API re-runs it on
 * another model inside the same call. Controlled by config/ai.json -> refusal_fallback.
 * Returns extra request fields to merge in (empty when disabled or unsupported for this model).
 */
export function fallbackFields(model: string): Record<string, unknown> {
  const f = config.ai.refusal_fallback;
  if (!f.enabled || !f.supported_models.includes(model)) return {};
  return { betas: [f.beta], fallbacks: "default" };
}
