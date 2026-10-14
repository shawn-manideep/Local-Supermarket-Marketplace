import type { Session } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { CustomerText as Text, CustomerTextInput as TextInput, CustomerTypographyProvider } from "./src/components/CustomerTypography";
import {
  customerApi,
  type AddressInput,
  type CustomerAddress,
  type CustomerProfile,
} from "./src/lib/api";
import { supabase, supabaseConfigured } from "./src/lib/supabase";
import { MarketplaceScreen } from "./src/MarketplaceScreen";
import { CartScreen } from "./src/CartScreen";
import { OrdersScreen } from "./src/OrdersScreen";
import { customerWebShellBounds } from "./src/lib/viewport-layout";
import {
  colors,
  radius,
  typography,
  spacing,
  shadows,
  commonStyles,
} from "./src/theme";
import { PhoneInput } from "./src/components/PhoneInput";
import { ConfirmationDialog } from "./src/components/ConfirmationDialog";
import { fontWeights } from "./src/theme";
import { usernameSchema, indianMobileSchema, portalResetPasswordSchema } from "@workspace/validation";
import { loginCustomerUsername, loginCustomerMobile } from "@workspace/api-client-react";
import { PasswordField, CustomerRecoveryForm, CustomerResetForm } from "./src/components/AuthControls";
import { CustomerBrandingLogo } from "./src/components/CustomerBrandingLogo";
import { SavedItemsProvider } from "./src/SavedItemsContext";
import { SavedItemsScreen } from "./src/SavedItemsScreen";
import { CustomerSettingsScreen } from "./src/CustomerSettingsScreen";
import { HelpSupportScreen } from "./src/HelpSupportScreen";
import { CustomerPolicyScreen } from "./src/CustomerPolicyScreen";
import { AccountPrivacyScreen } from "./src/AccountPrivacyScreen";
import { addressStreetLines, isLegacyAddress } from "./src/lib/address-format";
import { useLanguageScope, useTranslation, localizeCustomerMessage } from "@workspace/localization";
import { CustomerLanguageSelector } from "./src/components/LanguageSelector";
import { MobileRegistrationForm } from "./src/components/MobileRegistrationForm";

type Screen = "home" | "cart" | "orders" | "account" | "profile" | "addresses" | "saved" | "settings" | "help" | "privacy" | "accountPrivacy" | "terms";

function NavIcon({
  item,
  active,
}: {
  item: "home" | "cart" | "orders" | "account";
  active: boolean;
}) {
  const color = active ? colors.accent : colors.muted;

  if (item === "home") {
    return (
      <View style={styles.navIconFrame}>
        <View style={[styles.homeRoof, { borderColor: color }]} />
        <View style={[styles.homeBase, { borderColor: color }]} />
      </View>
    );
  }

  if (item === "cart") {
    return (
      <View style={styles.navIconFrame}>
        <View style={[styles.cartBasket, { borderColor: color }]} />
        <View style={styles.cartWheels}>
          <View style={[styles.cartWheel, { backgroundColor: color }]} />
          <View style={[styles.cartWheel, { backgroundColor: color }]} />
        </View>
      </View>
    );
  }

  if (item === "orders") {
    return (
      <View style={[styles.orderSheet, { borderColor: color }]}>
        <View style={[styles.orderLine, { backgroundColor: color }]} />
        <View style={[styles.orderLine, { backgroundColor: color }]} />
        <View style={[styles.orderLine, { backgroundColor: color }]} />
      </View>
    );
  }

  return (
    <View style={styles.navIconFrame}>
      <View style={[styles.accountHead, { borderColor: color }]} />
      <View style={[styles.accountBody, { borderColor: color }]} />
    </View>
  );
}

function Field(
  props: React.ComponentProps<typeof TextInput> & {
    label: string;
    error?: string;
  },
) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.accessibilityLabel ?? props.label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[
          styles.input,
          props.error ? styles.inputError : null,
          props.style,
        ]}
      />
      {!!props.error && <Text style={styles.errorText}>{props.error}</Text>}
    </View>
  );
}

function BasketBrand() {
  return (
    <CustomerBrandingLogo size={76} fallback={
    <View style={styles.brandDrawing}>
      <View style={styles.brandHandle} />
      <View style={styles.brandBasket}>
        <View style={styles.brandStripes}>
          <View style={styles.brandStripe} />
          <View style={styles.brandStripe} />
          <View style={styles.brandStripe} />
        </View>
      </View>
      <View style={styles.brandWheels}>
        <View style={styles.brandWheel} />
        <View style={styles.brandWheel} />
      </View>
      <View style={styles.brandLeaf} />
    </View>
    } />
  );
}

function AuthScreen({ initialMessage = "" }: { initialMessage?: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"signin" | "signup" | "recovery">("signin");
  const [username, setUsername] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [legacyLogin, setLegacyLogin] = useState(false);
  const [legacyRegistration, setLegacyRegistration] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialMessage);

  const submit = async () => {
    if (mode === "signup") {
      if (!legacyRegistration) return;
      if (!portalResetPasswordSchema.safeParse(password).success) {
        setMessage("Use at least 8 characters, including a letter and a number."); return;
      }
      if (password !== confirmation) { setMessage("Passwords must match."); return; }
    }
    setBusy(true);
    setMessage("");
    try {
      const mobileLogin = mode === "signin" && !legacyLogin;
      const parsed = mobileLogin ? indianMobileSchema.safeParse(mobileNumber) : usernameSchema.safeParse(username);
      if (!parsed.success) { setMessage(mobileLogin ? "Enter a valid registered Indian mobile number." : parsed.error.issues[0]?.message ?? "Enter a valid username."); return; }
      if (mode === "signin") {
        const result = mobileLogin
          ? await loginCustomerMobile({ mobileNumber: parsed.data, password })
          : await loginCustomerUsername({ username: parsed.data, password });
        const { error } = await supabase.auth.setSession(result.session);
        if (error) throw new Error();
      } else {
        const result = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { customer_signup: true, username: parsed.data } },
        });
        if (result.error) throw new Error();
        if (!result.data.session) setMessage("Check your registered email to confirm your account, then sign in with your chosen username.");
      }
    } catch (error) {
      setMessage("Unable to authenticate. Check your details and try again.");
    } finally {
      setPassword("");
      setConfirmation("");
      setBusy(false);
    }
  };

  if (!supabaseConfigured)
    return (
      <View style={styles.center}>
        <Text style={typography.title1}>{t("Configuration required")}</Text>
        <Text style={typography.body}>
          {t("Add the public Expo Supabase environment variables to use customer authentication.")}
        </Text>
      </View>
    );

  return (
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.authPage}>
      <View style={styles.authContainer}>
        <View style={styles.authBrand}>
          <BasketBrand />
          <Text style={styles.brandName}>{t("LOCAL BASKET")}</Text>
          <Text style={styles.brandSub}>{t("Fresh Groceries · Local Stores")}</Text>
        </View>
        <CustomerLanguageSelector />
        <Text style={typography.hero}>
          {mode === "signup" ? t("Create an account") : mode === "recovery" ? t("Recover your account") : t("Welcome back!")}
        </Text>
        <Text style={[typography.body, { marginBottom: spacing.xl }]}>
          {t("Shop fresh. Shop local.")}
        </Text>
        <View style={styles.authForm}>
          {mode === "signup" && !legacyRegistration ? <>
            <MobileRegistrationForm onLegacy={() => { setLegacyRegistration(true); setPassword(""); setConfirmation(""); setMessage(""); }} />
            <Pressable accessibilityRole="button" onPress={() => { setMode("signin"); setMessage(""); }} style={styles.authOutline}>
              <Text style={styles.authOutlineText}>{t("Back to sign in")}</Text>
            </Pressable>
          </> : mode === "recovery" ? <CustomerRecoveryForm initialIdentity={legacyLogin ? username : mobileNumber} identityType={legacyLogin ? "legacy" : "mobile"} onBack={() => setMode("signin")} /> : <>
          {mode === "signin" && !legacyLogin ? <>
          <Text style={typography.body}>{t("Mobile sign-in requires verified ownership. Existing customers can use their username below.")}</Text>
          <Field
            label={t("Mobile Number")}
            placeholder={t("Enter your registered mobile number")}
            accessibilityLabel={t("Mobile Number")}
            autoComplete="tel"
            keyboardType="phone-pad"
            autoCapitalize="none"
            maxLength={13}
            onChangeText={setMobileNumber}
            value={mobileNumber}
          />
          </> : <Field
            label={t("Username")}
            placeholder={t("Enter your username")}
            accessibilityLabel={t("Username")}
            autoComplete="username"
            autoCapitalize="none"
            maxLength={30}
            onChangeText={setUsername}
            value={username}
          />}
          {mode === "signup" && <Text style={typography.body}>{t("Registration still uses a recovery email. Mobile sign-in requires separate ownership verification.")}</Text>}
          {mode === "signup" && <Field
            label={t("Recovery email address")}
            placeholder={t("Enter your email")}
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
            value={email}
          />}
          <PasswordField
            label={t("Password")}
            placeholder={t("Enter your password")}
            onChangeText={setPassword}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
          />
          {mode === "signup" && <PasswordField label={t("Confirm Password")} placeholder={t("Re-enter your password")}
            autoComplete="new-password" onChangeText={setConfirmation} value={confirmation} />}
          {!!message && <Text style={styles.errorText}>{localizeCustomerMessage(message, t)}</Text>}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={submit}
            style={styles.primaryBtn}
          >
            {busy ? (
              <ActivityIndicator color={colors.card} />
            ) : (
              <Text style={styles.primaryBtnText}>
                {mode === "signin" ? t("Sign in") : t("Sign up")}
              </Text>
            )}
          </Pressable>
          {mode === "signin" && <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setLegacyLogin(value => !value); setPassword(""); setMessage(""); }}><Text style={styles.linkText}>{legacyLogin ? t("Use mobile number instead") : t("Use existing username instead")}</Text></Pressable>}
          {mode === "signin" && <Pressable accessibilityRole="button" onPress={() => { setPassword(""); setMessage(""); setMode("recovery"); }}><Text style={styles.linkText}>{t("Forgot Password?")}</Text></Pressable>}
          <Text style={styles.authDivider}>{t("OR")}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setPassword("");
              setConfirmation("");
              setLegacyRegistration(false);
              setMessage("");
            }}
            style={styles.authOutline}
          >
            <Text style={styles.authOutlineText}>
              {mode === "signin" ? t("Create an account") : t("Back to sign in")}
            </Text>
          </Pressable>
          </>}
        </View>
        <View style={styles.authIllustration}>
          <View style={styles.illustrationGlow}>
            <BasketBrand />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function AccountScreen({
  navigate,
  editProfile = false,
}: {
  navigate: (s: Screen) => void;
  editProfile?: boolean;
}) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void supabase.auth
      .getUser()
      .then(({ data }) => setEmail(data.user?.email ?? ""));
    void customerApi<{ profile: CustomerProfile }>("/api/customer/profile")
      .then(({ profile }) => {
        setProfile(profile);
        setName(profile.fullName ?? "");
        setPhone(profile.phone ?? "");
      })
      .catch((e) => setMessage(e.message));
  }, []);

  const save = async () => {
    if (phone && !/^[6-9]\d{9}$/.test(phone)) {
      setMessage("Please enter a valid 10-digit mobile number.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const { profile: next } = await customerApi<{ profile: CustomerProfile }>(
        "/api/customer/profile",
        {
          method: "PATCH",
          body: JSON.stringify({
            fullName: name.trim() || null,
            phone: phone.trim() || null,
          }),
        },
      );
      setProfile(next);
      setMessage("Profile saved successfully.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to save profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={commonStyles.page}>
      <View style={commonStyles.container}>
        {editProfile ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => navigate("account")}
            style={styles.profileHeader}
          >
             <Text style={styles.profileHeaderText}>{t("‹ Personal Information")}</Text>
          </Pressable>
        ) : (
          <Text style={styles.pageBar}>{t("My Account")}</Text>
        )}

        {!profile && !message ? (
          <ActivityIndicator
            accessibilityLabel={t("Loading account")}
            color={colors.accent}
            style={{ marginTop: spacing.xl }}
          />
        ) : (
          <View style={{ gap: spacing.lg }}>
            {editProfile ? (
              <View style={[commonStyles.card, styles.profileCard]}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {(name || email || "C").charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ gap: spacing.md }}>
                  <Field
                    label={t("Full Name")}
                    onChangeText={setName}
                    value={name}
                  />
                  <Field
                    label={t("Email")}
                    value={email}
                    editable={false}
                    style={{ backgroundColor: colors.bg, color: colors.muted }}
                  />
                  <PhoneInput
                    label={t("Mobile Number")}
                    value={phone}
                    onChangeText={setPhone}
                  />
                  {!!message && (
                    <Text
                      accessibilityRole="alert"
                      style={
                        message.includes("success")
                          ? styles.successText
                          : styles.errorText
                      }
                    >
                      {localizeCustomerMessage(message, t)}
                    </Text>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    onPress={save}
                    disabled={saving}
                    style={styles.primaryBtn}
                  >
                    {saving ? (
                      <ActivityIndicator color={colors.card} />
                    ) : (
                      <Text style={styles.primaryBtnText}>{t("Save Changes")}</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <View style={styles.accountBanner}>
                  <View style={styles.smallAvatar}>
                    <Text style={styles.avatarText}>
                      {(name || email || "C").charAt(0).toUpperCase()}
                    </Text>
                  </View>
                   <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.accountName}>
                       {name || t("Your account")}
                    </Text>
                    <Text style={styles.accountEmail}>{email}</Text>
                  </View>
                </View>
                <View style={styles.accountMenu}>
                  <Pressable
                    style={styles.menuRow}
                    onPress={() => navigate("profile")}
                  >
                    <Text style={styles.menuIcon}>♙</Text>
                    <Text style={styles.menuLabel}>{t("Personal Information")}</Text>
                    <Text style={styles.menuArrow}>›</Text>
                  </Pressable>
                  <Pressable
                    style={styles.menuRow}
                    onPress={() => navigate("addresses")}
                  >
                    <Text style={styles.menuIcon}>⌖</Text>
                    <Text style={styles.menuLabel}>{t("Delivery Addresses")}</Text>
                    <Text style={styles.menuArrow}>›</Text>
                  </Pressable>
                  <Pressable
                    style={styles.menuRow}
                    onPress={() => navigate("orders")}
                  >
                    <Text style={styles.menuIcon}>▤</Text>
                    <Text style={styles.menuLabel}>{t("My Orders")}</Text>
                    <Text style={styles.menuArrow}>›</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" style={styles.menuRow} onPress={() => navigate("saved")}>
                    <Text style={styles.menuIcon}>♡</Text>
                    <Text style={styles.menuLabel}>{t("Saved Items")}</Text>
                    <Text style={styles.menuArrow}>›</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" style={styles.menuRow} onPress={() => navigate("settings")}>
                    <Text style={styles.menuIcon}>⚙</Text>
                    <Text style={styles.menuLabel}>{t("Settings")}</Text>
                    <Text style={styles.menuArrow}>›</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={t("help.title")} style={styles.menuRow} onPress={() => navigate("help")}>
                    <Text accessible={false} style={styles.menuIcon}>?</Text>
                    <Text style={styles.menuLabel}>{t("help.title")}</Text>
                    <Text accessible={false} style={styles.menuArrow}>›</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={t("legal.privacy.title")} style={styles.menuRow} onPress={() => navigate("privacy")}>
                    <Text accessible={false} style={styles.menuIcon}>◇</Text>
                    <Text style={styles.menuLabel}>{t("legal.privacy.title")}</Text>
                    <Text accessible={false} style={styles.menuArrow}>›</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={t("legal.account.title")} style={styles.menuRow} onPress={() => navigate("accountPrivacy")}>
                    <Text accessible={false} style={styles.menuIcon}>⚿</Text>
                    <Text style={styles.menuLabel}>{t("legal.account.title")}</Text>
                    <Text accessible={false} style={styles.menuArrow}>›</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={t("legal.terms.title")} style={styles.menuRow} onPress={() => navigate("terms")}>
                    <Text accessible={false} style={styles.menuIcon}>≡</Text>
                    <Text style={styles.menuLabel}>{t("legal.terms.title")}</Text>
                    <Text accessible={false} style={styles.menuArrow}>›</Text>
                  </Pressable>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => supabase.auth.signOut()}
                  style={styles.signOut}
                >
                  <Text style={styles.signOutText}>{t("Sign Out")}</Text>
                </Pressable>
              </>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const blankAddress: AddressInput = {
  label: null,
  recipientName: "",
  phone: "",
  line1: "",
  line2: null,
  houseNumber: "",
  buildingName: null,
  landmark: null,
  locality: null,
  city: "",
  state: "",
  pincode: "",
  isDefault: false,
};
function editableAddress(
  address: AddressInput | CustomerAddress,
): AddressInput {
  const legacy = isLegacyAddress(address);
  const houseNumber = legacy ? address.line1 : address.houseNumber ?? "";
  const locality = legacy ? address.line2 : address.locality ?? null;
  return {
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    line1: houseNumber,
    line2: locality,
    houseNumber,
    buildingName: address.buildingName ?? null,
    landmark: address.landmark ?? null,
    locality,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    isDefault: address.isDefault,
  };
}

function AddressesScreen({ navigate }: { navigate: (s: Screen) => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<CustomerAddress[]>([]);
  const [draft, setDraft] = useState<AddressInput>(blankAddress);
  const [editId, setEditId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    customerApi<{ addresses: CustomerAddress[] }>("/api/customer/addresses")
      .then((r) => setItems(r.addresses))
      .catch((e) => setMessage(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (
      !draft.recipientName ||
      !draft.phone ||
      !draft.houseNumber?.trim() ||
      !draft.city ||
      !draft.state ||
      !draft.pincode
    ) {
      setMessage("Please fill all required fields.");
      return;
    }
    if (!/^[6-9]\d{9}$/.test(draft.phone)) {
      setMessage("Please enter a valid 10-digit Indian mobile number.");
      return;
    }

    setMessage("");
    try {
      const houseNumber = draft.houseNumber?.trim() ?? "";
      const locality = draft.locality?.trim() ?? "";
      const submittedAddress: AddressInput = {
        ...editableAddress(draft),
        line1: houseNumber,
        line2: locality || null,
        houseNumber,
        buildingName: draft.buildingName?.trim() || null,
        landmark: draft.landmark?.trim() || null,
        locality: locality || null,
      };
      await customerApi(
        editId
          ? `/api/customer/addresses/${editId}`
          : "/api/customer/addresses",
        {
          method: editId ? "PATCH" : "POST",
          body: JSON.stringify(submittedAddress),
        },
      );
      setDraft(blankAddress);
      setEditId(null);
      setMessage("Address saved.");
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to save address.");
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await customerApi(`/api/customer/addresses/${deleteId}`, {
        method: "DELETE",
      });
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to delete address.");
    }
    setDeleteId(null);
  };

  return (
    <>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <Pressable
            onPress={() => navigate("account")}
            style={{ marginBottom: spacing.md, alignSelf: "flex-start" }}
          >
            <Text style={styles.linkText}>{t("← Back to Account")}</Text>
          </Pressable>
          <Text style={typography.eyebrow}>{t("ADDRESSES")}</Text>
          <Text style={[typography.hero, { marginBottom: spacing.xl }]}>
            {t("Delivery Details")}
          </Text>

          <View style={commonStyles.card}>
            <Text style={[typography.title3, { marginBottom: spacing.md }]}>
              {editId ? t("Edit Address") : t("Add New Address")}
            </Text>
            <View style={{ gap: spacing.md }}>
              <Field
                label={t("Label (e.g. Home, Work)")}
                onChangeText={(v) => setDraft({ ...draft, label: v || null })}
                value={draft.label ?? ""}
              />
              <Field
                label={t("Recipient Name")}
                onChangeText={(v) => setDraft({ ...draft, recipientName: v })}
                value={draft.recipientName}
              />
              <PhoneInput
                label={t("Phone Number")}
                value={draft.phone}
                onChangeText={(v) => setDraft({ ...draft, phone: v })}
              />
              {editId && (() => {
                const editing = items.find((item) => item.id === editId);
                return editing && !editing.houseNumber
                  ? <Text style={[typography.caption, { marginBottom: spacing.xs }]}>
                    {t("This saved address predates structured fields. Its existing address text is retained in House Number / Flat Number and Locality; no address history has been changed.")}
                  </Text>
                  : null;
              })()}
              <Field
                label={t("House Number / Flat Number *")}
                placeholder={t("e.g. Flat 302")}
                onChangeText={(v) => setDraft({ ...draft, houseNumber: v, line1: v })}
                value={draft.houseNumber ?? ""}
              />
              <Field
                label={t("Building Name / Apartment Name (Optional)")}
                placeholder={t("e.g. Green Heights Apartments")}
                onChangeText={(v) => setDraft({ ...draft, buildingName: v || null })}
                value={draft.buildingName ?? ""}
              />
              <Field
                label={t("Landmark (Optional)")}
                placeholder={t("e.g. Near ABC School")}
                onChangeText={(v) => setDraft({ ...draft, landmark: v || null })}
                value={draft.landmark ?? ""}
              />
              <Field
                label={t("Locality")}
                placeholder={t("e.g. Pragathi Nagar")}
                onChangeText={(v) => setDraft({ ...draft, locality: v || null, line2: v || null })}
                value={draft.locality ?? ""}
              />
              <View style={{ gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label={t("City")}
                    onChangeText={(v) => setDraft({ ...draft, city: v })}
                    value={draft.city}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label={t("State")}
                    onChangeText={(v) => setDraft({ ...draft, state: v })}
                    value={draft.state}
                  />
                </View>
              </View>
              <Field
                label={t("Pincode")}
                keyboardType="number-pad"
                onChangeText={(v) =>
                  setDraft({ ...draft, pincode: v.replace(/\D/g, "") })
                }
                value={draft.pincode}
              />

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: draft.isDefault }}
                onPress={() =>
                  setDraft({ ...draft, isDefault: !draft.isDefault })
                }
                style={styles.checkRow}
              >
                <View
                  style={[
                    styles.checkbox,
                    draft.isDefault && styles.checkboxActive,
                  ]}
                >
                  {draft.isDefault && <View style={styles.checkboxInner} />}
                </View>
                <Text style={typography.bodySemibold}>
                  {t("Make this my default address")}
                </Text>
              </Pressable>

              {!!message && (
                <Text
                  accessibilityRole="alert"
                  style={
                    message.includes("saved")
                      ? styles.successText
                      : styles.errorText
                  }
                >
                  {localizeCustomerMessage(message, t)}
                </Text>
              )}

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
                {editId && (
                  <Pressable
                    style={[styles.secondaryBtn, { flex: 1 }]}
                    onPress={() => {
                      setEditId(null);
                      setDraft(blankAddress);
                      setMessage("");
                    }}
                  >
                    <Text style={styles.secondaryBtnText}>{t("Cancel")}</Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  onPress={save}
                  style={[styles.primaryBtn, { flex: 2 }]}
                >
                  <Text style={styles.primaryBtnText}>
                    {editId ? t("Update address") : t("Save address")}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>

          <Text
            style={[
              typography.title2,
              { marginTop: spacing.xl, marginBottom: spacing.md },
            ]}
          >
            {t("Saved Addresses")}
          </Text>
          {loading && items.length === 0 ? (
            <ActivityIndicator color={colors.accent} />
          ) : items.length === 0 ? (
            <Text style={typography.body}>{t("No addresses saved yet.")}</Text>
          ) : (
            <View style={{ gap: spacing.md }}>
              {items.map((item) => (
                <View key={item.id} style={commonStyles.card}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: spacing.xs,
                    }}
                  >
                    <Text style={typography.title3}>
                      {item.label || item.recipientName}{" "}
                      {item.isDefault ? (
                        <Text style={{ color: colors.accent, fontSize: 13 }}>
                          {t("• Default")}
                        </Text>
                      ) : (
                        ""
                      )}
                    </Text>
                  </View>
                  <Text style={typography.body}>
                    {item.recipientName} • +91 {item.phone}
                  </Text>
                  {addressStreetLines(item).map((line, index) => <Text key={`${item.id}-address-${index}`} style={typography.body}>{line}</Text>)}

                  <View
                    style={{
                      flexDirection: "row",
                      gap: spacing.xl,
                      marginTop: spacing.md,
                    }}
                  >
                    <Pressable
                      onPress={() => {
                        setEditId(item.id);
                        setDraft(editableAddress(item));
                        setMessage("");
                      }}
                    >
                      <Text
                        style={[typography.bodySemibold, { color: colors.ink }]}
                      >
                        {t("Edit")}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => setDeleteId(item.id)}>
                      <Text
                        style={[
                          typography.bodySemibold,
                          { color: colors.danger },
                        ]}
                      >
                        {t("Delete")}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
      <ConfirmationDialog
        visible={!!deleteId}
        title={t("Delete Address?")}
        message={t("Are you sure you want to remove this address? This won't affect past orders.")}
        confirmLabel={t("Delete")}
        isDestructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </>
  );
}

function CustomerApp() {
  const { t } = useTranslation();
  const { height: viewportHeight } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>("home");
  const [privacyReturn, setPrivacyReturn] = useState<"account" | "accountPrivacy">("account");
  const [activePincode, setActivePincode] = useState("");
  const [orderId, setOrderId] = useState<string | undefined>();
  const [requestedStoreId, setRequestedStoreId] = useState<string | undefined>();
  const [requestedSavedItem, setRequestedSavedItem] = useState<{ productId: string; storeId: string } | undefined>();
  const [homeResetToken, setHomeResetToken] = useState(0);
  const [cartUnits, setCartUnits] = useState(0);
  const [cartUpdate, setCartUpdate] = useState<{ units: number; storeName: string }>();
  const navItems: Array<"home" | "orders" | "account"> = [
    "home",
    "orders",
    "account",
  ];
  const navLabels = { home: t("Home"), orders: t("Reorder"), account: t("Account") };
  return (
    <View style={[styles.shell, Platform.OS === "web" && customerWebShellBounds(viewportHeight)]}>
      <View style={[styles.content, commonStyles.viewport]}>
        <View style={[{ flex: 1, display: screen === "home" ? "flex" : "none" }, commonStyles.viewport]}>
          <MarketplaceScreen
            active={screen === "home"}
            openAddresses={() => setScreen("addresses")}
            openCart={() => setScreen("cart")}
            resetToken={homeResetToken}
            onCartUnitsChange={setCartUnits}
            cartUpdate={cartUpdate}
            requestedStoreId={requestedStoreId}
            onStoreRequestHandled={() => setRequestedStoreId(undefined)}
            onPincodeChange={setActivePincode}
            requestedSavedItem={requestedSavedItem}
            onSavedItemRequestHandled={() => setRequestedSavedItem(undefined)}
            onOpenOrder={(id) => { setOrderId(id); setScreen("orders"); }}
          />
        </View>
        {screen === "home" ? null : screen === "cart" ? (
          <CartScreen
            onCartChange={value => {
              const units = value?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
              setCartUnits(units);
              setCartUpdate({ units, storeName: value?.storeName ?? "" });
            }}
            openAddresses={() => setScreen("addresses")}
            continueShopping={(storeId) => {
              setRequestedStoreId(storeId);
              setScreen("home");
            }}
            onOrderPlaced={(id) => {
              setOrderId(id);
              setScreen("orders");
            }}
          />
        ) : screen === "orders" ? (
          <OrdersScreen
            initialOrderId={orderId}
            onRepeatAdded={() => {
              setScreen("cart");
              setOrderId(undefined);
            }}
          />
        ) : screen === "account" ? (
          <AccountScreen navigate={(destination) => {
            if (destination === "privacy") setPrivacyReturn("account");
            setScreen(destination);
          }} />
        ) : screen === "profile" ? (
          <AccountScreen navigate={setScreen} editProfile />
        ) : screen === "saved" ? (
          <SavedItemsScreen
            pincode={activePincode || undefined}
            onBack={() => setScreen("account")}
            onOpenItem={(productId, storeId) => {
              setRequestedSavedItem({ productId, storeId });
              setScreen("home");
            }}
          />
        ) : screen === "settings" ? (
          <CustomerSettingsScreen onBack={() => setScreen("account")} />
        ) : screen === "help" ? (
          <HelpSupportScreen onBack={() => setScreen("account")} />
        ) : screen === "privacy" ? (
          <CustomerPolicyScreen kind="privacy" onBack={() => setScreen(privacyReturn)} />
        ) : screen === "terms" ? (
          <CustomerPolicyScreen kind="terms" onBack={() => setScreen("account")} />
        ) : screen === "accountPrivacy" ? (
          <AccountPrivacyScreen onBack={() => setScreen("account")} onNavigate={(destination) => {
            if (destination === "privacy") setPrivacyReturn("accountPrivacy");
            setScreen(destination);
          }} />
        ) : (
          <AddressesScreen navigate={setScreen} />
        )}
      </View>
      <View accessibilityLabel={t("Primary navigation")} style={styles.nav}>
        {navItems.map((item) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={t("{name} tab", { name: navLabels[item] })}
            accessibilityState={{
              selected:
                screen === item ||
                (item === "account" &&
                  (screen === "profile" || screen === "addresses" || screen === "saved" || screen === "settings" || screen === "help" || screen === "privacy" || screen === "accountPrivacy" || screen === "terms")),
            }}
            key={item}
            onPress={() => {
              setOrderId(undefined);
              if (item === "home") {
                setRequestedStoreId(undefined);
                setHomeResetToken(value => value + 1);
              }
              setScreen(item);
            }}
            style={styles.navItem}
          >
            <NavIcon
              item={item}
              active={
                screen === item ||
                (item === "account" &&
                  (screen === "profile" || screen === "addresses" || screen === "saved" || screen === "settings" || screen === "help" || screen === "privacy" || screen === "accountPrivacy" || screen === "terms"))
              }
            />
            <Text
              style={[
                styles.navText,
                (screen === item ||
                  (item === "account" &&
                    (screen === "profile" || screen === "addresses" || screen === "saved" || screen === "settings" || screen === "help" || screen === "privacy" || screen === "accountPrivacy" || screen === "terms"))) &&
                  styles.navActive,
              ]}
            >
              {navLabels[item]}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  const { t } = useTranslation();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recoveryMode, setRecoveryMode] = useState(() => Platform.OS === "web" && new URLSearchParams(window.location.search).get("recovery") === "1");
  const [authNotice, setAuthNotice] = useState("");
  const [customerAccess, setCustomerAccess] = useState<"checking" | "allowed" | "denied">("checking");
  const [accessError, setAccessError] = useState("");
  const verifiedCustomer = useRef<string | null>(null);
  useLanguageScope(session?.user.id ?? null);
  useEffect(() => {
    void supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(true);
        if (Platform.OS === "web") window.history.replaceState(null, "", `${window.location.pathname}?recovery=1`);
      } else if (event === "SIGNED_IN") setRecoveryMode(false);
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || recoveryMode) return;
    const controller = new AbortController();
    if (verifiedCustomer.current !== session.user.id) setCustomerAccess("checking");
    setAccessError("");
    void customerApi<{ auth: { role: string } }>("/api/auth/me", { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        if (result.auth.role === "customer") { verifiedCustomer.current = session.user.id; setCustomerAccess("allowed"); }
        else { verifiedCustomer.current = null; setCustomerAccess("denied"); setAccessError("This portal is for Customer accounts. Sign out to use your Customer username."); }
      })
      .catch(() => {
        if (!controller.signal.aborted) { verifiedCustomer.current = null; setCustomerAccess("denied"); setAccessError("Customer access is unavailable. Sign out and try again, or contact your administrator."); }
      });
    return () => controller.abort();
  }, [session?.access_token, recoveryMode]);

  if (session === undefined)
    return (
      <CustomerTypographyProvider>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={typography.body}>{t("Restoring session…")}</Text>
        </View>
      </CustomerTypographyProvider>
    );
  return (
    <CustomerTypographyProvider>
      {session && recoveryMode ? <CustomerResetForm onComplete={success => {
        setRecoveryMode(false); setSession(null);
         setAuthNotice(success ? "Password updated. Sign in with your new password." : "Password reset cancelled.");
        if (Platform.OS === "web") window.history.replaceState(null, "", window.location.pathname);
        }} /> : session ? customerAccess === "allowed" && verifiedCustomer.current === session.user.id ? <SavedItemsProvider key={session.user.id}><CustomerApp /></SavedItemsProvider> :
        <View style={styles.center}>{customerAccess !== "denied" ? <><ActivityIndicator color={colors.accent} /><Text style={typography.body}>{t("Checking Customer access…")}</Text></> :
          <><Text accessibilityRole="alert" style={typography.body}>{localizeCustomerMessage(accessError, t)}</Text><Pressable accessibilityRole="button" onPress={() => { void supabase.auth.signOut(); }} style={styles.primaryBtn}><Text style={styles.primaryBtnText}>{t("Sign out")}</Text></Pressable></>}</View>
        : <AuthScreen initialMessage={authNotice || (recoveryMode ? "Your reset link is invalid or expired. Request new instructions." : "")} />}
    </CustomerTypographyProvider>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.bg,
    width: "100%",
    maxWidth: 430,
    alignSelf: "center",
    ...(Platform.OS === "web"
      ? { boxShadow: `0 0 40px ${colors.shadow}` }
      : {}),
  },
  content: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.bg,
  },
  authPage: {
    flexGrow: 1,
    backgroundColor: colors.card,
    justifyContent: "center",
    padding: spacing.xl,
    paddingTop: Platform.OS === "web" ? 67 : 30,
  },
  authContainer: { width: "100%", maxWidth: 400, alignSelf: "center" },
  field: { gap: spacing.xs },
  label: { ...typography.bodySemibold, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 48,
    ...typography.bodySemibold,
    color: colors.ink,
    backgroundColor: colors.card,
  },
  inputError: { borderColor: colors.danger },
  errorText: { ...typography.caption, color: colors.danger },
  successText: { ...typography.caption, color: colors.ink },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    height: 52,
    justifyContent: "center",
    alignItems: "center",
    ...shadows.sm,
  },
  primaryBtnText: {
    ...typography.bodySemibold,
    color: colors.card,
    fontSize: 16,
  },
  secondaryBtn: {
    backgroundColor: colors.soft,
    borderRadius: radius.md,
    height: 52,
    justifyContent: "center",
    alignItems: "center",
  },
  secondaryBtnText: {
    ...typography.bodySemibold,
    color: colors.ink,
    fontSize: 16,
  },
  linkText: {
    ...typography.bodySemibold,
    color: colors.accent,
    textAlign: "center",
    padding: spacing.sm,
  },
  menuRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 48,
    paddingVertical: spacing.sm,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    paddingVertical: spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.muted,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxActive: { borderColor: colors.ink },
  checkboxInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.ink,
  },
  nav: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.card,
    paddingBottom: Platform.OS === "web" ? 34 : 20,
    paddingTop: 12,
    ...shadows.sm,
  },
  navItem: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  navIconFrame: {
    width: 24,
    height: 22,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  homeRoof: {
    position: "absolute",
    top: 2,
    width: 15,
    height: 15,
    borderLeftWidth: 2,
    borderTopWidth: 2,
    transform: [{ rotate: "45deg" }],
  },
  homeBase: {
    position: "absolute",
    bottom: 1,
    width: 15,
    height: 12,
    borderWidth: 2,
    borderTopWidth: 0,
    borderRadius: 2,
  },
  cartBasket: {
    width: 19,
    height: 13,
    borderWidth: 2,
    borderTopWidth: 0,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    transform: [{ skewX: "-8deg" }],
  },
  cartWheels: {
    position: "absolute",
    bottom: 0,
    left: 4,
    right: 3,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cartWheel: { width: 4, height: 4, borderRadius: 2 },
  orderSheet: {
    width: 18,
    height: 21,
    borderWidth: 2,
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingTop: 4,
    gap: 3,
  },
  orderLine: { height: 2, width: "100%", borderRadius: 1 },
  accountHead: {
    position: "absolute",
    top: 1,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
  },
  accountBody: {
    position: "absolute",
    bottom: 0,
    width: 19,
    height: 10,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: 2,
    borderBottomWidth: 0,
  },
  navText: { ...typography.caption, color: colors.muted, fontSize: 11 },
  navActive: { color: colors.accent, fontWeight: fontWeights.medium },
  authBrand: { alignItems: "center", marginBottom: 36 },
  brandDrawing: {
    width: 62,
    height: 56,
    alignSelf: "center",
    position: "relative",
    marginBottom: 6,
  },
  brandHandle: {
    position: "absolute",
    top: 10,
    left: 7,
    width: 17,
    height: 4,
    backgroundColor: colors.accent,
    transform: [{ rotate: "22deg" }],
  },
  brandBasket: {
    position: "absolute",
    top: 19,
    left: 15,
    width: 38,
    height: 28,
    backgroundColor: colors.accent,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    transform: [{ skewX: "-8deg" }],
    justifyContent: "center",
    alignItems: "center",
  },
  brandStripes: { flexDirection: "row", gap: 6 },
  brandStripe: {
    height: 16,
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.card,
    opacity: 0.8,
  },
  brandWheels: {
    position: "absolute",
    top: 48,
    left: 20,
    width: 30,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  brandWheel: {
    width: 6,
    height: 6,
    backgroundColor: colors.accent,
    borderRadius: 3,
  },
  brandLeaf: {
    position: "absolute",
    right: 4,
    top: 3,
    width: 14,
    height: 10,
    borderTopLeftRadius: 12,
    borderBottomRightRadius: 12,
    backgroundColor: colors.success,
    transform: [{ rotate: "-22deg" }],
  },
  brandName: {
    fontSize: 19,
    fontWeight: fontWeights.bold,
    color: colors.ink,
    letterSpacing: 1.5,
  },
  brandSub: { fontSize: 11, color: colors.muted },
  authForm: { gap: 14 },
  passwordToggle: { alignSelf: "flex-end", marginTop: -12 },
  authDivider: {
    textAlign: "center",
    color: colors.muted,
    marginVertical: 8,
    fontSize: 12,
  },
  authOutline: {
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
  },
  authOutlineText: { color: colors.accent, fontWeight: fontWeights.semibold },
  authIllustration: {
    height: 110,
    backgroundColor: colors.soft,
    marginHorizontal: -spacing.xl,
    marginBottom: -spacing.xl,
    marginTop: 52,
    alignItems: "center",
    justifyContent: "center",
    borderTopLeftRadius: 80,
    borderTopRightRadius: 80,
  },
  illustrationGlow: { opacity: 0.28, transform: [{ scale: 1.5 }] },
  pageBar: {
    backgroundColor: colors.accent,
    color: colors.card,
    fontSize: 20,
    fontWeight: fontWeights.bold,
    padding: 18,
    marginHorizontal: -spacing.lg,
    marginTop: -8,
    marginBottom: 20,
  },
  backLink: {
    color: colors.accent,
    fontWeight: fontWeights.medium,
    fontSize: 18,
    marginBottom: 24,
  },
  profileHeader: {
    backgroundColor: colors.accent,
    padding: 18,
    marginHorizontal: -spacing.lg,
    marginTop: -8,
    marginBottom: 18,
  },
  profileHeaderText: { color: colors.card, fontWeight: fontWeights.semibold, fontSize: 20 },
  profileCard: { gap: 22, borderWidth: 0, backgroundColor: colors.card },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.soft,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 12,
  },
  smallAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 26, color: colors.accent, fontWeight: fontWeights.semibold },
  accountBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.accent,
    padding: 18,
    borderRadius: radius.lg,
  },
  accountName: { color: colors.card, fontWeight: fontWeights.semibold, fontSize: 17 },
  accountEmail: { color: "rgba(255,255,255,0.84)", fontSize: 12 },
  accountMenu: { gap: 8 },
  menuIcon: {
    color: colors.accent,
    fontSize: 21,
    width: 32,
    textAlign: "center",
  },
  menuLabel: { flex: 1, fontSize: 15, color: colors.text, fontWeight: fontWeights.medium },
  menuArrow: { color: colors.muted, fontSize: 22 },
  unsupported: { color: colors.muted, fontSize: 11 },
  signOut: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutText: { color: colors.danger, fontWeight: fontWeights.semibold },
});
