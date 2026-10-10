import AsyncStorage from "@react-native-async-storage/async-storage";

/** Language preferences are isolated from authentication/session storage. */
export const customerLanguageStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
};
