const SEPARATORS = ["\n\n", "\n", ". ", " "];

function splitPieces(text, maxLen, separators) {
  if (text.length <= maxLen) return [text];

  const [sep, ...rest] = separators;
  if (sep === undefined) {
    const out = [];
    for (let i = 0; i < text.length; i += maxLen)
      out.push(text.slice(i, i + maxLen));
    return out;
  }

  const parts = text
    .split(sep)
    .map((part, i, all) => (i < all.length - 1 ? part + sep : part));
  return parts.flatMap((part) => splitPieces(part, maxLen, rest));
}

function overlapTail(text, overlap) {
  if (overlap <= 0) return "";
  const start = text.length - overlap;
  if (/\s/.test(text[start - 1])) return text.slice(start);
  const cut = text.slice(start);
  const firstSpace = cut.search(/\s/);
  return firstSpace === -1 ? cut : cut.slice(firstSpace + 1);
}

export function chunkText(text, { size, overlap }) {
  const pieces = splitPieces(text, size - overlap, SEPARATORS).filter(Boolean);

  const chunks = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length > size) {
      chunks.push(current.trim());
      current = overlapTail(current, overlap) + piece;
    } else {
      current += piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
