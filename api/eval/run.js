// Evalua la recuperacion (solo /search, sin modelo de chat, asi que es rapido).
// Para evaluar la respuesta del modelo completo, ver eval/ask.js.
// Uso, desde api/ y con el servidor andando:
//   node eval/run.js                       usa questions.json
//   node eval/run.js questions-docs.json   usa otro set de preguntas
//
// Cada pregunta tiene dos tipos posibles:
//   - con "expect": texto que debe aparecer en el chunk correcto -> mide en que puesto sale.
//     Puede ser una lista: las preguntas que cruzan documentos o secciones necesitan que
//     aparezcan todos los textos entre los resultados; el puesto es el del peor.
//   - con "expectAny": lista de textos de los que basta uno. Sirve cuando la respuesta esta en
//     mas de un chunk (por ejemplo la tabla y un caso resuelto): el puesto es el del mejor.
//     Si hay "expect" y "expectAny", se exigen las dos cosas.
//   - sin ninguno: no esta en los documentos -> solo se anota la similitud del primer resultado
//
// Al final compara "menor similitud de un acierto" contra "mayor similitud de una pregunta sin
// respuesta": si la primera es mayor, existe un umbral que las separa (MIN_SIMILARITY).
import { readFile } from 'node:fs/promises';

const API = process.env.API_URL ?? 'http://localhost:3000';
// El set es el argumento que termina en .json, o QUESTIONS_FILE, o questions.json.
const questionsName =
  process.argv.slice(2).find((a) => a.endsWith('.json')) ?? process.env.QUESTIONS_FILE ?? 'questions.json';
const questions = JSON.parse(
  await readFile(new URL(`./${questionsName}`, import.meta.url), 'utf-8'),
);
console.log(`Preguntas: ${questionsName} (${questions.length})`);

// k = 5 para ver no solo si acierta sino que tan arriba queda el acierto.
async function search(question, k = 5) {
  const res = await fetch(`${API}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, k }),
  });
  if (!res.ok) throw new Error(`/search respondio ${res.status}`);
  return (await res.json()).results;
}

const rows = [];
for (const item of questions) {
  const results = await search(item.q);
  const top1 = results[0]?.similarity ?? 0;
  if (item.expect || item.expectAny) {
    const where = (text) => results.findIndex((r) => r.content.includes(text));
    // "expect": deben aparecer todos; vale el puesto del que sale mas abajo.
    const all = [].concat(item.expect ?? []).map(where);
    // "expectAny": basta uno; vale el puesto del que sale mas arriba.
    const anyHits = (item.expectAny ?? []).map(where).filter((i) => i !== -1);
    const anyMissing = item.expectAny && anyHits.length === 0;

    const missing = all.includes(-1) || anyMissing;
    const position = Math.max(
      ...all,
      ...(item.expectAny ? [Math.min(...anyHits)] : []),
    );
    rows.push({
      pregunta: item.q,
      tipo: 'responde',
      rango: missing ? 'FALLO' : position + 1,
      sim_hit: missing ? null : results[position].similarity,
      sim_top1: top1,
    });
  } else {
    rows.push({ pregunta: item.q, tipo: 'sin respuesta', rango: '-', sim_hit: null, sim_top1: top1 });
  }
}
console.table(rows);

// Resumen. Si no hay aciertos o no hay preguntas sin respuesta, Math.min/Math.max
// sobre un arreglo vacio imprimen Infinity o -Infinity.
const answerable = rows.filter((r) => r.tipo === 'responde');
const hits = answerable.filter((r) => typeof r.rango === 'number');
const first = hits.filter((r) => r.rango === 1).length;
const noAnswer = rows.filter((r) => r.tipo === 'sin respuesta');

console.log(`Con respuesta: ${answerable.length} | en el top-5: ${hits.length} | en el puesto 1: ${first}`);
console.log(`Menor similitud de un acierto: ${Math.min(...hits.map((r) => r.sim_hit))}`);
console.log(`Mayor similitud de una pregunta sin respuesta: ${Math.max(...noAnswer.map((r) => r.sim_top1))}`);