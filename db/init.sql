-- Esquema inicial. Docker lo ejecuta una sola vez, al crear el volumen pgdata.
-- Ingesta: la API guarda un documento y sus chunks con el embedding de cada uno.
-- Consulta: la API busca los chunks cuyo embedding este mas cerca del de la pregunta.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filename     TEXT NOT NULL,
  mime_type    TEXT,
  size_bytes   BIGINT,
  -- SHA-256 del archivo. UNIQUE evita cargar dos veces el mismo archivo
  -- aunque dos requests lleguen a la vez (la base es la ultima defensa).
  content_hash TEXT NOT NULL UNIQUE,
  -- Texto extraido del archivo. Permite reindexar sin volver a subirlo.
  -- (La API tambien lo agrega sola a bases viejas: ver ensureSchema.)
  content      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- CASCADE: borrar un documento borra tambien todos sus chunks.
  document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content     TEXT NOT NULL,
  -- 1024 es la dimension de bge-m3. Si cambias de modelo de embeddings hay que
  -- cambiar este numero (y EMBED_DIMENSIONS en config.js) y re-vectorizar todo.
  -- Pendiente: crear un indice HNSW (vector_cosine_ops). Hoy no hay indice, asi
  -- que cada busqueda compara contra todos los chunks (exacta pero lineal).
  embedding   vector(1024) NOT NULL,
  UNIQUE (document_id, chunk_index)
);