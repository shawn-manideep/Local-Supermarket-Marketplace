import { useState } from "react";
import { Pressable, View } from "react-native";
import { mobileRegistrationSchema } from "@workspace/validation";
import { useTranslation, localizeCustomerMessage } from "@workspace/localization";
import { CustomerText as Text, CustomerTextInput as TextInput } from "./CustomerTypography";
import { PasswordField } from "./AuthControls";
import { colors, commonStyles, radius, spacing, typography } from "../theme";

export function MobileRegistrationForm({ onLegacy }: { onLegacy: () => void }) {
  const { t } = useTranslation();
  const [mobileNumber, setMobileNumber] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);
  const changed = () => { setError(""); setChecked(false); };

  const validate = () => {
    setChecked(false);
    const result = mobileRegistrationSchema.safeParse({ mobileNumber, password, confirmation });
    if (!result.success) {
      const field = result.error.issues[0]?.path[0];
      setError(field === "mobileNumber" ? "Enter a valid Indian mobile number, optionally prefixed with +91."
        : field === "password" ? "Use at least 8 characters, including a letter and a number."
        : "Passwords must match.");
      return;
    }
    setError("");
    setChecked(true);
    setPassword(""); setConfirmation("");
    // Intentionally no Auth/API call: valid input is not verified ownership.
  };

  return <View style={{ gap: spacing.md }} testID="customer-mobile-registration">
    <Text style={typography.body}>{t("Email-free registration is not yet available. Your mobile number must be verified before an account can be created.")}</Text>
    <View style={{ gap: spacing.sm }}>
      <Text style={typography.bodySemibold}>{t("Mobile Number")}</Text>
      <TextInput accessibilityLabel={t("Mobile Number")} autoComplete="tel" keyboardType="phone-pad"
        autoCapitalize="none" maxLength={13} placeholder={t("Enter your mobile number")}
        value={mobileNumber} onChangeText={value => { setMobileNumber(value); changed(); }}
        style={[commonStyles.card, { fontSize: 15, minHeight: 48 }]} placeholderTextColor={colors.muted} />
    </View>
    <Text style={typography.body}>{t("Use at least 8 characters, including a letter and a number.")}</Text>
    <PasswordField label={t("Password")} placeholder={t("Enter your password")} autoComplete="new-password"
      value={password} onChangeText={value => { setPassword(value); changed(); }} />
    <PasswordField label={t("Confirm Password")} placeholder={t("Re-enter your password")} autoComplete="new-password"
      value={confirmation} onChangeText={value => { setConfirmation(value); changed(); }} />
    {!!error && <Text accessibilityRole="alert" style={{ ...typography.body, color: colors.danger }}>{localizeCustomerMessage(error, t)}</Text>}
    {checked && <Text accessibilityRole="alert" style={typography.body}>{t("Details are valid, but no account was created. Secure mobile verification is not available yet.")}</Text>}
    <Pressable accessibilityRole="button" onPress={validate}
      style={{ backgroundColor: colors.accent, padding: spacing.lg, borderRadius: radius.lg, alignItems: "center" }}>
      <Text style={{ ...typography.bodySemibold, color: colors.card }}>{t("Check details")}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" onPress={onLegacy} style={{ alignItems: "center", padding: spacing.md }}>
      <Text style={{ ...typography.bodySemibold, color: colors.accent }}>{t("Use current email registration")}</Text>
    </Pressable>
  </View>;
}
