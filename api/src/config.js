// Configuracion central. Es el unico archivo que lee process.env; el resto del
// codigo importa `config`. Asi los valores y sus defaults viven en un solo lugar.
// Las variables vienen de api/.env (ver .env.example).
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL,
  chunkSize: Number(process.env.CHUNK_SIZE ?? 1000),
  chunkOverlap: Number(process.env.CHUNK_OVERLAP ?? 200),
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  embedModel: process.env.EMBED_MODEL ?? "bge-m3",
  // Debe coincidir con vector(1024) de db/init.sql. ollama.js lo usa para
  // rechazar vectores de otro tamano antes de que fallen al insertarse.
  embedDimensions: Number(process.env.EMBED_DIMENSIONS ?? 1024),
  embedBatchSize: Number(process.env.EMBED_BATCH_SIZE ?? 16),
  chatModel: process.env.CHAT_MODEL ?? "llama3.2:3b",
  // Similitud coseno minima para considerar relevante un chunk (lo usa /ask).
  minSimilarity: Number(process.env.MIN_SIMILARITY ?? 0.45),
};

// Estas validaciones corren al importar el modulo, o sea al arrancar: es mejor
// que la API no levante con un mensaje claro a que falle despues en medio de
// una subida de archivos.
if (!config.databaseUrl) {
  throw new Error("Falta DATABASE_URL en el archivo .env");
}
// Con overlap >= size las piezas del chunker tendrian largo cero o negativo.
if (config.chunkOverlap >= config.chunkSize) {
  throw new Error("CHUNK_OVERLAP debe ser menor que CHUNK_SIZE");
}
