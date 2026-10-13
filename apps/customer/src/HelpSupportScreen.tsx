import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "@workspace/localization";
import { CustomerText as Text, CustomerTextInput as TextInput } from "./components/CustomerTypography";
import { CustomerLanguageSelector } from "./components/LanguageSelector";
import {
  filterHelpTopics,
  helpCategories,
  supportNotice,
  toggleHelpQuestion,
  type HelpCategoryId,
} from "./lib/help-support";
import { colors, commonStyles, radius, shadows, spacing, typography } from "./theme";

type HelpSupportScreenProps = { onBack: () => void };

type GlyphName = "back" | "search" | "close" | "chevron" | "check" | "chat" | "contact";
const glyphs: Record<GlyphName, string> = {
  back: "‹",
  search: "⌕",
  close: "×",
  chevron: "›",
  check: "✓",
  chat: "◌",
  contact: "✉",
};

function Glyph({ name, color, size = 20 }: { name: GlyphName; color: string; size?: number }) {
  return <Text style={{ color, fontSize: size, lineHeight: size + 4, fontWeight: "600" }}>{glyphs[name]}</Text>;
}

export function HelpSupportScreen({ onBack }: HelpSupportScreenProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<HelpCategoryId | null>(null);
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const [notice, setNotice] = useState<"chat" | "contact" | null>(null);

  const filteredTopics = useMemo(
    () => filterHelpTopics(query, category, t),
    [query, category, t],
  );
  const hasFilters = query.trim().length > 0 || category !== null;

  const clearFilters = () => {
    setQuery("");
    setCategory(null);
  };

  const showSupportNotice = (action: "chat" | "contact") => {
    setNotice(action);
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        style={commonStyles.viewport}
        contentContainerStyle={commonStyles.page}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={commonStyles.container}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("help.back")}
            onPress={onBack}
            style={styles.backButton}
            hitSlop={4}
          >
            <Glyph name="back" size={26} color={colors.accent} />
            <Text style={styles.backText}>{t("help.back")}</Text>
          </Pressable>

          <View style={styles.heading}>
            <Text style={typography.hero}>{t("help.title")}</Text>
            <CustomerLanguageSelector labelKey="customer.language" />
          </View>

          <View style={styles.searchBox}>
            <Glyph name="search" size={23} color={colors.muted} />
            <TextInput
              accessibilityLabel={t("help.searchPlaceholder")}
              value={query}
              onChangeText={setQuery}
              placeholder={t("help.searchPlaceholder")}
              placeholderTextColor={colors.muted}
              returnKeyType="search"
              style={styles.searchInput}
            />
            {query.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("help.clearFilters")}
                onPress={clearFilters}
                style={styles.clearSearch}
              >
                <Glyph name="close" size={22} color={colors.muted} />
              </Pressable>
            )}
          </View>

          <View style={styles.sectionHeading}>
            <Text style={typography.title2}>{t("help.categories")}</Text>
          </View>
          <View style={styles.categoryGrid}>
            {helpCategories.map((item) => {
              const selected = category === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={t(item.label)}
                  accessibilityState={{ selected }}
                  onPress={() => setCategory(selected ? null : item.id)}
                  style={[styles.categoryCard, selected && styles.categoryCardSelected]}
                >
                  <View style={[styles.categoryIcon, selected && styles.categoryIconSelected]}>
                    <Text style={[styles.categoryGlyph, selected && styles.categoryGlyphSelected]}>{item.icon}</Text>
                  </View>
                  <Text style={[styles.categoryLabel, selected && styles.categoryLabelSelected]}>
                    {t(item.label)}
                  </Text>
                  <Glyph name={selected ? "check" : "chevron"} size={18} color={selected ? colors.card : colors.muted} />
                </Pressable>
              );
            })}
          </View>

          <View style={styles.faqHeader}>
            <Text style={typography.title2}>{t("help.faq")}</Text>
            <Text style={styles.topicCount}>
              {t("help.questionsCount", { count: filteredTopics.length })}
            </Text>
          </View>

          {hasFilters && (
            <Pressable
              accessibilityRole="button"
              onPress={clearFilters}
              style={styles.clearFilters}
            >
              <Text style={styles.clearFiltersText}>{t("help.clearFilters")}</Text>
              <Glyph name="close" size={17} color={colors.accent} />
            </Pressable>
          )}

          {filteredTopics.length === 0 ? (
            <View accessibilityLiveRegion="polite" style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Glyph name="search" size={27} color={colors.accent} />
              </View>
              <Text style={styles.emptyTitle}>{t("help.noResults")}</Text>
              <Text style={styles.emptyHint}>{t("help.noResultsHint")}</Text>
              {hasFilters && (
                <Pressable
                  accessibilityRole="button"
                  onPress={clearFilters}
                  style={styles.emptyClearButton}
                >
                  <Text style={styles.emptyClearText}>{t("help.clearFilters")}</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={styles.faqList}>
              {filteredTopics.map((topic) => {
                const expanded = openQuestion === topic.id;
                return (
                  <View key={topic.id} style={styles.faqItem}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded }}
                      onPress={() => setOpenQuestion((current) => toggleHelpQuestion(current, topic.id))}
                      style={styles.questionButton}
                    >
                      <Text style={styles.questionText}>{t(topic.question)}</Text>
                      <Text style={styles.faqChevron}>{expanded ? "⌃" : "⌄"}</Text>
                    </Pressable>
                    {expanded && (
                      <View style={styles.answerWrap}>
                        <View style={styles.answerRule} />
                        <Text style={styles.answerText}>{t(topic.answer)}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.supportCard}>
            <View style={styles.supportMark}>
              <Glyph name="chat" size={23} color={colors.card} />
            </View>
            <Text style={styles.supportTitle}>{t("help.stillNeedHelp")}</Text>
            <Text style={styles.supportIntro}>{t("help.supportIntro")}</Text>
            <View style={styles.supportActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => showSupportNotice("chat")}
                style={styles.chatButton}
              >
                <Glyph name="chat" size={17} color={colors.card} />
                <Text style={styles.chatButtonText}>{t("help.chat")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => showSupportNotice("contact")}
                style={styles.contactButton}
              >
                <Glyph name="contact" size={17} color={colors.accent} />
                <Text style={styles.contactButtonText}>{t("help.contact")}</Text>
              </Pressable>
            </View>
            {notice !== null && (
              <Text accessibilityLiveRegion="polite" style={styles.notice}>
                {t(supportNotice(notice))}
              </Text>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
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
    paddingRight: spacing.md,
    marginBottom: spacing.md,
  },
  backText: { ...typography.bodySemibold, color: colors.accent },
  heading: { gap: spacing.xs, marginBottom: spacing.lg },
  searchBox: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    ...shadows.sm,
  },
  searchInput: { flex: 1, minWidth: 0, minHeight: 50, ...typography.body, color: colors.ink, paddingVertical: 0 },
  clearSearch: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -spacing.sm },
  sectionHeading: { marginBottom: spacing.md },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing.sm, marginBottom: spacing.xl },
  categoryCard: {
    width: "48.5%",
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  categoryCardSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  categoryIcon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: colors.soft },
  categoryIconSelected: { backgroundColor: "rgba(255,255,255,0.18)" },
  categoryGlyph: { color: colors.accent, fontSize: 20, lineHeight: 25, fontWeight: "600", textAlign: "center" },
  categoryGlyphSelected: { color: colors.card },
  categoryLabel: { flex: 1, flexShrink: 1, ...typography.caption, color: colors.ink, fontWeight: "600" },
  categoryLabelSelected: { color: colors.card },
  faqHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginBottom: spacing.md },
  topicCount: { ...typography.caption, color: colors.muted },
  clearFilters: { minHeight: 44, flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: spacing.xs, paddingHorizontal: spacing.sm },
  clearFiltersText: { ...typography.caption, color: colors.accent, fontWeight: "600" },
  faqList: { gap: spacing.sm },
  faqItem: { overflow: "hidden", borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.card },
  questionButton: { minHeight: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  questionText: { flex: 1, ...typography.bodySemibold, color: colors.ink },
  faqChevron: { ...typography.title2, color: colors.accent, width: 20, textAlign: "center" },
  answerWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  answerRule: { height: 1, backgroundColor: colors.line, marginBottom: spacing.md },
  answerText: { ...typography.body, color: colors.muted },
  emptyState: { alignItems: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl, borderRadius: radius.lg, backgroundColor: colors.card },
  emptyIcon: { width: 48, height: 48, borderRadius: radius.full, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  emptyTitle: { ...typography.title3, color: colors.ink, textAlign: "center" },
  emptyHint: { ...typography.body, color: colors.muted, textAlign: "center", marginTop: spacing.xs },
  emptyClearButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, marginTop: spacing.sm },
  emptyClearText: { ...typography.bodySemibold, color: colors.accent },
  supportCard: { marginTop: spacing.xxl, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.ink },
  supportMark: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  supportTitle: { ...typography.title2, color: colors.card },
  supportIntro: { ...typography.body, color: "rgba(255,255,255,0.78)", marginTop: spacing.xs },
  supportActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
  chatButton: { minHeight: 48, flexGrow: 1, flexBasis: 120, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.accent },
  chatButtonText: { ...typography.bodySemibold, color: colors.card, flexShrink: 1, textAlign: "center", paddingVertical: spacing.sm },
  contactButton: { minHeight: 48, flexGrow: 1, flexBasis: 120, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.card },
  contactButtonText: { ...typography.bodySemibold, color: colors.accent, flexShrink: 1, textAlign: "center", paddingVertical: spacing.sm },
  notice: { ...typography.caption, color: colors.card, marginTop: spacing.md },
});
