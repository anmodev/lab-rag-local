// Segundo paso de la ingesta: texto -> chunks de hasta `size` caracteres.
// Los chunks se vectorizan en ollama.js y se guardan con repository.js.
// Un chunk chico da busquedas precisas; el overlap evita perder una idea que
// cae justo en el corte entre dos chunks.

// De mayor a menor: se intenta cortar por parrafo, luego por linea, luego por
// oracion y al final por palabra, para partir lo menos posible el sentido.
const SEPARATORS = ["\n\n", "\n", ". ", " "];

// Parte el texto en piezas de a lo sumo maxLen, recursivamente: si una pieza
// sigue siendo muy larga, la parte con el siguiente separador de la lista.
function splitPieces(text, maxLen, separators) {
  if (text.length <= maxLen) return [text];

  const [sep, ...rest] = separators;
  // Sin separadores, ultimo recurso: corte duro cada maxLen caracteres.
  if (sep === undefined) {
    const out = [];
    for (let i = 0; i < text.length; i += maxLen)
      out.push(text.slice(i, i + maxLen));
    return out;
  }

  // split se come el separador; se lo devolvemos a cada parte (menos la
  // ultima) para no perder los saltos de linea ni los puntos al unir despues.
  const parts = text
    .split(sep)
    .map((part, i, all) => (i < all.length - 1 ? part + sep : part));
  return parts.flatMap((part) => splitPieces(part, maxLen, rest));
}

// Devuelve el final del chunk anterior para repetirlo al inicio del siguiente.
// Si el corte cae a mitad de palabra, avanza hasta el siguiente espacio para
// que el overlap empiece en palabra completa.
function overlapTail(text, overlap) {
  if (overlap <= 0) return "";
  const start = text.length - overlap;
  if (/\s/.test(text[start - 1])) return text.slice(start);
  const cut = text.slice(start);
  const firstSpace = cut.search(/\s/);
  return firstSpace === -1 ? cut : cut.slice(firstSpace + 1);
}

// Las piezas miden size - overlap, no size. Asi, cuando a un chunk nuevo se le
// antepone el overlap, el total nunca pasa de size.
// Pendiente: respetar los titulos de Markdown (hoy un titulo puede quedar
// separado de su parrafo).
export function chunkText(text, { size, overlap }) {
  const pieces = splitPieces(text, size - overlap, SEPARATORS).filter(Boolean);

  const chunks = [];
  let current = "";
  for (const piece of pieces) {
    // Si la pieza ya no cabe, se cierra el chunk y el siguiente arranca con
    // la cola del anterior (overlap) mas la pieza.
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


// Parte un Markdown en secciones segun sus titulos (# a ######).
// Cada seccion trae la ruta de titulos que la contiene y su texto.
// Un titulo sin texto propio (por ejemplo el titulo del documento) no genera chunk:
// solo queda como parte de la ruta de las secciones que cuelgan de el.
function parseSections(text) {
  const sections = [];
  const stack = []; // titulos activos, de mayor a menor nivel: [{ level, title }]
  let body = [];
  let inFence = false; // dentro de un bloque de codigo los # no son titulos

  const flush = () => {
    const content = body.join('\n').trim();
    if (content) sections.push({ path: stack.map((h) => h.title), body: content });
    body = [];
  };

  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) {
      flush(); // cierra la seccion anterior con SU ruta, antes de cambiar la pila
      const level = m[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: m[2] });
    } else {
      body.push(line);
    }
  }
  flush();
  return sections;
}

// Chunker para Markdown: un chunk por seccion, con la ruta de titulos como primera linea
// ("Documento > Seccion") para que el texto no pierda su contexto al estar suelto.
// Si una seccion no cabe en `size`, se parte con chunkText y cada trozo conserva la ruta.
export function chunkMarkdown(text, { size, overlap }) {
  const chunks = [];
  for (const { path, body } of parseSections(text)) {
    let prefix = path.length ? `${path.join(' > ')}\n` : '';
    if (prefix.length > size / 2) prefix = ''; // ruta absurdamente larga: mejor sin ella
    const room = size - prefix.length; // espacio que queda para el texto

    if (body.length <= room) {
      chunks.push(prefix + body);
      continue;
    }
    const inner = { size: room, overlap: Math.min(overlap, Math.floor(room / 4)) };
    for (const piece of chunkText(body, inner)) chunks.push(prefix + piece);
  }
  return chunks;
}