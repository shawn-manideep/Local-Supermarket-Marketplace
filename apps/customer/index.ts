import { createElement } from "react";
import { registerRootComponent } from "expo";
import App from "./App";
import { LanguageProvider } from "@workspace/localization";
import { customerLanguageStorage } from "./src/lib/language-storage";

registerRootComponent(() =>
  createElement(
    LanguageProvider,
    { storage: customerLanguageStorage, storageKeyPrefix: "local-basket:customer:language:v1" },
    createElement(App),
  ),
);