// Picks the inquiry text source: LLM when configured, template otherwise or
// when the LLM call fails (the user always gets a usable text).

import type { InquiryListing } from "./facts";
import type { InquiryGenerator } from "./llm";
import type { InquiryProfile } from "./profile";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { buildTemplateInquiry } from "./template";

export type InquiryResult =
  | { readonly text: string; readonly source: "llm"; readonly model: string; readonly warning: null }
  | { readonly text: string; readonly source: "template"; readonly model: null; readonly warning: string | null };

export async function generateInquiry(
  listing: InquiryListing,
  profile: InquiryProfile,
  generator: InquiryGenerator | null,
): Promise<InquiryResult> {
  const template = buildTemplateInquiry(listing, profile);
  if (!generator) return { text: template, source: "template", model: null, warning: null };

  try {
    const text = await generator.generate({ system: SYSTEM_PROMPT, prompt: buildUserPrompt(listing, profile) });
    return { text, source: "llm", model: generator.model, warning: null };
  } catch (error) {
    // Message only: SDK errors carry the request body (household profile).
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[inquiry] LLM (${generator.model}) failed, using template: ${reason}`);
    return { text: template, source: "template", model: null, warning: "KI nicht erreichbar – Vorlage verwendet." };
  }
}
