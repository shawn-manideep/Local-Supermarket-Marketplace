import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { requestAccountRecovery } from "@workspace/api-client-react";
import { RECOVERY_CONFIRMATION, resetPasswordSchema, usernameSchema, isPasswordOwner } from "@workspace/validation";
import { CustomerText as Text, CustomerTextInput as TextInput } from "./CustomerTypography";
import { colors, radius, spacing, typography, commonStyles } from "../theme";
import { supabase } from "../lib/supabase";
import { passwordVisibility } from "@workspace/constants";
import { CustomerLanguageSelector } from "./LanguageSelector";
import { useTranslation, localizeCustomerMessage } from "@workspace/localization";
import { customerApi } from "../lib/api";
import { CustomerBrandingLogo } from "./CustomerBrandingLogo";

export function PasswordField({ label = "Password", ...props }: React.ComponentProps<typeof TextInput> & { label?: string }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const visibility = passwordVisibility(visible);
  const translatedVisibilityLabel = t(visibility.label === "Hide password" ? "Hide password" : "Show password");
  return <View style={styles.field}>
    <Text style={typography.bodySemibold}>{(["Password", "New password", "Confirm password", "Confirm new password", "Current password"] as const).includes(label as "Password") ? t(label as "Password") : label}</Text>
    <View style={styles.passwordRow}>
      <TextInput {...props} accessibilityLabel={label} autoCapitalize="none" secureTextEntry={visibility.secureTextEntry} style={styles.passwordInput} maxLength={128} />
      <Pressable accessibilityRole="button" accessibilityLabel={translatedVisibilityLabel} accessibilityState={{ selected: visible }} onPress={() => setVisible(value => !value)} style={styles.eyeButton}>
        <View style={styles.eye}><View style={styles.pupil} />{visible && <View style={styles.slash} />}</View>
      </Pressable>
    </View>
  </View>;
}

export function CustomerRecoveryForm({ initialIdentity = "", onBack }: { initialIdentity?: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    const checked = resetPasswordSchema.safeParse(password);
    if (!checked.success || password !== confirmation) {
      setError(!checked.success ? "Use at least 8 characters." : "Passwords must match."); return;
    }
    const parsed = usernameSchema.safeParse(initialIdentity);
    if (!initialIdentity.trim()) { setError("Enter your username on the sign-in screen first, then reopen Forgot Password."); return; }
    if (!parsed.success) { setError("Enter a valid username."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await requestAccountRecovery({ role: "customer", identity: parsed.data });
      setPassword(""); setConfirmation("");
      setMessage(RECOVERY_CONFIRMATION);
    } catch { setError("Reset instructions could not be requested. Please wait and try again."); }
    finally { setBusy(false); }
  };
  return <View style={styles.form}>
    <Text style={typography.title2}>{t("Forgot Password?")}</Text>
    <Text style={typography.body}>{t("Verify ownership using the recovery link sent for the account entered on sign-in. Re-enter your new password after verification.")}</Text>
    <PasswordField label={t("New password")} autoComplete="new-password" value={password} onChangeText={setPassword} />
    <PasswordField label={t("Re-enter New Password")} autoComplete="new-password" value={confirmation} onChangeText={setConfirmation} />
    {!!message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[typography.body, { color: colors.success }]}>{localizeCustomerMessage(message, t)}</Text>}
    {!!error && <Text accessibilityRole="alert" style={[typography.body, { color: colors.danger }]}>{localizeCustomerMessage(error, t)}</Text>}
    <Pressable accessibilityRole="button" disabled={busy} onPress={submit} style={styles.primaryButton}>{busy ? <ActivityIndicator color={colors.card} /> : <Text style={styles.primaryButtonText}>{t("Send Reset Instructions")}</Text>}</Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setPassword(""); setConfirmation(""); onBack(); }}><Text style={styles.link}>{t("Back to sign in")}</Text></Pressable>
  </View>;
}

export function CustomerResetForm({ onComplete }: { onComplete: (success: boolean) => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const finish = async (success: boolean) => {
    setPassword(""); setConfirmation("");
    await supabase.auth.signOut();
    onComplete(success);
  };
  const submit = async () => {
    const parsed = resetPasswordSchema.safeParse(password);
    if (!parsed.success || password !== confirmation) { setError(!parsed.success ? "Use at least 8 characters." : "Passwords must match."); return; }
    setBusy(true); setError("");
    try {
      const { data: before } = await supabase.auth.getSession();
      if (!before.session) throw new Error();
      const profile = await customerApi<{ auth?: { role?: string; userId?: string } }>("/api/auth/me");
      if (!isPasswordOwner(profile.auth, before.session.user.id, "customer")) throw new Error();
      const { data: current } = await supabase.auth.getSession();
      if (current.session?.user.id !== before.session.user.id || current.session?.access_token !== before.session.access_token) throw new Error();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error();
      await finish(true);
    } catch { setError("Your reset link may have expired. Request new instructions and try again."); }
    finally { setBusy(false); }
  };
  return <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.resetPage}><View style={[commonStyles.card, styles.form]}>
    <CustomerBrandingLogo size={56} />
    <CustomerLanguageSelector />
    <Text style={typography.title1}>{t("Choose a new password")}</Text>
    <Text style={typography.body}>{t("Use at least 8 characters.")}</Text>
    <PasswordField label={t("New password")} autoComplete="new-password" value={password} onChangeText={setPassword} />
    <PasswordField label={t("Re-enter New Password")} autoComplete="new-password" value={confirmation} onChangeText={setConfirmation} />
    {!!error && <Text accessibilityRole="alert" style={[typography.body, { color: colors.danger }]}>{localizeCustomerMessage(error, t)}</Text>}
    <Pressable accessibilityRole="button" disabled={busy} onPress={submit} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{busy ? t("Updating…") : t("Update password")}</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void finish(false); }}><Text style={styles.link}>{t("Cancel reset")}</Text></Pressable>
  </View></ScrollView>;
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  form: { gap: spacing.md },
  passwordRow: { flexDirection: "row", minWidth: 0, alignItems: "center", borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.card },
  passwordInput: { flex: 1, minWidth: 0, minHeight: 50, paddingHorizontal: spacing.md, ...typography.body, color: colors.ink },
  eyeButton: { width: 48, height: 48, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  eye: { width: 22, height: 14, borderWidth: 2, borderColor: colors.muted, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  pupil: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted },
  slash: { position: "absolute", width: 27, height: 2, backgroundColor: colors.muted, transform: [{ rotate: "40deg" }] },
  input: { minHeight: 50, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, ...typography.body, color: colors.ink, backgroundColor: colors.card },
  link: { ...typography.bodySemibold, color: colors.accent, textAlign: "center", paddingVertical: spacing.sm },
  resetPage: { flexGrow: 1, justifyContent: "center", padding: spacing.md, paddingTop: Platform.OS === "web" ? 67 : spacing.xl, paddingBottom: Platform.OS === "web" ? 34 : spacing.xl, backgroundColor: colors.bg },
  primaryButton: { minHeight: 48, padding: spacing.md, backgroundColor: colors.accent, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { ...typography.bodySemibold, color: colors.card },
});
