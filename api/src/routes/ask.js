import { Router } from "express";
import { config } from "../config.js";
import { embedTexts, chat } from "../ollama.js";
import { searchChunks } from "../repository.js";

export const askRouter = Router();

const NO_INFO = "No tengo informacion sobre eso en los documentos.";

const SYSTEM_PROMPT = `Eres un asistente que responde preguntas sobre documentos internos de una empresa.
Responde solo con la informacion del contexto. Si la respuesta no esta en el contexto, responde exactamente: "${NO_INFO}"
Responde en espanol, de forma breve y directa.`;

askRouter.post("/", async (req, res) => {
  const { question, k = 3 } = req.body ?? {};
  if (typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: 'Falta "question" en el body' });
  }
  const limit = Math.min(Math.max(Number(k) || 3, 1), 10);

  const [vector] = await embedTexts([question]);
  const found = await searchChunks(vector, limit);
  const relevant = found.filter((c) => c.similarity >= config.minSimilarity);

  if (relevant.length === 0) {
    return res.json({ question, answer: NO_INFO, sources: [] });
  }

  const context = relevant
    .map((c, i) => `[${i + 1}] (${c.filename})\n${c.content}`)
    .join("\n\n");

  const started = performance.now();
  const reply = await chat([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Contexto:\n${context}\n\nPregunta: ${question}` },
  ]);
  const chatMs = Math.round(performance.now() - started);

  res.json({
    question,
    answer: reply.message.content.trim(),
    sources: relevant.map((c) => ({
      filename: c.filename,
      chunkIndex: c.chunk_index,
      similarity: Number(c.similarity.toFixed(4)),
    })),
    stats: {
      chatMs,
      promptTokens: reply.prompt_eval_count,
      answerTokens: reply.eval_count,
      loadMs: Math.round(reply.load_duration / 1e6),
      promptMs: Math.round(reply.prompt_eval_duration / 1e6),
      genMs: Math.round(reply.eval_duration / 1e6),
    },
  });
});
