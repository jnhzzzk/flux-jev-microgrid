import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import app from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticDirectory = path.resolve(currentDirectory, "../../dist");
if (existsSync(staticDirectory)) {
  app.use(express.static(staticDirectory));
  app.use((request, response, next) => {
    if (request.method === "GET" && request.accepts("html")) {
      response.sendFile(path.join(staticDirectory, "index.html"));
      return;
    }
    next();
  });
}

app.listen(port, host, () => {
  console.log(`Flux microgrid API listening on http://${host}:${port}`);
});
