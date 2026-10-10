// Corre las preguntas contra /ask (pipeline completo: busqueda + modelo de chat) y guarda
// en eval/ask.log cada pregunta con lo ESPERADO y lo RESPONDIDO, para revisarlo a mano.
// No califica sola: un texto esperado fijo no entiende parafrasis ("descontara" no contiene
// "descuenta"), y calificar es mas fiable leyendo la respuesta que buscando una cadena.
//
// Uso, desde api/ y con el servidor andando:
//   node eval/ask.js                          una pregunta a la vez (por defecto)
//   node eval/ask.js 4                        hasta 4 preguntas en simultaneo
//   node eval/ask.js 4 questions-docs.json    con otro set de preguntas
//   node eval/ask.js 4 --ids=17,36,39         solo esas preguntas (numero de la tabla)
//   node eval/ask.js 4 --k=3                  fija cuantos fragmentos recibe el modelo
//
// En el set, "answerHas" (texto o lista) y "answerAny" (alternativas) describen la respuesta
// esperada; una pregunta sin ninguno no esta en los documentos y debe decir "no tengo
// informacion". Solo se usan para mostrar lo esperado en el log.
import { readFile, writeFile } from "node:fs/promises";

const API = process.env.API_URL ?? "http://localhost:3000";
const ANSWER_WIDTH = Number(process.env.ANSWER_WIDTH ?? 80); // ancho de la columna respuesta
const args = process.argv.slice(2);
const concurrency = Math.max(1, Number(args.find((a) => /^\d+$/.test(a))) || 1);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const k = option("k") ? Number(option("k")) : undefined;
const only = option("ids") ? new Set(option("ids").split(",").map(Number)) : null;

const setName = args.find((a) => a.endsWith(".json")) ?? process.env.QUESTIONS_FILE ?? "questions.json";
const all = JSON.parse(await readFile(new URL(`./${setName}`, import.meta.url), "utf-8"));
// Cada pregunta conserva su numero original, aunque se corra solo una parte.
const selected = all.map((item, n) => ({ item, n })).filter(({ n }) => !only || only.has(n));
if (!selected.length) {
  console.error(`Ninguna pregunta coincide con --ids en ${setName}`);
  process.exit(1);
}

const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);
// Segundos desde 1 s; por debajo, milisegundos
const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

// Que se espera de la respuesta, en palabras, para el log.
function expected(item) {
  const all = [].concat(item.answerHas ?? []);
  const any = item.answerAny ?? [];
  if (!all.length && !any.length) return "sin dato en los documentos: debe decir que no tiene informacion";
  const parts = [];
  if (all.length) parts.push(all.join(" y "));
  if (any.length) parts.push(`alguno de: ${any.join(" | ")}`);
  return parts.join(" y ");
}

// Llama a /ask y mide la latencia completa vista por el cliente (incluye la espera en cola).
// Nunca lanza: si algo falla devuelve { error } para no tumbar a las demas preguntas.
async function ask(question) {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const res = await fetch(`${API}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(k ? { question, k } : { question }),
    });
    if (!res.ok) return { error: `HTTP ${res.status}`, ms: elapsed() };
    return { ...(await res.json()), ms: elapsed() };
  } catch (err) {
    return { error: err.cause?.code ?? err.message, ms: elapsed() };
  }
}

// Ejecuta fn sobre cada item con maximo `limit` en vuelo a la vez.
async function runPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++; // seguro: JavaScript ejecuta esto de a un paso, sin hilos
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const wallStart = performance.now();
const results = await runPool(selected, concurrency, ({ item }) => ask(item.q));
const wallMs = Math.round(performance.now() - wallStart);

// Tabla: la respuesta sale cortada; el log tiene el texto completo.
console.table(
  selected.map(({ item, n }, i) => {
    const r = results[i];
    const s = r.stats; // no existe si /ask respondio sin llamar al modelo (umbral)
    return {
      n,
      pregunta: cut(item.q, 42),
      respuesta: cut((r.error ? `ERROR: ${r.error}` : r.answer).replace(/\s+/g, " "), ANSWER_WIDTH),
      chunks: r.sources?.length ?? 0, // fragmentos que pasaron el umbral
      prompt_tok: s ? s.promptTokens : 0, // tokens que leyo el modelo
      tiempo: fmt(r.ms), // latencia total, con espera en cola
      modelo: fmt(s ? s.loadMs + s.promptMs + s.genMs : 0), // trabajo real del modelo, sin cola
    };
  }),
);

// Log para revisar a mano. Cada corrida lo sobreescribe: copiarlo si se quiere conservar.
const model = results.find((r) => r.model)?.model ?? "desconocido";
const log = selected
  .map(({ item, n }, i) => {
    const r = results[i];
    const why = r.reasoning ? `Razonamiento: ${r.reasoning}\n` : "";
    const ans = r.error ? `ERROR: ${r.error}` : r.answer;
    return `#${n} P: ${item.q}\nEsperado: ${expected(item)}\n${why}R: ${ans}\n`;
  })
  .join("\n");
const scope = only ? ` | Solo: #${[...only].join(",#")}` : "";
await writeFile(
  new URL("./ask.log", import.meta.url),
  `Corrida: ${new Date().toLocaleString("es-CO")} | Modelo: ${model} | Concurrencia: ${concurrency} | Preguntas: ${setName}${k ? ` | k: ${k}` : ""}${scope}\n\n${log}`,
  "utf-8",
);

const times = results.map((r) => r.ms);
const modelSum = results.reduce((a, r) => a + (r.stats ? r.stats.loadMs + r.stats.promptMs + r.stats.genMs : 0), 0);
const errors = results.filter((r) => r.error).length;
console.log(`Preguntas: ${setName} (${selected.length}) | Modelo: ${model} | Concurrencia: ${concurrency} | Errores: ${errors}`);
console.log(`Tiempo total: ${fmt(wallMs)} | Suma del trabajo del modelo: ${fmt(modelSum)}`);
console.log(
  `Latencia por pregunta -> promedio: ${fmt(Math.round(times.reduce((a, b) => a + b, 0) / times.length))} | maxima: ${fmt(Math.max(...times))}`,
);
console.log("Respuestas completas y lo esperado: api/eval/ask.log");
