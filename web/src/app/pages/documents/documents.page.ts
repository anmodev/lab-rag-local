import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import {
  DocumentsService,
  KnowledgeDocument,
  errorMessage,
} from '../../core/documents.service';

// Estado de cada archivo que se esta subiendo o ya se subio.
interface UploadItem {
  id: number;
  name: string;
  status: 'uploading' | 'ok' | 'error';
  message: string;
}

@Component({
  selector: 'app-documents-page',
  imports: [DatePipe],
  templateUrl: './documents.page.html',
  styleUrl: './documents.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentsPage implements OnInit {
  private readonly service = inject(DocumentsService);
  private nextId = 1;

  protected readonly documents = signal<KnowledgeDocument[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly uploads = signal<UploadItem[]>([]);
  protected readonly dragging = signal(false);

  ngOnInit(): void {
    void this.refresh();
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
    void this.uploadAll(input.files);
    input.value = ''; // permite volver a elegir el mismo archivo
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    void this.uploadAll(event.dataTransfer?.files ?? null);
  }

  // Los archivos se suben de a uno: vectorizar es lo caro y la API lo hace
  // en serie de todas formas.
  private async uploadAll(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      await this.uploadOne(file);
    }
    await this.refresh();
  }

  private async uploadOne(file: File): Promise<void> {
    const id = this.nextId++;
    this.uploads.update((list) => [
      { id, name: file.name, status: 'uploading', message: 'Procesando...' },
      ...list,
    ]);
    try {
      const res = await this.service.upload(file);
      this.setUpload(id, 'ok', `Listo: ${res.chunkCount} fragmentos`);
    } catch (err) {
      this.setUpload(id, 'error', errorMessage(err));
    }
  }

  private setUpload(id: number, status: UploadItem['status'], message: string): void {
    this.uploads.update((list) =>
      list.map((u) => (u.id === id ? { ...u, status, message } : u)),
    );
  }

  protected formatSize(bytes: string | null): string {
    const n = Number(bytes);
    if (!bytes || Number.isNaN(n)) return '-';
    return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
  }
}
