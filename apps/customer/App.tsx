import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
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

type Screen = "home" | "cart" | "orders" | "account" | "profile" | "addresses";

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
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);

  const submit = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result =
        mode === "signin"
          ? await supabase.auth.signInWithPassword({
              email: email.trim(),
              password,
            })
          : await supabase.auth.signUp({ email: email.trim(), password });
      if (result.error) throw result.error;
      if (mode === "signup" && !result.data.session)
        setMessage("Check your email to confirm your account, then sign in.");
    } catch (error) {
      setMessage("Unable to authenticate. Check your details and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!supabaseConfigured)
    return (
      <View style={styles.center}>
        <Text style={typography.title1}>Configuration required</Text>
        <Text style={typography.body}>
          Add the public Expo Supabase environment variables to use customer
          authentication.
        </Text>
      </View>
    );

  return (
    <ScrollView contentContainerStyle={styles.authPage}>
      <View style={styles.authContainer}>
        <View style={styles.authBrand}>
          <BasketBrand />
          <Text style={styles.brandName}>LOCAL BASKET</Text>
          <Text style={styles.brandSub}>Fresh Groceries · Local Stores</Text>
        </View>
        <Text style={typography.hero}>
          {mode === "signin" ? "Welcome back!" : "Create an account"}
        </Text>
        <Text style={[typography.body, { marginBottom: spacing.xl }]}>
          Shop fresh. Shop local.
        </Text>
        <View style={styles.authForm}>
          <Field
            label="Email address"
            placeholder="Enter your email"
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
            value={email}
          />
          <Field
            label="Password"
            placeholder="Enter your password"
            onChangeText={setPassword}
            secureTextEntry={!passwordVisible}
            value={password}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => setPasswordVisible((v) => !v)}
            style={styles.passwordToggle}
          >
            <Text style={styles.linkText}>
              {passwordVisible ? "Hide password" : "Show password"}
            </Text>
          </Pressable>
          {!!message && <Text style={styles.errorText}>{message}</Text>}
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
                {mode === "signin" ? "Sign in" : "Sign up"}
              </Text>
            )}
          </Pressable>
          <Text style={styles.authDivider}>OR</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setMessage("");
            }}
            style={styles.authOutline}
          >
            <Text style={styles.authOutlineText}>
              {mode === "signin" ? "Create an account" : "Back to sign in"}
            </Text>
          </Pressable>
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
    <ScrollView contentContainerStyle={commonStyles.page}>
      <View style={commonStyles.container}>
        {editProfile ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => navigate("account")}
            style={styles.profileHeader}
          >
            <Text style={styles.profileHeaderText}>‹ Personal Information</Text>
          </Pressable>
        ) : (
          <Text style={styles.pageBar}>My Account</Text>
        )}

        {!profile && !message ? (
          <ActivityIndicator
            accessibilityLabel="Loading account"
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
                    label="Full Name"
                    onChangeText={setName}
                    value={name}
                  />
                  <Field
                    label="Email"
                    value={email}
                    editable={false}
                    style={{ backgroundColor: colors.bg, color: colors.muted }}
                  />
                  <PhoneInput
                    label="Mobile Number"
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
                      {message}
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
                      <Text style={styles.primaryBtnText}>Save Changes</Text>
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
                  <View>
                    <Text style={styles.accountName}>
                      {name || "Your account"}
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
                    <Text style={styles.menuLabel}>Personal Information</Text>
                    <Text style={styles.menuArrow}>›</Text>
                  </Pressable>
                  <Pressable
                    style={styles.menuRow}
                    onPress={() => navigate("addresses")}
                  >
                    <Text style={styles.menuIcon}>⌖</Text>
                    <Text style={styles.menuLabel}>Delivery Addresses</Text>
                    <Text style={styles.menuArrow}>›</Text>
                  </Pressable>
                  <Pressable
                    style={styles.menuRow}
                    onPress={() => navigate("orders")}
                  >
                    <Text style={styles.menuIcon}>▤</Text>
                    <Text style={styles.menuLabel}>My Orders</Text>
                    <Text style={styles.menuArrow}>›</Text>
                  </Pressable>
                  <View style={styles.menuRow}>
                    <Text style={styles.menuIcon}>♡</Text>
                    <Text style={styles.menuLabel}>Saved Items</Text>
                    <Text style={styles.unsupported}>Coming soon</Text>
                  </View>
                  <View style={styles.menuRow}>
                    <Text style={styles.menuIcon}>⚙</Text>
                    <Text style={styles.menuLabel}>Settings</Text>
                    <Text style={styles.unsupported}>Coming soon</Text>
                  </View>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => supabase.auth.signOut()}
                  style={styles.signOut}
                >
                  <Text style={styles.signOutText}>Sign Out</Text>
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
  city: "",
  state: "",
  pincode: "",
  isDefault: false,
};
function editableAddress(
  address: AddressInput | CustomerAddress,
): AddressInput {
  return {
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    isDefault: address.isDefault,
  };
}

function AddressesScreen({ navigate }: { navigate: (s: Screen) => void }) {
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
      !draft.line1 ||
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
      await customerApi(
        editId
          ? `/api/customer/addresses/${editId}`
          : "/api/customer/addresses",
        {
          method: editId ? "PATCH" : "POST",
          body: JSON.stringify(editableAddress(draft)),
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
      <ScrollView contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <Pressable
            onPress={() => navigate("account")}
            style={{ marginBottom: spacing.md, alignSelf: "flex-start" }}
          >
            <Text style={styles.linkText}>← Back to Account</Text>
          </Pressable>
          <Text style={typography.eyebrow}>ADDRESSES</Text>
          <Text style={[typography.hero, { marginBottom: spacing.xl }]}>
            Delivery Details
          </Text>

          <View style={commonStyles.card}>
            <Text style={[typography.title3, { marginBottom: spacing.md }]}>
              {editId ? "Edit Address" : "Add New Address"}
            </Text>
            <View style={{ gap: spacing.md }}>
              <Field
                label="Label (e.g. Home, Work)"
                onChangeText={(v) => setDraft({ ...draft, label: v || null })}
                value={draft.label ?? ""}
              />
              <Field
                label="Recipient Name"
                onChangeText={(v) => setDraft({ ...draft, recipientName: v })}
                value={draft.recipientName}
              />
              <PhoneInput
                label="Phone Number"
                value={draft.phone}
                onChangeText={(v) => setDraft({ ...draft, phone: v })}
              />
              <Field
                label="Address Line 1"
                onChangeText={(v) => setDraft({ ...draft, line1: v })}
                value={draft.line1}
              />
              <Field
                label="Address Line 2 (Optional)"
                onChangeText={(v) => setDraft({ ...draft, line2: v || null })}
                value={draft.line2 ?? ""}
              />
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="City"
                    onChangeText={(v) => setDraft({ ...draft, city: v })}
                    value={draft.city}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="State"
                    onChangeText={(v) => setDraft({ ...draft, state: v })}
                    value={draft.state}
                  />
                </View>
              </View>
              <Field
                label="Pincode"
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
                  Make this my default address
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
                  {message}
                </Text>
              )}

              <View style={{ flexDirection: "row", gap: spacing.md }}>
                {editId && (
                  <Pressable
                    style={[styles.secondaryBtn, { flex: 1 }]}
                    onPress={() => {
                      setEditId(null);
                      setDraft(blankAddress);
                      setMessage("");
                    }}
                  >
                    <Text style={styles.secondaryBtnText}>Cancel</Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  onPress={save}
                  style={[styles.primaryBtn, { flex: 2 }]}
                >
                  <Text style={styles.primaryBtnText}>
                    {editId ? "Update address" : "Save address"}
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
            Saved Addresses
          </Text>
          {loading && items.length === 0 ? (
            <ActivityIndicator color={colors.accent} />
          ) : items.length === 0 ? (
            <Text style={typography.body}>No addresses saved yet.</Text>
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
                          • Default
                        </Text>
                      ) : (
                        ""
                      )}
                    </Text>
                  </View>
                  <Text style={typography.body}>
                    {item.recipientName} • +91 {item.phone}
                  </Text>
                  <Text style={typography.body}>
                    {item.line1}
                    {item.line2 ? `, ${item.line2}` : ""}
                  </Text>
                  <Text style={typography.body}>
                    {item.city}, {item.state} {item.pincode}
                  </Text>

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
                        Edit
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => setDeleteId(item.id)}>
                      <Text
                        style={[
                          typography.bodySemibold,
                          { color: colors.danger },
                        ]}
                      >
                        Delete
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
        title="Delete Address?"
        message="Are you sure you want to remove this address? This won't affect past orders."
        confirmLabel="Delete"
        isDestructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </>
  );
}

function CustomerApp() {
  const { height: viewportHeight } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>("home");
  const [orderId, setOrderId] = useState<string | undefined>();
  const [requestedStoreId, setRequestedStoreId] = useState<string | undefined>();
  const [homeResetToken, setHomeResetToken] = useState(0);
  const [cartUnits, setCartUnits] = useState(0);
  const navItems: Array<"home" | "orders" | "account"> = [
    "home",
    "orders",
    "account",
  ];
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
            requestedStoreId={requestedStoreId}
            onStoreRequestHandled={() => setRequestedStoreId(undefined)}
            onOpenOrder={(id) => { setOrderId(id); setScreen("orders"); }}
          />
        </View>
        {screen === "home" ? null : screen === "cart" ? (
          <CartScreen
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
          <AccountScreen navigate={setScreen} />
        ) : screen === "profile" ? (
          <AccountScreen navigate={setScreen} editProfile />
        ) : (
          <AddressesScreen navigate={setScreen} />
        )}
      </View>
      <View accessibilityLabel="Primary navigation" style={styles.nav}>
        {navItems.map((item) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={`${item} tab`}
            accessibilityState={{
              selected:
                screen === item ||
                (item === "account" &&
                  (screen === "profile" || screen === "addresses")),
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
                  (screen === "profile" || screen === "addresses"))
              }
            />
            <Text
              style={[
                styles.navText,
                (screen === item ||
                  (item === "account" &&
                    (screen === "profile" || screen === "addresses"))) &&
                  styles.navActive,
              ]}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    void supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) =>
      setSession(next),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined)
    return (
      <CustomerTypographyProvider>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={typography.body}>Restoring session…</Text>
        </View>
      </CustomerTypographyProvider>
    );
  return (
    <CustomerTypographyProvider>
      {session ? <CustomerApp /> : <AuthScreen />}
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
    paddingVertical: spacing.sm,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
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
