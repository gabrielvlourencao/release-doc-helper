import { Component, Input, Output, EventEmitter } from '@angular/core';

/**
 * Componente de estado vazio
 * Exibido quando não há dados para mostrar
 */
@Component({
  selector: 'app-empty-state',
  template: `
    <div class="text-center py-16">
      <div class="w-16 h-16 mx-auto text-slate-300 mb-4">
        <ng-container [ngSwitch]="icon">
          <svg *ngSwitchCase="'folder_open'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"/>
          </svg>
          <svg *ngSwitchCase="'inbox'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
          </svg>
          <svg *ngSwitchDefault fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
        </ng-container>
      </div>
      <h3 class="text-lg font-semibold text-slate-900 mb-2">{{ title }}</h3>
      <p class="text-slate-500 max-w-sm mx-auto mb-6">{{ description }}</p>
      <button *ngIf="actionLabel" 
              class="btn-primary"
              (click)="action.emit()">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        {{ actionLabel }}
      </button>
    </div>
  `
})
export class EmptyStateComponent {
  @Input() icon = 'inbox';
  @Input() title = 'Nenhum item encontrado';
  @Input() description = 'Não há dados para exibir no momento.';
  @Input() actionLabel?: string;
  @Input() actionIcon = 'add';
  @Output() action = new EventEmitter<void>();
}
