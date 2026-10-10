import { isLanguage, type Language } from "./translation";

export interface LanguageStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}
export interface LanguageSnapshot {
  language: Language;
  ready: boolean;
  storageError: "load" | "save" | null;
}
const initial: LanguageSnapshot = { language: "en", ready: false, storageError: null };

export function languagePreferenceKey(prefix: string, accountId: string | null): string {
  return `${prefix}:${accountId === null ? "signed-out" : `account:${encodeURIComponent(accountId)}`}`;
}

/** Framework-independent, account-scoped preference state. Never reads auth storage. */
export function createLanguagePreference(storage: LanguageStorage, prefix: string) {
  let snapshot = initial;
  let accountId: string | null = null;
  let started = false;
  let revision = 0;
  const listeners = new Set<() => void>();
  const cache = new Map<string, LanguageSnapshot>();
  const writes = new Map<string, Promise<void>>();
  const intents = new Map<string, number>();
  const emit = (next: LanguageSnapshot) => {
    snapshot = next;
    listeners.forEach(listener => listener());
  };

  async function switchScope(nextAccount: string | null): Promise<void> {
    if (started && nextAccount === accountId) return;
    started = true;
    accountId = nextAccount;
    const currentRevision = ++revision;
    const key = languagePreferenceKey(prefix, nextAccount);
    const cached = cache.get(key);
    emit(cached ?? { ...initial });
    // A local selection (including a failed save) outranks storage during this session.
    if (cached) return;
    try {
      await writes.get(key);
      const stored = await storage.getItem(key);
      if (revision !== currentRevision) return;
      const loaded: LanguageSnapshot = {
        language: isLanguage(stored) ? stored : "en", ready: true, storageError: null,
      };
      cache.set(key, loaded);
      emit(loaded);
    } catch {
      if (revision !== currentRevision) return;
      const failed: LanguageSnapshot = { language: "en", ready: true, storageError: "load" };
      cache.set(key, failed);
      emit(failed);
    }
  }

  function setLanguage(language: Language): Promise<void> {
    if (!isLanguage(language)) return Promise.resolve();
    ++revision;
    const key = languagePreferenceKey(prefix, accountId);
    const intent = (intents.get(key) ?? 0) + 1;
    intents.set(key, intent);
    const chosen: LanguageSnapshot = { language, ready: true, storageError: null };
    cache.set(key, chosen);
    emit(chosen);
    // Ordered per key: a slow earlier write can never replace the latest selection.
    const write = (writes.get(key) ?? Promise.resolve())
      .then(() => storage.setItem(key, language))
      .then(() => {
        const cached = cache.get(key);
        if (cached && intents.get(key) === intent) {
          const saved = { ...cached, storageError: null };
          cache.set(key, saved);
          if (key === languagePreferenceKey(prefix, accountId)) emit(saved);
        }
      })
      .catch(() => {
        const cached = cache.get(key);
        if (cached && intents.get(key) === intent) {
          const failed: LanguageSnapshot = { ...cached, storageError: "save" };
          cache.set(key, failed);
          if (key === languagePreferenceKey(prefix, accountId)) emit(failed);
        }
      });
    writes.set(key, write);
    void write.then(() => { if (writes.get(key) === write) writes.delete(key); });
    return write;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    switchScope, setLanguage,
    async settled() { while (writes.size) await Promise.all(writes.values()); },
  };
}
