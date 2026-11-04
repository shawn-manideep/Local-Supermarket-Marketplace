import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
const allowedHosts = [
  replitDevDomain,
  replitDevDomain?.endsWith(".replit.dev")
    ? replitDevDomain.replace(/\.replit\.dev$/, ".repl.co")
    : undefined,
].filter((host): host is string => Boolean(host));

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts,
    proxy: {
      "/api": {
        target: process.env.PREVIEW_BACKEND_ORIGIN ?? "http://127.0.0.1:8080",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyRequest, request) => {
            // Recovery must reach the backend's explicit Origin allowlist.
            // Other API requests retain the existing preview proxy behavior.
            if (!/^\/api\/auth\/recovery\/?(?:\?|$)/i.test(request.url ?? "")) {
              proxyRequest.removeHeader("origin");
            }
          });
        },
      },
    },
  },
});