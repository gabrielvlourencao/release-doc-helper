import { Component, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { GitHubAuthService } from './core';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  template: `
    <div class="min-h-screen bg-slate-50">
      <app-header *ngIf="showHeader"></app-header>
      <main [class.pt-16]="showHeader">
        <router-outlet></router-outlet>
      </main>
    </div>
  `
})
export class AppComponent implements OnInit {
  title = 'Release Doc Helper';
  showHeader = false;

  constructor(
    private authService: GitHubAuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Verifica autenticação inicial
    this.updateHeaderVisibility();

    // Atualiza quando a rota muda
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        this.updateHeaderVisibility();
      });

    // Atualiza quando o estado de autenticação muda
    this.authService.token$.subscribe(() => {
      this.updateHeaderVisibility();
    });
  }

  private updateHeaderVisibility(): void {
    const isAuthRoute = this.router.url.includes('/auth/login') || 
                        this.router.url.includes('/auth/callback');
    
    // Mostra header se:
    // 1. Usuário está autenticado com GitHub OAuth, ou
    // 2. Usuário tem token de serviço na sessão (funcional)
    // E não está na rota de login/callback
    const isDeveloper = this.authService.isAuthenticated();
    const hasServiceToken = !!sessionStorage.getItem('service_token');
    const hasAccess = isDeveloper || hasServiceToken;
    this.showHeader = hasAccess && !isAuthRoute;
  }
}
