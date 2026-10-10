// Punto de entrada de la API. Arma Express, monta las rutas (documents para la
// ingesta, search y ask para la consulta) y traduce los errores a codigos HTTP.
import express from "express";
import { config } from "./config.js";
import { pingDb } from "./db.js";
import { ensureSchema } from "./repository.js";
import { documentsRouter } from "./routes/documents.js";
import { UnsupportedFileError } from "./extractors.js";
import { OllamaError } from "./ollama.js";
import { searchRouter } from './routes/search.js';
import { askRouter } from './routes/ask.js';

const app = express();
app.use(express.json());

// Health check: 503 si la base no responde, para que un monitor o un script
// de arranque lo detecte sin interpretar el body.
app.get("/health", async (req, res) => {
  const db = await pingDb().catch(() => false);
  res.status(db ? 200 : 503).json({ status: db ? "ok" : "degraded", db });
});

app.use("/documents", documentsRouter);
app.use('/search', searchRouter);
app.use('/ask', askRouter);

// Manejador de errores central. Express lo reconoce por tener 4 parametros
// (aunque `next` no se use) y tiene que registrarse DESPUES de las rutas para
// recibir lo que ellas lancen. Express 5 pasa aqui tambien los errores de los
// handlers async, por eso las rutas no necesitan try/catch.
app.use((err, req, res, next) => {
  // 502: fallo Ollama, no la API.
  if (err instanceof OllamaError) {
    return res.status(502).json({ error: err.message });
  }
  // 415: extension de archivo que no sabemos leer.
  if (err instanceof UnsupportedFileError) {
    return res.status(415).json({ error: err.message });
  }
  // Codigo que lanza multer cuando el archivo pasa el tope de documents.js.
  if (err.code === "LIMIT_FILE_SIZE") {
    return res
      .status(413)
      .json({ error: "El archivo supera el limite de 5 MB" });
  }
  // Cualquier otra cosa es un bug nuestro: el detalle queda en el log y al
  // cliente no se le muestra, para no filtrar datos internos.
  console.error(err);
  res.status(500).json({ error: "Error interno" });
});

await ensureSchema();

app.listen(config.port, () => {
  console.log(`API escuchando en http://localhost:${config.port}`);
});
