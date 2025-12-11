import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmColor?: 'primary' | 'danger';
}

/**
 * Componente de diálogo de confirmação reutilizável
 * Agora implementado como modal inline
 */
@Component({
  selector: 'app-confirm-dialog',
  template: `
    <div *ngIf="isOpen" 
         class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
         (click)="onBackdropClick($event)">
      <div class="bg-white rounded-2xl shadow-xl max-w-md w-full animate-fade-in" 
           (click)="$event.stopPropagation()">
        <div class="p-6">
          <h2 class="text-xl font-semibold text-slate-900 mb-2">{{ data.title }}</h2>
          <p class="text-slate-600 whitespace-pre-line">{{ data.message }}</p>
        </div>
        <div class="flex justify-end gap-3 px-6 py-4 bg-slate-50 rounded-b-2xl">
          <button class="btn-secondary" (click)="onCancel()">
            {{ data.cancelText || 'Cancelar' }}
          </button>
          <button [class]="confirmButtonClass" (click)="onConfirm()">
            {{ data.confirmText || 'Confirmar' }}
          </button>
        </div>
      </div>
    </div>
  `
})
export class ConfirmDialogComponent {
  @Input() isOpen = false;
  @Input() data: ConfirmDialogData = {
    title: 'Confirmar',
    message: 'Tem certeza?'
  };
  
  @Output() confirmed = new EventEmitter<boolean>();
  @Output() closed = new EventEmitter<void>();

  get confirmButtonClass(): string {
    return this.data.confirmColor === 'danger' ? 'btn-danger' : 'btn-primary';
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onCancel();
    }
  }

  onCancel(): void {
    this.isOpen = false;
    this.confirmed.emit(false);
    this.closed.emit();
  }

  onConfirm(): void {
    this.isOpen = false;
    this.confirmed.emit(true);
    this.closed.emit();
  }
}
