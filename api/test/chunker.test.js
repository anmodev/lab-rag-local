// Pruebas del chunker con casos construidos a proposito. No necesitan servidor ni base.
// Uso, desde api/: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkMarkdown, chunkText } from "../src/chunker.js";

// Un parrafo de largo conocido (100 caracteres) para armar secciones de tamano exacto.
const para = (n) => "x".repeat(96) + ` ${String(n).padStart(2, "0")}.`;
const section = (count) =>
  `# Doc\n\n## S\n${Array.from({ length: count }, (_, i) => para(i + 1)).join("\n\n")}\n`;

test("no corta dentro de 'a. m.' ni 'p. m.', pero si entre oraciones reales", () => {
  const text =
    "La jornada es de lunes a viernes, de 7:00 a. m. a 6:00 p. m., con una hora de almuerzo. " +
    "El ingreso se registra con el carne. Se permite un retraso maximo de 10 minutos.";
  const chunks = chunkText(text, { size: 60, overlap: 0 });
  const bad = chunks.find((c, i) => i > 0 && /^[a-z]/.test(c) && /\b[ap]\. m\.$/.test(chunks[i - 1]));
  assert.equal(bad, undefined, JSON.stringify(chunks));
  assert.ok(chunks.some((c) => c.endsWith("almuerzo.")), JSON.stringify(chunks));
});

test("una tabla larga se parte por filas y cada trozo repite el encabezado", () => {
  const rows = Array.from({ length: 12 }, (_, i) => `| D+${i + 1} | Actividad numero ${i + 1} | Responsable ${i + 1} |`);
  const md = `# Doc\n\n## Calendario\n| Dia | Actividad | Responsable |\n|---|---|---|\n${rows.join("\n")}\n`;
  const chunks = chunkMarkdown(md, { size: 300, overlap: 50 });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.includes("| Dia | Actividad | Responsable |")));
  assert.ok(rows.every((r) => chunks.some((c) => c.includes(r))), "no se pierde ninguna fila");
  assert.ok(chunks.every((c) => c.length <= 375), "ninguno pasa del limite blando (size + 25 %)");
});

test("un bloque de codigo partido conserva sus cercas y su introduccion", () => {
  const code = Array.from({ length: 30 }, (_, i) => `echo "linea ${i + 1} del script"`).join("\n");
  const md = `# Doc\n\n## Script\nEjemplo del script:\n\n\`\`\`bash\n${code}\n\`\`\`\n`;
  const chunks = chunkMarkdown(md, { size: 300, overlap: 50 });
  assert.ok(chunks.every((c) => (c.match(/```/g) ?? []).length % 2 === 0), "cercas balanceadas");
  assert.match(chunks[0], /Ejemplo del script:\s+```bash/);
});

test("una seccion corta es un solo chunk con su ruta de titulos", () => {
  const chunks = chunkMarkdown("# Manual\n\n## 1. Intro\nTexto corto.\n", { size: 500, overlap: 50 });
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].startsWith("Manual > 1. Intro\n"));
});

test("el texto bajo el titulo del documento se pega a la primera seccion", () => {
  const md = "# Politica\nVersion 2.4 · Uso interno\n\n## 1. Objetivo\nDefine como se pagan los gastos menores.\n";
  const chunks = chunkMarkdown(md, { size: 500, overlap: 50 });
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].includes("Version 2.4") && chunks[0].includes("gastos menores"));
});

test("tamano dinamico: una seccion que pasa un poco del objetivo se queda entera", () => {
  const chunks = chunkMarkdown(section(6), { size: 500, overlap: 50 });
  assert.equal(chunks.length, 1, chunks.map((c) => c.length).join(","));
});

test("una seccion mas larga se reparte en partes parejas", () => {
  const lengths = chunkMarkdown(section(9), { size: 500, overlap: 50 }).map((c) => c.length);
  assert.equal(lengths.length, 2, lengths.join(","));
  assert.ok(Math.min(...lengths) / Math.max(...lengths) > 0.6, lengths.join(","));
});

test("un parrafo largo no deja una cola diminuta al final", () => {
  const sentence = "Esta es una oracion de prueba con varias palabras para ocupar espacio. ";
  const text = `# Doc\n\n## S\n${sentence.repeat(14).trim()}\n`;
  const lengths = chunkMarkdown(text, { size: 500, overlap: 50 }).map((c) => c.length);
  assert.ok(Math.min(...lengths) > 150, lengths.join(","));
});

test("un texto vacio no genera chunks", () => {
  assert.equal(chunkMarkdown("", { size: 500, overlap: 50 }).length, 0);
});
