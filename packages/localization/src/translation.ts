import { en, te, type TranslationKey } from "./dictionaries";

export type Language = "en" | "te";
export const LANGUAGE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "te", label: "తెలుగు" },
] as const;
export type TranslationParams = Readonly<Record<string, string | number>>;
export type TranslationFunction = (key: TranslationKey, params?: TranslationParams) => string;

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "te";
}

export function translate(language: Language, key: TranslationKey, params: TranslationParams = {}): string {
  const text = (language === "te" ? te[key] : undefined) || en[key];
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder);
}
