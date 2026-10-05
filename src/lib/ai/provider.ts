import "server-only";
import { anthropicProvider } from "./anthropicProvider";

// The app talks to the AI through this one interface. Claude (Anthropic) is the provider. Keeping the interface means
// another vendor could be added later without touching the call flow or the scorer.

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
  readonly name: "anthropic";
  streamProspect(req: ProspectRequest): Promise<ProspectResponse>;
  scoreJson(req: ScoreRequest): Promise<ScoreResponse>;
}

export class RefusalError extends Error {
  constructor(public category: string | null) {
    super("The model declined this request.");
  }
}

export function getProvider(): LlmProvider {
  return anthropicProvider;
}
