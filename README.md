# Lab RAG local

Laboratorio para aprender el flujo de un RAG corriendo todo en local, sin nube: subes un
archivo, se divide en chunks, se vectoriza, se guarda en Postgres y luego puedes hacer
preguntas que el modelo responde solo con lo que encuentra. Incluye una API (Node) y un
front (Angular) con carga de documentos y chat con la respuesta escribiendose en tiempo real.

## Arquitectura

```
INGESTA
archivo (.md / .txt) -> API Node -> extraer texto -> chunks -> embeddings (Ollama) -> Postgres + pgvector

CONSULTA
pregunta -> embedding -> 5 chunks mas parecidos -> filtro por umbral -> modelo de chat -> respuesta + fuentes
```

El front (`web/`) habla con la API; la API habla con Ollama (modelos) y Postgres (datos).

## Como funciona, paso a paso

### La idea en una frase

Un modelo de lenguaje no conoce tus documentos y, si le preguntas por ellos, **inventa**.
RAG (*Retrieval-Augmented Generation*, generacion aumentada con recuperacion) lo resuelve en
dos movimientos: primero **buscar** en tus documentos los trozos que sirven y despues pedirle
al modelo que **responda leyendo solo esos trozos**.

Es como un examen a libro abierto: el modelo no memoriza el manual de la empresa; alguien le
busca la pagina correcta y se la pone delante antes de contestar.

### Vocabulario

| Termino | Que es | En este proyecto |
|---|---|---|
| **Chunk** (fragmento) | Un trozo de un documento. Se parte porque el modelo lee mejor trozos cortos y la busqueda es mas precisa | Una seccion del documento, de unos 500 caracteres |
| **Embedding** (vector) | Una lista de numeros que representa el *sentido* de un texto. Textos con significado parecido quedan con vectores cercanos, aunque no compartan palabras | 1024 numeros por chunk, calculados por `bge-m3` |
| **Similitud coseno** | Un numero de 0 a 1 que mide cuan parecidos son dos vectores (1 = identicos) | El `0.57` que ves en las fuentes |
| **pgvector** | Extension de Postgres que guarda vectores y encuentra los mas cercanos a uno dado | Columna `embedding vector(1024)` |
| **k** | Cuantos fragmentos se recuperan por pregunta | 5 por defecto, 10 como maximo |
| **Umbral** | Similitud minima para considerar util un fragmento | `MIN_SIMILARITY=0.45` |
| **Prompt** | El texto completo que se le manda al modelo: instrucciones + fragmentos + pregunta | Se arma en `routes/ask.js` |
| **Modelo de chat** (LLM) | El que redacta la respuesta | `llama3.2:3b` |
| **Alucinacion** | Cuando el modelo inventa un dato que no esta en los documentos. El umbral y las instrucciones la reducen, no la eliminan | Las "trampas" de la evaluacion la provocan a proposito |
| **Streaming** | La respuesta llega por partes, como si se escribiera | `POST /ask/stream` |
| **Ollama** | Programa que ejecuta los modelos en tu maquina y los expone por HTTP | Contenedor `ollama`, puerto 11434 |

### Ingesta: que pasa cuando subes un archivo

```
archivo -> texto -> trozos (chunks) -> vectores -> Postgres
```

1. **Recibir.** `POST /documents` ([routes/documents.js](api/src/routes/documents.js)) acepta un
   archivo de hasta 5 MB.
2. **Extraer el texto.** [extractors.js](api/src/extractors.js) lo convierte a texto plano segun la
   extension (`.md` y `.txt`).
3. **Detectar duplicados.** Se calcula el SHA-256 del archivo; si ya existe se responde 409
   *antes* de vectorizar, que es lo caro.
4. **Dividir.** [chunker.js](api/src/chunker.js): los `.md` por secciones de titulos, el resto por
   tamano con solapamiento (ver "Como se dividen los documentos").
5. **Vectorizar.** [ollama.js](api/src/ollama.js) manda los chunks a `bge-m3` en lotes de 16 y
   recibe un vector de 1024 numeros por cada uno.
6. **Guardar.** [repository.js](api/src/repository.js) inserta el documento y todos sus chunks (texto
   y vector) en una sola transaccion: o se guarda todo o no se guarda nada.

### Consulta: que pasa cuando preguntas

```
pregunta -> vector -> buscar los mas parecidos -> filtrar por umbral -> armar prompt -> modelo -> respuesta
```

1. **Vectorizar la pregunta** con el mismo `bge-m3`. Debe ser el mismo modelo que se uso en la
   ingesta, o los vectores no son comparables.
2. **Buscar.** `searchChunks` pide a pgvector los `k` chunks con menor distancia coseno. La busqueda
   es exacta: compara contra todos los chunks.
3. **Filtrar.** Se descartan los que no llegan a `MIN_SIMILARITY`. Si no queda ninguno, se responde
   "No tengo informacion" **sin llamar al modelo** (por eso tarda ~100 ms).
4. **Armar el prompt.** Instrucciones + los fragmentos numerados con su archivo + la pregunta.
5. **Generar.** El modelo redacta la respuesta usando solo ese contexto.
6. **Devolver** la respuesta, las fuentes (archivo, fragmento y similitud) y los tiempos.

Lo que recibe el modelo, abreviado:

```
[sistema] Eres un asistente que responde preguntas sobre documentos internos...
[usuario] Contexto:
          [1] (manual-colaborador.md)
          Manual del colaborador de Acme S.A.S. > 4. Viaticos y gastos de viaje
          ... El hospedaje se reserva unicamente con la agencia de viajes aliada,
          con un tope de 280.000 pesos por noche en Bogota y 220.000 en otras ciudades...

          Pregunta: cual es el tope de hospedaje por noche en bogota
```

### Tres casos reales (con los documentos de `data/docs/`)

| Pregunta | Similitud del mejor chunk | Que pasa |
|---|---|---|
| "cual es el tope de hospedaje por noche en bogota" | 0.58 | Pasa el umbral, el modelo lee la seccion de viaticos y responde **280.000 pesos** |
| "cual es la capital de Francia" | 0.31 | No pasa el umbral: respuesta fija, **el modelo ni se llama** |
| "cuanto pagan por una hora extra nocturna" | 0.57 | **Pasa el umbral** (habla de horas extras), pero el dato no existe: lo decide el modelo, que debe decir "no tengo informacion" |

El tercer caso es el mas importante para entender los limites: la similitud mide *tema*, no si la
respuesta esta. Una pregunta cercana al tema pero sin dato puede sacar mas similitud que una
pregunta bien contestada. El umbral no basta; el ultimo filtro es el modelo.

### Las perillas

| Variable | Que cambia | Que tener en cuenta |
|---|---|---|
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | Tamano objetivo de los fragmentos y cuanto se repite entre vecinos | Chunks grandes dan contexto pero diluyen la busqueda; chicos son precisos pero pierden contexto. Cambiarlos obliga a vaciar y re-subir |
| `k` (en la peticion) | Cuantos fragmentos lee el modelo | Mas fragmentos rescatan respuestas que quedaban en el puesto 4 o 5, pero el prompt es mas largo y mas lento |
| `MIN_SIMILARITY` | Que tan exigente es el filtro | Alto: rechaza preguntas validas. Bajo: deja pasar relleno |
| `CHAT_MODEL` | Que modelo redacta | Mas grande = mejor lectura, pero mas lento y mas memoria |
| `ASK_REASONING` | Respuesta directa o con una linea de razonamiento | Ayuda con rangos y cuentas; con modelos de 3B a 4B no mejoro el total |
| `EMBED_MODEL` | Que modelo vectoriza | La dimension (1024) esta en tres sitios; cambiarlo implica re-vectorizar todo |

### Limitaciones conocidas

- Los modelos pequenos (3B a 4B) a veces inventan un dato a partir de un concepto parecido (responden un
  salario con el cupo de una tarjeta) y leen mal rangos y tablas de varias columnas. Ninguna regla de
  prompt probada lo arreglo; pide un modelo mayor.
- Una pregunta de dos partes sobre temas distintos ("el formulario de teletrabajo y el de vacaciones")
  puede perder un fragmento: la busqueda trae cinco y a veces ambos temas no caben.
- No hay memoria de conversacion: cada pregunta se responde sola (un "y en Medellin?" de seguimiento no funciona).
- La busqueda es solo semantica: un codigo exacto como `PV-01` puede no rankear bien.
- Los resultados cambian un poco entre corridas aunque `temperature` sea 0 (ver "Evaluar").
- Solo lee `.md` y `.txt`; PDF y Word estan pendientes.
- La API no tiene autenticacion: no exponerla fuera de tu maquina tal cual.

## Tecnologias

| Pieza | Tecnologia |
|---|---|
| API | Node 24, Express 5, multer, pg |
| Front | Angular 21 (componentes standalone y signals) |
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

3. API. Crea `api/.env` a partir de la plantilla y arrancala (desde la carpeta `api`):

```
copy .env.example .env
npm install
npm run dev
```

Si cambias el `.env`, reinicia el servidor a mano (`Ctrl+C` y `npm run dev`): `--watch` solo vigila los `.js`.
`db/init.sql` (extension y tablas) solo corre la primera vez que se crea el volumen de Postgres.

4. Front (desde la carpeta `web`, con la API andando):

```
npm install
npm start
```

Abre `http://localhost:4200`. El servidor de desarrollo reenvia `/api/...` a
`http://localhost:3000` (ver `web/proxy.conf.json`), asi que no hace falta CORS.

5. Cargar la base de conocimiento: en la pantalla **Documentos**, arrastra los archivos de
   `data/docs/` (15 documentos, unos 2 minutos). Despues pregunta en la pantalla **Chat**.

### Si ya tenias el lab andando (despues de un `git pull`)

Un `.env` y una base creados con una version anterior siguen funcionando, pero no dan los
resultados de referencia. Para dejarlos al dia:

1. En `api/.env` pon `CHUNK_SIZE=500` y `CHUNK_OVERLAP=100` (o borra esas dos lineas: son los
   valores por defecto) y revisa que no tenga `ASK_REASONING=true`. Compara con `api/.env.example`.
2. En `api`: `npm install`; en `web`: `npm install`. Reinicia la API.
3. Vacia los documentos viejos (el chunker cambio y el dedupe es por hash del archivo):

```
docker exec rag_db psql -U rag_user -d rag_db -c "TRUNCATE documents RESTART IDENTITY CASCADE;"
```

4. Vuelve a subir los 15 archivos de `data/docs/` desde el front.

Para confirmar que quedo bien: la base debe tener 15 documentos y 303 chunks, y desde `api/`
`node eval/run.js` debe dar 34 con respuesta, 34 en el top-5 y 29 en el puesto 1
(`node eval/run.js questions-docs.json`: 74, 74 y 64).

## Probar sin el front

```
curl.exe http://localhost:3000/health
curl.exe -F "file=@data/docs/manual-colaborador.md" http://localhost:3000/documents
curl.exe -X POST http://localhost:3000/search -H "Content-Type: application/json" -d "{\"question\":\"cuanto es el viatico diario en bogota\",\"k\":3}"
curl.exe -X POST http://localhost:3000/ask -H "Content-Type: application/json" -d "{\"question\":\"cada cuanto debo cambiar mi contrasena\"}"
```

Salud de la API; subir un documento; buscar chunks parecidos (sin modelo de chat); preguntar
(busca y responde). La respuesta de `/ask` trae `sources`: exactamente los fragmentos que leyo el modelo.

## Evaluar

Se corre desde `api/` con el servidor andando. Hay dos sets de preguntas en `api/eval/`:

| Set | Preguntas | Sobre |
|---|---|---|
| `questions.json` | 45 (34 con respuesta, 11 sin ella) | Los 3 documentos originales |
| `questions-docs.json` | 83 (74 con respuesta, 9 sin ella) | Los 12 documentos grandes |

**Recuperacion** (rapido, segundos). Muestra en que puesto sale el chunk correcto y la similitud, y al
final compara aciertos contra preguntas sin respuesta para calibrar `MIN_SIMILARITY`:

```
node eval/run.js
node eval/run.js questions-docs.json
```

**Pipeline completo** con el modelo (minutos). El numero es cuantas preguntas se mandan en simultaneo:

```
node eval/ask.js 4
node eval/ask.js 4 questions-docs.json
node eval/ask.js 4 --ids=17,36,39        solo esas preguntas
node eval/ask.js 4 --k=3                 fija cuantos fragmentos recibe el modelo
```

`ask.js` **no califica solo**: escribe `api/eval/ask.log` con cada pregunta, lo esperado y la
respuesta, para revisarlo leyendo. Se probo un calificador automatico y daba falsos positivos
("2 horas" dentro de "72 horas") y falsos negativos ("descontara" frente a "descuenta"); leer la
respuesta es mas fiable. El log se sobreescribe en cada corrida: copialo si quieres conservarlo.
La variable `ANSWER_WIDTH` (por defecto 80) cambia el ancho de la columna de respuesta en la tabla;
`API_URL` apunta a otra API (por defecto `http://localhost:3000`).

Cada pregunta puede llevar:

| Campo | Para que sirve |
|---|---|
| `expect` | Texto que debe aparecer en el chunk correcto (`run.js`). Una lista exige que aparezcan todos |
| `expectAny` | Lista de textos de los que basta uno, para cuando la respuesta esta en mas de un chunk (la tabla y un caso resuelto) |
| `answerHas` / `answerAny` | Lo esperado en la respuesta (todos / alguno). Solo se muestra en el log |
| `tipo` | `directa`, `parafrasis`, `ortografia`, `rangos`, `combinar`, `codigo` o `trampa` |

Sin `answerHas` ni `answerAny`, la pregunta no esta en los documentos y el modelo debe decir que no
tiene informacion.

Dos reglas del laboratorio:

- **Cambiar una sola cosa por medicion** (modelo, prompt, chunker, `k`) y comparar contra una referencia.
- **Hay ruido entre corridas**: aun con `temperature: 0` y `seed: 42`, con el modelo repartido entre GPU
  y CPU una misma pregunta cambia de respuesta. Diferencias de 1 a 3 preguntas no son concluyentes.

Pruebas del chunker (casos hechos a proposito, sin servidor):

```
npm test
```

## Como se dividen los documentos

- **Markdown (`.md`)**: un chunk por seccion, con la ruta de titulos como primera linea
  (por ejemplo `Manual > 5. Compras`). `CHUNK_SIZE` es un tamano **objetivo**, no un tope duro:
  - Una seccion que lo pasa un poco (hasta un 25 %) se queda entera.
  - Una mas larga se divide en bloques (parrafos, listas, tablas y codigo) que se reparten parejo,
    sin dejar una cola de pocas lineas.
  - Solo se corta dentro de un bloque cuando el bloque solo ya no cabe: por oraciones (sin cortar en
    `a. m.` ni `p. m.`), por filas (cada trozo de una tabla repite su encabezado) o por lineas (cada
    trozo de codigo conserva sus cercas).
  - La frase que termina en `:` se queda con el bloque que presenta, y el texto bajo el titulo del
    documento (por ejemplo la version) se pega a la primera seccion.
- **Otros tipos (`.txt`)**: cortes por parrafo, linea, oracion y palabra, con `CHUNK_SIZE` y `CHUNK_OVERLAP`.

Si cambias estos parametros o el chunker, hay que vaciar los documentos y volver a subirlos
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
data/docs/             15 documentos de prueba (los que se cargan desde el front)
CLAUDE.md              guia del proyecto para Claude Code
api/
  .env.example         plantilla de configuracion
  src/
    server.js          arranque, rutas y manejo de errores
    config.js          variables de entorno
    db.js              pool de Postgres y transacciones
    extractors.js      extraccion de texto por tipo de archivo
    chunker.js         chunkText (por tamano) y chunkMarkdown (por secciones y bloques)
    ollama.js          embeddings y chat
    repository.js      todo el SQL en un solo lugar
    reply.js           separa razonamiento y respuesta del modelo (completa o por partes)
    routes/            documents.js, search.js, ask.js
  test/                chunker.test.js
  eval/                questions*.json, run.js (recuperacion) y ask.js (pipeline completo)
web/                   front en Angular: pantalla de documentos y chat con streaming
```

## Configuracion segun el equipo

El mismo codigo corre en equipos distintos; lo que cambia es como corre Ollama. La
configuracion medida (`llama3.2:3b`, respuesta directa, `k=5`) funciona en todos; una GPU
solo la hace mas rapida.

| Equipo | Como correr Ollama | Estado |
|---|---|---|
| Sin GPU, 16 GB | Docker, `docker-compose.yml` tal cual | Medido con la configuracion anterior: 42/45 en ~326 s |
| NVIDIA con 4 GB de VRAM | Docker + `docker-compose.override.yml` con GPU | Medido: ver "Resultados" |
| NVIDIA con 8 GB o mas | Igual que la anterior | Sin medir |
| Mac con Apple Silicon, 16 GB o mas | Ollama nativo + solo `db` en Docker | Sin medir |

Mas memoria no garantiza mas calidad: `qwen2.5:7b` no supero a `llama3.2:3b` y fue ~60 % mas lento, y
`gemma3:4b` acerto lo mismo (41/45) tardando ~3 veces mas. Mas VRAM compra velocidad, no precision.

### Sin GPU (solo CPU)

Es el `docker-compose.yml` tal cual y el `.env.example` por defecto: no hay que cambiar nada.

- Si `docker compose up -d` falla con `range of CPUs is from 0.01 to N.00`, el equipo tiene menos
  nucleos que el limite `cpus: "8"` del compose: bajar ese numero al que diga el error. En Windows
  con WSL, los nucleos que ve Docker salen de `processors` en `.wslconfig`.

### GPU NVIDIA (Windows con WSL2 o Linux)

Requisitos: driver de NVIDIA actualizado. En Windows basta con Docker Desktop con WSL2; en Linux hace
falta ademas el NVIDIA Container Toolkit.

Crear `docker-compose.override.yml` en la raiz del repo (git lo ignora, es por equipo). Docker Compose
lo fusiona solo con `docker-compose.yml`:

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

La columna `PROCESSOR` de `ollama ps` dice que parte del modelo esta en GPU. Con 4 GB de VRAM,
`llama3.2:3b` queda en ~80 % GPU; el resto va a CPU.

Detalle de VRAM: `bge-m3` y el modelo de chat no caben juntos en 4 GB y Ollama se los expulsaba entre
si, recargando uno en cada pregunta (~6 s). Por eso `ollama.js` pide los embeddings en CPU
(`num_gpu: 0`).

### Mac con Apple Silicon

Docker en Mac no puede usar la GPU del chip: un Ollama dentro de Docker correria solo en CPU. La opcion
buena es **Ollama nativo** (app o `brew install ollama`) y en Docker solo la base de datos:

```
docker compose up -d db
ollama pull bge-m3
ollama pull llama3.2:3b
```

La API ya apunta a `http://localhost:11434` (`OLLAMA_URL`), asi que no cambia nada. Las variables
`OLLAMA_*` del compose (`KEEP_ALIVE`, `MAX_LOADED_MODELS`, etc.) no aplican al Ollama nativo. Este perfil
no esta medido: es un punto de partida.

### Otras cosas a tener en cuenta

- La primera pregunta despues de 5 minutos sin uso paga la carga del modelo (`OLLAMA_KEEP_ALIVE=5m`).
- Al cambiar de equipo la base de datos arranca vacia: hay que volver a subir los documentos.
- Cambiar de modelo, de `k` o de chunker cambia los resultados: medirlo antes de compararlo con la referencia.

## Resultados de referencia

Medidos en un equipo con GPU de 4 GB, con los 15 documentos cargados y revisando las respuestas a mano.

| Configuracion | Original (45) | Nuevo (83) | Tiempo del original |
|---|---|---|---|
| Chunker anterior (1000/200), `k=3` | 38 | 72 | ~111 s |
| Chunker por bloques (500/100), `k=3` | 39 | 77 | ~116 s |
| **Chunker por bloques (500/100), `k=5` (la actual)** | **41** | **78** | ~167 s |
| `gemma3:4b` con razonamiento, `k=5` | 41 | sin medir completo | ~506 s |

Recuperacion (`run.js`, el fragmento correcto entre los 5 primeros): con el chunker anterior 32/34 y
73/74; con el actual 34/34 y 74/74.

Lo aprendido:
- Con solo 3 documentos el original daba 42/45; al crecer a 15, la busqueda tiene mas candidatos parecidos
  y el mismo modelo baja a 38. Mas documentos exigen mejor troceado.
- **Troceo y `k` movieron mas que el modelo y el prompt.** Un chunker que no corta tablas ni codigo ni
  oraciones, y recibir 5 fragmentos en vez de 3, subieron la nota; tres versiones de reglas en el prompt no.
- Las reglas del tipo "comprueba que el contexto trata de lo mismo que la pregunta" empeoraron: `llama3.2:3b`
  dio falsos "no tengo informacion" (de 1 a 8) y `gemma3:4b` firmaba el "coincide" sin comprobarlo.
- `MIN_SIMILARITY=0.45` separa las preguntas lejanas del tema, pero las cercanas sin dato llegan a ~0.70,
  por encima de casi todos los aciertos. Esas las resuelve el modelo, y es donde fallan los modelos chicos.
- Ollama atiende de a poco: pedir varias preguntas a la vez no acelera el total.

## Ver la base de datos desde consola

No hace falta un cliente grafico: se consulta con `psql` dentro del contenedor `rag_db`
(`-U` usuario, `-d` base, `-c` ejecuta una sentencia y sale).

Documentos cargados, y cuantos chunks tiene cada uno:

```
docker exec rag_db psql -U rag_user -d rag_db -c "SELECT d.id, d.filename, count(c.id) AS chunks FROM documents d LEFT JOIN chunks c ON c.document_id = d.id GROUP BY d.id ORDER BY d.id;"
```

Chunks de un documento (cambia el `6` por el id), con su largo y el inicio del texto:

```
docker exec rag_db psql -U rag_user -d rag_db -c "SELECT chunk_index, length(content) AS caracteres, left(content, 70) AS inicio FROM chunks WHERE document_id = 6 ORDER BY chunk_index;"
```

Sesion interactiva (`-it` conecta tu teclado). Dentro: `\dt` lista tablas, `\d chunks` muestra
las columnas, `\q` sale:

```
docker exec -it rag_db psql -U rag_user -d rag_db
```

## Utiles

Vaciar todos los documentos (los chunks se borran en cascada y los ids vuelven a 1). Necesario antes
de re-subir con otros parametros o con otro chunker, porque el dedupe es por hash del archivo:

```
docker exec rag_db psql -U rag_user -d rag_db -c "TRUNCATE documents RESTART IDENTITY CASCADE;"
```

Ver que modelos tiene Ollama en memoria, y descargarlos para liberar RAM:

```
docker exec ollama ollama ps
docker exec ollama ollama stop llama3.2:3b
```

Reiniciar todo desde cero (borra modelos y datos):

```
docker compose down -v
```

## Pendientes

- Preguntas de dos partes sobre temas distintos: buscar cada parte por separado y juntar los resultados.
- Frenar el "inventa a partir de un concepto parecido": un modelo mayor (con GPU) o una verificacion aparte.
- Indice HNSW y comparar con `EXPLAIN` contra el escaneo exacto.
- Busqueda hibrida (texto + vectores) para codigos exactos.
- Autenticacion y limite de cola en la API antes de exponerla.
- Mas tipos de archivo (PDF, Word, PowerPoint) y borrar documentos desde el front.
