import { createContext, forwardRef, isValidElement, useContext, type PropsWithChildren, type ReactNode } from "react";
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
const teluguFonts = {
  NotoSansTelugu_400Regular: require("@workspace/localization/assets/NotoSansTelugu-Regular.ttf"),
  NotoSansTelugu_500Medium: require("@workspace/localization/assets/NotoSansTelugu-Medium.ttf"),
  NotoSansTelugu_600SemiBold: require("@workspace/localization/assets/NotoSansTelugu-SemiBold.ttf"),
  NotoSansTelugu_700Bold: require("@workspace/localization/assets/NotoSansTelugu-Bold.ttf"),
};
const teluguFamilies: Record<"400" | "500" | "600" | "700", string> = {
  "400": "NotoSansTelugu_400Regular",
  "500": "NotoSansTelugu_500Medium",
  "600": "NotoSansTelugu_600SemiBold",
  "700": "NotoSansTelugu_700Bold",
};
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
    ...teluguFonts,
  });
  return <InterReady.Provider value={loaded}>{children}</InterReady.Provider>;
}

function textContent(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(value)) return textContent(value.props.children);
  return "";
}

function containsTelugu(value: string | undefined) {
  return Boolean(value && /[\u0c00-\u0c7f]/u.test(value));
}

function familyFor(style: StyleProp<TextStyle> | undefined, loaded: boolean, telugu: boolean) {
  const weight = Number(StyleSheet.flatten(style)?.fontWeight ?? theme.typography.weights.regular);
  if (loaded && telugu) {
    const supported = ([400, 500, 600, 700] as const).find(item => item >= weight) ?? 700;
    return teluguFamilies[String(supported) as keyof typeof teluguFamilies];
  }
  if (!loaded) {
    if (Platform.OS === "web") return theme.typography.fontFamily;
    return Platform.OS === "ios" ? "System" : "sans-serif";
  }
  const supported = ([300, 400, 500, 600, 700] as const).find((item) => item >= weight)
    ?? theme.typography.weights.bold;
  return interFamilies[String(supported) as keyof typeof interFamilies];
}

export const CustomerText = forwardRef<NativeText, TextProps>(function CustomerText({ style, ...props }, ref) {
  const loaded = useContext(InterReady);
  return <NativeText ref={ref} {...props} style={[style, { fontFamily: familyFor(style, loaded, /[\u0c00-\u0c7f]/u.test(textContent(props.children))) }]} />;
});

export const CustomerTextInput = forwardRef<NativeTextInput, TextInputProps>(function CustomerTextInput({ style, ...props }, ref) {
  const loaded = useContext(InterReady);
  const inputText = [props.value, props.defaultValue, props.placeholder].filter((value): value is string => typeof value === "string").join(" ");
  return <NativeTextInput ref={ref} {...props} style={[style, { fontFamily: familyFor(style, loaded, containsTelugu(inputText)) }]} />;
});
