import { createContext, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore, type PropsWithChildren } from "react";
import { createLanguagePreference, type LanguageStorage } from "./preference";
import { translate, type Language, type TranslationFunction } from "./translation";

type Preference = ReturnType<typeof createLanguagePreference>;
const LanguageContext = createContext<Preference | null>(null);

export function LanguageProvider({ storage, storageKeyPrefix, children }: PropsWithChildren<{
  storage: LanguageStorage; storageKeyPrefix: string;
}>) {
  const [preference] = useState(() => createLanguagePreference(storage, storageKeyPrefix));
  return <LanguageContext.Provider value={preference}>{children}</LanguageContext.Provider>;
}

function usePreference() {
  const preference = useContext(LanguageContext);
  if (!preference) throw new Error("Language hooks require LanguageProvider.");
  return preference;
}

/** Call in the existing session-owning root; never change session handling. */
export function useLanguageScope(accountId: string | null) {
  const preference = usePreference();
  useLayoutEffect(() => { void preference.switchScope(accountId); }, [preference, accountId]);
}

export function useTranslation() {
  const preference = usePreference();
  const snapshot = useSyncExternalStore(preference.subscribe, preference.getSnapshot, preference.getSnapshot);
  const t = useMemo<TranslationFunction>(() =>
    (key, params) => translate(snapshot.language, key, params), [snapshot.language]);
  return {
    ...snapshot, t,
    setLanguage: (language: Language) => preference.setLanguage(language),
  };
}
