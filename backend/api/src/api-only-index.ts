import {
  loadApiOnlyApp,
  verifyApiOnlyDatabaseIdentity,
} from "./api-only/startup.js";

const createApp = await loadApiOnlyApp(
  process.env,
  verifyApiOnlyDatabaseIdentity,
  async () => {
    const appModule = await import("./app.js");
    return appModule.createApp;
  },
);

const app = createApp();
const port = Number(process.env.PORT ?? 5000);

app.listen(port, "0.0.0.0", () => {
  process.stdout.write(`API-only server listening on port ${port}\n`);
});
