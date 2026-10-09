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

3. API. Crea `api/.env`:

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
cd api
npm install
npm run dev
```

`db/init.sql` (extension y tablas) solo corre la primera vez que se crea el volumen de Postgres.

## Probar

Salud de la API y la base de datos:

```
curl.exe http://localhost:3000/health
```

Subir un documento (de `data/docs/`):

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

Evaluar la recuperacion con un set de preguntas (desde `api/`, con el servidor andando):

```
node eval/run.js
```

## Endpoints

| Metodo | Ruta | Que hace |
|---|---|---|
| GET | `/health` | Estado de la API y la base de datos |
| POST | `/documents` | Recibe un archivo (campo `file`), lo procesa y lo guarda. 409 si ya existe (mismo hash) |
| POST | `/search` | Body `{question, k}`. Devuelve los chunks mas parecidos con su similitud |
| POST | `/ask` | Body `{question, k}`. Busca, filtra por umbral y responde con el modelo, con fuentes y tiempos |

## Estructura

```
docker-compose.yml     Ollama + Postgres
db/init.sql            extension vector y tablas documents / chunks
data/docs/             documentos de prueba
api/
  src/
    server.js          arranque, rutas y manejo de errores
    config.js          variables de entorno
    db.js              pool de Postgres y transacciones
    extractors.js      extraccion de texto por tipo de archivo
    chunker.js         division en chunks con overlap
    ollama.js          embeddings y chat
    repository.js      todo el SQL en un solo lugar
    routes/            documents.js, search.js, ask.js
  eval/                questions.json y run.js
```

## Utiles

Borrar todos los documentos (los chunks se borran en cascada). Necesario antes de
re-subir un archivo con otros parametros de chunk, porque el dedupe es por hash del archivo:

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