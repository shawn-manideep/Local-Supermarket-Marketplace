export const en = {
  "common.language": "Language",
  "common.languageHelp": "Choose your interface language. More screens will be translated in later phases.",
  "common.languageLoadError": "Your language preference could not be loaded. English is being used for now.",
  "common.languageSaveError": "Your language preference could not be saved. It may not be remembered next time.",
  "common.loading": "Loading…",
  "common.greeting": "Hello, {name}!",
  "common.englishFallback": "English fallback",
  "auth.language": "Sign-in language",
  "customer.language": "Preferred language",
} as const;

export type TranslationKey = keyof typeof en;

// Partial by design: lookup falls back to English, never to a blank label.
export const te: Partial<Record<TranslationKey, string>> = {
  "common.language": "భాష",
  "common.languageHelp": "ఇంటర్‌ఫేస్ భాషను ఎంచుకోండి. ఇతర తెరల అనువాదం తరువాతి దశల్లో అందుబాటులోకి వస్తుంది.",
  "common.languageLoadError": "మీ భాష ప్రాధాన్యతను లోడ్ చేయలేకపోయాము. ప్రస్తుతానికి ఆంగ్లం ఉపయోగించబడుతోంది.",
  "common.languageSaveError": "మీ భాష ప్రాధాన్యతను సేవ్ చేయలేకపోయాము. తదుపరిసారి ఇది గుర్తుండకపోవచ్చు.",
  "common.loading": "లోడ్ అవుతోంది…",
  "common.greeting": "నమస్కారం, {name}!",
  "auth.language": "సైన్-ఇన్ భాష",
  "customer.language": "ప్రాధాన్య భాష",
};
