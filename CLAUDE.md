# CLAUDE.md

Guia para Claude Code en este repositorio.

Laboratorio de RAG 100% local (sin nube) para aprender el flujo completo: extraer texto, dividir en chunks, vectorizar, guardar en Postgres y responder con un modelo usando solo lo recuperado. Tiene una API (Node) y un front (Angular) con carga de documentos y chat con respuesta en streaming. Comentarios y docs en espanol simple, sin tildes. Excepcion: los textos que vera el usuario final de una aplicacion real (y los documentos de `data/docs/`) llevan tildes. Los comandos del README estan escritos para cmd de Windows.

## Comandos

Infra (desde la raiz del repo): `docker compose up -d` levanta Ollama y Postgres+pgvector. Solo la primera vez, descargar los modelos:
`docker exec ollama ollama pull bge-m3` y `docker exec ollama ollama pull llama3.2:3b`.

API (desde `api/`, Node 24+, ESM): copiar `.env.example` a `.env`, luego `npm install` y `npm run dev` (`node --watch --env-file=.env src/server.js`). `npm test` corre las pruebas del chunker (`node --test`, sin servidor). No hay build ni lint. Al cambiar `.env` hay que reiniciar a mano: `--watch` solo vigila los `.js`.

Front (desde `web/`): `npm install` y `npm start`; abre `http://localhost:4200` y reenvia `/api` a la API (`proxy.conf.json`).

Evaluacion (necesita el servidor andando, desde `api/`):
- `node eval/run.js [set.json]`: solo recuperacion (`/search`). Muestra en que puesto sale el chunk esperado y el hueco de similitud con que se calibra `MIN_SIMILARITY`. Tarda segundos.
- `node eval/ask.js [concurrencia] [set.json] [--ids=1,2] [--k=3]`: pipeline completo (`/ask`). **No califica**: escribe `api/eval/ask.log` con cada pregunta, lo esperado y la respuesta, para que la revise una persona. Tarda minutos (45 preguntas: unos 3 con llama3.2:3b).
- Sets: `questions.json` (45 preguntas, sobre los 3 documentos originales) y `questions-docs.json` (83, sobre los 12 documentos grandes). Campos: `q`, `expect` / `expectAny` (texto del chunk correcto, lo usa `run.js`; una lista exige todos, `expectAny` basta uno), `answerHas` / `answerAny` (lo esperado en la respuesta, solo informativo) y `tipo`. Sin ninguno de los dos, la pregunta no esta en los documentos y debe decir que no sabe. Variable `API_URL`.
- Una respuesta completa y los chunks que leyo el modelo: `curl.exe -X POST http://localhost:3000/ask -H "Content-Type: application/json" -d "{\"question\":\"...\"}"`. El campo `sources` es exactamente lo que llego al modelo.

## Arquitectura

API Express 5 (`api/src`) delante de dos servicios Docker. La API corre fuera de Docker y los alcanza por localhost.

- Ingesta (`routes/documents.js`): subida -> `extractors.js` (por extension, solo .txt y .md) -> chunker -> embeddings por lotes en `ollama.js` -> `repository.saveDocument` (una transaccion). Duplicados por SHA-256 (409). `GET /documents` lista lo cargado.
- Chunker (`chunker.js`): los `.md` usan `chunkMarkdown`: un chunk por seccion de titulos con la ruta "Documento > Seccion" como primera linea. `CHUNK_SIZE` es un tamano OBJETIVO: una seccion que lo pasa hasta un 25 % se queda entera; una mas larga se reparte parejo en bloques (parrafos, listas, tablas, codigo) sin partirlos; dentro de un bloque se corta por oraciones (sin cortar en "a. m."), filas (repitiendo el encabezado) o lineas (conservando las cercas). Los demas tipos usan `chunkText`.
- Consulta (`routes/search.js`, `routes/ask.js`): vectoriza la pregunta -> `repository.searchChunks` (coseno, exacta, sin indice) -> `/ask` toma `k=5` y filtra por `MIN_SIMILARITY`; si nada pasa, responde la frase fija "no tengo informacion" sin llamar al modelo -> `CHAT_MODEL` con un system prompt que lo limita al contexto. `temperature: 0` y `seed: 42`. Con `ASK_REASONING=true` el modelo razona en una linea antes de responder y `reply.js` separa razonamiento y respuesta. `POST /ask/stream` entrega la respuesta por partes (una linea JSON por evento).
- Los embeddings se piden en CPU (`num_gpu: 0` en `ollama.js`): con 4 GB de VRAM el modelo de embeddings y el de chat se expulsaban entre si y cada pregunta pagaba una recarga.
- `config.js` es el unico archivo que lee `process.env` y valida al importarse (exige `DATABASE_URL` y `CHUNK_OVERLAP < CHUNK_SIZE`).
- `repository.js` concentra todo el SQL. Los vectores se envian como texto `'[..]'::vector`.
- `server.js` tiene un manejador central de errores: `OllamaError` -> 502, `UnsupportedFileError` -> 415, limite de multer -> 413. Los handlers son async sin try/catch (Express 5 reenvia los rechazos).
- Las `stats` de `/ask` vienen de Ollama en nanosegundos y se convierten a ms.

## Trampas

- La dimension de los embeddings (1024, bge-m3) esta en tres lugares: `vector(1024)` en `db/init.sql`, `EMBED_DIMENSIONS` en `config.js` y el propio modelo. Cambiar de modelo implica cambiar todo y re-vectorizar.
- `db/init.sql` solo corre cuando se crea el volumen `pgdata` por primera vez. Los cambios de esquema se aplican a mano o con `docker compose down -v` (borra datos y modelos).
- Cambiar los parametros de chunking o el codigo del chunker obliga a vaciar los documentos antes de re-subirlos (`TRUNCATE documents RESTART IDENTITY CASCADE;`), porque el dedupe es por hash del archivo.
- `docker-compose.yml` limita Ollama a 8 CPUs: en un equipo con menos nucleos Docker no arranca el contenedor (`range of CPUs is from 0.01 to N`). Los ajustes de un equipo (GPU, CPUs, memoria) van en un `docker-compose.override.yml` local, que git ignora.
- `OLLAMA_CONTEXT_LENGTH=4096`. `/ask` limita `k` a 10; con `k=5` y chunks de ~400 caracteres el prompt ronda los 700 a 1000 tokens.
- Memoria: PC de 16 GB con WSL limitado (`.wslconfig`). Con los dos modelos cargados el sistema llega al ~90 % y se pone lento. Cerrar apps antes de evaluaciones largas.
- `OLLAMA_KEEP_ALIVE=5m`: tras 5 minutos sin uso el modelo se descarga y la primera pregunta paga la carga (~7 s con llama3.2:3b, ~25 s con gemma3:4b).
- No modificar `api/.env` (es la configuracion real); los cambios de plantilla van en `api/.env.example`.

## Evaluacion: reglas y hallazgos

- Cambiar una sola variable por corrida (modelo, prompt, chunker, `k`) y comparar contra una referencia.
- **Hay ruido entre corridas**: aun con `temperature: 0` y `seed: 42`, con el modelo repartido entre GPU y CPU una misma pregunta con el mismo prompt cambia de respuesta. Diferencias de 1 a 3 preguntas en un set de 45 a 128 no son concluyentes; fiarse de patrones (por ejemplo "aparecieron falsos 'no se'") y no de un punto.
- **Calificar leyendo el log, no con un texto fijo.** Un calificador automatico dio falsos positivos ("2 horas" dentro de "72 horas") y falsos negativos ("descontara" frente a "descuent"). Por eso `ask.js` ya no califica.
- Resultados con `llama3.2:3b` directo, `k=5`, chunker v2 con 500/100 y los 15 documentos (juzgados a mano): set original 41/45, set nuevo 78/83. Con el chunker anterior (1000) y `k=3`, el original daba 38/45 (con 3 documentos daba 42/45: crecer el corpus cuesta recuperacion).
- Que movio y que no, con ese mismo modelo: troceado v2 +1 a +3 (arreglo fragmentos cortados, tablas sin encabezado y codigo partido); `k=3` -> `k=5` +2 (rescata chunks que quedaban en el puesto 4 o 5) a costa de ~44 % mas de tiempo. Reglas nuevas en el prompt ("comprueba que el contexto trata de lo mismo", razonamiento en pasos con "coincide SI/NO") empeoraron: llama dio falsos "no se" (de 1 a 8) y gemma firmaba el "coincide" sin comprobarlo.
- Comparacion de modelos (mismo set, `k=5`): `gemma3:4b` con razonamiento de una linea acierta lo mismo que `llama3.2:3b` directo (41/45) y tarda ~3 veces mas; `qwen2.5:7b` no mejoro y fue ~60 % mas lento. Fallan preguntas distintas, no menos.
- Errores que persisten con modelos de 3B a 4B: inventar un dato a partir de una tabla de otro concepto (salario del gerente respondido con el cupo de tarjeta; bono de navidad con el bono por antiguedad), leer mal rangos y tablas de varias columnas, y preguntas de dos partes sobre temas distintos (llega un solo fragmento).
- El umbral no separa trampas de aciertos: las preguntas cercanas al tema sin dato llegan a similitud ~0.70, por encima de casi todos los aciertos (~0.50 a 0.75). Esas las resuelve el modelo, no el umbral.
- La referencia de la empresa (CPU) con la configuracion anterior era 42/45 en ~326 s; los tiempos del PC de la empresa no se volvieron a medir con la configuracion actual.

## Forma de trabajo

- El usuario esta aprendiendo: explicar que hace cada comando antes de pedirle que lo corra. Un cambio a la vez.
- Los comandos de operacion (docker compose, npm run dev, evaluaciones, curl) los corre el usuario en su cmd; no levantar servicios ni correr evaluaciones por su cuenta salvo que lo autorice expresamente. Si algo queda corriendo, avisar y cerrarlo.
- Pedir confirmacion antes de borrar datos (`TRUNCATE documents`, `docker compose down -v`).
- Piloto futuro en .NET, posiblemente con SQL Server 2012 (sin tipo vector): mantener el acceso a datos aislado en `repository.js`.

## Pendientes

- Preguntas de dos partes sobre temas distintos: buscar cada parte por separado y juntar los resultados.
- Frenar el "inventa a partir de un concepto parecido": probar un modelo mayor (con GPU) o una verificacion aparte antes de responder; las reglas de prompt no bastaron.
- Indice HNSW y comparar con `EXPLAIN` contra el escaneo exacto (hoy no se nota con ~300 fragmentos).
- Busqueda hibrida (texto + vectores) para codigos exactos como `PV-01`.
- Autenticacion y limite de cola en la API antes de exponerla fuera de localhost.
- Extractores para PDF, Word y PowerPoint (por ejemplo MarkItDown o Docling).
- Borrar documentos desde el front.
- Fijar la version de la imagen de Ollama y sacar las credenciales del compose a `.env`.
