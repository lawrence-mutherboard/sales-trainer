import "server-only";
import { config } from "@/lib/config";
import { anthropic, fallbackFields, type BetaStreamParams } from "./client";
import type { LlmProvider, ProspectRequest, ProspectResponse, ScoreRequest, ScoreResponse } from "./provider";

// Claude implementation (the intended provider). Uses prompt caching on the two system blocks, the
// "between_tools" thinking setting for fast replies, structured outputs for the scorer, and the
// server-side refusal fallback when enabled in config/ai.json.

async function streamProspect(req: ProspectRequest): Promise<ProspectResponse> {
  const model = config.ai.prospect.model;

  // The private clock note rides along as a second text block on the last message, outside the cached prefix.
  const history = req.messages.slice(0, -1);
  const last = req.messages[req.messages.length - 1];

  const params = {
    model,
    max_tokens: config.ai.prospect.max_tokens,
    system: [
      { type: "text", text: req.globalPrompt, cache_control: { type: "ephemeral" } },
      { type: "text", text: req.sessionPrompt, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      ...history,
      { role: last.role, content: [{ type: "text", text: last.content }, { type: "text", text: req.privateNote }] },
    ],
    ...(config.ai.prospect.thinking === "between_tools" ? { thinking: { type: "between_tools" } } : {}),
    ...fallbackFields(model),
  } as unknown as BetaStreamParams;

  const stream = anthropic().beta.messages.stream(params);
  stream.on("text", (delta: string) => req.onText(delta));
  const final = await stream.finalMessage();

  if (process.env.NODE_ENV !== "production") {
    const u = final.usage as unknown as Record<string, number>;
    console.log(
      `[prospect:anthropic] cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} input=${u.input_tokens} output=${u.output_tokens}`,
    );
  }
  return { refused: final.stop_reason === "refusal" };
}

async function scoreJson(req: ScoreRequest): Promise<ScoreResponse> {
  const model = config.ai.scorer.model;
  const params = {
    model,
    max_tokens: config.ai.scorer.max_tokens,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
    output_config: {
      effort: config.ai.scorer.effort,
      format: { type: "json_schema", schema: req.schema },
    },
    ...fallbackFields(model),
  } as unknown as BetaStreamParams;

  // Stream and wait for the final message: large outputs must be streamed to avoid HTTP timeouts.
  const message = await anthropic().beta.messages.stream(params).finalMessage();

  const refused = message.stop_reason === "refusal";
  const category = refused
    ? ((message as unknown as { stop_details?: { category?: string | null } }).stop_details?.category ?? null)
    : null;
  const textBlock = message.content.find((c) => c.type === "text");

  return {
    text: textBlock && textBlock.type === "text" ? textBlock.text : "",
    model: message.model ?? model,
    refused,
    refusalCategory: category,
    truncated: message.stop_reason === "max_tokens",
  };
}

export const anthropicProvider: LlmProvider = { name: "anthropic", streamProspect, scoreJson };
