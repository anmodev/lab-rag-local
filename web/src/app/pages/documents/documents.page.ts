import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  DocumentsService,
  KnowledgeDocument,
  errorMessage,
} from '../../core/documents.service';

const MAX_BYTES = 5 * 1024 * 1024; // el mismo tope de la API
const ALLOWED = ['.md', '.txt'];

// queued: esperando turno. uploading: la API la esta procesando.
// duplicate: la API ya la tenia (no es un error, solo un aviso).
type UploadStatus = 'queued' | 'uploading' | 'ok' | 'duplicate' | 'error';

interface UploadItem {
  id: number;
  name: string;
  size: string;
  status: UploadStatus;
  message: string;
  startedAt: number | null; // milisegundos, mientras se procesa
  seconds: number; // duracion total, cuando termina
}

@Component({
  selector: 'app-documents-page',
  imports: [DatePipe],
  templateUrl: './documents.page.html',
  styleUrl: './documents.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentsPage implements OnInit, OnDestroy {
  private readonly service = inject(DocumentsService);
  private nextId = 1;
  private queue: { id: number; file: File }[] = [];
  private working = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  protected readonly documents = signal<KnowledgeDocument[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly uploads = signal<UploadItem[]>([]);
  protected readonly dragging = signal(false);

  // Reloj que se actualiza cada segundo mientras se procesa, para mostrar el tiempo.
  protected readonly now = signal(Date.now());
  protected readonly busy = signal(false);

  // Avance del lote: cuantos archivos se aceptaron y cuantos ya terminaron.
  protected readonly batchTotal = signal(0);
  protected readonly batchDone = signal(0);
  protected readonly batchPercent = computed(() =>
    this.batchTotal() ? Math.round((this.batchDone() / this.batchTotal()) * 100) : 0,
  );
  protected readonly hasFinished = computed(() =>
    this.uploads().some((u) => u.status !== 'queued' && u.status !== 'uploading'),
  );

  ngOnInit(): void {
    void this.refresh();
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }

  protected async refresh(): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    try {
      this.documents.set(await this.service.list());
    } catch (err) {
      this.loadError.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.enqueue(input.files);
    input.value = ''; // permite volver a elegir el mismo archivo
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.enqueue(event.dataTransfer?.files ?? null);
  }

  protected clearFinished(): void {
    this.uploads.update((list) =>
      list.filter((u) => u.status === 'queued' || u.status === 'uploading'),
    );
  }

  // Valida cada archivo antes de mandarlo: asi el usuario se entera al instante
  // de un formato o un tamano que la API iba a rechazar de todas formas.
  private enqueue(files: FileList | null): void {
    if (!files?.length) return;
    const accepted: { id: number; file: File }[] = [];

    for (const file of Array.from(files)) {
      const id = this.nextId++;
      const problem = this.validate(file);
      const item: UploadItem = {
        id,
        name: file.name,
        size: this.formatBytes(file.size),
        status: problem ? 'error' : 'queued',
        message: problem ?? 'En cola',
        startedAt: null,
        seconds: 0,
      };
      this.uploads.update((list) => [item, ...list]);
      if (!problem) accepted.push({ id, file });
    }

    if (!accepted.length) return;
    if (!this.working) {
      this.batchTotal.set(0);
      this.batchDone.set(0);
    }
    this.batchTotal.update((n) => n + accepted.length);
    this.queue.push(...accepted);
    void this.run();
  }

  private validate(file: File): string | null {
    const name = file.name.toLowerCase();
    if (!ALLOWED.some((ext) => name.endsWith(ext))) {
      return 'Formato no admitido: solo se aceptan archivos .md y .txt';
    }
    if (file.size === 0) return 'El archivo está vacío';
    if (file.size > MAX_BYTES) {
      return `Supera el límite de 5 MB (pesa ${this.formatBytes(file.size)})`;
    }
    return null;
  }

  // Un solo trabajador procesa la cola: vectorizar es lo caro y la API lo hace
  // en serie de todas formas. Los archivos que se agreguen mientras tanto
  // simplemente se suman al final.
  private async run(): Promise<void> {
    if (this.working) return;
    this.working = true;
    this.busy.set(true);
    this.startTimer();

    while (this.queue.length) {
      const { id, file } = this.queue.shift()!;
      const started = Date.now();
      this.patch(id, { status: 'uploading', message: '', startedAt: started });
      try {
        const res = await this.service.upload(file);
        const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
        this.patch(id, {
          status: 'ok',
          message: `Listo: ${res.chunkCount} fragmentos`,
          startedAt: null,
          seconds,
        });
      } catch (err) {
        const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
        const duplicate = err instanceof HttpErrorResponse && err.status === 409;
        this.patch(id, {
          status: duplicate ? 'duplicate' : 'error',
          message: duplicate ? 'Ya estaba cargado, no se repitió' : errorMessage(err),
          startedAt: null,
          seconds,
        });
      }
      this.batchDone.update((n) => n + 1);
      // La tabla se actualiza con cada archivo, no solo al final del lote.
      await this.refresh();
    }

    this.working = false;
    this.busy.set(false);
    this.stopTimer();
  }

  private patch(id: number, change: Partial<UploadItem>): void {
    this.uploads.update((list) => list.map((u) => (u.id === id ? { ...u, ...change } : u)));
  }

  private startTimer(): void {
    this.now.set(Date.now());
    this.timer ??= setInterval(() => this.now.set(Date.now()), 1000);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // Segundos que lleva procesandose un archivo.
  protected elapsed(item: UploadItem): number {
    return item.startedAt ? Math.max(0, Math.floor((this.now() - item.startedAt) / 1000)) : 0;
  }

  // La API hace todo en una sola llamada y no informa el avance interno, asi que
  // se explica que esta pasando segun cuanto lleva.
  protected uploadingText(item: UploadItem): string {
    const s = this.elapsed(item);
    if (s < 2) return 'Subiendo el archivo…';
    if (s < 20) return 'Extrayendo el texto y vectorizando los fragmentos…';
    return 'Vectorizando… los documentos grandes pueden tardar varios minutos';
  }

  protected formatSize(bytes: string | null): string {
    const n = Number(bytes);
    if (!bytes || Number.isNaN(n)) return '-';
    return this.formatBytes(n);
  }

  private formatBytes(n: number): string {
    return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
  }
}
