import { Pressable, StyleSheet, View } from "react-native";
import { LANGUAGE_OPTIONS, useTranslation } from "@workspace/localization";
import { CustomerText as Text } from "./CustomerTypography";
import { colors, radius, spacing, typography } from "../theme";

export function CustomerLanguageSelector({ labelKey = "auth.language" }: { labelKey?: "auth.language" | "customer.language" }) {
  const { language, setLanguage, t, storageError } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{t(labelKey)}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={t(labelKey)} style={styles.options}>
        {LANGUAGE_OPTIONS.map(({ code, label }) => {
          const selected = language === code;
          return (
            <Pressable
              key={code}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityLanguage={code === "te" ? "te-IN" : "en-IN"}
              accessibilityState={{ checked: selected }}
              onPress={() => void setLanguage(code)}
              style={[styles.option, selected && styles.selected]}
            >
              <Text style={[styles.optionText, selected && styles.selectedText]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.help}>{t("common.languageHelp")}</Text>
      {storageError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(storageError === "load" ? "common.languageLoadError" : "common.languageSaveError")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs, alignSelf: "stretch" },
  label: { ...typography.caption, color: colors.ink, fontWeight: "600" },
  options: {
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
  },
  option: {
    minWidth: 88,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  selected: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  optionText: { ...typography.bodySemibold, color: colors.muted },
  selectedText: { color: colors.ink },
  help: { ...typography.caption, color: colors.muted },
  error: { ...typography.caption, color: colors.danger },
});
