import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { colors, radius, typography, spacing } from "../theme";

interface PhoneInputProps {
  value: string;
  onChangeText: (val: string) => void;
  label: string;
  error?: string;
}

export function PhoneInput({ value, onChangeText, label, error: externalError }: PhoneInputProps) {
  const [touched, setTouched] = useState(false);

  const handleTextChange = (text: string) => {
    const cleaned = text.replace(/\D/g, "").slice(0, 10);
    onChangeText(cleaned);
  };

  const getError = () => {
    if (externalError) return externalError;
    if (!touched || !value) return undefined;
    if (value.length < 10) return "Phone number must be exactly 10 digits";
    if (!/^[6-9]/.test(value)) return "Mobile number must start with 6, 7, 8, or 9";
    return undefined;
  };

  const error = getError();

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrapper, error ? styles.inputError : null]}>
        <Text style={styles.prefix}>+91</Text>
        <View style={styles.divider} />
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={handleTextChange}
          keyboardType="phone-pad"
          maxLength={10}
          onBlur={() => setTouched(true)}
          placeholder="9999999999"
          placeholderTextColor="#A0AFA6"
        />
      </View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  label: { ...typography.bodySemibold, fontSize: 13 },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    height: 48,
  },
  inputError: { borderColor: colors.danger },
  prefix: { ...typography.bodySemibold, paddingLeft: spacing.md, paddingRight: spacing.sm },
  divider: { width: 1, height: 24, backgroundColor: colors.line, marginRight: spacing.sm },
  input: { flex: 1, height: "100%", ...typography.bodySemibold, color: colors.ink },
  errorText: { ...typography.caption, color: colors.danger },
});
