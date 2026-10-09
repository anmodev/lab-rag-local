// Evalua la recuperacion (solo /search, sin modelo de chat, asi que es rapido).
// Para evaluar la respuesta del modelo completo, ver eval/ask.js.
// Uso, desde api/ y con el servidor andando: node eval/run.js
//
// questions.json tiene dos tipos de pregunta:
//   - con "expect": texto que debe aparecer en el chunk correcto -> mide en que puesto sale
//   - sin "expect": no esta en los documentos -> solo se anota la similitud del primer resultado
//
// Al final compara "menor similitud de un acierto" contra "mayor similitud de una pregunta sin
// respuesta": si la primera es mayor, existe un umbral que las separa (MIN_SIMILARITY).
import { readFile } from 'node:fs/promises';

const API = process.env.API_URL ?? 'http://localhost:3000';
const questions = JSON.parse(
  await readFile(new URL('./questions.json', import.meta.url), 'utf-8'),
);

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
  if (item.expect) {
    // rango = posicion (1 = primero) del primer chunk que contiene el texto esperado
    const idx = results.findIndex((r) => r.content.includes(item.expect));
    rows.push({
      pregunta: item.q,
      tipo: 'responde',
      rango: idx === -1 ? 'FALLO' : idx + 1,
      sim_hit: idx === -1 ? null : results[idx].similarity,
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