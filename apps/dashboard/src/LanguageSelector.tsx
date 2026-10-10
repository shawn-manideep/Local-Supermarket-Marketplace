import React from "react";
import { LANGUAGE_OPTIONS, useTranslation } from "@workspace/localization";

type LanguageLabelKey = "auth.language" | "vendor.language" | "delivery.language" | "admin.language";

export function LanguageSelector({ labelKey }: { labelKey: LanguageLabelKey }) {
  const { language, setLanguage, t, storageError } = useTranslation();
  return (
    <section className="lb-language-selector" aria-label={t(labelKey)} lang={language}>
      <span className="lb-language-label">{t(labelKey)}</span>
      <div className="lb-language-options" role="group" aria-label={t(labelKey)}>
        {LANGUAGE_OPTIONS.map(({ code, label }) => {
          const selected = language === code;
          return (
            <button
              key={code}
              type="button"
              lang={code}
              data-testid={`button-language-${code}`}
              aria-pressed={selected}
              className={selected ? "is-selected" : ""}
              onClick={() => void setLanguage(code)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <span className="lb-language-help">{t("common.languageHelp")}</span>
      {storageError && (
        <span className="lb-language-error" role="alert">
          {t(storageError === "load" ? "common.languageLoadError" : "common.languageSaveError")}
        </span>
      )}
    </section>
  );
}
