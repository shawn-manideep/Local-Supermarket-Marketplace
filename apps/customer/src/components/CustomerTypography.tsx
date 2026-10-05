import { createContext, forwardRef, useContext, type PropsWithChildren } from "react";
import { useFonts } from "expo-font";
import {
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  Platform,
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { theme } from "@workspace/constants";

const InterReady = createContext(false);
const interFamilies: Record<"300" | "400" | "500" | "600" | "700", string> = {
  "300": "Inter_300Light",
  "400": "Inter_400Regular",
  "500": "Inter_500Medium",
  "600": "Inter_600SemiBold",
  "700": "Inter_700Bold",
};

export function CustomerTypographyProvider({ children }: PropsWithChildren) {
  const [loaded] = useFonts({
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  return <InterReady.Provider value={loaded}>{children}</InterReady.Provider>;
}

function familyFor(style: StyleProp<TextStyle> | undefined, loaded: boolean) {
  if (!loaded) {
    if (Platform.OS === "web") return theme.typography.fontFamily;
    return Platform.OS === "ios" ? "System" : "sans-serif";
  }
  const weight = Number(StyleSheet.flatten(style)?.fontWeight ?? theme.typography.weights.regular);
  const supported = ([300, 400, 500, 600, 700] as const).find((item) => item >= weight)
    ?? theme.typography.weights.bold;
  return interFamilies[String(supported) as keyof typeof interFamilies];
}

export const CustomerText = forwardRef<NativeText, TextProps>(function CustomerText({ style, ...props }, ref) {
  const loaded = useContext(InterReady);
  return <NativeText ref={ref} {...props} style={[style, { fontFamily: familyFor(style, loaded) }]} />;
});

export const CustomerTextInput = forwardRef<NativeTextInput, TextInputProps>(function CustomerTextInput({ style, ...props }, ref) {
  const loaded = useContext(InterReady);
  return <NativeTextInput ref={ref} {...props} style={[style, { fontFamily: familyFor(style, loaded) }]} />;
});
