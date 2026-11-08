// LLM text generation via the Vercel AI SDK against any OpenAI-compatible
// endpoint: OpenRouter by default, or a local server (Ollama, LM Studio) via
// INQUIRY_BASE_URL. Same code path locally and on the server.

import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { InquiryLlmConfig } from "../env";

export type GenerateRequest = { readonly system: string; readonly prompt: string };

export type InquiryGenerator = {
  readonly model: string;
  generate(request: GenerateRequest): Promise<string>;
};

// Reasoning models spend most of this on thinking before the ~300 text tokens.
const MAX_OUTPUT_TOKENS = 4000;
const TIMEOUT_MS = 30_000;

export function createLlmGenerator(config: InquiryLlmConfig): InquiryGenerator {
  const provider = createOpenAICompatible({
    name: "inquiry",
    baseURL: config.baseUrl,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  });
  const model = provider(config.model);

  return {
    model: config.model,
    async generate({ system, prompt }) {
      const { text, finishReason } = await generateText({
        model,
        system,
        prompt,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (finishReason === "length") throw new Error("LLM text was cut off (max output tokens)");
      const trimmed = text.trim();
      if (!trimmed) throw new Error("LLM returned an empty text");
      return trimmed;
    },
  };
}
