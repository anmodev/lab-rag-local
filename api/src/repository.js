// Todo el SQL del proyecto vive aqui. Las rutas llaman a estas funciones y no
// saben nada de tablas ni de pgvector, asi que cambiar de base despues solo
// obliga a reescribir este archivo.
import { pool, withTransaction } from "./db.js";

// pg no sabe serializar un arreglo JS como vector, asi que se manda como
// texto '[0.1,0.2,...]' y la consulta lo convierte con ::vector.
const toVectorLiteral = (vector) => `[${vector.join(",")}]`;

// Agrega lo que falte al esquema de una base creada con una version anterior
// (db/init.sql solo corre al crear el volumen). Se llama una vez al arrancar.
// content guarda el texto extraido del archivo: con el se puede volver a dividir y
// vectorizar un documento (reindexar) sin pedirle al usuario que lo suba otra vez.
export async function ensureSchema() {
  await pool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS content TEXT");
}

// Ingesta: se usa para detectar duplicados antes de vectorizar.
export async function findDocumentByHash(hash) {
  const { rows } = await pool.query(
    "SELECT id, filename, created_at FROM documents WHERE content_hash = $1",
    [hash],
  );
  return rows[0] ?? null;
}

// Lista los documentos cargados, del mas reciente al mas antiguo, con cuantos
// chunks tiene cada uno. count() devuelve bigint, que pg entrega como texto,
// por eso se castea a int.
export async function listDocuments() {
  const { rows } = await pool.query(
    `SELECT d.id, d.filename, d.size_bytes, d.created_at,
            count(c.id)::int AS chunk_count
       FROM documents d
       LEFT JOIN chunks c ON c.document_id = d.id
      GROUP BY d.id
      ORDER BY d.created_at DESC`,
  );
  return rows;
}

// Guarda el documento y todos sus chunks en una transaccion: si un INSERT
// falla, no queda un documento a medias sin sus chunks.
export function saveDocument({
  filename,
  mimeType,
  sizeBytes,
  hash,
  content,
  chunks,
  vectors,
}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO documents (filename, mime_type, size_bytes, content_hash, content)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [filename, mimeType, sizeBytes, hash, content],
    );
    const documentId = rows[0].id;
    await insertChunks(client, documentId, chunks, vectors);
    return documentId;
  });
}

// vectors[i] corresponde a chunks[i] (embedTexts conserva el orden).
async function insertChunks(client, documentId, chunks, vectors) {
  for (let i = 0; i < chunks.length; i++) {
    await client.query(
      `INSERT INTO chunks (document_id, chunk_index, content, embedding)
       VALUES ($1, $2, $3, $4::vector)`,
      [documentId, i, chunks[i], toVectorLiteral(vectors[i])],
    );
  }
}

// Un documento con su texto guardado (null si se cargo antes de que existiera la
// columna content: ese no se puede reindexar).
export async function getDocument(id) {
  const { rows } = await pool.query(
    "SELECT id, filename, content FROM documents WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

// Ids de todos los documentos, del mas antiguo al mas reciente.
export async function listDocumentIds() {
  const { rows } = await pool.query("SELECT id FROM documents ORDER BY id");
  return rows.map((r) => r.id);
}

// Cambia los chunks de un documento por otros nuevos, en una transaccion: si algo
// falla se conservan los anteriores. Devuelve false si el documento ya no existe
// (alguien lo borro mientras se vectorizaba). El FOR UPDATE bloquea la fila para
// que un borrado en paralelo espere a que termine el reemplazo.
export function replaceChunks(documentId, chunks, vectors) {
  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      "SELECT 1 FROM documents WHERE id = $1 FOR UPDATE",
      [documentId],
    );
    if (rowCount === 0) return false;
    await client.query("DELETE FROM chunks WHERE document_id = $1", [documentId]);
    await insertChunks(client, documentId, chunks, vectors);
    return true;
  });
}

// Borra un documento (sus chunks se borran en cascada). false si no existia.
export async function deleteDocument(id) {
  const { rowCount } = await pool.query("DELETE FROM documents WHERE id = $1", [id]);
  return rowCount > 0;
}

// Borra todos los documentos y devuelve cuantos eran.
export async function deleteAllDocuments() {
  const { rowCount } = await pool.query("DELETE FROM documents");
  return rowCount;
}

// Consulta: los `limit` chunks mas cercanos al vector de la pregunta.
// <=> es la distancia coseno (0 = identicos), por eso se ordena de menor a
// mayor. 1 - distancia da la similitud (1 = identicos), que es lo que se
// muestra y se compara con MIN_SIMILARITY.
// Sin indice, Postgres compara contra todos los chunks: la busqueda es exacta.
export async function searchChunks(vector, limit) {
  const { rows } = await pool.query(
    `SELECT c.id, c.document_id, d.filename, c.chunk_index, c.content,
            1 - (c.embedding <=> $1::vector) AS similarity
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
      ORDER BY c.embedding <=> $1::vector
      LIMIT $2`,
    [toVectorLiteral(vector), limit],
  );
  return rows;
}
