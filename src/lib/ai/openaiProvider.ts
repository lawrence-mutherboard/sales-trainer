import "server-only";
import OpenAI from "openai";
import { config } from "@/lib/config";
import type { LlmProvider, ProspectRequest, ProspectResponse, ScoreRequest, ScoreResponse } from "./provider";

// OpenAI implementation, for trying the app before Anthropic API access is available.
// Uses Chat Completions with streaming for the prospect, and JSON-schema structured outputs for the scorer.
// Set OPENAI_API_KEY in .env.local. Optional: OPENAI_BASE_URL (for a proxy or a local test server).

let client: OpenAI | null = null;
export function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set. Add it to .env.local (or switch LLM_PROVIDER back to anthropic).");
  }
  client ??= new OpenAI({ baseURL: process.env.OPENAI_BASE_URL || undefined });
  return client;
}

async function streamProspect(req: ProspectRequest): Promise<ProspectResponse> {
  const cfg = config.ai.openai;

  const history = req.messages.slice(0, -1);
  const last = req.messages[req.messages.length - 1];

  const stream = await openai().chat.completions.create({
    model: cfg.prospect_model,
    stream: true,
    stream_options: { include_usage: true },
    max_completion_tokens: cfg.prospect_max_tokens,
    temperature: cfg.prospect_temperature,
    messages: [
      // Stable text first so OpenAI's automatic prompt caching can reuse the prefix.
      { role: "system", content: `${req.globalPrompt}\n\n${req.sessionPrompt}` },
      ...history,
      { role: last.role, content: `${last.content}\n\n${req.privateNote}` },
    ],
  });

  let refused = false;
  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    const delta = choice?.delta?.content;
    if (delta) req.onText(delta);
    if (choice?.delta?.refusal || choice?.finish_reason === "content_filter") refused = true;

    if (chunk.usage && process.env.NODE_ENV !== "production") {
      const u = chunk.usage;
      console.log(
        `[prospect:openai] cached=${u.prompt_tokens_details?.cached_tokens ?? 0} input=${u.prompt_tokens} output=${u.completion_tokens}`,
      );
    }
  }
  return { refused };
}

async function scoreJson(req: ScoreRequest): Promise<ScoreResponse> {
  const cfg = config.ai.openai;

  const res = await openai().chat.completions.create({
    model: cfg.scorer_model,
    max_completion_tokens: cfg.scorer_max_tokens,
    ...(cfg.scorer_reasoning_effort ? { reasoning_effort: cfg.scorer_reasoning_effort } : {}),
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "call_score", strict: true, schema: req.schema },
    },
  });

  const choice = res.choices[0];
  const refused = Boolean(choice?.message?.refusal) || choice?.finish_reason === "content_filter";
  return {
    text: choice?.message?.content ?? "",
    model: res.model ?? cfg.scorer_model,
    refused,
    refusalCategory: null,
    truncated: choice?.finish_reason === "length",
  };
}

export const openaiProvider: LlmProvider = { name: "openai", streamProspect, scoreJson };
