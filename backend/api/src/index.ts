import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 5000);

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.listen(port, "0.0.0.0", () => {
  process.stdout.write(`API listening on port ${port}\n`);
});