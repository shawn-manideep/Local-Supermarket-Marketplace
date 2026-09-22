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
        target: "http://localhost:5000",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyRequest) => {
            proxyRequest.removeHeader("origin");
          });
        },
      },
    },
  },
});