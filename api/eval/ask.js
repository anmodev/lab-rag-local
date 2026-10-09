// Evalua el pipeline completo (/ask): respuesta del modelo, acierto y tiempos.
// Uso, desde api/ y con el servidor andando:
//   node eval/ask.js       una pregunta a la vez (por defecto)
//   node eval/ask.js 4     hasta 4 preguntas en simultaneo
//   node eval/ask.js 20    todas a la vez (equivale a un Promise.all de las 20)
//
// En questions.json, "answerHas" es el texto que debe aparecer en la respuesta del modelo.
// Las preguntas sin "answerHas" no estan en los documentos: se espera "no tengo informacion".
import { readFile } from "node:fs/promises";

const API = process.env.API_URL ?? "http://localhost:3000";
const ANSWER_WIDTH = Number(process.env.ANSWER_WIDTH ?? 80); // ancho de la columna respuesta
const concurrency = Math.max(1, Number(process.argv[2]) || 1);

const questions = JSON.parse(
  await readFile(new URL("./questions.json", import.meta.url), "utf-8"),
);

// Minusculas y sin tildes: asi "Area" con tilde y "area" cuentan como iguales al comparar
const clean = (s) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);
// Segundos desde 1 s; por debajo, milisegundos
const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

// Llama a /ask y mide la latencia completa vista por el cliente (incluye la espera en cola).
// Nunca lanza: si algo falla devuelve { error } para no tumbar a las demas preguntas.
async function ask(question) {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const res = await fetch(`${API}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) return { error: `HTTP ${res.status}`, ms: elapsed() };
    return { ...(await res.json()), ms: elapsed() };
  } catch (err) {
    return { error: err.cause?.code ?? err.message, ms: elapsed() };
  }
}

// Ejecuta fn sobre cada item con maximo `limit` en vuelo a la vez.
// Son `limit` "trabajadores" que sacan preguntas de la misma lista hasta agotarla;
// el Promise.all espera a que todos terminen. Con limit = cantidad de preguntas,
// es el Promise.all clasico de lanzar todas juntas.
async function runPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++; // seguro: JavaScript ejecuta esto de a un paso, sin hilos
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

// Arma la fila de la tabla y decide si la respuesta es correcta
// Arma la fila de la tabla y decide si la respuesta es correcta
function toRow(item, r) {
  const pregunta = cut(item.q, 42);
  if (r.error) {
    return {
      pregunta,
      respuesta: `ERROR: ${r.error}`,
      ok: "ERROR",
      ms: r.ms,
      modelo_ms: 0,
    };
  }
  // Textos aceptados como correctos. Con "answerHas" se espera ese dato; si no lo hay, la pregunta
  // no esta en los documentos y se acepta cualquier forma de decir que no hay informacion.
  const accepted = item.answerHas
    ? [clean(item.answerHas)]
    : ["no tengo informacion", "no se menciona"];
  const s = r.stats; // no existe si /ask respondio sin llamar al modelo (umbral)
  return {
    pregunta,
    respuesta: cut(r.answer.replace(/\s+/g, " "), ANSWER_WIDTH),
    ok: accepted.some((t) => clean(r.answer).includes(t)) ? "OK" : "FALLO",
    chunks: r.sources.length, // chunks que pasaron el umbral
    prompt_tok: s ? s.promptTokens : 0, // tokens que leyo el modelo
    ms: r.ms, // latencia total, con espera en cola
    modelo_ms: s ? s.loadMs + s.promptMs + s.genMs : 0, // trabajo real del modelo, sin cola
  };
}

const wallStart = performance.now();
const results = await runPool(questions, concurrency, (item) => ask(item.q));
const wallMs = Math.round(performance.now() - wallStart);

const rows = questions.map((item, i) => toRow(item, results[i]));
// rows conserva los ms como numero para los calculos; solo la tabla usa texto
console.table(
  rows.map(({ ms, modelo_ms, ...rest }) => ({
    ...rest,
    tiempo: fmt(ms),
    modelo: fmt(modelo_ms),
  })),
);

const ok = rows.filter((r) => r.ok === "OK").length;
const errors = rows.filter((r) => r.ok === "ERROR").length;
const times = rows.map((r) => r.ms);
const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
const modelSum = rows.reduce((a, r) => a + r.modelo_ms, 0);

console.log(
  `Concurrencia: ${concurrency} | Aciertos: ${ok}/${rows.length} | Errores: ${errors}`,
);
console.log(
  `Tiempo total: ${fmt(wallMs)} | Suma del trabajo del modelo: ${fmt(modelSum)}`,
);
console.log(
  `Latencia por pregunta -> promedio: ${fmt(avg)} | maxima: ${fmt(Math.max(...times))}`,
);
