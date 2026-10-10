import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ChatEvent, ChatService, ChatSource } from '../../core/chat.service';
import { Block, parseMessage } from '../../core/format';

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  // Texto completo recibido hasta ahora (la pregunta, o la respuesta del asistente).
  text: string;
  // Parte del texto que ya se muestra: avanza de a poco para el efecto de escritura.
  shown: string;
  reasoning: string;
  sources: ChatSource[];
  // thinking: razonando, aun sin respuesta. writing: escribiendo la respuesta.
  status: 'thinking' | 'writing' | 'done' | 'error';
  meta: string;
}

@Component({
  selector: 'app-chat-page',
  templateUrl: './chat.page.html',
  styleUrl: './chat.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPage implements OnDestroy {
  private readonly chat = inject(ChatService);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  private nextId = 1;
  private controller: AbortController | null = null;
  private pumping = false;
  private frame = 0;

  protected readonly messages = signal<ChatMessage[]>([]);
  protected readonly draft = signal('');
  protected readonly busy = signal(false);

  protected readonly suggestions = [
    '¿Cuál es el tope de hospedaje por noche en Bogotá?',
    '¿Con cuántos días de anticipación debo pedir vacaciones?',
    '¿Qué paquete instalo para las actualizaciones automáticas?',
    '¿Qué es una skill?',
  ];

  ngOnDestroy(): void {
    this.controller?.abort();
    cancelAnimationFrame(this.frame);
  }

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  // Enter envia; Shift+Enter agrega un salto de linea.
  protected onEnter(event: Event): void {
    if ((event as KeyboardEvent).shiftKey) return;
    event.preventDefault();
    void this.send();
  }

  protected stop(): void {
    this.controller?.abort();
  }

  protected async send(text?: string): Promise<void> {
    const question = (text ?? this.draft()).trim();
    if (!question || this.busy()) return;
    this.draft.set('');

    const assistantId = this.nextId + 1;
    this.messages.update((list) => [
      ...list,
      this.newMessage('user', question),
      { ...this.newMessage('assistant', ''), status: 'thinking' },
    ]);
    this.scrollToEnd();

    this.busy.set(true);
    const controller = new AbortController();
    this.controller = controller;
    try {
      for await (const event of this.chat.ask(question, controller.signal)) {
        this.apply(assistantId, event);
      }
      // Si el stream termino sin evento "done", no dejar el mensaje colgado.
      this.patch(assistantId, (m) =>
        m.status === 'thinking' || m.status === 'writing' ? { ...m, status: 'done' } : m,
      );
    } catch (err) {
      if (controller.signal.aborted) {
        this.patch(assistantId, (m) => ({
          ...m,
          status: 'done',
          text: m.text || 'Respuesta cancelada.',
        }));
        this.startPump();
      } else {
        const message = err instanceof Error ? err.message : 'Ocurrió un error inesperado.';
        this.patch(assistantId, (m) => ({ ...m, status: 'error', text: message, shown: message }));
      }
    } finally {
      this.busy.set(false);
      this.controller = null;
    }
  }

  private newMessage(role: ChatMessage['role'], text: string): ChatMessage {
    return {
      id: this.nextId++,
      role,
      text,
      shown: text,
      reasoning: '',
      sources: [],
      status: 'done',
      meta: '',
    };
  }

  private patch(id: number, change: (m: ChatMessage) => ChatMessage): void {
    this.messages.update((list) => list.map((m) => (m.id === id ? change(m) : m)));
  }

  // Aplica un evento del stream al mensaje del asistente.
  private apply(id: number, event: ChatEvent): void {
    switch (event.type) {
      case 'sources':
        this.patch(id, (m) => ({ ...m, sources: event.sources }));
        break;
      case 'reasoning':
        this.patch(id, (m) => ({ ...m, reasoning: m.reasoning + event.text }));
        break;
      case 'answer':
        this.patch(id, (m) => ({ ...m, status: 'writing', text: m.text + event.text }));
        this.startPump();
        break;
      case 'done':
        this.patch(id, (m) => ({
          ...m,
          status: 'done',
          // El resultado final manda: corrige lo mostrado si el modelo no
          // respeto el formato y el parseo en vivo se equivoco.
          text: event.answer,
          shown: event.answer.startsWith(m.shown) ? m.shown : '',
          reasoning: event.reasoning,
          meta: this.metaOf(event),
        }));
        this.startPump();
        break;
      case 'error':
        this.patch(id, (m) => ({ ...m, status: 'error', text: event.message, shown: event.message }));
        break;
    }
  }

  private metaOf(event: Extract<ChatEvent, { type: 'done' }>): string {
    const seconds = event.stats ? `${(event.stats.chatMs / 1000).toFixed(1)} s` : '';
    return [event.model, seconds].filter(Boolean).join(' · ');
  }

  // Efecto de escritura: "shown" avanza hacia "text" unos caracteres por cuadro.
  // Si hay mucho texto pendiente avanza mas rapido, para no quedarse atras.
  private startPump(): void {
    if (this.pumping) return;
    this.pumping = true;
    this.frame = requestAnimationFrame(this.pump);
  }

  private readonly pump = (): void => {
    let pending = false;
    this.messages.update((list) =>
      list.map((m) => {
        if (m.role !== 'assistant' || m.shown.length >= m.text.length) return m;
        pending = true;
        const backlog = m.text.length - m.shown.length;
        const step = Math.max(1, Math.floor(backlog / 60));
        return { ...m, shown: m.text.slice(0, m.shown.length + step) };
      }),
    );
    this.scrollToEnd();
    if (pending) {
      this.frame = requestAnimationFrame(this.pump);
    } else {
      this.pumping = false;
    }
  };

  private scrollToEnd(): void {
    setTimeout(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  // El texto visible, ya dividido en parrafos y bloques de codigo.
  protected blocks(m: ChatMessage): Block[] {
    return parseMessage(m.shown);
  }

  protected isTyping(m: ChatMessage): boolean {
    return m.role === 'assistant' && m.status !== 'error' && m.shown.length < m.text.length;
  }
}
