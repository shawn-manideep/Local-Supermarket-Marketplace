export { en, te, type TranslationKey } from "./dictionaries";
export { LANGUAGE_OPTIONS, isLanguage, translate, type Language, type TranslationParams, type TranslationFunction } from "./translation";
export { createLanguagePreference, languagePreferenceKey, type LanguageStorage, type LanguageSnapshot } from "./preference";
export { LanguageProvider, useLanguageScope, useTranslation } from "./provider";
