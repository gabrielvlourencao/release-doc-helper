import { Injectable } from '@angular/core';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

/**
 * Serviço de notificações
 * Centraliza exibição de mensagens para o usuário usando toasts customizados
 */
@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private toasts: Toast[] = [];
  private nextId = 0;

  /**
   * Exibe mensagem de sucesso
   */
  success(message: string): void {
    this.show(message, 'success');
  }

  /**
   * Exibe mensagem de erro
   */
  error(message: string): void {
    this.show(message, 'error', 6000);
  }

  /**
   * Exibe mensagem de aviso
   */
  warning(message: string): void {
    this.show(message, 'warning');
  }

  /**
   * Exibe mensagem informativa
   */
  info(message: string): void {
    this.show(message, 'info');
  }

  private show(message: string, type: Toast['type'], duration: number = 4000): void {
    const toast: Toast = {
      id: this.nextId++,
      message,
      type
    };

    // Cria e insere o elemento do toast
    const toastElement = document.createElement('div');
    toastElement.className = `toast toast-${type}`;
    toastElement.innerHTML = `
      <div class="flex items-center gap-3">
        <span>${this.getIcon(type)}</span>
        <span>${message}</span>
      </div>
    `;
    
    document.body.appendChild(toastElement);

    // Remove após o tempo definido
    setTimeout(() => {
      toastElement.style.opacity = '0';
      toastElement.style.transform = 'translateY(20px)';
      setTimeout(() => {
        document.body.removeChild(toastElement);
      }, 300);
    }, duration);
  }

  private getIcon(type: Toast['type']): string {
    const icons = {
      success: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`,
      error: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`,
      warning: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`,
      info: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`
    };
    return icons[type];
  }
}
