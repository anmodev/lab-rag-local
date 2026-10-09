// Primer paso de la ingesta: archivo subido -> texto plano normalizado.
// Despues el texto pasa a chunker.js.
import path from "node:path";

// server.js la mapea a HTTP 415.
export class UnsupportedFileError extends Error {}

// Un extractor por extension. Para soportar PDF o DOCX se agrega una linea
// aqui con su funcion (buffer) => texto, sin tocar el resto del flujo.
const extractors = {
  ".txt": (buffer) => buffer.toString("utf-8"),
  ".md": (buffer) => buffer.toString("utf-8"),
};

// Deja el texto en una forma unica. Sin esto, el mismo contenido guardado con
// BOM o con saltos \r\n daria texto distinto y por lo tanto otros chunks y
// otros embeddings.
function normalize(text) {
  return text
    .replace(/^\uFEFF/, "") // BOM que algunos editores de Windows agregan
    .replace(/\r\n?/g, "\n")
    .trim();
}

// Se decide por extension y no por MIME porque el MIME lo manda el cliente y
// no es confiable (muchos mandan application/octet-stream para todo).
export function extractText(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const extract = extractors[ext];
  if (!extract) {
    throw new UnsupportedFileError(
      `Tipo de archivo no soportado: ${ext || "sin extension"}`,
    );
  }
  return normalize(extract(file.buffer));
}
