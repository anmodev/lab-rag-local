// Convierte el texto de una respuesta en bloques para mostrarlos con formato:
// bloques de codigo (```), codigo en linea (`x`) y negrita (**x**).
// Devuelve datos, no HTML: la plantilla los dibuja con elementos de Angular, asi
// que el texto del modelo nunca se interpreta como HTML.

export interface Inline {
  kind: 'text' | 'code' | 'bold';
  text: string;
}

export type Block =
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'code'; text: string };

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/;

function parseInline(text: string): Inline[] {
  return text
    .split(INLINE)
    .filter((part) => part !== '')
    .map((part): Inline => {
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
        return { kind: 'code', text: part.slice(1, -1) };
      }
      if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
        return { kind: 'bold', text: part.slice(2, -2) };
      }
      return { kind: 'text', text: part };
    });
}

export function parseMessage(source: string): Block[] {
  const blocks: Block[] = [];
  // Partiendo por ``` las posiciones pares son texto y las impares son codigo.
  // Mientras llega la respuesta, un bloque sin cerrar se muestra como codigo
  // a medida que se escribe.
  source.split('```').forEach((part, index) => {
    if (index % 2 === 1) {
      // La primera linea puede ser el lenguaje (```bash): se descarta.
      const code = part.replace(/^[A-Za-z0-9_+-]*\n/, '').replace(/\n+$/, '');
      if (code) blocks.push({ kind: 'code', text: code });
    } else if (part.trim()) {
      blocks.push({ kind: 'paragraph', inlines: parseInline(part.trim()) });
    }
  });
  return blocks;
}
