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
        body: JSON.stringify({ model: config.embedModel, input: batch }),
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
      // temperature 0 y seed fija: misma pregunta y mismo contexto dan la
      // misma respuesta, lo que permite comparar cambios en el laboratorio.
      options: { temperature: 0, seed: 42 },
    }),
  });
  if (!res.ok) {
    throw new OllamaError(
      `Ollama /api/chat respondio ${res.status}: ${await res.text()}`,
    );
  }
  return res.json();
}
