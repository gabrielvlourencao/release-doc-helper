import { Injectable } from '@angular/core';
import { CanActivate, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { GitHubAuthService } from '../services/github-auth.service';

/**
 * Guard para proteger rotas que requerem autenticação
 * Permite acesso se:
 * - Usuário está logado com GitHub (developer)
 * - Usuário está com token de serviço no localStorage (funcional)
 */
@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(
    private authService: GitHubAuthService,
    private router: Router
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): boolean {
    // Verifica se há token de usuário (dev logado)
    const userToken = localStorage.getItem('github_token');
    if (userToken) {
      return true;
    }

    // Verifica se há token de serviço no localStorage (funcional)
    const serviceToken = localStorage.getItem('service_token');
    if (serviceToken) {
      return true;
    }

    // Redireciona para login
    this.router.navigate(['/auth/login'], { queryParams: { returnUrl: state.url } });
    return false;
  }
}

