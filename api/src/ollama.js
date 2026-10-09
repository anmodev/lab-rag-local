import { config } from "./config.js";

export class OllamaError extends Error {}

export async function embedTexts(texts) {
  const vectors = [];

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
      throw new OllamaError(
        `No se pudo conectar con Ollama en ${config.ollamaUrl}`,
      );
    }

    if (!res.ok) {
      throw new OllamaError(
        `Ollama respondio ${res.status}: ${await res.text()}`,
      );
    }
    const data = await res.json();
    vectors.push(...data.embeddings);
  }

  const wrong = vectors.find((v) => v.length !== config.embedDimensions);
  if (wrong) {
    throw new OllamaError(
      `El modelo devolvio ${wrong.length} dimensiones y la base espera ${config.embedDimensions}`,
    );
  }
  return vectors;
}

export async function chat(messages) {
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.chatModel,
      messages,
      stream: false,
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
