import { StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Local Supermarket Marketplace</Text>
      <Text style={styles.subtitle}>Customer App — Phase 1</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: "#f7f7f2",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#1d2a22",
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: "#526258",
    fontSize: 16,
    marginTop: 12,
    textAlign: "center",
  },
});