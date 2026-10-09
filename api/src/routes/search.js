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
  const limit = Math.min(Math.max(Number(k) || 4, 1), 20);

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
