import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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
import { colors, radius, typography, spacing, shadows, commonStyles } from "./src/theme";
import { PhoneInput } from "./src/components/PhoneInput";
import { ConfirmationDialog } from "./src/components/ConfirmationDialog";

type Screen = "home" | "cart" | "orders" | "account" | "addresses";

function NavIcon({ item, active }: { item: Exclude<Screen, "addresses">; active: boolean }) {
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

function Field(props: React.ComponentProps<typeof TextInput> & { label: string; error?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.accessibilityLabel ?? props.label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[styles.input, props.error ? styles.inputError : null, props.style]}
      />
      {!!props.error && <Text style={styles.errorText}>{props.error}</Text>}
    </View>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async () => {
    setBusy(true); setMessage("");
    try {
      const result = mode === "signin"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password });
      if (result.error) throw result.error;
      if (mode === "signup" && !result.data.session) setMessage("Check your email to confirm your account, then sign in.");
    } catch (error) {
      setMessage("Unable to authenticate. Check your details and try again.");
    } finally { setBusy(false); }
  };

  if (!supabaseConfigured) return <View style={styles.center}><Text style={typography.title1}>Configuration required</Text><Text style={typography.body}>Add the public Expo Supabase environment variables to use customer authentication.</Text></View>;
  
  return (
    <ScrollView contentContainerStyle={styles.authPage}>
      <View style={styles.authContainer}>
        <Text style={typography.eyebrow}>LOCAL BASKET</Text>
        <Text style={typography.hero}>{mode === "signin" ? "Welcome back" : "Create account"}</Text>
        <Text style={[typography.body, { marginBottom: spacing.xl }]}>Your neighbourhood supermarket starts here.</Text>
        
        <View style={commonStyles.card}>
          <Field label="Email" autoCapitalize="none" keyboardType="email-address" onChangeText={setEmail} value={email} />
          <Field label="Password" onChangeText={setPassword} secureTextEntry value={password} />
          {!!message && <Text style={styles.errorText}>{message}</Text>}
          
          <Pressable accessibilityRole="button" disabled={busy} onPress={submit} style={styles.primaryBtn}>
            {busy ? <ActivityIndicator color={colors.card} /> : <Text style={styles.primaryBtnText}>{mode === "signin" ? "Sign in" : "Sign up"}</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>
            <Text style={styles.linkText}>{mode === "signin" ? "New here? Create an account" : "Already registered? Sign in"}</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

function AccountScreen({ navigate }: { navigate: (s: Screen) => void }) {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
    void customerApi<{ profile: CustomerProfile }>("/api/customer/profile")
      .then(({ profile }) => {
        setProfile(profile);
        setName(profile.fullName ?? "");
        setPhone(profile.phone ?? "");
      })
      .catch((e) => setMessage(e.message));
  }, []);

  const save = async () => {
    if (phone && (!/^[6-9]\d{9}$/.test(phone))) {
      setMessage("Please enter a valid 10-digit mobile number.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const { profile: next } = await customerApi<{ profile: CustomerProfile }>("/api/customer/profile", {
        method: "PATCH",
        body: JSON.stringify({ fullName: name.trim() || null, phone: phone.trim() || null })
      });
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
        <Text style={typography.eyebrow}>ACCOUNT HUB</Text>
        <Text style={[typography.hero, { marginBottom: spacing.xl }]}>Your Details</Text>
        
        {!profile && !message ? <ActivityIndicator accessibilityLabel="Loading account" color={colors.accent} style={{ marginTop: spacing.xl }} /> : (
          <View style={{ gap: spacing.lg }}>
            <View style={commonStyles.card}>
              <Text style={[typography.title3, { marginBottom: spacing.md }]}>Personal Details</Text>
              <View style={{ gap: spacing.md }}>
                <Field label="Email" value={email} editable={false} style={{ backgroundColor: colors.bg, color: colors.muted }} />
                <Field label="Full name" onChangeText={setName} value={name} />
                <PhoneInput label="Mobile Number" value={phone} onChangeText={setPhone} />
                {!!message && <Text accessibilityRole="alert" style={message.includes("success") ? styles.successText : styles.errorText}>{message}</Text>}
                <Pressable accessibilityRole="button" onPress={save} disabled={saving} style={styles.primaryBtn}>
                  {saving ? <ActivityIndicator color={colors.card} /> : <Text style={styles.primaryBtnText}>Save profile</Text>}
                </Pressable>
              </View>
            </View>

            <View style={commonStyles.card}>
              <Text style={[typography.title3, { marginBottom: spacing.md }]}>Delivery</Text>
              <Pressable style={styles.menuRow} onPress={() => navigate("addresses")}>
                <Text style={typography.bodySemibold}>Manage Addresses</Text>
                <Text style={typography.body}>→</Text>
              </Pressable>
            </View>

            <View style={commonStyles.card}>
              <Text style={[typography.title3, { marginBottom: spacing.md }]}>Orders</Text>
              <Pressable style={styles.menuRow} onPress={() => navigate("orders")}>
                <Text style={typography.bodySemibold}>My Orders</Text>
                <Text style={typography.body}>→</Text>
              </Pressable>
            </View>

            <View style={commonStyles.card}>
              <Text style={[typography.title3, { marginBottom: spacing.md }]}>Account</Text>
              <Pressable accessibilityRole="button" onPress={() => supabase.auth.signOut()} style={styles.menuRow}>
                <Text style={[typography.bodySemibold, { color: colors.danger }]}>Sign out</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const blankAddress: AddressInput = { label: null, recipientName: "", phone: "", line1: "", line2: null, city: "", state: "", pincode: "", isDefault: false };
function editableAddress(address: AddressInput | CustomerAddress): AddressInput {
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
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!draft.recipientName || !draft.phone || !draft.line1 || !draft.city || !draft.state || !draft.pincode) {
      setMessage("Please fill all required fields."); return;
    }
    if (!/^[6-9]\d{9}$/.test(draft.phone)) {
      setMessage("Please enter a valid 10-digit Indian mobile number."); return;
    }
    
    setMessage("");
    try {
      await customerApi(editId ? `/api/customer/addresses/${editId}` : "/api/customer/addresses", {
        method: editId ? "PATCH" : "POST",
        body: JSON.stringify(editableAddress(draft))
      });
      setDraft(blankAddress); setEditId(null); setMessage("Address saved."); load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to save address."); }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await customerApi(`/api/customer/addresses/${deleteId}`, { method: "DELETE" });
      load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to delete address."); }
    setDeleteId(null);
  };

  return (
    <>
      <ScrollView contentContainerStyle={commonStyles.page}>
        <View style={commonStyles.container}>
          <Pressable onPress={() => navigate("account")} style={{ marginBottom: spacing.md, alignSelf: "flex-start" }}>
            <Text style={styles.linkText}>← Back to Account</Text>
          </Pressable>
          <Text style={typography.eyebrow}>ADDRESSES</Text>
          <Text style={[typography.hero, { marginBottom: spacing.xl }]}>Delivery Details</Text>
          
          <View style={commonStyles.card}>
            <Text style={[typography.title3, { marginBottom: spacing.md }]}>{editId ? "Edit Address" : "Add New Address"}</Text>
            <View style={{ gap: spacing.md }}>
              <Field label="Label (e.g. Home, Work)" onChangeText={(v) => setDraft({ ...draft, label: v || null })} value={draft.label ?? ""} />
              <Field label="Recipient Name" onChangeText={(v) => setDraft({ ...draft, recipientName: v })} value={draft.recipientName} />
              <PhoneInput label="Phone Number" value={draft.phone} onChangeText={(v) => setDraft({ ...draft, phone: v })} />
              <Field label="Address Line 1" onChangeText={(v) => setDraft({ ...draft, line1: v })} value={draft.line1} />
              <Field label="Address Line 2 (Optional)" onChangeText={(v) => setDraft({ ...draft, line2: v || null })} value={draft.line2 ?? ""} />
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                <View style={{ flex: 1 }}><Field label="City" onChangeText={(v) => setDraft({ ...draft, city: v })} value={draft.city} /></View>
                <View style={{ flex: 1 }}><Field label="State" onChangeText={(v) => setDraft({ ...draft, state: v })} value={draft.state} /></View>
              </View>
              <Field label="Pincode" keyboardType="number-pad" onChangeText={(v) => setDraft({ ...draft, pincode: v.replace(/\D/g, '') })} value={draft.pincode} />
              
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: draft.isDefault }} onPress={() => setDraft({ ...draft, isDefault: !draft.isDefault })} style={styles.checkRow}>
                <View style={[styles.checkbox, draft.isDefault && styles.checkboxActive]}>
                  {draft.isDefault && <View style={styles.checkboxInner} />}
                </View>
                <Text style={typography.bodySemibold}>Make this my default address</Text>
              </Pressable>
              
              {!!message && <Text accessibilityRole="alert" style={message.includes("saved") ? styles.successText : styles.errorText}>{message}</Text>}
              
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                {editId && (
                  <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={() => { setEditId(null); setDraft(blankAddress); setMessage(""); }}>
                    <Text style={styles.secondaryBtnText}>Cancel</Text>
                  </Pressable>
                )}
                <Pressable accessibilityRole="button" onPress={save} style={[styles.primaryBtn, { flex: 2 }]}>
                  <Text style={styles.primaryBtnText}>{editId ? "Update address" : "Save address"}</Text>
                </Pressable>
              </View>
            </View>
          </View>
          
          <Text style={[typography.title2, { marginTop: spacing.xl, marginBottom: spacing.md }]}>Saved Addresses</Text>
          {loading && items.length === 0 ? <ActivityIndicator color={colors.accent} /> : items.length === 0 ? (
            <Text style={typography.body}>No addresses saved yet.</Text>
          ) : (
            <View style={{ gap: spacing.md }}>
              {items.map((item) => (
                <View key={item.id} style={commonStyles.card}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: spacing.xs }}>
                    <Text style={typography.title3}>{item.label || item.recipientName} {item.isDefault ? <Text style={{ color: colors.accent, fontSize: 13 }}>• Default</Text> : ""}</Text>
                  </View>
                  <Text style={typography.body}>{item.recipientName} • +91 {item.phone}</Text>
                  <Text style={typography.body}>{item.line1}{item.line2 ? `, ${item.line2}` : ""}</Text>
                  <Text style={typography.body}>{item.city}, {item.state} {item.pincode}</Text>
                  
                  <View style={{ flexDirection: "row", gap: spacing.xl, marginTop: spacing.md }}>
                    <Pressable onPress={() => { setEditId(item.id); setDraft(editableAddress(item)); setMessage(""); }}>
                      <Text style={[typography.bodySemibold, { color: colors.ink }]}>Edit</Text>
                    </Pressable>
                    <Pressable onPress={() => setDeleteId(item.id)}>
                      <Text style={[typography.bodySemibold, { color: colors.danger }]}>Delete</Text>
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
  const [screen, setScreen] = useState<Screen>("home");
  const [orderId, setOrderId] = useState<string | undefined>();
  const navItems: Exclude<Screen, "addresses">[] = ["home", "cart", "orders", "account"];
  return (
    <View style={styles.shell}>
      <View style={styles.content}>
        {screen === "home" ? <MarketplaceScreen openAddresses={() => setScreen("addresses")} openCart={() => setScreen("cart")} /> 
        : screen === "cart" ? <CartScreen openAddresses={() => setScreen("addresses")} onOrderPlaced={(id) => { setOrderId(id); setScreen("orders"); }} /> 
        : screen === "orders" ? <OrdersScreen initialOrderId={orderId} /> 
        : screen === "account" ? <AccountScreen navigate={setScreen} /> 
        : <AddressesScreen navigate={setScreen} />}
      </View>
      <View accessibilityLabel="Primary navigation" style={styles.nav}>
        {navItems.map((item) => (
          <Pressable accessibilityRole="tab" accessibilityLabel={`${item} tab`} accessibilityState={{ selected: screen === item }} key={item} onPress={() => { setOrderId(undefined); setScreen(item); }} style={styles.navItem}>
            <NavIcon item={item} active={screen === item} />
            <Text style={[styles.navText, screen === item && styles.navActive]}>{item[0].toUpperCase()+item.slice(1)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => { 
    void supabase.auth.getSession().then(({ data }) => setSession(data.session)); 
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next)); 
    return () => data.subscription.unsubscribe(); 
  }, []);
  
  if (session === undefined) return <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={typography.body}>Restoring session…</Text></View>;
  return session ? <CustomerApp /> : <AuthScreen />;
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl, backgroundColor: colors.bg },
  authPage: { flexGrow: 1, backgroundColor: colors.bg, justifyContent: "center", padding: spacing.xl },
  authContainer: { width: "100%", maxWidth: 400, alignSelf: "center" },
  field: { gap: spacing.xs },
  label: { ...typography.bodySemibold, fontSize: 13 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 48, ...typography.bodySemibold, color: colors.ink, backgroundColor: colors.card },
  inputError: { borderColor: colors.danger },
  errorText: { ...typography.caption, color: colors.danger },
  successText: { ...typography.caption, color: colors.ink },
  primaryBtn: { backgroundColor: colors.ink, borderRadius: radius.md, height: 52, justifyContent: "center", alignItems: "center" },
  primaryBtnText: { ...typography.bodySemibold, color: colors.card, fontSize: 16 },
  secondaryBtn: { backgroundColor: colors.soft, borderRadius: radius.md, height: 52, justifyContent: "center", alignItems: "center" },
  secondaryBtnText: { ...typography.bodySemibold, color: colors.ink, fontSize: 16 },
  linkText: { ...typography.bodySemibold, color: colors.accent, textAlign: "center", padding: spacing.sm },
  menuRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.muted, justifyContent: "center", alignItems: "center" },
  checkboxActive: { borderColor: colors.ink },
  checkboxInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.ink },
  nav: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.card, paddingBottom: Platform.OS === "web" ? 34 : 20, paddingTop: 12, ...shadows.sm },
  navItem: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", gap: 4 },
  navIconFrame: { width: 24, height: 22, position: "relative", alignItems: "center", justifyContent: "center" },
  homeRoof: { position: "absolute", top: 2, width: 15, height: 15, borderLeftWidth: 2, borderTopWidth: 2, transform: [{ rotate: "45deg" }] },
  homeBase: { position: "absolute", bottom: 1, width: 15, height: 12, borderWidth: 2, borderTopWidth: 0, borderRadius: 2 },
  cartBasket: { width: 19, height: 13, borderWidth: 2, borderTopWidth: 0, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, transform: [{ skewX: "-8deg" }] },
  cartWheels: { position: "absolute", bottom: 0, left: 4, right: 3, flexDirection: "row", justifyContent: "space-between" },
  cartWheel: { width: 4, height: 4, borderRadius: 2 },
  orderSheet: { width: 18, height: 21, borderWidth: 2, borderRadius: 3, paddingHorizontal: 3, paddingTop: 4, gap: 3 },
  orderLine: { height: 2, width: "100%", borderRadius: 1 },
  accountHead: { position: "absolute", top: 1, width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
  accountBody: { position: "absolute", bottom: 0, width: 19, height: 10, borderTopLeftRadius: 10, borderTopRightRadius: 10, borderWidth: 2, borderBottomWidth: 0 },
  navText: { ...typography.caption, color: colors.muted, fontSize: 11 },
  navActive: { color: colors.ink, fontWeight: "800" },
});
