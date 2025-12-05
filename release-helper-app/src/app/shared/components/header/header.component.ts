import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { GitHubAuthService } from '../../../core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

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

          <!-- User Menu -->
          <div class="ml-4 flex items-center gap-2 border-l border-slate-200 pl-4">
            <!-- Usuário logado com GitHub OAuth -->
            <ng-container *ngIf="user">
              <div class="flex items-center gap-2 text-sm text-slate-600">
                <img [src]="user.avatar_url" [alt]="user.login" class="w-7 h-7 rounded-full">
                <span class="hidden sm:inline">{{ user.login }}</span>
              </div>
              <button (click)="handleLogout()" 
                      class="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-2"
                      title="Sair">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
                </svg>
                <span class="hidden sm:inline">Sair</span>
              </button>
            </ng-container>
            
            <!-- Usuário funcional (com token de serviço) -->
            <ng-container *ngIf="!user && isFunctional && serviceUser">
              <div class="flex items-center gap-2 text-sm text-slate-600">
                <img [src]="serviceUser.avatar_url" [alt]="serviceUser.login" class="w-7 h-7 rounded-full ring-2 ring-amber-400">
                <div class="hidden sm:block">
                  <span class="text-slate-600">{{ serviceUser.login }}</span>
                  <span class="text-xs text-amber-600 ml-1">(serviço)</span>
                </div>
              </div>
              <button (click)="handleLogout()" 
                      class="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-2"
                      title="Sair">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
                </svg>
                <span class="hidden sm:inline">Sair</span>
              </button>
            </ng-container>
            
            <!-- Sem login -->
            <ng-container *ngIf="!user && !isFunctional">
              <button (click)="goToLogin()" 
                      class="px-3 py-1.5 text-sm text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors flex items-center gap-2"
                      title="Fazer login">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path fill-rule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" clip-rule="evenodd"/>
                </svg>
                <span class="hidden sm:inline">Login</span>
              </button>
            </ng-container>
          </div>
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
export class HeaderComponent implements OnInit, OnDestroy {
  user: any = null;
  serviceUser: any = null;
  isFunctional = false;
  private destroy$ = new Subject<void>();

  constructor(
    private router: Router,
    private authService: GitHubAuthService
  ) {}

  ngOnInit(): void {
    this.loadUserInfo();
    
    // Observa mudanças no usuário OAuth
    this.authService.user$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadUserInfo();
      });
  }

  private loadUserInfo(): void {
    // Tenta carregar usuário OAuth
    this.user = this.authService.getUser();
    
    // Se não tem usuário OAuth, verifica se é funcional
    if (!this.user) {
      const serviceUserStr = sessionStorage.getItem('service_user');
      if (serviceUserStr) {
        try {
          this.serviceUser = JSON.parse(serviceUserStr);
          this.isFunctional = true;
        } catch {
          this.serviceUser = null;
          this.isFunctional = false;
        }
      }
    } else {
      this.isFunctional = false;
      this.serviceUser = null;
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  navigateHome(): void {
    this.router.navigate(['/home']);
  }

  handleLogout(): void {
    // Limpa autenticação GitHub OAuth
    this.authService.logout();
    // Limpa dados de funcional
    sessionStorage.removeItem('user_mode');
    sessionStorage.removeItem('service_token');
    sessionStorage.removeItem('service_user');
    this.router.navigate(['/auth/login']);
  }

  goToLogin(): void {
    // Limpa tudo para permitir escolher novamente
    sessionStorage.removeItem('user_mode');
    sessionStorage.removeItem('service_token');
    sessionStorage.removeItem('service_user');
    this.router.navigate(['/auth/login']);
  }
}
