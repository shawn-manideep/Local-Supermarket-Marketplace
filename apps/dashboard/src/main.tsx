import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { LanguageProvider } from "@workspace/localization";
import { dashboardLanguageStorage } from "./language-storage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageProvider storage={dashboardLanguageStorage} storageKeyPrefix="local-basket:dashboard:language:v1">
      <App />
    </LanguageProvider>
  </StrictMode>,
);