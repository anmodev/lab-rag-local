// Ruta de consulta sin modelo de chat: POST /search.
// Flujo: pregunta -> embedding -> busqueda por similitud -> chunks crudos.
// Sirve para ver que recupera el sistema antes de que el modelo de chat
// intervenga, y es lo que usa api/eval/run.js para medir la calidad.
import { Router } from "express";
import { embedTexts } from "../ollama.js";
import { searchChunks } from "../repository.js";

export const searchRouter = Router();

searchRouter.post("/", async (req, res) => {
  const { question, k = 4 } = req.body ?? {};
  if (typeof question !== "string" || !question.trim()) {
    return res
      .status(400)
      .json({ error: 'Falta la pregunta en el campo "question"' });
  }
  // k se acota entre 1 y 20 para que un valor raro no traiga toda la tabla.
  const limit = Math.min(Math.max(Number(k) || 4, 1), 20);

  // La pregunta tiene que vectorizarse con el mismo modelo que los chunks;
  // con otro modelo los vectores no serian comparables.
  const [vector] = await embedTexts([question.trim()]);
  const results = await searchChunks(vector, limit);

  res.json({
    question: question.trim(),
    results: results.map((r) => ({
      similarity: Number(r.similarity.toFixed(4)),
      filename: r.filename,
      chunkIndex: r.chunk_index,
      content: r.content,
    })),
  });
});
