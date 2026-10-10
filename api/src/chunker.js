// Segundo paso de la ingesta: texto -> chunks de hasta `size` caracteres.
// Los chunks se vectorizan en ollama.js y se guardan con repository.js.
// Un chunk chico da busquedas precisas; el overlap evita perder una idea que
// cae justo en el corte entre dos chunks.

// Fin de oracion: un punto (o ! ? ...) seguido de espacio y de algo que empieza una
// oracion nueva (mayuscula, digito, signo de apertura o comilla). Asi NO corta en
// abreviaturas como "a. m.", "p. m." o "etc." cuando sigue una minuscula.
// Es un corte de ancho cero: el espacio queda al final de la oracion anterior.
const SENTENCE_BREAK = /(?<=[.!?…]\s+)(?=[A-ZÁÉÍÓÚÑ¿¡"“*(\d])/;

// De mayor a menor: se intenta cortar por parrafo, luego por linea, luego por
// oracion y al final por palabra, para partir lo menos posible el sentido.
const SEPARATORS = ["\n\n", "\n", SENTENCE_BREAK, " "];

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

  // Con un separador de texto, split se come el separador y se lo devolvemos a cada
  // parte (menos la ultima) para no perder saltos de linea al unir despues. El corte
  // por expresion regular es de ancho cero y no consume nada.
  const parts =
    sep instanceof RegExp
      ? text.split(sep)
      : text
          .split(sep)
          .map((part, i, all) => (i < all.length - 1 ? part + sep : part));
  return parts.flatMap((part) => splitPieces(part, maxLen, rest));
}

// Devuelve el final del chunk anterior para repetirlo al inicio del siguiente: las
// ultimas oraciones COMPLETAS que quepan en `overlap` caracteres. Si ni la ultima
// oracion cabe, no hay overlap: es mejor que repetir media oracion.
function overlapTail(text, overlap) {
  if (overlap <= 0) return "";
  const sentences = text.split(SENTENCE_BREAK);
  let tail = "";
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (sentences[i].length + tail.length > overlap) break;
    tail = sentences[i] + tail;
  }
  return tail;
}

// Las piezas miden size - overlap, no size. Asi, cuando a un chunk nuevo se le
// antepone el overlap, el total nunca pasa de size.
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

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

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
    const content = body.join("\n").trim();
    if (content) sections.push({ path: stack.map((h) => h.title), body: content });
    body = [];
  };

  for (const line of text.split("\n")) {
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

// El texto que queda justo bajo el titulo del documento (por ejemplo "Version 2.4 ·
// Uso interno") no sirve como chunk propio: casi no dice nada. Se pega al comienzo de
// la primera seccion que le sigue.
const TITLE_BODY_MAX = 200;
function mergeTitleSection(sections) {
  const [first, second, ...rest] = sections;
  if (first && second && first.path.length <= 1 && first.body.length < TITLE_BODY_MAX) {
    return [{ path: second.path, body: `${first.body}\n\n${second.body}` }, ...rest];
  }
  return sections;
}

const FENCE = /^\s*(```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const TABLE_SEPARATOR = /^\s*\|[\s:|-]+\|\s*$/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/;

// Divide el texto de una seccion en bloques que tienen sentido enteros: bloques de
// codigo, tablas, listas y parrafos. Cortar dentro de uno de ellos es lo que rompe el
// significado, asi que solo se corta ahi cuando el bloque no cabe de otra forma.
function toBlocks(body) {
  const lines = body.split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
    } else if (FENCE.test(line)) {
      const start = i++;
      while (i < lines.length && !FENCE.test(lines[i])) i++;
      i = Math.min(i + 1, lines.length); // incluye la cerca de cierre
      blocks.push({ type: "code", lines: lines.slice(start, i) });
    } else if (TABLE_ROW.test(line)) {
      const start = i;
      while (i < lines.length && TABLE_ROW.test(lines[i])) i++;
      blocks.push({ type: "table", lines: lines.slice(start, i) });
    } else if (LIST_ITEM.test(line)) {
      const start = i;
      while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !TABLE_ROW.test(lines[i])) i++;
      blocks.push({ type: "list", lines: lines.slice(start, i) });
    } else {
      const start = i;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !FENCE.test(lines[i]) &&
        !TABLE_ROW.test(lines[i]) &&
        !LIST_ITEM.test(lines[i])
      ) {
        i++;
      }
      blocks.push({ type: "paragraph", lines: lines.slice(start, i) });
    }
  }
  return blocks;
}

// Agrupa lineas en trozos de a lo sumo `room` caracteres (sin partir una linea).
function groupLines(lines, room, fixed = 0) {
  const groups = [];
  let current = [];
  let length = fixed;
  for (const line of lines) {
    const add = line.length + 1;
    if (current.length && length + add > room) {
      groups.push(current);
      current = [];
      length = fixed;
    }
    current.push(line);
    length += add;
  }
  if (current.length) groups.push(current);
  return groups;
}

// Un bloque de codigo que no cabe se parte por lineas, y cada trozo se cierra y se
// vuelve a abrir con su cerca, para que siga siendo un bloque de codigo valido.
function splitCode(lines, room) {
  const open = lines[0];
  const hasClose = lines.length > 1 && FENCE.test(lines[lines.length - 1]);
  const inner = lines.slice(1, hasClose ? -1 : undefined);
  const fixed = open.length + "\n```".length + 1;
  return groupLines(inner, room, fixed).map((g) => `${open}\n${g.join("\n")}\n\`\`\``);
}

// Una tabla que no cabe se parte por filas, y el encabezado se repite en cada trozo:
// una fila suelta ("| D+5 | Balance de prueba |") no significa nada sin sus columnas.
function splitTable(lines, room) {
  const hasHeader = lines.length > 1 && TABLE_SEPARATOR.test(lines[1]);
  const header = hasHeader ? lines.slice(0, 2) : [];
  const fixed = header.join("\n").length + 1;
  return groupLines(lines.slice(header.length), room, fixed).map((g) =>
    [...header, ...g].join("\n"),
  );
}

// Una lista que no cabe se parte por elementos (un elemento y sus lineas de continuacion).
function splitList(lines, room, overlap) {
  const items = [];
  for (const line of lines) {
    if (LIST_ITEM.test(line) || !items.length) items.push(line);
    else items[items.length - 1] += `\n${line}`;
  }
  return groupLines(items, room).flatMap((g) => {
    const text = g.join("\n");
    // Un solo elemento mas largo que el espacio disponible: se parte por oraciones.
    return text.length > room
      ? chunkText(text, { size: room, overlap: Math.min(overlap, Math.floor(room / 4)) })
      : [text];
  });
}

// Convierte un bloque en una o mas piezas que caben en `room`.
function blockPieces(block, room, overlap) {
  const text = block.lines.join("\n");
  if (text.length <= room) return [text];
  if (block.type === "code") return splitCode(block.lines, room);
  if (block.type === "table") return splitTable(block.lines, room);
  if (block.type === "list") return splitList(block.lines, room, overlap);

  // Parrafo largo: se reparte en partes parejas en vez de llenar `room` y dejar una cola
  // minuscula. Un 10 % de margen evita que sobre una oracion suelta al final.
  const parts = Math.ceil(text.length / room);
  const target = Math.min(room, Math.ceil((text.length / parts) * 1.1));
  const pieces = chunkText(text, { size: target, overlap: 0 });

  // Cada parte retoma la ultima oracion de la anterior si es corta, para no perder una
  // idea que cae justo en el corte. Nunca se repite media oracion.
  const budget = Math.min(overlap, Math.floor(room * 0.2));
  return pieces.map((piece, i) => {
    const tail = i === 0 ? "" : overlapTail(pieces[i - 1], budget).trimEnd();
    return tail ? `${tail} ${piece}` : piece;
  });
}

// Junta las piezas en chunks, cortando solo entre bloques. `room` es el tamano objetivo y
// `soft` el limite blando: un chunk puede pasar de `room` hasta `soft` para no dejar
// huerfanos. Una frase que termina en ":" ("Ejemplo del script:") se queda con lo que presenta.
function packBlocks(blocks, room, soft, overlap) {
  // Primero se arman las unidades. Un parrafo corto que termina en ":" presenta al
  // bloque que le sigue (codigo, tabla o lista): se le reserva espacio en el primer
  // trozo de ese bloque, para que nunca quede la introduccion sola y su contenido aparte.
  const units = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const text = block.lines.join("\n");
    const next = blocks[i + 1];
    if (block.type === "paragraph" && next && text.trimEnd().endsWith(":") && text.length <= room / 2) {
      const [first, ...others] = blockPieces(next, room - text.length - 2, overlap);
      units.push(`${text}\n\n${first}`, ...others);
      i++; // el bloque siguiente ya quedo incluido
    } else {
      units.push(...blockPieces(block, room, overlap));
    }
  }

  // Largo objetivo de cada chunk: el reparto parejo de todo el texto en el numero de
  // chunks que haria falta, con un margen que absorbe un bloque que no encaja justo.
  // Nunca pasa del limite blando ni queda por debajo de la unidad mas grande.
  const SEP = 2; // "\n\n" entre unidades
  const total = units.reduce((n, u) => n + u.length, 0) + SEP * (units.length - 1);
  const parts = Math.max(1, Math.ceil(total / room));
  const widest = Math.max(...units.map((u) => u.length));
  const cap = Math.min(soft, Math.max(Math.ceil((total / parts) * 1.15), widest));

  // Despues se juntan en chunks, cortando solo entre unidades.
  const chunks = [];
  let current = "";
  for (const unit of units) {
    const joined = current ? `${current}\n\n${unit}` : unit;
    if (current && joined.length > cap) {
      chunks.push(current);
      current = unit;
    } else {
      current = joined;
    }
  }
  if (current) chunks.push(current);

  // Un chunk muy corto (una cola de pocas lineas) se pega al vecino si cabe dentro del
  // limite blando: es mejor que pase un poco a que quede un fragmento casi vacio.
  const minLen = Math.max(100, Math.floor(room * 0.25));
  const merged = [];
  for (const chunk of chunks) {
    const prev = merged[merged.length - 1];
    const small = prev !== undefined && (chunk.length < minLen || prev.length < minLen);
    if (small && prev.length + SEP + chunk.length <= soft) {
      merged[merged.length - 1] = `${prev}\n\n${chunk}`;
    } else {
      merged.push(chunk);
    }
  }
  return merged;
}

// Cuanto puede pasar un chunk del tamano objetivo para no dejar huerfanos: 25 %.
const SOFT_LIMIT = 1.25;

// Chunker para Markdown: la seccion de titulos es la unidad y cada chunk lleva la ruta
// de titulos como primera linea ("Documento > Seccion") para no perder su contexto.
// `size` es un tamano OBJETIVO, no un tope duro: una seccion que lo pasa un poco (hasta
// un 25 %) se queda entera. Una mas larga se divide en bloques (parrafos, listas, tablas,
// codigo) que se reparten parejo sin partirlos; solo se corta dentro de un bloque cuando
// el bloque solo ya no cabe, y entonces se hace por oraciones, filas o lineas.
export function chunkMarkdown(text, { size, overlap }) {
  const chunks = [];
  for (const { path, body } of mergeTitleSection(parseSections(text))) {
    let prefix = path.length ? `${path.join(" > ")}\n` : "";
    if (prefix.length > size / 2) prefix = ""; // ruta absurdamente larga: mejor sin ella
    const room = size - prefix.length; // espacio objetivo para el texto
    const soft = Math.floor(size * SOFT_LIMIT) - prefix.length; // limite blando

    if (body.length <= soft) {
      chunks.push(prefix + body);
      continue;
    }
    for (const piece of packBlocks(toBlocks(body), room, soft, overlap)) {
      chunks.push(prefix + piece);
    }
  }
  return chunks;
}
