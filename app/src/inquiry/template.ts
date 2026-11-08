// Deterministic inquiry text, used when no LLM is configured or the LLM call
// fails. Only mentions facts the listing actually has.

import { formatPlace, listingFacts, type InquiryListing } from "./facts";
import type { InquiryProfile } from "./profile";

const DEFAULT_SIGNATURE = "[Eure Namen]";
const DEFAULT_ABOUT = "[Kurz über euch: wer zieht ein, Beruf, Einkommen, gewünschter Einzug]";

export function buildTemplateInquiry(listing: InquiryListing, profile: InquiryProfile): string {
  const facts = listingFacts(listing);
  const factLine = facts.length > 0 ? ` (${facts.join(", ")})` : "";
  const place = formatPlace(listing);

  return [
    "Sehr geehrte Damen und Herren,",
    "",
    `wir interessieren uns sehr für Ihre Wohnung „${listing.title}“ in ${place}${factLine}.`,
    "",
    profile.about || DEFAULT_ABOUT,
    "",
    "Wir würden uns freuen, die Wohnung bei einem Besichtigungstermin kennenzulernen. " +
      "Vollständige Unterlagen (Einkommensnachweise, SCHUFA-Auskunft, Mietschuldenfreiheitsbescheinigung) " +
      "reichen wir gerne nach.",
    "",
    "Mit freundlichen Grüßen",
    profile.signature || DEFAULT_SIGNATURE,
  ].join("\n");
}
