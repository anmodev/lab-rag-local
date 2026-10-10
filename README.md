# Lab RAG local

Laboratorio para aprender el flujo de un RAG corriendo todo en local (CPU, sin nube):
subes un archivo, se divide en chunks, se vectoriza, se guarda en Postgres y luego
puedes buscar o hacer preguntas que el modelo responde solo con lo que encuentra.

## Arquitectura

```
INGESTA
archivo (.md / .txt) -> API Node -> extraer texto -> chunks -> embeddings (Ollama) -> Postgres + pgvector

CONSULTA
pregunta -> embedding -> top-k chunks similares -> filtro por umbral -> llama3.2:3b -> respuesta + fuentes
```

Los `.md` se dividen por secciones de titulos; los demas tipos, por tamano (ver "Como se dividen los documentos").

## Tecnologias

| Pieza | Tecnologia |
|---|---|
| API | Node 24, Express 5, multer, pg |
| Embeddings | Ollama con `bge-m3` (1024 dimensiones) |
| Modelo de chat | Ollama con `llama3.2:3b` |
| Base de datos | Postgres 16 con pgvector (`pgvector/pgvector:pg16`) |
| Infraestructura | Docker Compose sobre Docker Desktop (WSL2) |

## Requisitos

- Docker Desktop con WSL2. Limites sugeridos en `%USERPROFILE%\.wslconfig`:
  `memory=6GB`, `processors=8`, `swap=4GB`
- Node 24 o superior
- 16 GB de RAM en total. Con los dos modelos cargados el equipo queda justo: cierra apps pesadas
  antes de las evaluaciones largas.

## Levantar el lab

1. Contenedores (Ollama y Postgres), desde la raiz del repo:

```
docker compose up -d
```

2. Descargar los modelos (solo la primera vez):

```
docker exec ollama ollama pull bge-m3
docker exec ollama ollama pull llama3.2:3b
```

3. API. Crea `api/.env` a partir de la plantilla (desde la carpeta `api`):

```
copy .env.example .env
```

Su contenido es:

```text
PORT=3000
DATABASE_URL=postgresql://rag_user:rag_password@localhost:5432/rag_db
OLLAMA_URL=http://localhost:11434
EMBED_MODEL=bge-m3
CHAT_MODEL=llama3.2:3b
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
MIN_SIMILARITY=0.45
```

Luego:

```
npm install
npm run dev
```

Si cambias el `.env`, reinicia el servidor a mano (`Ctrl+C` y `npm run dev`): `--watch` solo vigila los `.js`.
`db/init.sql` (extension y tablas) solo corre la primera vez que se crea el volumen de Postgres.

## Probar

Salud de la API y la base de datos:

```
curl.exe http://localhost:3000/health
```

Subir un documento (de `data/docs/`, desde la raiz del repo):

```
curl.exe -F "file=@data/docs/manual-colaborador.md" http://localhost:3000/documents
```

Buscar chunks parecidos (sin modelo de chat):

```
curl.exe -X POST http://localhost:3000/search -H "Content-Type: application/json" -d "{\"question\":\"cuanto es el viatico diario en bogota\",\"k\":3}"
```

Preguntar (busca y responde con el modelo):

```
curl.exe -X POST http://localhost:3000/ask -H "Content-Type: application/json" -d "{\"question\":\"cada cuanto debo cambiar mi contrasena\"}"
```

## Evaluar

Las preguntas estan en `api/eval/questions.json`. Se corren desde `api/` con el servidor andando.

Solo la recuperacion (rapido, segundos). Muestra en que puesto sale el chunk correcto y
la similitud, y al final compara aciertos contra preguntas sin respuesta para calibrar `MIN_SIMILARITY`:

```
node eval/run.js
```

El pipeline completo con el modelo (tarda unos 5 minutos con las 45 preguntas). Imprime la respuesta, si es correcta,
cuantos chunks y tokens uso y los tiempos (en segundos desde 1 s, en ms por debajo). El numero es cuantas preguntas se mandan en simultaneo:

```
node eval/ask.js 1
node eval/ask.js 4
```

Para ver la respuesta completa en la tabla, antes de correrlo: `set ANSWER_WIDTH=300`.

Para revisar una sola pregunta con la respuesta completa y los chunks que leyo el modelo (`sources`):

```
curl.exe -X POST http://localhost:3000/ask -H "Content-Type: application/json" -d "{\"question\":\"quien aprueba una compra de 12 millones de pesos\"}"
```

`questions.json` tiene 45 preguntas: las 20 originales y 25 nuevas, marcadas con `"nueva": true` y un
`tipo` (`parafrasis`, `ortografia`, `combinar`, `rangos`, `trampa`). Los scripts ignoran esos dos campos.

## Como se dividen los documentos

- **Markdown (`.md`)**: un chunk por seccion, con la ruta de titulos como primera linea
  (por ejemplo `Manual > 5. Compras`). Si una seccion es mas larga que `CHUNK_SIZE`, se parte en trozos
  y cada uno conserva la ruta.
- **Otros tipos (`.txt`)**: cortes por parrafo, linea, oracion y palabra, con `CHUNK_SIZE` y `CHUNK_OVERLAP`.

Si cambias estos parametros o el chunker, hay que borrar los documentos y volver a subirlos
(ver "Utiles"), porque los duplicados se detectan por el hash del archivo.

## Endpoints

| Metodo | Ruta | Que hace |
|---|---|---|
| GET | `/health` | Estado de la API y la base de datos |
| GET | `/documents` | Lista los documentos cargados, con tamano, fecha y cantidad de chunks |
| POST | `/documents` | Recibe un archivo (campo `file`), lo procesa y lo guarda. 409 si ya existe (mismo hash) |
| POST | `/search` | Body `{question, k}`. Devuelve los chunks mas parecidos con su similitud |
| POST | `/ask` | Body `{question, k}`. Busca, filtra por umbral y responde con el modelo, con fuentes y tiempos |
| POST | `/ask/stream` | Igual que `/ask`, pero la respuesta llega por partes (una linea JSON por evento: `sources`, `reasoning`, `answer`, `done`, `error`) |

## Estructura

```
docker-compose.yml     Ollama + Postgres
db/init.sql            extension vector y tablas documents / chunks
data/docs/             documentos de prueba
CLAUDE.md              guia del proyecto para Claude Code
api/
  .env.example         plantilla de configuracion
  src/
    server.js          arranque, rutas y manejo de errores
    config.js          variables de entorno
    db.js              pool de Postgres y transacciones
    extractors.js      extraccion de texto por tipo de archivo
    chunker.js         chunkText (por tamano) y chunkMarkdown (por secciones)
    ollama.js          embeddings y chat
    repository.js      todo el SQL en un solo lugar
    reply.js           separa razonamiento y respuesta del modelo (completa o por partes)
    routes/            documents.js, search.js, ask.js
  eval/                questions.json, run.js (recuperacion) y ask.js (pipeline completo)
web/                   front en Angular: pantalla de documentos y chat con streaming
```

## Front (Angular)

Dos pantallas: **Documentos** (cargar `.md` y `.txt` y ver lo cargado) y **Chat**
(las respuestas se van escribiendo en tiempo real, con razonamiento y fuentes).
Necesita la API andando en el puerto 3000. Desde la carpeta `web`:

```
npm install
npm start
```

Abre `http://localhost:4200`. El servidor de desarrollo reenvia `/api/...` a
`http://localhost:3000` (ver `web/proxy.conf.json`), asi que no hace falta CORS.
Para que no pierda la conexion, la API debe estar escuchando en ese puerto.

### Estilo de respuesta (`ASK_REASONING`)

Por defecto `/ask` responde directo, que es lo medido con `llama3.2:3b`. Con
`ASK_REASONING=true` en `api/.env` el modelo razona antes de responder: arregla
rangos y cuentas con modelos como `gemma3:4b`, pero con `llama3.2:3b` empeora.
Cambiarlo obliga a reiniciar la API a mano y conviene medirlo con `eval/ask.js`.

## Configuracion segun el equipo

El mismo codigo corre en equipos distintos, pero tres decisiones dependen del hardware:
como corre Ollama, que modelo de chat se usa y como se le pide la respuesta.

| Equipo | Como correr Ollama | `CHAT_MODEL` | `ASK_REASONING` | Estado |
|---|---|---|---|---|
| Sin GPU, 16 GB | Docker, `docker-compose.yml` tal cual | `llama3.2:3b` | `false` | Medido: 42/45 (326 s en CPU) |
| NVIDIA con 4 GB de VRAM | Docker + `docker-compose.override.yml` con GPU | `gemma3:4b` | `true` | Medido: 43/45 (~330 s) |
| NVIDIA con 8 GB o mas | Igual que la anterior | `gemma3:4b` o un 7B | `true` | Sin medir |
| Mac con Apple Silicon, 16 GB o mas | Ollama nativo + solo `db` en Docker | `gemma3:4b` o un 7B | `true` | Sin medir |
| Poca RAM (8 GB) | Docker, `docker-compose.yml` tal cual | `llama3.2:3b` | `false` | Sin medir |

"Medido" significa corrido con `eval/ask.js 4` y las 45 preguntas. Mas memoria no
garantiza mas calidad: en las pruebas `qwen2.5:7b` (42/45, 534 s) no supero a
`gemma3:4b` (43/45) y fue un 60% mas lento. Mas VRAM compra velocidad y modelos
mas grandes, y hay que medir cuanto mejora en cada caso.

### Sin GPU (solo CPU)

Es el `docker-compose.yml` tal cual y el `.env.example` por defecto: no hay que
cambiar nada.

- Si `docker compose up -d` falla con `range of CPUs is from 0.01 to N.00`, el equipo
  tiene menos nucleos que el limite `cpus: "8"` del compose: bajar ese numero al
  que diga el error. En Windows con WSL, los nucleos que ve Docker salen de
  `processors` en `.wslconfig`.
- Con `llama3.2:3b`, `ASK_REASONING` debe quedar en `false`: con razonamiento
  empeoro (34/45 contra 42/45).

### GPU NVIDIA (Windows con WSL2 o Linux)

Requisitos: driver de NVIDIA actualizado. En Windows basta con Docker Desktop con
WSL2; en Linux hace falta ademas el NVIDIA Container Toolkit.

Crear `docker-compose.override.yml` en la raiz del repo (git lo ignora, es por
equipo). Docker Compose lo fusiona solo con `docker-compose.yml`:

```yaml
services:
  ollama:
    deploy:
      resources:
        limits:
          cpus: "6"    # igual o menor a los nucleos que ve Docker
          memory: 6G   # subir si el modelo de chat es de 7B o mas
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

Para comprobar que quedo bien:

```
docker compose config
docker exec ollama nvidia-smi
docker exec ollama ollama ps
```

La columna `PROCESSOR` de `ollama ps` dice que parte del modelo esta en GPU. Con
4 GB de VRAM, `gemma3:4b` queda en ~54% GPU y `llama3.2:3b` en ~80%; el resto va
a CPU.

Detalle de VRAM: `bge-m3` y el modelo de chat no caben juntos en 4 GB y Ollama se
los expulsaba entre si, recargando uno en cada pregunta (~6 s). Por eso `ollama.js`
pide los embeddings en CPU (`num_gpu: 0`). Con mucha VRAM podrian ir en GPU, pero
hoy no es configurable.

En `api/.env` de un equipo con 4 GB:

```
CHAT_MODEL=gemma3:4b
ASK_REASONING=true
```

### Mac con Apple Silicon

Docker en Mac no puede usar la GPU del chip: un Ollama dentro de Docker correria
solo en CPU. La opcion buena es **Ollama nativo** (app o `brew install ollama`) y
en Docker solo la base de datos:

```
docker compose up -d db
ollama pull bge-m3
ollama pull gemma3:4b
```

La API ya apunta a `http://localhost:11434` (`OLLAMA_URL`), asi que no cambia nada.
Las variables `OLLAMA_*` del compose (`KEEP_ALIVE`, `MAX_LOADED_MODELS`, etc.) no
aplican al Ollama nativo: si hacen falta, se definen como variables de entorno del
sistema. Este perfil no esta medido: es un punto de partida.

### Otras cosas a tener en cuenta

- La primera pregunta despues de 5 minutos sin uso paga la carga del modelo
  (`OLLAMA_KEEP_ALIVE=5m`): unos 25 s con `gemma3:4b` en una GPU de 4 GB.
- Al cambiar de equipo la base de datos arranca vacia: hay que volver a subir los
  documentos (pantalla Documentos o `POST /documents`).
- Cambiar de modelo o de `ASK_REASONING` cambia los resultados: medirlo con
  `eval/ask.js` antes de compararlo con las referencias.

## Resultados de referencia

Con `llama3.2:3b` y el chunker por secciones.

Las 20 preguntas originales (14 con respuesta y 6 sin ella):

| Prueba | Resultado |
|---|---|
| `run.js` | 14/14 en el top-5, 13 en el puesto 1 |
| `ask.js 4` | 19/20, unos 140 s en total |

Las 45 preguntas (20 originales + 25 nuevas, 34 con respuesta y 11 sin ella):

| Prueba | Resultado |
|---|---|
| `run.js` | 34/34 en el top-5, 30 en el puesto 1 |
| `ask.js 4` | 42/45, unos 326 s en total |

Las 25 nuevas por tipo en `ask.js 4`:

| Tipo | Aciertos | Fallo |
|---|---|---|
| Parafraseadas | 5/5 | |
| Con errores de ortografia | 4/5 | comer en Cali |
| Combinar o calcular | 3/5 | aprobador de 12 millones, vacaciones por 3 anos |
| Rangos numericos | 5/5 | |
| Trampas cercanas al tema | 5/5 | |

Lo aprendido hasta ahora:
- `MIN_SIMILARITY=0.45` separa las preguntas lejanas del tema (hasta ~0.40) de los aciertos (desde ~0.49).
  Las preguntas cercanas al tema pero sin respuesta (~0.55 a 0.58) se mezclan con los aciertos: las resuelve el modelo.
- Los modelos de 3B confunden rangos y temas parecidos. Cambiar de modelo o retocar el prompt no mejoro: conviene medir antes de cambiar.
- Ollama atiende de a poco: unas 5 a 6 preguntas por minuto en este equipo, sin importar cuantas lleguen juntas.
- Al modelo le llegan todos los chunks que pasan el umbral (hasta `k`, 3 por defecto), no solo el mejor. No sabe cual es el mejor: un chunk de relleno puede distraerlo.
- Las preguntas cercanas al tema sin dato (trampas) llegan a ~0.67 de similitud, por encima de casi todos los aciertos. Ningun umbral las separa; en esta corrida el modelo dijo que no sabia en las 5.
- Los 3 fallos nuevos fueron de lectura del modelo, no de busqueda, y dos de ellos aciertan al cambiar la redaccion de la pregunta. El modelo de 3B es sensible a como se pregunta.
- Un modelo de chat mayor deberia mejorar la lectura, no la busqueda ni el umbral. Para compararlo: cambiar solo `CHAT_MODEL` y medir contra estos resultados (ver "Para el piloto" en `CLAUDE.md`).

## Ver la base de datos desde consola

No hace falta un cliente grafico: se consulta con `psql` dentro del contenedor `rag_db`
(`-U` usuario, `-d` base, `-c` ejecuta una sentencia y sale).

Documentos cargados:

```
docker exec rag_db psql -U rag_user -d rag_db -c "SELECT id, filename, size_bytes, created_at FROM documents ORDER BY id;"
```

Cuantos chunks tiene cada documento:

```
docker exec rag_db psql -U rag_user -d rag_db -c "SELECT d.id, d.filename, count(*) AS chunks FROM chunks c JOIN documents d ON d.id = c.document_id GROUP BY d.id, d.filename ORDER BY d.id;"
```

Chunks de un documento (cambia el `6` por el id), con su largo y el inicio del texto:

```
docker exec rag_db psql -U rag_user -d rag_db -c "SELECT chunk_index, length(content) AS caracteres, left(content, 70) AS inicio FROM chunks WHERE document_id = 6 ORDER BY chunk_index;"
```

Texto completo de un chunk (`-t -A` imprime solo el texto, sin bordes ni encabezados):

```
docker exec rag_db psql -U rag_user -d rag_db -t -A -c "SELECT content FROM chunks WHERE document_id = 6 AND chunk_index = 4;"
```

Comprobar que los vectores tienen 1024 dimensiones:

```
docker exec rag_db psql -U rag_user -d rag_db -c "SELECT chunk_index, vector_dims(embedding) AS dimensiones FROM chunks WHERE document_id = 6 ORDER BY chunk_index LIMIT 3;"
```

Sesion interactiva (`-it` conecta tu teclado). Dentro: `\dt` lista tablas, `\d chunks` muestra
las columnas, `\q` sale:

```
docker exec -it rag_db psql -U rag_user -d rag_db
```

## Utiles

Borrar todos los documentos (los chunks se borran en cascada). Necesario antes de
re-subir un archivo con otros parametros o con otro chunker, porque el dedupe es por hash del archivo:

```
docker exec rag_db psql -U rag_user -d rag_db -c "DELETE FROM documents;"
```

Ver que modelos tiene Ollama en memoria:

```
docker exec ollama ollama ps
```

Reiniciar todo desde cero (borra modelos y datos):

```
docker compose down -v
```

## Pendientes

- Indice HNSW y comparar con `EXPLAIN` contra el escaneo exacto.
- Medir consistencia en el set de evaluacion: varias redacciones de cada pregunta y contar las que se responden bien siempre.
- Calificador de `ask.js` que acepte una lista de textos esperados (preguntas de dos partes).
- Respuestas en streaming y limite de concurrencia en la API.
- Mas tipos de archivo (PDF, Word, PowerPoint) para el piloto.