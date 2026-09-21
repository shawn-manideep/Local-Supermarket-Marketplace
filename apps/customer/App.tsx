import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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

type Screen = "home" | "cart" | "orders" | "account" | "addresses";
const colors = { bg: "#F7F5F0", card: "#FFFFFF", ink: "#1C2924", muted: "#5F7068", accent: "#D45543", soft: "#EAF0EC", line: "#E3DFD5", danger: "#C13521", highlight: "#FFF2EF" };

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  return <View style={styles.field}><Text style={styles.label}>{props.label}</Text><TextInput {...props} placeholderTextColor="#8A9892" style={styles.input} /></View>;
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

  if (!supabaseConfigured) return <View style={styles.center}><Text style={styles.title}>Configuration required</Text><Text style={styles.body}>Add the public Expo Supabase environment variables to use customer authentication.</Text></View>;
  return <ScrollView contentContainerStyle={styles.auth}>
    <Text style={styles.brand}>Local Basket</Text>
    <Text style={styles.hero}>{mode === "signin" ? "Welcome back" : "Create your account"}</Text>
    <Text style={styles.body}>Your neighbourhood supermarket account starts here.</Text>
    <View style={styles.card}>
      <Field label="Email" autoCapitalize="none" keyboardType="email-address" onChangeText={setEmail} value={email} />
      <Field label="Password" onChangeText={setPassword} secureTextEntry value={password} />
      {!!message && <Text style={styles.error}>{message}</Text>}
      <Pressable accessibilityRole="button" disabled={busy} onPress={submit} style={styles.primary}><Text style={styles.primaryText}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}</Text></Pressable>
      <Pressable onPress={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}><Text style={styles.link}>{mode === "signin" ? "New here? Create an account" : "Already registered? Sign in"}</Text></Pressable>
    </View>
  </ScrollView>;
}

function AccountScreen() {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { void customerApi<{ profile: CustomerProfile }>("/api/customer/profile").then(({ profile }) => { setProfile(profile); setName(profile.fullName ?? ""); setPhone(profile.phone ?? ""); }).catch((e) => setMessage(e.message)); }, []);
  const save = async () => {
    setMessage("");
    try { const { profile: next } = await customerApi<{ profile: CustomerProfile }>("/api/customer/profile", { method: "PATCH", body: JSON.stringify({ fullName: name.trim() || null, phone: phone.trim() || null }) }); setProfile(next); setMessage("Profile saved."); } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to save profile."); }
  };
  return <ScrollView contentContainerStyle={styles.page}><Text style={styles.eyebrow}>ACCOUNT</Text><Text style={styles.hero}>Your details</Text>{!profile && !message ? <ActivityIndicator color={colors.accent} /> : <View style={styles.card}><Field label="Full name" onChangeText={setName} value={name} /><Field label="Phone" keyboardType="phone-pad" onChangeText={setPhone} value={phone} />{!!message && <Text style={styles.notice}>{message}</Text>}<Pressable onPress={save} style={styles.primary}><Text style={styles.primaryText}>Save profile</Text></Pressable><Pressable onPress={() => supabase.auth.signOut()}><Text style={[styles.link, { color: colors.danger }]}>Sign out</Text></Pressable></View>}</ScrollView>;
}

const blankAddress: AddressInput = { label: null, recipientName: "", phone: "", line1: "", line2: null, city: "", state: "", pincode: "", isDefault: false };
function AddressesScreen() {
  const [items, setItems] = useState<CustomerAddress[]>([]); const [draft, setDraft] = useState<AddressInput>(blankAddress); const [editId, setEditId] = useState<string | null>(null); const [message, setMessage] = useState("");
  const load = () => customerApi<{ addresses: CustomerAddress[] }>("/api/customer/addresses").then((r) => setItems(r.addresses)).catch((e) => setMessage(e.message));
  useEffect(() => { void load(); }, []);
  const save = async () => {
    try { await customerApi(editId ? `/api/customer/addresses/${editId}` : "/api/customer/addresses", { method: editId ? "PATCH" : "POST", body: JSON.stringify(draft) }); setDraft(blankAddress); setEditId(null); setMessage("Address saved."); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to save address."); }
  };
  const remove = (id: string) => Alert.alert("Delete address?", "Historical order snapshots will not be affected.", [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => void customerApi(`/api/customer/addresses/${id}`, { method: "DELETE" }).then(load).catch((e) => setMessage(e.message)) }]);
  return <ScrollView contentContainerStyle={styles.page}><Text style={styles.eyebrow}>ADDRESSES</Text><Text style={styles.hero}>Delivery details</Text><View style={styles.card}>{(["recipientName","phone","line1","line2","city","state","pincode"] as const).map((key) => <Field key={key} label={{recipientName:"Recipient name",phone:"Phone",line1:"Address line 1",line2:"Address line 2",city:"City",state:"State",pincode:"Pincode"}[key]} keyboardType={key === "phone" || key === "pincode" ? "phone-pad" : "default"} onChangeText={(value) => setDraft({ ...draft, [key]: value || (key === "line2" ? null : "") })} value={draft[key] ?? ""} />)}<Pressable onPress={() => setDraft({ ...draft, isDefault: !draft.isDefault })} style={styles.check}><Text style={styles.body}>{draft.isDefault ? "●" : "○"} Make default</Text></Pressable><Pressable onPress={save} style={styles.primary}><Text style={styles.primaryText}>{editId ? "Update address" : "Add address"}</Text></Pressable>{!!message && <Text style={styles.notice}>{message}</Text>}</View>{items.map((item) => <View key={item.id} style={styles.address}><Text style={styles.addressTitle}>{item.recipientName}{item.isDefault ? " · Default" : ""}</Text><Text style={styles.body}>{item.line1}{item.line2 ? `, ${item.line2}` : ""}, {item.city}, {item.state} {item.pincode}</Text><View style={styles.row}><Pressable onPress={() => { setEditId(item.id); setDraft({ ...item }); }}><Text style={styles.link}>Edit</Text></Pressable><Pressable onPress={() => remove(item.id)}><Text style={[styles.link,{color:colors.danger}]}>Delete</Text></Pressable></View></View>)}</ScrollView>;
}

function CustomerApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [orderId, setOrderId] = useState<string | undefined>();
  return <View style={styles.shell}><View style={styles.content}>{screen === "home" ? <MarketplaceScreen openAddresses={() => setScreen("addresses")} openCart={() => setScreen("cart")} /> : screen === "cart" ? <CartScreen openAddresses={() => setScreen("addresses")} onOrderPlaced={(id) => { setOrderId(id); setScreen("orders"); }} /> : screen === "orders" ? <OrdersScreen initialOrderId={orderId} /> : screen === "account" ? <AccountScreen /> : <AddressesScreen />}</View><View accessibilityLabel="Primary navigation" style={styles.nav}>{(["home","cart","orders","account"] as Screen[]).map((item) => <Pressable accessibilityRole="tab" accessibilityLabel={`${item} tab`} accessibilityState={{ selected: screen === item }} key={item} onPress={() => { setOrderId(undefined); setScreen(item); }} style={styles.navItem}><Text style={[styles.navText, screen === item && styles.navActive]}>{item[0].toUpperCase()+item.slice(1)}</Text></Pressable>)}</View></View>;
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => { void supabase.auth.getSession().then(({ data }) => setSession(data.session)); const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next)); return () => data.subscription.unsubscribe(); }, []);
  if (session === undefined) return <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.body}>Restoring your session…</Text></View>;
  return session ? <CustomerApp /> : <AuthScreen />;
}

const webTop = Platform.OS === "web" ? 67 : 24;
const styles = StyleSheet.create({
  shell:{flex:1,backgroundColor:colors.bg},content:{flex:1},center:{flex:1,alignItems:"center",justifyContent:"center",gap:12,padding:28,backgroundColor:colors.bg},auth:{flexGrow:1,justifyContent:"center",paddingTop:webTop,paddingBottom:40,paddingHorizontal:24,backgroundColor:colors.bg},page:{paddingTop:webTop,paddingBottom:36,paddingHorizontal:22,gap:16},brand:{fontSize:17,fontWeight:"800",color:colors.accent,marginBottom:28},hero:{fontSize:34,lineHeight:40,fontWeight:"800",color:colors.ink},title:{fontSize:24,fontWeight:"800",color:colors.ink},body:{fontSize:15,lineHeight:22,color:colors.muted},eyebrow:{fontSize:12,fontWeight:"800",letterSpacing:1.5,color:colors.accent},card:{backgroundColor:colors.card,borderRadius:18,padding:18,gap:15,marginTop:24,borderWidth:1,borderColor:colors.line},field:{gap:7},label:{fontSize:13,fontWeight:"700",color:colors.ink},input:{borderWidth:1,borderColor:colors.line,borderRadius:12,paddingHorizontal:14,paddingVertical:12,fontSize:16,color:colors.ink,backgroundColor:"#FCFDFB"},primary:{backgroundColor:colors.ink,borderRadius:12,padding:15,alignItems:"center"},primaryText:{color:"#FFFFFF",fontWeight:"800",fontSize:15},link:{color:colors.accent,fontWeight:"700",textAlign:"center",padding:8},error:{color:colors.danger,fontSize:14},notice:{color:colors.muted,fontSize:14},nav:{flexDirection:"row",borderTopWidth:1,borderTopColor:colors.line,backgroundColor:colors.card,paddingBottom:Platform.OS === "web" ? 34 : 12,paddingTop:10},navItem:{flex:1,alignItems:"center",padding:10},navText:{color:colors.muted,fontWeight:"700",fontSize:13},navActive:{color:colors.accent},address:{backgroundColor:colors.card,borderRadius:16,padding:16,gap:8,borderWidth:1,borderColor:colors.line},addressTitle:{fontWeight:"800",fontSize:16,color:colors.ink},row:{flexDirection:"row",gap:18},check:{paddingVertical:4},
});