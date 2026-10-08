import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { resetPasswordSchema } from "@workspace/validation";
import { changeCustomerPassword, getCustomerAccountSettings, type GetCustomerAccountSettings200Account } from "@workspace/api-client-react";
import { customerApi } from "./lib/api";
import { CustomerText as Text, CustomerTextInput as TextInput } from "./components/CustomerTypography";
import { PasswordField } from "./components/AuthControls";
import { PhoneInput } from "./components/PhoneInput";
import { colors, commonStyles, radius, spacing, typography } from "./theme";

export function CustomerSettingsScreen({ onBack }: { onBack: () => void }) {
  const [account, setAccount] = useState<GetCustomerAccountSettings200Account | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const load = async () => {
    setLoading(true);
    setProfileError("");
    try {
      const result = await getCustomerAccountSettings();
      setAccount(result.account);
      setName(result.account.fullName ?? "");
      setPhone(result.account.phone ?? "");
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : "Unable to load account settings.");
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const saveProfile = async () => {
    if (phone && !/^[6-9]\d{9}$/.test(phone)) {
      setProfileError("Please enter a valid 10-digit mobile number.");
      setProfileMessage("");
      return;
    }
    setProfileBusy(true); setProfileError(""); setProfileMessage("");
    try {
      const result = await customerApi<{ profile: { fullName: string | null; phone: string | null } }>("/api/customer/profile", {
        method: "PATCH",
        body: JSON.stringify({ fullName: name.trim() || null, phone: phone.trim() || null }),
      });
      setName(result.profile.fullName ?? "");
      setPhone(result.profile.phone ?? "");
      setProfileMessage("Your profile is up to date.");
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : "Unable to save profile.");
    } finally { setProfileBusy(false); }
  };

  const changePassword = async () => {
    setPasswordError(""); setPasswordMessage("");
    const valid = resetPasswordSchema.safeParse(newPassword);
    if (!currentPassword) { setPasswordError("Enter your current password."); return; }
    if (!valid.success) { setPasswordError(valid.error.issues[0]?.message ?? "Use a stronger password."); return; }
    if (newPassword !== confirmPassword) { setPasswordError("The new passwords do not match."); return; }
    setPasswordBusy(true);
    try {
      const result = await changeCustomerPassword({ currentPassword, newPassword, confirmPassword });
      setPasswordMessage(result.message || "Password changed successfully.");
    } catch (cause) {
      setPasswordError(cause instanceof Error ? cause.message : "Unable to change password.");
    } finally {
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setPasswordBusy(false);
    }
  };

  return <ScrollView style={commonStyles.viewport} contentContainerStyle={commonStyles.page} keyboardShouldPersistTaps="handled">
    <View style={commonStyles.container}>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ My Account</Text></Pressable>
      <Text style={typography.eyebrow}>PREFERENCES & SECURITY</Text>
      <Text style={typography.hero}>Settings</Text>
      <Text style={[typography.body, styles.intro]}>Your account details and sign-in security.</Text>
      {!!profileError && !loading && <View style={styles.errorBox}>
        <Text accessibilityRole="alert" style={styles.error}>{profileError}</Text>
        <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={styles.backText}>Retry loading account details</Text></Pressable>
      </View>}
      {loading ? <View style={styles.loading}><ActivityIndicator color={colors.accent} /><Text style={typography.caption}>Loading account settings…</Text></View> :
        <>
          <View style={styles.card}>
            <Text style={typography.title2}>Account</Text>
            <Text style={styles.help}>Your username and registered recovery contact are shown for reference.</Text>
            <View style={styles.staticField}><Text style={styles.label}>Username</Text><Text style={styles.value}>{account?.username || "Not set"}</Text></View>
            <View style={styles.staticField}><Text style={styles.label}>Registered email</Text><Text style={styles.value}>{account?.registeredEmail || "Not available"}</Text></View>
          </View>
          <View style={styles.card}>
            <Text style={typography.title2}>Profile</Text>
            <Text style={styles.help}>These details are also used on your customer profile.</Text>
            <View style={styles.field}><Text style={styles.label}>Full name</Text><TextInput accessibilityLabel="Full name" value={name} onChangeText={setName} placeholder="Your name" style={styles.input} /></View>
            <PhoneInput label="Mobile number" value={phone} onChangeText={setPhone} />
            {!!profileError && <Text accessibilityRole="alert" style={styles.error}>{profileError}</Text>}
            {!!profileMessage && <Text accessibilityRole="alert" style={styles.success}>{profileMessage}</Text>}
            <Pressable accessibilityRole="button" disabled={profileBusy} onPress={() => void saveProfile()} style={[styles.primary, profileBusy && styles.disabled]}>
              <Text style={styles.primaryText}>{profileBusy ? "Saving…" : "Save profile"}</Text>
            </Pressable>
          </View>
          <View style={styles.card}>
            <Text style={typography.title2}>Change password</Text>
            <Text style={styles.help}>Use at least 8 characters. Your current password is verified securely before the update.</Text>
            <PasswordField label="Current password" autoComplete="current-password" value={currentPassword} onChangeText={setCurrentPassword} />
            <PasswordField label="New password" autoComplete="new-password" value={newPassword} onChangeText={setNewPassword} />
            <PasswordField label="Confirm new password" autoComplete="new-password" value={confirmPassword} onChangeText={setConfirmPassword} />
            {!!passwordError && <Text accessibilityRole="alert" style={styles.error}>{passwordError}</Text>}
            {!!passwordMessage && <Text accessibilityRole="alert" style={styles.success}>{passwordMessage}</Text>}
            <Pressable accessibilityRole="button" disabled={passwordBusy} onPress={() => void changePassword()} style={[styles.primary, passwordBusy && styles.disabled]}>
              <Text style={styles.primaryText}>{passwordBusy ? "Updating…" : "Change password"}</Text>
            </Pressable>
          </View>
        </>}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  back: { alignSelf: "flex-start", paddingVertical: spacing.md },
  backText: { ...typography.bodySemibold, color: colors.accent },
  intro: { marginTop: spacing.sm, marginBottom: spacing.xl },
  loading: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, marginBottom: spacing.md },
  help: { ...typography.caption, marginTop: -spacing.sm },
  staticField: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, backgroundColor: colors.bg },
  field: { gap: spacing.xs },
  label: { ...typography.caption, color: colors.ink, fontWeight: "600" },
  value: { ...typography.body, color: colors.muted },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: spacing.md, ...typography.body, color: colors.ink, backgroundColor: colors.card },
  primary: { minHeight: 48, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.md },
  primaryText: { ...typography.bodySemibold, color: colors.card },
  disabled: { opacity: 0.55 },
  error: { ...typography.caption, color: colors.danger },
  success: { ...typography.caption, color: colors.success },
  errorBox: { backgroundColor: colors.highlight, padding: spacing.md, borderRadius: radius.md, gap: spacing.sm, marginBottom: spacing.md },
});
