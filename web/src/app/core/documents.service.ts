import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

// Lo que devuelve GET /documents. Postgres entrega los bigint como texto.
export interface KnowledgeDocument {
  id: string;
  filename: string;
  size_bytes: string | null;
  created_at: string;
  chunk_count: number;
}

// Lo que devuelve POST /documents.
export interface UploadResult {
  documentId: string;
  filename: string;
  chunkCount: number;
  embedMs: number;
}

// Convierte un error HTTP en un mensaje para el usuario.
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'No se pudo conectar con el servidor.';
    const detail = (err.error as { error?: string } | null)?.error;
    if (detail) return detail;
  }
  return 'Ocurrió un error inesperado.';
}

@Injectable({ providedIn: 'root' })
export class DocumentsService {
  private readonly http = inject(HttpClient);

  async list(): Promise<KnowledgeDocument[]> {
    const res = await firstValueFrom(
      this.http.get<{ documents: KnowledgeDocument[] }>('/api/documents'),
    );
    return res.documents;
  }

  upload(file: File): Promise<UploadResult> {
    // La API espera el archivo en el campo "file" de un formulario multipart.
    const body = new FormData();
    body.append('file', file);
    return firstValueFrom(this.http.post<UploadResult>('/api/documents', body));
  }
}
