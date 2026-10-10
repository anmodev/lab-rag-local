import { Injectable } from '@angular/core';

export interface ChatSource {
  filename: string;
  chunkIndex: number;
  similarity: number;
}

export interface ChatStats {
  chatMs: number;
  promptTokens: number;
  answerTokens: number;
}

// Eventos que emite POST /ask/stream, una linea JSON por evento.
export type ChatEvent =
  | { type: 'sources'; sources: ChatSource[] }
  | { type: 'reasoning'; text: string }
  | { type: 'answer'; text: string }
  | {
      type: 'done';
      answer: string;
      reasoning: string;
      model: string;
      stats?: ChatStats;
    }
  | { type: 'error'; message: string };

@Injectable({ providedIn: 'root' })
export class ChatService {
  // Se usa fetch directo y no HttpClient: fetch permite leer el cuerpo de la
  // respuesta a medida que llega, que es lo que necesita el streaming.
  async *ask(question: string, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    const res = await fetch('/api/ask/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal,
    });

    if (!res.ok || !res.body) {
      let message = `Error ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // la respuesta no era JSON: se queda el mensaje generico
      }
      throw new Error(message);
    }

    // Un trozo de red puede traer media linea: se acumula hasta tener lineas
    // completas (terminadas en salto de linea) antes de interpretarlas.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as ChatEvent;
      }
    }
    if (buffer.trim()) yield JSON.parse(buffer) as ChatEvent;
  }
}
