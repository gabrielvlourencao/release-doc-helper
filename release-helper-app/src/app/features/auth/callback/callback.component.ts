import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { GitHubAuthService } from '../../../core';

/**
 * Componente para processar o callback do OAuth
 */
@Component({
  selector: 'app-callback',
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <div class="text-center">
        <div class="animate-spin w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p class="text-slate-600">Processando autenticação...</p>
      </div>
    </div>
  `
})
export class CallbackComponent implements OnInit {
  constructor(
    private authService: GitHubAuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    // Processa o callback e aguarda
    const checkAuth = () => {
      if (this.authService.isAuthenticated()) {
        const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/home';
        this.router.navigate([returnUrl]);
      } else {
        // Aguarda um pouco mais caso ainda esteja processando
        setTimeout(() => {
          if (this.authService.isAuthenticated()) {
            const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/home';
            this.router.navigate([returnUrl]);
          } else {
            this.router.navigate(['/auth/login'], { 
              queryParams: { error: 'auth_failed' } 
            });
          }
        }, 2000);
      }
    };
    
    // Primeira verificação após 1 segundo
    setTimeout(checkAuth, 1000);
  }
}

