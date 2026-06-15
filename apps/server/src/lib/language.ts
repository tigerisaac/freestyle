import { getDb } from "./db.js";

export const ISO_LANGUAGE_NAMES: Record<string, string> = {
  ar: "Arabic",
  cs: "Czech",
  da: "Danish",
  de: "German",
  el: "Greek",
  en: "English",
  es: "Spanish",
  fa: "Persian",
  fi: "Finnish",
  fr: "French",
  hi: "Hindi",
  hu: "Hungarian",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  mk: "Macedonian",
  ms: "Malay",
  nl: "Dutch",
  no: "Norwegian",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  sv: "Swedish",
  th: "Thai",
  tr: "Turkish",
  uk: "Ukrainian",
  vi: "Vietnamese",
  zh: "Chinese",
};

export function parseLanguageSetting(
  value: string | null | undefined,
): string[] {
  if (!value || value === "auto") return [];

  const seen = new Set<string>();
  const languages: string[] = [];

  for (const part of value.split(",")) {
    const normalized = part.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    languages.push(normalized);
  }

  return languages;
}

export function normalizeLanguageSetting(
  value: string | null | undefined,
): string | undefined {
  const languages = parseLanguageSetting(value);
  return languages.length === 1 ? languages[0] : undefined;
}

export function normalizeLanguageHintsSetting(
  value: string | null | undefined,
): string[] | undefined {
  const languages = parseLanguageSetting(value);
  return languages.length > 0 ? languages : undefined;
}

export function getLanguageSetting(): string | undefined {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = 'language'")
    .get() as { value: string } | undefined;
  return normalizeLanguageSetting(row?.value);
}

export function getLanguageHintsSetting(): string[] | undefined {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = 'language'")
    .get() as { value: string } | undefined;
  return normalizeLanguageHintsSetting(row?.value);
}
