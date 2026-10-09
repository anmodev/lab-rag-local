import { Router } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { extractText } from "../extractors.js";
import { chunkText } from "../chunker.js";
import { embedTexts } from "../ollama.js";
import { findDocumentByHash, saveDocument } from "../repository.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

export const documentsRouter = Router();

documentsRouter.post("/", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ error: 'Falta el archivo en el campo "file"' });
  }

  const text = extractText(req.file);
  const hash = createHash("sha256").update(req.file.buffer).digest("hex");

  const existing = await findDocumentByHash(hash);
  if (existing) {
    return res.status(409).json({
      error: "Este archivo ya fue cargado",
      documentId: existing.id,
    });
  }

  const chunks = chunkText(text, {
    size: config.chunkSize,
    overlap: config.chunkOverlap,
  });
  if (chunks.length === 0) {
    return res.status(400).json({ error: "El archivo no tiene texto" });
  }

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
