import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "@workspace/localization";
import { CustomerText as Text } from "./components/CustomerTypography";
import { CustomerLanguageSelector } from "./components/LanguageSelector";
import { PolicyBackButton } from "./CustomerPolicyScreen";
import {
  accountPrivacyActions,
  accountPrivacySections,
  type AccountPrivacyDestination,
} from "./lib/customer-policies";
import { colors, commonStyles, radius, spacing, typography } from "./theme";

type AccountPrivacyScreenProps = {
  onBack: () => void;
  onNavigate: (destination: AccountPrivacyDestination) => void;
};

export function AccountPrivacyScreen({ onBack, onNavigate }: AccountPrivacyScreenProps) {
  const { t } = useTranslation();
  const [requestNoticeVisible, setRequestNoticeVisible] = useState(false);

  return (
    <View style={styles.screen}>
      <ScrollView style={commonStyles.viewport} contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <PolicyBackButton onPress={onBack} />
          <View style={styles.heading}>
            <Text style={typography.hero}>{t("legal.account.title")}</Text>
            <CustomerLanguageSelector labelKey="customer.language" />
          </View>

          <View style={styles.introCard}>
            <Text style={styles.intro}>{t("legal.account.intro")}</Text>
          </View>

          <View style={styles.capabilityList}>
            {accountPrivacySections.map((section) => (
              <View key={section.id} style={styles.capabilityCard}>
                <Text style={styles.capabilityTitle}>{t(section.title)}</Text>
                <Text style={styles.capabilityBody}>{t(section.body)}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.actionsHeading}>{t("legal.account.actions")}</Text>
          <View style={styles.actionsList}>
            {accountPrivacyActions.map((action) => (
              <Pressable
                key={action.id}
                accessibilityRole="button"
                accessibilityLabel={t(action.label)}
                onPress={() => onNavigate(action.destination)}
                style={({ pressed }) => [styles.actionButton, pressed && styles.actionPressed]}
              >
                <Text style={styles.actionText}>{t(action.label)}</Text>
                <Text accessible={false} style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.requestCard}>
            <Text style={styles.requestTitle}>{t("legal.account.request")}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("legal.account.request")}
              onPress={() => setRequestNoticeVisible(true)}
              style={({ pressed }) => [styles.requestButton, pressed && styles.actionPressed]}
            >
              <Text style={styles.requestButtonText}>{t("legal.account.request")}</Text>
            </Pressable>
            {requestNoticeVisible ? (
              <Text accessibilityLiveRegion="polite" style={styles.requestNotice}>
                {t("legal.account.requestUnavailable")}
              </Text>
            ) : null}
          </View>
          <PolicyBackButton onPress={onBack} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  heading: { gap: spacing.md, marginBottom: spacing.lg },
  introCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  intro: { ...typography.body, color: colors.ink, lineHeight: 24 },
  capabilityList: { gap: spacing.sm, marginBottom: spacing.xl },
  capabilityCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  capabilityTitle: { ...typography.bodySemibold, color: colors.ink },
  capabilityBody: { ...typography.body, color: colors.muted, lineHeight: 23 },
  actionsHeading: { ...typography.title2, color: colors.ink, marginBottom: spacing.sm },
  actionsList: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    marginBottom: spacing.xl,
  },
  actionButton: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  actionPressed: { opacity: 0.68 },
  actionText: { ...typography.bodySemibold, color: colors.accent, flex: 1, flexShrink: 1 },
  chevron: { color: colors.accent, fontSize: 25, lineHeight: 30 },
  requestCard: {
    backgroundColor: colors.soft,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  requestTitle: { ...typography.title3, color: colors.ink },
  requestButton: {
    minHeight: 48,
    alignSelf: "stretch",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  requestButtonText: { ...typography.bodySemibold, color: colors.card, textAlign: "center" },
  requestNotice: {
    ...typography.body,
    color: colors.ink,
    lineHeight: 23,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
  },
});
