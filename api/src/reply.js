// Interpreta la respuesta del modelo de chat. El prompt le pide el formato
// "Razonamiento: ... Respuesta: ...". Aqui se separa el razonamiento de la
// respuesta final, tanto con el texto completo (splitReply, para /ask) como a
// medida que llegan los trozos (createReplyParser, para /ask/stream).

const REASONING_TAG = "razonamiento:";
const ANSWER_TAG = "respuesta:";

// Al usuario solo le llega lo que sigue al ultimo "Respuesta:"; el razonamiento va
// aparte para poder revisarlo. Si el modelo no uso el marcador (o lo dejo vacio),
// la respuesta es el texto completo y no hay razonamiento.
export function splitReply(text) {
  const marks = [...text.matchAll(/respuesta:/gi)];
  if (!marks.length) return { answer: text, reasoning: "" };
  const last = marks.at(-1);
  const answer = text.slice(last.index + ANSWER_TAG.length).trim();
  if (!answer) return { answer: text, reasoning: "" };
  const reasoning = text
    .slice(0, last.index)
    .replace(/^\s*razonamiento:\s*/i, "")
    .trim();
  return { answer, reasoning };
}

// Version incremental: recibe el texto en trozos (tokens) y devuelve eventos
// { type: "reasoning" | "answer", text } listos para enviar al cliente.
// Fases: start (aun no se sabe como empieza), reasoning y answer.
// Un marcador puede llegar partido entre dos trozos ("Respu" + "esta:"), por eso
// se retiene el final del texto hasta estar seguro de que no es parte de uno.
export function createReplyParser() {
  let phase = "start";
  let pending = "";
  let reasoningStarted = false;
  let answerStarted = false;
  let events = [];

  // Al inicio del razonamiento y de la respuesta se quitan los espacios y
  // saltos de linea que el modelo deja despues del marcador.
  const emitReasoning = (text) => {
    if (!text) return;
    if (!reasoningStarted) {
      text = text.trimStart();
      if (!text) return;
      reasoningStarted = true;
    }
    events.push({ type: "reasoning", text });
  };
  const emitAnswer = (text) => {
    if (!text) return;
    if (!answerStarted) {
      text = text.trimStart();
      if (!text) return;
      answerStarted = true;
    }
    events.push({ type: "answer", text });
  };

  // `final` = ya no va a llegar mas texto: se suelta todo lo retenido.
  function drain(final) {
    let moved = true;
    while (moved) {
      moved = false;

      if (phase === "start") {
        const head = pending.trimStart().toLowerCase();
        if (head.startsWith(REASONING_TAG)) {
          phase = "reasoning";
          pending = pending.trimStart().slice(REASONING_TAG.length);
          moved = true;
        } else if (head.startsWith(ANSWER_TAG)) {
          // Respondio sin razonamiento pero con el marcador.
          phase = "answer";
          pending = pending.trimStart().slice(ANSWER_TAG.length);
          moved = true;
        } else if (
          !final &&
          (REASONING_TAG.startsWith(head) || ANSWER_TAG.startsWith(head))
        ) {
          // Todavia podria ser el comienzo de un marcador: esperar mas texto.
        } else {
          // Contesto directo, sin formato: todo es respuesta.
          phase = "answer";
          moved = true;
        }
      } else if (phase === "reasoning") {
        const idx = pending.toLowerCase().indexOf(ANSWER_TAG);
        if (idx >= 0) {
          emitReasoning(pending.slice(0, idx).trimEnd());
          pending = pending.slice(idx + ANSWER_TAG.length);
          phase = "answer";
          moved = true;
        } else {
          // Retener las ultimas letras por si el marcador llega partido.
          const keep = final ? 0 : ANSWER_TAG.length - 1;
          const cut = pending.length - keep;
          if (cut > 0) {
            emitReasoning(pending.slice(0, cut));
            pending = pending.slice(cut);
          }
        }
      } else {
        emitAnswer(pending);
        pending = "";
      }
    }
  }

  const flush = () => {
    const out = events;
    events = [];
    return out;
  };

  return {
    push(text) {
      pending += text;
      drain(false);
      return flush();
    },
    end() {
      drain(true);
      return flush();
    },
  };
}
