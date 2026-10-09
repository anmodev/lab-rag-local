import { pool, withTransaction } from "./db.js";

const toVectorLiteral = (vector) => `[${vector.join(",")}]`;

export async function findDocumentByHash(hash) {
  const { rows } = await pool.query(
    "SELECT id, filename, created_at FROM documents WHERE content_hash = $1",
    [hash],
  );
  return rows[0] ?? null;
}

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
