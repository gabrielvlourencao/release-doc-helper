import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil, filter, timeout } from 'rxjs/operators';
import { GitHubAuthService } from '../../../core';

/**
 * Componente para processar o callback do OAuth
 * Aguarda o processamento completo antes de redirecionar
 */
@Component({
  selector: 'app-callback',
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <div class="text-center">
        <div class="animate-spin w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p class="text-slate-600">Processando autenticação...</p>
        <p class="text-xs text-slate-400 mt-2">Aguarde, isso pode levar alguns segundos</p>
      </div>
    </div>
  `
})
export class CallbackComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  constructor(
    private authService: GitHubAuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    // Aguarda o token ser definido (quando o callback processar com sucesso)
    // ou timeout após 30 segundos
    this.authService.token$
      .pipe(
        takeUntil(this.destroy$),
        filter(token => token !== null), // Aguarda até ter um token
        timeout(30000) // Timeout de 30 segundos
      )
      .subscribe({
        next: () => {
          // Autenticação bem-sucedida
          const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/home';
          this.router.navigate([returnUrl]);
        },
        error: (error) => {
          // Timeout ou erro
          console.error('Erro ao processar autenticação:', error);
          this.router.navigate(['/auth/login'], { 
            queryParams: { error: 'auth_timeout' } 
          });
        }
      });

    // Fallback: verifica periodicamente se autenticou (caso o observable não emita)
    let attempts = 0;
    const maxAttempts = 60; // 60 tentativas = 30 segundos máximo
    
    const checkAuth = () => {
      attempts++;
      
      if (this.authService.isAuthenticated()) {
        // Autenticação bem-sucedida
        const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/home';
        this.router.navigate([returnUrl]);
      } else if (attempts >= maxAttempts) {
        // Timeout - redireciona para login com erro
        this.router.navigate(['/auth/login'], { 
          queryParams: { error: 'auth_timeout' } 
        });
      } else {
        // Continua verificando
        setTimeout(checkAuth, 500);
      }
    };
    
    // Inicia verificação após um pequeno delay para dar tempo do callback iniciar
    setTimeout(checkAuth, 1000);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

