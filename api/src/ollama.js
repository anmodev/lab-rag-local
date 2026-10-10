// Cliente HTTP de Ollama. Sirve a los dos flujos: embedTexts vectoriza los
// chunks (ingesta) y la pregunta (consulta); chat genera la respuesta final
// en /ask.
import { config } from "./config.js";

// Error propio para que server.js lo distinga y responda 502 (falla un
// servicio externo, no la API).
export class OllamaError extends Error {}

// Devuelve un vector por cada texto, en el mismo orden.
export async function embedTexts(texts) {
  const vectors = [];

  // En lotes (16 por defecto) para no mandar un documento grande en una sola
  // peticion. Ollama acepta un arreglo en `input` y devuelve los embeddings
  // en el mismo orden.
  for (let i = 0; i < texts.length; i += config.embedBatchSize) {
    const batch = texts.slice(i, i + config.embedBatchSize);

    let res;
    try {
      res = await fetch(`${config.ollamaUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.embedModel,
          input: batch,
          // num_gpu 0 = embeddings en CPU. Con 4 GB de VRAM, bge-m3 y el modelo
          // de chat juntos no caben y Ollama se los expulsa entre si, pagando
          // una recarga (~6 s) en cada pregunta. En CPU el chat conserva la GPU.
          options: { num_gpu: 0 },
        }),
      });
    } catch {
      // fetch solo lanza si no hubo conexion (Ollama apagado o URL mala).
      throw new OllamaError(
        `No se pudo conectar con Ollama en ${config.ollamaUrl}`,
      );
    }

    // Las respuestas HTTP con error (modelo no descargado, etc.) no lanzan solas.
    if (!res.ok) {
      throw new OllamaError(
        `Ollama respondio ${res.status}: ${await res.text()}`,
      );
    }
    const data = await res.json();
    vectors.push(...data.embeddings);
  }

  // Validar aqui da un error claro; si no, Postgres rechazaria el INSERT con
  // un mensaje de pgvector mas dificil de entender.
  const wrong = vectors.find((v) => v.length !== config.embedDimensions);
  if (wrong) {
    throw new OllamaError(
      `El modelo devolvio ${wrong.length} dimensiones y la base espera ${config.embedDimensions}`,
    );
  }
  return vectors;
}

// temperature 0 y seed fija: misma pregunta y mismo contexto dan la misma
// respuesta, lo que permite comparar cambios en el laboratorio.
const CHAT_OPTIONS = { temperature: 0, seed: 42 };

// Devuelve la respuesta completa de Ollama (texto y estadisticas de tiempo).
export async function chat(messages) {
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.chatModel,
      messages,
      // Una sola respuesta JSON, sin ir recibiendo tokens de a poco.
      stream: false,
      options: CHAT_OPTIONS,
    }),
  });
  if (!res.ok) {
    throw new OllamaError(
      `Ollama /api/chat respondio ${res.status}: ${await res.text()}`,
    );
  }
  return res.json();
}

// Igual que chat, pero entrega la respuesta por partes. Con stream: true Ollama
// manda una linea JSON por cada trozo de texto ({ message: { content }, done }),
// y la ultima (done: true) trae las estadisticas. `signal` permite cortar la
// generacion si el cliente se desconecta.
export async function* chatStream(messages, signal) {
  let res;
  try {
    res = await fetch(`${config.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.chatModel,
        messages,
        stream: true,
        options: CHAT_OPTIONS,
      }),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") return;
    throw new OllamaError(
      `No se pudo conectar con Ollama en ${config.ollamaUrl}`,
    );
  }
  if (!res.ok) {
    throw new OllamaError(
      `Ollama /api/chat respondio ${res.status}: ${await res.text()}`,
    );
  }

  // Un trozo de red puede traer media linea; se acumula hasta tener lineas
  // completas (terminadas en salto de linea) antes de interpretarlas.
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}
