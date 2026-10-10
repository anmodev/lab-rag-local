// Ruta de ingesta: POST /documents.
// Flujo: archivo -> texto (extractors) -> chunks (chunker) -> embeddings
// (ollama) -> Postgres (repository).
import { Router } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { extractText } from "../extractors.js";
import { embedTexts } from "../ollama.js";
import {
  findDocumentByHash,
  listDocuments,
  saveDocument,
} from "../repository.js";
import path from "node:path";
import { chunkText, chunkMarkdown } from "../chunker.js";

// El archivo se queda en memoria (no en disco) porque es chico y solo se lee
// una vez. El tope de 5 MB evita que una subida enorme llene la RAM; si se
// pasa, multer lanza LIMIT_FILE_SIZE y server.js responde 413.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

export const documentsRouter = Router();

// Documentos cargados en la base de conocimiento (para la pantalla de carga).
documentsRouter.get("/", async (req, res) => {
  const documents = await listDocuments();
  res.json({ documents });
});

documentsRouter.post("/", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ error: 'Falta el archivo en el campo "file"' });
  }

  const text = extractText(req.file);
  // El hash es del archivo original, no del texto ni de los chunks. Por eso,
  // si cambias CHUNK_SIZE o CHUNK_OVERLAP, el mismo archivo seguira contando
  // como duplicado: hay que borrar el documento antes de volver a subirlo.
  const hash = createHash("sha256").update(req.file.buffer).digest("hex");

  // Se revisa el duplicado ANTES de vectorizar, que es la parte cara (una
  // llamada a Ollama por cada lote de chunks).
  const existing = await findDocumentByHash(hash);
  if (existing) {
    return res.status(409).json({
      error: "Este archivo ya fue cargado",
      documentId: existing.id,
    });
  }

  // Los .md se dividen por secciones; el resto de tipos, con el chunker generico
  const isMarkdown =
    path.extname(req.file.originalname).toLowerCase() === ".md";
  const chunker = isMarkdown ? chunkMarkdown : chunkText;
  const chunks = chunker(text, {
    size: config.chunkSize,
    overlap: config.chunkOverlap,
  });

  if (chunks.length === 0) {
    return res.status(400).json({ error: "El archivo no tiene texto" });
  }

  // embedMs mide cuanto cuesta vectorizar el documento; sirve para comparar
  // tamanos de chunk o modelos.
  const started = performance.now();
  const vectors = await embedTexts(chunks);
  const embedMs = Math.round(performance.now() - started);

  const documentId = await saveDocument({
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    hash,
    chunks,
    vectors,
  });

  res.status(201).json({
    documentId,
    filename: req.file.originalname,
    chunkCount: chunks.length,
    embedMs,
  });
});
