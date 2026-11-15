/**
 * Script guard for AI-written texts. The model sometimes slips a few characters of another script into a sentence
 * ("Discuss resistant hybrids with道の seed supplier"). English text may hold Latin letters only; Ukrainian text
 * Cyrillic and Latin (names, units). The micro sign is allowed in both for units. Pure: no I/O.
 */
export type TextLang = "en" | "uk";

const ALLOWED_EN = /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}μ]$/u;
const ALLOWED_UK = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}μ]$/u;

/** The first letter that does not belong to the language's scripts, or null when the text is clean. */
export function foreignScriptChar(text: string, lang: TextLang): string | null {
  const allowed = lang === "uk" ? ALLOWED_UK : ALLOWED_EN;
  for (const ch of text) if (!allowed.test(ch)) return ch;
  return null;
}

export const hasForeignScript = (text: string, lang: TextLang): boolean => foreignScriptChar(text, lang) !== null;
