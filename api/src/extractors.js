import path from "node:path";

export class UnsupportedFileError extends Error {}

const extractors = {
  ".txt": (buffer) => buffer.toString("utf-8"),
  ".md": (buffer) => buffer.toString("utf-8"),
};

function normalize(text) {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

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
