// Rutas de consulta completa: POST /ask (respuesta de una vez) y POST /ask/stream
// (respuesta por partes, para mostrarla mientras se escribe).
// Flujo: pregunta -> embedding -> busqueda -> filtro por MIN_SIMILARITY ->
// armar contexto -> modelo de chat. Es la parte "generacion" del RAG.
import { Router } from "express";
import { config } from "../config.js";
import { embedTexts, chat, chatStream, OllamaError } from "../ollama.js";
import { searchChunks } from "../repository.js";
import { splitReply, createReplyParser } from "../reply.js";

export const askRouter = Router();

// Texto fijo que ve el usuario cuando no hay informacion. Tambien se le pide
// al modelo que lo use, asi la respuesta es la misma venga de donde venga.
const NO_INFO = "No tengo informacion sobre eso en los documentos.";

// Obliga al modelo a contestar solo con el contexto recuperado; sin esto
// tiende a completar con lo que "sabe" y a inventar datos de la empresa.
// Respuesta directa: el prompt con el que se midio llama3.2:3b (42/45).
const PROMPT_DIRECT = `Eres un asistente que responde preguntas sobre documentos internos de una empresa.
Responde solo con la informacion del contexto. Si la respuesta no esta en el contexto, responde exactamente: "${NO_INFO}"
Responde en espanol, de forma breve y directa.`;

// Con razonamiento (ASK_REASONING=true): el modelo escribe "Razonamiento: ..."
// y despues "Respuesta: ...". Arregla rangos y cuentas en gemma3:4b, pero con
// llama3.2:3b empeora; por eso no es el modo por defecto.
const PROMPT_REASONING = `Eres un asistente que responde preguntas sobre documentos internos de una empresa.
Responde solo con la informacion del contexto. Si la respuesta no esta en el contexto, responde exactamente: "${NO_INFO}"
Antes de la respuesta final escribe una linea de razonamiento: si el contexto define rangos, indica a que rango pertenece el valor de la pregunta; si hay que sumar o multiplicar, muestra la cuenta.
Despues escribe "Respuesta:" seguido de una respuesta natural, como la daria una persona: una o dos frases cortas que incluyan el dato con su unidad (pesos, dias, horas, etc.). Hablale al usuario de tu ("Debes...", "Tienes...") y nunca respondas en primera persona, como si fueras el usuario.
Si en tu razonamiento concluyes que el contexto no tiene el dato, escribe despues de "Respuesta:" exactamente: "${NO_INFO}" y nada mas, sin ofrecer informacion parecida.
Responde en espanol.`;

const SYSTEM_PROMPT = config.askReasoning ? PROMPT_REASONING : PROMPT_DIRECT;

// Devuelve los chunks relevantes para la pregunta (puede ser una lista vacia).
async function retrieve(question, k) {
  // k se acota entre 1 y 10: mas chunks llenan la ventana de contexto
  // (OLLAMA_CONTEXT_LENGTH) y Ollama recortaria el prompt sin avisar.
  const limit = Math.min(Math.max(Number(k) || 3, 1), 10);

  // 1. Recuperar: los k chunks mas cercanos, sean buenos o no.
  const [vector] = await embedTexts([question]);
  const found = await searchChunks(vector, limit);
  // 2. Filtrar: la busqueda siempre devuelve algo, aunque no tenga relacion.
  //    El umbral separa lo relevante del relleno.
  return found.filter((c) => c.similarity >= config.minSimilarity);
}

// 3. Armar el contexto, con cada chunk numerado y con su archivo de origen.
function buildMessages(relevant, question) {
  const context = relevant
    .map((c, i) => `[${i + 1}] (${c.filename})\n${c.content}`)
    .join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Contexto:\n${context}\n\nPregunta: ${question}` },
  ];
}

const toSources = (relevant) =>
  relevant.map((c) => ({
    filename: c.filename,
    chunkIndex: c.chunk_index,
    similarity: Number(c.similarity.toFixed(4)),
  }));

// Tiempos y tokens para entender donde se va el tiempo. Ollama los da en
// nanosegundos, por eso se divide entre 1e6 para pasarlos a ms.
// loadMs: cargar el modelo en memoria (alto si estaba descargado).
// promptMs: leer el prompt; cerca de 0 significa que Ollama reutilizo la
// cache de un prompt identico.
// genMs: generar la respuesta token por token.
const toStats = (chatMs, r) => ({
  chatMs,
  promptTokens: r.prompt_eval_count,
  answerTokens: r.eval_count,
  loadMs: Math.round(r.load_duration / 1e6),
  promptMs: Math.round(r.prompt_eval_duration / 1e6),
  genMs: Math.round(r.eval_duration / 1e6),
});

const validQuestion = (q) => typeof q === "string" && q.trim();

askRouter.post("/", async (req, res) => {
  const { question, k } = req.body ?? {};
  if (!validQuestion(question)) {
    return res.status(400).json({ error: 'Falta "question" en el body' });
  }

  const relevant = await retrieve(question, k);

  // Si nada pasa el umbral no se llama al modelo: la respuesta es instantanea
  // y se evita que invente algo con un contexto que no sirve.
  if (relevant.length === 0) {
    return res.json({ question, answer: NO_INFO, sources: [] });
  }

  // 4. Generar la respuesta.
  const started = performance.now();
  const reply = await chat(buildMessages(relevant, question));
  const chatMs = Math.round(performance.now() - started);

  // El modelo responde "Razonamiento: ... Respuesta: ..."; al usuario solo le llega
  // la respuesta y el razonamiento va aparte.
  const { answer, reasoning } = splitReply(reply.message.content.trim());

  res.json({
    question,
    // Modelo que respondio: sirve para saber de que corrida es cada log de evaluacion.
    model: config.chatModel,
    answer,
    reasoning,
    sources: toSources(relevant),
    stats: toStats(chatMs, reply),
  });
});

// Misma consulta, pero la respuesta llega por partes como lineas JSON (una por
// linea, application/x-ndjson). Eventos, en orden:
//   { type: "sources", sources }       los chunks usados, apenas se recuperan
//   { type: "reasoning", text }        trozos del razonamiento (0 o mas)
//   { type: "answer", text }           trozos de la respuesta final
//   { type: "done", answer, reasoning, model, stats }   el resultado completo
//   { type: "error", message }         algo fallo despues de empezar a enviar
askRouter.post("/stream", async (req, res) => {
  const { question, k } = req.body ?? {};
  if (!validQuestion(question)) {
    return res.status(400).json({ error: 'Falta "question" en el body' });
  }

  // Hasta aqui los errores (Ollama caido, etc.) salen por el manejador central
  // con su codigo HTTP; despues de enviar las cabeceras ya no se puede.
  const relevant = await retrieve(question, k);

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();
  const send = (event) => res.write(`${JSON.stringify(event)}\n`);

  send({ type: "sources", sources: toSources(relevant) });

  if (relevant.length === 0) {
    send({ type: "answer", text: NO_INFO });
    send({ type: "done", answer: NO_INFO, reasoning: "", model: config.chatModel });
    return res.end();
  }

  // Si el cliente cierra la pestana se corta tambien la generacion en Ollama.
  const controller = new AbortController();
  res.on("close", () => controller.abort());

  const parser = createReplyParser();
  let full = "";
  let last = null; // el ultimo trozo de Ollama (done: true) trae las estadisticas
  const started = performance.now();

  try {
    const parts = chatStream(buildMessages(relevant, question), controller.signal);
    for await (const part of parts) {
      if (part.message?.content) {
        full += part.message.content;
        parser.push(part.message.content).forEach(send);
      }
      if (part.done) last = part;
    }
    parser.end().forEach(send);

    // El resultado final se calcula con el texto completo, igual que en /ask:
    // si el modelo no respeto el formato, el cliente reemplaza lo que mostro.
    const chatMs = Math.round(performance.now() - started);
    const { answer, reasoning } = splitReply(full.trim());
    send({
      type: "done",
      answer,
      reasoning,
      model: config.chatModel,
      stats: last ? toStats(chatMs, last) : undefined,
    });
  } catch (err) {
    if (!controller.signal.aborted) {
      console.error(err);
      send({
        type: "error",
        message: err instanceof OllamaError ? err.message : "Error interno",
      });
    }
  }
  res.end();
});
