import { createApp } from "../../../backend/api/src/app.js";
import healthRouter from "./routes/health";

const app = createApp();

app.use("/api", healthRouter);

export default app;
