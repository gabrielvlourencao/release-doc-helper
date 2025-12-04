import { Component } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Componente de cabeçalho da aplicação
 * Design limpo e corporativo inspirado em pedidos.ltsolutions.com.br
 */
@Component({
  selector: 'app-header',
  template: `
    <header class="bg-white border-b border-slate-200 fixed top-0 left-0 right-0 z-50">
      <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <!-- Logo/Brand -->
        <div class="flex items-center gap-3 cursor-pointer" (click)="navigateHome()">
          <div class="w-9 h-9 bg-primary-500 rounded-xl flex items-center justify-center">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
          </div>
          <span class="text-lg font-semibold text-slate-900">Release Helper</span>
        </div>

        <!-- Navigation -->
        <nav class="flex items-center gap-1">
          <a routerLink="/releases" 
             routerLinkActive="bg-slate-100 text-primary-500"
             class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-50 font-medium text-sm transition-colors flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/>
            </svg>
            Demandas
          </a>
          
          <a routerLink="/releases/new" 
             class="ml-2 btn-primary text-sm">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
            Nova Release
          </a>
        </nav>
      </div>
    </header>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class HeaderComponent {
  constructor(private router: Router) {}

  navigateHome(): void {
    this.router.navigate(['/']);
  }
}
