import { readFile } from "node:fs/promises";

const API = process.env.API_URL ?? "http://localhost:3000";
const questions = JSON.parse(
  await readFile(new URL("./questions.json", import.meta.url), "utf-8"),
);

async function search(question, k = 5) {
  const res = await fetch(`${API}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    const idx = results.findIndex((r) => r.content.includes(item.expect));
    rows.push({
      pregunta: item.q,
      tipo: "responde",
      rango: idx === -1 ? "FALLO" : idx + 1,
      sim_hit: idx === -1 ? null : results[idx].similarity,
      sim_top1: top1,
    });
  } else {
    rows.push({
      pregunta: item.q,
      tipo: "sin respuesta",
      rango: "-",
      sim_hit: null,
      sim_top1: top1,
    });
  }
}
console.table(rows);

const answerable = rows.filter((r) => r.tipo === "responde");
const hits = answerable.filter((r) => typeof r.rango === "number");
const first = hits.filter((r) => r.rango === 1).length;
const noAnswer = rows.filter((r) => r.tipo === "sin respuesta");

console.log(
  `Con respuesta: ${answerable.length} | en el top-5: ${hits.length} | en el puesto 1: ${first}`,
);
console.log(
  `Menor similitud de un acierto: ${Math.min(...hits.map((r) => r.sim_hit))}`,
);
console.log(
  `Mayor similitud de una pregunta sin respuesta: ${Math.max(...noAnswer.map((r) => r.sim_top1))}`,
);
