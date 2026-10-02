import "server-only";
import { config } from "@/lib/config";
import { anthropicProvider } from "./anthropicProvider";
import { openaiProvider } from "./openaiProvider";

// The app talks to the AI through this one interface, so the model vendor can be swapped with a setting.
// Claude is the intended provider (the prompts and rubric are tuned for it). OpenAI is supported so the app
// can be tried before Anthropic API access is sorted. Pick with LLM_PROVIDER=anthropic|openai in .env.local,
// or "provider" in config/ai.json.

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface ProspectRequest {
  /** Identical for every call (rules + company facts). Must come first so vendors can cache the prefix. */
  globalPrompt: string;
  /** This call's persona, hidden profile and objections. */
  sessionPrompt: string;
  /** Conversation so far. The last message is the rep's (or the "call connects" opener). */
  messages: ChatMsg[];
  /** Private system note (the call clock) to attach to the last message. Never shown or spoken. */
  privateNote: string;
  /** Called with each piece of reply text as it streams in. */
  onText: (delta: string) => void;
}

export interface ProspectResponse {
  refused: boolean;
}

export interface ScoreRequest {
  system: string;
  user: string;
  /** JSON Schema the reply must follow. */
  schema: Record<string, unknown>;
}

export interface ScoreResponse {
  text: string;
  /** The model that actually answered. */
  model: string;
  refused: boolean;
  refusalCategory: string | null;
  truncated: boolean;
}

export interface LlmProvider {
  readonly name: "anthropic" | "openai";
  streamProspect(req: ProspectRequest): Promise<ProspectResponse>;
  scoreJson(req: ScoreRequest): Promise<ScoreResponse>;
}

export class RefusalError extends Error {
  constructor(public category: string | null) {
    super("The model declined this request.");
  }
}

export function getProvider(): LlmProvider {
  const name = (process.env.LLM_PROVIDER ?? config.ai.provider).toLowerCase();
  if (name === "openai") return openaiProvider;
  if (name === "anthropic") return anthropicProvider;
  throw new Error(`Unknown LLM_PROVIDER "${name}". Use "anthropic" or "openai".`);
}
