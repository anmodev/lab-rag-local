// Ruta de consulta completa: POST /ask.
// Flujo: pregunta -> embedding -> busqueda -> filtro por MIN_SIMILARITY ->
// armar contexto -> modelo de chat. Es la parte "generacion" del RAG.
import { Router } from "express";
import { config } from "../config.js";
import { embedTexts, chat } from "../ollama.js";
import { searchChunks } from "../repository.js";

export const askRouter = Router();

// Texto fijo que ve el usuario cuando no hay informacion. Tambien se le pide
// al modelo que lo use, asi la respuesta es la misma venga de donde venga.
const NO_INFO = "No tengo informacion sobre eso en los documentos.";

// Obliga al modelo a contestar solo con el contexto recuperado; sin esto
// tiende a completar con lo que "sabe" y a inventar datos de la empresa.
const SYSTEM_PROMPT = `Eres un asistente que responde preguntas sobre documentos internos de una empresa.
Responde solo con la informacion del contexto. Si la respuesta no esta en el contexto, responde exactamente: "${NO_INFO}"
Responde en espanol, de forma breve y directa.`;

askRouter.post("/", async (req, res) => {
  const { question, k = 3 } = req.body ?? {};
  if (typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: 'Falta "question" en el body' });
  }
  // k se acota entre 1 y 10: mas chunks llenan la ventana de contexto
  // (OLLAMA_CONTEXT_LENGTH) y Ollama recortaria el prompt sin avisar.
  const limit = Math.min(Math.max(Number(k) || 3, 1), 10);

  // 1. Recuperar: los k chunks mas cercanos, sean buenos o no.
  const [vector] = await embedTexts([question]);
  const found = await searchChunks(vector, limit);
  // 2. Filtrar: la busqueda siempre devuelve algo, aunque no tenga relacion.
  //    El umbral separa lo relevante del relleno.
  const relevant = found.filter((c) => c.similarity >= config.minSimilarity);

  // Si nada pasa el umbral no se llama al modelo: la respuesta es instantanea
  // y se evita que invente algo con un contexto que no sirve.
  if (relevant.length === 0) {
    return res.json({ question, answer: NO_INFO, sources: [] });
  }

  // 3. Armar el contexto, con cada chunk numerado y con su archivo de origen.
  const context = relevant
    .map((c, i) => `[${i + 1}] (${c.filename})\n${c.content}`)
    .join("\n\n");

  // 4. Generar la respuesta.
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
    // Tiempos y tokens para entender donde se va el tiempo. Ollama los da en
    // nanosegundos, por eso se divide entre 1e6 para pasarlos a ms.
    // loadMs: cargar el modelo en memoria (alto si estaba descargado).
    // promptMs: leer el prompt; cerca de 0 significa que Ollama reutilizo la
    // cache de un prompt identico.
    // genMs: generar la respuesta token por token.
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
