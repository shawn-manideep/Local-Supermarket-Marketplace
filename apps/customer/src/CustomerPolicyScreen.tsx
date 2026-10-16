import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "@workspace/localization";
import { CustomerText as Text } from "./components/CustomerTypography";
import { CustomerLanguageSelector } from "./components/LanguageSelector";
import { customerPolicies, type PolicyKind } from "./lib/customer-policies";
import { colors, commonStyles, radius, spacing, typography } from "./theme";

type CustomerPolicyScreenProps = { kind: PolicyKind; onBack: () => void };

export function CustomerPolicyScreen({ kind, onBack }: CustomerPolicyScreenProps) {
  const { t } = useTranslation();
  const policy = customerPolicies[kind];

  return (
    <View style={styles.screen}>
      <ScrollView
        style={commonStyles.viewport}
        contentContainerStyle={commonStyles.page}
        keyboardShouldPersistTaps="handled"
      >
        <View style={commonStyles.container}>
          <PolicyBackButton onPress={onBack} />

          <View style={styles.heading}>
            <Text style={typography.hero}>{t(policy.title)}</Text>
            <CustomerLanguageSelector labelKey="customer.language" />
          </View>

          <View style={styles.draftBanner} accessibilityRole="summary">
            <Text style={styles.draftTitle}>{t("legal.draftTitle")}</Text>
            <Text style={styles.draftNotice}>{t("legal.draftNotice")}</Text>
          </View>

          <View style={styles.introCard}>
            <Text style={styles.intro}>{t(policy.intro)}</Text>
          </View>

          <View style={styles.sections}>
            {policy.sections.map((section, index) => (
              <View key={section.id} style={styles.sectionCard}>
                <View style={styles.sectionHeading}>
                  {kind === "privacy" && <Text accessible={false} style={styles.sectionNumber}>{String(index + 1)}</Text>}
                  <Text style={styles.sectionTitle}>{t(section.title)}</Text>
                </View>
                <Text style={styles.sectionBody}>{t(section.body)}</Text>
                {section.review ? (
                  <View style={styles.reviewNote}>
                    <Text style={styles.reviewLabel}>{t("legal.reviewTitle")}</Text>
                    <Text style={styles.reviewText}>{t(section.review)}</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
          <PolicyBackButton onPress={onBack} />
        </View>
      </ScrollView>
    </View>
  );
}

export function PolicyBackButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("legal.back")}
      onPress={onPress}
      style={styles.backButton}
    >
      <Text style={styles.backGlyph}>‹</Text>
      <Text style={styles.backText}>{t("legal.back")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  backButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingRight: spacing.lg,
    marginBottom: spacing.md,
  },
  backText: {
    ...typography.bodySemibold,
    color: colors.accent,
  },
  backGlyph: {
    color: colors.accent,
    fontSize: 26,
    lineHeight: 31,
  },
  heading: { gap: spacing.md, marginBottom: spacing.lg },
  draftBanner: {
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
    borderRadius: radius.md,
    backgroundColor: colors.soft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  draftTitle: { ...typography.bodySemibold, color: colors.ink },
  draftNotice: { ...typography.body, color: colors.text },
  introCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  intro: { ...typography.body, color: colors.ink, lineHeight: 24 },
  sections: { gap: spacing.md, marginBottom: spacing.xl },
  sectionCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  sectionHeading: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, marginBottom: spacing.sm },
  sectionNumber: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: "700",
    paddingTop: 2,
    minWidth: 25,
  },
  sectionTitle: { ...typography.title3, color: colors.ink, flex: 1, flexShrink: 1 },
  sectionBody: { ...typography.body, color: colors.text, lineHeight: 24 },
  reviewNote: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  reviewLabel: { ...typography.caption, color: colors.accent, fontWeight: "700" },
  reviewText: { ...typography.caption, color: colors.muted, lineHeight: 21 },
});
