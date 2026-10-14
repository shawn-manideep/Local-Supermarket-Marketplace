import { View, Pressable } from "react-native";
import { CustomerText as Text, CustomerTextInput as TextInput } from "./CustomerTypography";
import { PhoneInput } from "./PhoneInput";
import { colors, spacing, typography } from "../theme";
import type { AddressInput } from "../lib/api";
import { useTranslation } from "@workspace/localization";

export function CustomerAddressFields({
  draft,
  onChange,
  showDefaultToggle = true,
  legacyNote,
}: {
  draft: AddressInput;
  onChange: (patch: Partial<AddressInput>) => void;
  showDefaultToggle?: boolean;
  legacyNote?: string;
}) {
  const { t } = useTranslation();
  const fieldStyle = {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink,
    minHeight: 48,
  } as const;
  const field = (
    label: string,
    value: string,
    update: (value: string) => void,
    placeholder?: string,
    keyboardType?: "default" | "number-pad",
  ) => (
    <View style={{ gap: spacing.xs }}>
      <Text style={typography.caption}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        value={value}
        onChangeText={update}
        style={fieldStyle}
      />
    </View>
  );
  const cityField = field(t("City"), draft.city, city => onChange({ city }));
  const stateField = field(t("State"), draft.state, state => onChange({ state }));

  return (
    <View style={{ gap: spacing.md }}>
      {field(t("Label (e.g. Home, Work)"), draft.label ?? "", value => onChange({ label: value || null }))}
      {field(t("Recipient Name"), draft.recipientName, recipientName => onChange({ recipientName }))}
      <PhoneInput label={t("Phone Number")} value={draft.phone} onChangeText={phone => onChange({ phone })} />
      {!!legacyNote && <Text style={typography.caption}>{legacyNote}</Text>}
      {field(t("House Number / Flat Number *"), draft.houseNumber ?? "", value => onChange({ houseNumber: value, line1: value }), t("e.g. Flat 302"))}
      {field(t("Building Name / Apartment Name (Optional)"), draft.buildingName ?? "", value => onChange({ buildingName: value || null }), t("e.g. Green Heights Apartments"))}
      {field(t("Landmark (Optional)"), draft.landmark ?? "", value => onChange({ landmark: value || null }), t("e.g. Near ABC School"))}
      {field(t("Locality"), draft.locality ?? "", value => onChange({ locality: value || null, line2: value || null }), t("e.g. Pragathi Nagar"))}
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <View style={{ flex: 1 }}>{cityField}</View>
        <View style={{ flex: 1 }}>{stateField}</View>
      </View>
      {field(t("Pincode"), draft.pincode, value => onChange({ pincode: value.replace(/\D/g, "") }), undefined, "number-pad")}
      {showDefaultToggle && (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: draft.isDefault }}
          onPress={() => onChange({ isDefault: !draft.isDefault })}
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs }}
        >
          <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: draft.isDefault ? colors.accent : colors.muted, backgroundColor: draft.isDefault ? colors.accent : colors.card, alignItems: "center", justifyContent: "center" }}>
            {draft.isDefault ? <View style={{ width: 8, height: 8, backgroundColor: colors.card, borderRadius: 2 }} /> : null}
          </View>
          <Text style={typography.bodySemibold}>{t("Make this my default address")}</Text>
        </Pressable>
      )}
    </View>
  );
}
