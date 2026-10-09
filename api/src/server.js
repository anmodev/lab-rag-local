import express from "express";
import { config } from "./config.js";
import { pingDb } from "./db.js";
import { documentsRouter } from "./routes/documents.js";
import { UnsupportedFileError } from "./extractors.js";
import { OllamaError } from "./ollama.js";
import { searchRouter } from './routes/search.js';
import { askRouter } from './routes/ask.js';

const app = express();
app.use(express.json());

app.get("/health", async (req, res) => {
  const db = await pingDb().catch(() => false);
  res.status(db ? 200 : 503).json({ status: db ? "ok" : "degraded", db });
});

app.use("/documents", documentsRouter);
app.use('/search', searchRouter);
app.use('/ask', askRouter);

app.use((err, req, res, next) => {
  if (err instanceof OllamaError) {
    return res.status(502).json({ error: err.message });
  }
  if (err instanceof UnsupportedFileError) {
    return res.status(415).json({ error: err.message });
  }
  if (err.code === "LIMIT_FILE_SIZE") {
    return res
      .status(413)
      .json({ error: "El archivo supera el limite de 5 MB" });
  }
  console.error(err);
  res.status(500).json({ error: "Error interno" });
});

app.listen(config.port, () => {
  console.log(`API escuchando en http://localhost:${config.port}`);
});
