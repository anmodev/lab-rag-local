# CLAUDE.md

Guia para Claude Code en este repositorio.

Laboratorio de RAG 100% local (CPU, sin nube) para aprender el flujo completo: extraer texto, dividir en chunks, vectorizar, guardar en Postgres y responder con un modelo usando solo lo recuperado. Comentarios y docs en espanol simple, sin tildes. Excepcion: los textos que vera el usuario final de una aplicacion real llevan tildes. Los comandos del README estan escritos para cmd de Windows.

## Comandos

Infra (desde la raiz del repo): `docker compose up -d` levanta Ollama y Postgres+pgvector. Solo la primera vez, descargar los modelos:
`docker exec ollama ollama pull bge-m3` y `docker exec ollama ollama pull llama3.2:3b`.

API (desde `api/`, Node 24+, ESM): copiar `.env.example` a `.env`, luego `npm install` y `npm run dev` (`node --watch --env-file=.env src/server.js`). No hay build, lint ni pruebas unitarias (`npm test` es un stub). Al cambiar `.env` hay que reiniciar a mano: `--watch` solo vigila los `.js`.

La evaluacion es la suite de pruebas, y ambas necesitan el servidor andando:
- `node eval/run.js`: solo recuperacion (`/search`). Muestra en que puesto sale el chunk esperado y el hueco de similitud con que se calibra `MIN_SIMILARITY`. Tarda segundos.
- `node eval/ask.js [concurrencia]`: pipeline completo (`/ask`). Califica la respuesta del modelo y mide tiempos. Tarda minutos (unos 3 a 4). Argumento: preguntas en simultaneo (1 por defecto). Variable opcional `ANSWER_WIDTH` para el ancho de la columna de respuesta.
- Los casos estan en `api/eval/questions.json`: `q`, `expect` (texto que debe estar en el chunk correcto, lo usa `run.js`) y `answerHas` (texto que debe estar en la respuesta, lo usa `ask.js`). Sin ninguno de los dos, la pregunta no esta en los documentos y se espera que el modelo diga que no sabe. Variable `API_URL`.

## Arquitectura

API Express 5 (`api/src`) delante de dos servicios Docker. La API corre fuera de Docker y los alcanza por localhost.

- Ingesta (`routes/documents.js`): subida -> `extractors.js` (por extension, solo .txt y .md; para un tipo nuevo se agrega una entrada al mapa) -> chunker -> embeddings por lotes en `ollama.js` -> `repository.saveDocument` (una transaccion). Los duplicados se detectan por SHA-256 (`content_hash`, responde 409).
- Chunker (`chunker.js`): los `.md` usan `chunkMarkdown` (un chunk por seccion de titulos, con la ruta "Documento > Seccion" como primera linea; una seccion mas larga que `CHUNK_SIZE` se parte con `chunkText` y cada trozo conserva la ruta; los `#` dentro de bloques de codigo no cuentan como titulos). Los demas tipos usan `chunkText` (recursivo por parrafo, linea, oracion y palabra, con `CHUNK_SIZE` y `CHUNK_OVERLAP`).
- Consulta (`routes/search.js`, `routes/ask.js`): vectoriza la pregunta -> `repository.searchChunks` (distancia coseno `<=>`, busqueda exacta, sin indice todavia) -> `/ask` filtra por `MIN_SIMILARITY`; si nada pasa, devuelve la respuesta fija "no tengo informacion" sin llamar al modelo de chat -> modelo de `CHAT_MODEL` (por defecto `llama3.2:3b`) con un system prompt que lo limita al contexto. El chat usa `temperature: 0` y `seed: 42` para que las respuestas sean reproducibles.
- `config.js` es el unico archivo que lee `process.env` y valida al importarse (exige `DATABASE_URL` y `CHUNK_OVERLAP < CHUNK_SIZE`).
- `repository.js` concentra todo el SQL. Los vectores se envian como texto `'[..]'::vector`.
- `server.js` tiene un manejador central de errores: `OllamaError` -> 502, `UnsupportedFileError` -> 415, limite de tamano de multer -> 413. Los handlers son async sin try/catch (Express 5 reenvia los rechazos).
- Las `stats` de `/ask` vienen de Ollama en nanosegundos y se convierten a ms. Un `promptMs` casi en cero indica cache de un prompt identico al anterior.

## Trampas

- La dimension de los embeddings (1024, bge-m3) esta en tres lugares: `vector(1024)` en `db/init.sql`, `EMBED_DIMENSIONS` en `config.js` y el propio modelo. Cambiar de modelo implica cambiar todo y re-vectorizar.
- `db/init.sql` solo corre cuando se crea el volumen `pgdata` por primera vez. Los cambios de esquema se aplican a mano o con `docker compose down -v` (borra datos y modelos).
- Cambiar los parametros de chunking o el codigo del chunker obliga a borrar los documentos antes de re-subirlos (`DELETE FROM documents;`, los chunks se borran en cascada), porque el dedupe es por hash del archivo.
- `OLLAMA_CONTEXT_LENGTH=4096` en `docker-compose.yml`. `/ask` limita `k` a 10 y ese limite es prudencial: con chunks de ~1000 caracteres (~300 tokens), un `k` alto se acerca al tope. Se asume que Ollama recorta en silencio un prompt demasiado grande, pero no se ha verificado en este lab.
- Memoria: PC de 16 GB con WSL limitado a 6 GB (`.wslconfig`). Con los dos modelos cargados el sistema llega al ~96% y se pone lento. Cerrar apps antes de correr evaluaciones largas.
- `OLLAMA_KEEP_ALIVE=5m`: tras 5 minutos sin uso el modelo se descarga, y la primera pregunta paga la carga (~7 s). Al cambiar `CHAT_MODEL` o reiniciar los contenedores pasa lo mismo.
- No modificar `api/.env` (es la configuracion real); los cambios de plantilla van en `api/.env.example`.

## Evaluacion: reglas y hallazgos

- Cambiar una sola variable por corrida (modelo, prompt, chunker, concurrencia) y comparar contra una referencia.
- Referencia con `chunkMarkdown` y `llama3.2:3b`: `run.js` deja las 14 preguntas con respuesta en el top-5 (13 en el puesto 1); `ask.js 4` da 19/20 en el script y tarda ~140 s. El fallo restante es maternidad: el modelo responde "no se menciona", que es correcto en el fondo.
- Con `MIN_SIMILARITY=0.45`: los aciertos quedan desde ~0.49, las preguntas lejanas del tema hasta ~0.40, pero las preguntas cercanas al tema sin respuesta llegan a ~0.55-0.58 y se traslapan con los aciertos. Esas las resuelve el modelo, no el umbral.
- Los modelos de 3B confunden rangos y temas parecidos. `qwen2.5:3b` no fue mejor (18/20) y un prompt que pedia "el dato exacto" empeoro el resultado (16/20). No retocar el prompt sin medir.
- El chunker por secciones mejoro la velocidad (~190 s -> ~140 s con concurrencia 4, menos tokens por prompt) y arreglo el error del incidente critico.
- Concurrencia: Ollama no escala en este equipo (unas 5 a 6 preguntas por minuto). Con 20 en simultaneo la espera maxima fue de ~217 s, cerca del limite de 300 s de `fetch`.

## Forma de trabajo

- El usuario esta aprendiendo: explicar que hace cada comando antes de pedirle que lo corra. Un cambio a la vez.
- Pedir confirmacion antes de borrar datos (`DELETE FROM documents`, `docker compose down -v`).
- Piloto futuro en .NET, posiblemente con SQL Server 2012 (sin tipo vector): mantener el acceso a datos aislado en `repository.js`.

## Pendientes

- Indice HNSW y comparar con `EXPLAIN` contra el escaneo exacto.
- Set de evaluacion mas dificil: preguntas parafraseadas, con errores de ortografia, que combinen dos secciones, con rangos numericos y trampas cercanas al tema.
- Respuestas en streaming y limite de concurrencia en la API.
- Extractores para PDF, Word y PowerPoint (por ejemplo un servicio de conversion tipo MarkItDown o Docling).
- Unir secciones muy cortas en el chunker de Markdown.
- Corte relativo al primer resultado, para no mandar chunks de relleno al modelo.
- Fijar la version de la imagen de Ollama y sacar las credenciales del compose a `.env`.