// Todo el SQL del proyecto vive aqui. Las rutas llaman a estas funciones y no
// saben nada de tablas ni de pgvector, asi que cambiar de base despues solo
// obliga a reescribir este archivo.
import { pool, withTransaction } from "./db.js";

// pg no sabe serializar un arreglo JS como vector, asi que se manda como
// texto '[0.1,0.2,...]' y la consulta lo convierte con ::vector.
const toVectorLiteral = (vector) => `[${vector.join(",")}]`;

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
  chunks,
  vectors,
}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO documents (filename, mime_type, size_bytes, content_hash)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [filename, mimeType, sizeBytes, hash],
    );
    const documentId = rows[0].id;

    // vectors[i] corresponde a chunks[i] (embedTexts conserva el orden).
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        `INSERT INTO chunks (document_id, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4::vector)`,
        [documentId, i, chunks[i], toVectorLiteral(vectors[i])],
      );
    }
    return documentId;
  });
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
