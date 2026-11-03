import { useState } from "react";

// Sign-in only. Operational portals and Admin do not consume this dictionary.
export const signInTelugu = {
  "Username or email address": "వినియోగదారు పేరు లేదా ఇమెయిల్ చిరునామా",
  "Enter your username or email address": "మీ వినియోగదారు పేరు లేదా ఇమెయిల్ చిరునామాను నమోదు చేయండి",
  "Password": "పాస్‌వర్డ్",
  "Show password": "పాస్‌వర్డ్‌ను చూపించు",
  "Hide password": "పాస్‌వర్డ్‌ను దాచు",
  "Sign in": "సైన్ ఇన్",
  "Forgot Password?": "పాస్‌వర్డ్ మర్చిపోయారా?",
  "Signing in…": "సైన్ ఇన్ అవుతోంది…",
  "Vendor Portal": "విక్రేత పోర్టల్",
  "Vendor sign in": "విక్రేత సైన్ ఇన్",
  "Sign Up as Vendor": "విక్రేతగా నమోదు చేసుకోండి",
  "Use your registered username or email address and password.": "మీ నమోదిత వినియోగదారు పేరు లేదా ఇమెయిల్ చిరునామా మరియు పాస్‌వర్డ్‌ను ఉపయోగించండి.",
  "Enter a valid username or email address.": "చెల్లుబాటు అయ్యే వినియోగదారు పేరు లేదా ఇమెయిల్ చిరునామాను నమోదు చేయండి.",
  "Unable to sign in. Check your details and try again.": "సైన్ ఇన్ కాలేదు. మీ వివరాలను తనిఖీ చేసి మళ్లీ ప్రయత్నించండి.",
  "Delivery partner portal": "డెలివరీ భాగస్వామి పోర్టల్",
  "Partner sign in": "భాగస్వామి సైన్ ఇన్",
  "Secure access": "సురక్షిత ప్రవేశం",
  "Your route starts here.": "మీ ప్రయాణం ఇక్కడ ప్రారంభమవుతుంది.",
  "Partner operations": "భాగస్వామి కార్యకలాపాలు",
  "A quiet place to check your daily delivery totals, assigned work, and partner profile.": "మీ రోజువారీ డెలివరీల మొత్తం, కేటాయించిన పని మరియు భాగస్వామి ప్రొఫైల్‌ను ఇక్కడ చూడండి.",
  "Partner accounts are provided by an administrator.": "భాగస్వామి ఖాతాలను నిర్వాహకుడు అందిస్తారు.",
} as const;
export type SignInText = keyof typeof signInTelugu;
export function translateSignIn(language: "en" | "te", text: string) {
  return language === "te" && Object.hasOwn(signInTelugu, text) ? signInTelugu[text as SignInText] : text;
}
export function useSignInLanguage() {
  const [language, setLanguage] = useState<"en" | "te">("en");
  return {
    language,
    t: (text: string) => translateSignIn(language, text),
    languageControl: <label className="text-button">Language / భాష{" "}
      <select aria-label="Sign-in language / సైన్ ఇన్ భాష" value={language}
        onChange={event => setLanguage(event.target.value === "te" ? "te" : "en")}>
        <option value="en">English</option><option value="te">తెలుగు</option>
      </select>
    </label>,
  };
}
