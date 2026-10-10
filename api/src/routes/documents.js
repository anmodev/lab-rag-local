// Rutas de documentos. Ingesta: POST /documents.
// Flujo: archivo -> texto (extractors) -> chunks (chunker) -> embeddings
// (ollama) -> Postgres (repository).
// Mantenimiento: borrar uno o todos, y reindexar (volver a dividir y vectorizar el
// texto guardado) uno o todos, por ejemplo despues de cambiar CHUNK_SIZE.
import { Router } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { extractText } from "../extractors.js";
import { embedTexts } from "../ollama.js";
import {
  deleteAllDocuments,
  deleteDocument,
  findDocumentByHash,
  getDocument,
  listDocumentIds,
  listDocuments,
  replaceChunks,
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

// Los .md se dividen por secciones; el resto de tipos, con el chunker generico.
// Lo usan la subida y el reindexado, para que las dos hagan exactamente lo mismo.
function chunkDocument(text, filename) {
  const isMarkdown = path.extname(filename).toLowerCase() === ".md";
  const chunker = isMarkdown ? chunkMarkdown : chunkText;
  return chunker(text, { size: config.chunkSize, overlap: config.chunkOverlap });
}

// Vuelve a dividir y vectorizar el texto guardado de un documento. Primero se
// vectoriza (lo lento) y despues se reemplazan los chunks en una transaccion:
// si Ollama falla, el documento conserva los chunks que tenia.
// Devuelve null si no existe o si no tiene texto guardado (se cargo antes de que
// la base guardara el texto): ese hay que borrarlo y volver a subirlo.
async function reindexDocument(id) {
  const doc = await getDocument(id);
  if (!doc) return { notFound: true };
  if (!doc.content) return { filename: doc.filename, noContent: true };

  const chunks = chunkDocument(doc.content, doc.filename);
  const started = performance.now();
  const vectors = await embedTexts(chunks);
  const embedMs = Math.round(performance.now() - started);

  const replaced = await replaceChunks(doc.id, chunks, vectors);
  if (!replaced) return { notFound: true };
  return { documentId: doc.id, filename: doc.filename, chunkCount: chunks.length, embedMs };
}

// El :id llega como texto; si no es un numero, Postgres lanzaria un error 500.
documentsRouter.param("id", (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: "Id de documento invalido" });
  next();
});

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

  const chunks = chunkDocument(text, req.file.originalname);

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
    content: text,
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

// Borra todos los documentos (y sus chunks). Hay que pedirlo asi, sin id.
documentsRouter.delete("/", async (req, res) => {
  const deleted = await deleteAllDocuments();
  res.json({ deleted });
});

documentsRouter.delete("/:id", async (req, res) => {
  const deleted = await deleteDocument(req.params.id);
  if (!deleted) return res.status(404).json({ error: "El documento no existe" });
  res.json({ deleted: 1 });
});

// Reindexa todos, de a uno (Ollama no gana nada en paralelo). Los que no tienen
// texto guardado se listan en "skipped" en vez de abortar todo. Si Ollama falla a
// mitad, responde 502: los documentos ya reindexados quedan reindexados.
documentsRouter.post("/reindex", async (req, res) => {
  const started = performance.now();
  const reindexed = [];
  const skipped = [];
  for (const id of await listDocumentIds()) {
    const result = await reindexDocument(id);
    if (result.notFound) continue; // lo borraron mientras tanto
    if (result.noContent) skipped.push(result.filename);
    else reindexed.push({ filename: result.filename, chunkCount: result.chunkCount });
  }
  res.json({ reindexed, skipped, totalMs: Math.round(performance.now() - started) });
});

documentsRouter.post("/:id/reindex", async (req, res) => {
  const result = await reindexDocument(req.params.id);
  if (result.notFound) return res.status(404).json({ error: "El documento no existe" });
  if (result.noContent) {
    return res.status(409).json({
      error: "Este documento se cargo sin guardar su texto: borralo y vuelve a subirlo",
    });
  }
  res.json(result);
});
