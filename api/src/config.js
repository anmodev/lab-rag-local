export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL,
  chunkSize: Number(process.env.CHUNK_SIZE ?? 1000),
  chunkOverlap: Number(process.env.CHUNK_OVERLAP ?? 200),
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  embedModel: process.env.EMBED_MODEL ?? "bge-m3",
  embedDimensions: Number(process.env.EMBED_DIMENSIONS ?? 1024),
  embedBatchSize: Number(process.env.EMBED_BATCH_SIZE ?? 16),
  chatModel: process.env.CHAT_MODEL ?? "llama3.2:3b",
  minSimilarity: Number(process.env.MIN_SIMILARITY ?? 0.45),
};

if (!config.databaseUrl) {
  throw new Error("Falta DATABASE_URL en el archivo .env");
}
if (config.chunkOverlap >= config.chunkSize) {
  throw new Error("CHUNK_OVERLAP debe ser menor que CHUNK_SIZE");
}
