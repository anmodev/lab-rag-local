import { Routes } from '@angular/router';

// Cada pantalla se carga solo cuando se visita (lazy loading).
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'chat' },
  {
    path: 'chat',
    title: 'Chat',
    loadComponent: () => import('./pages/chat/chat.page').then((m) => m.ChatPage),
  },
  {
    path: 'documentos',
    title: 'Documentos',
    loadComponent: () =>
      import('./pages/documents/documents.page').then((m) => m.DocumentsPage),
  },
  { path: '**', redirectTo: 'chat' },
];
