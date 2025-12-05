import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { GitHubAuthService } from '../../../core';

/**
 * Componente de login com GitHub
 * Suporta:
 * - Login com conta GitHub (para devs) - PRs criados com conta do dev
 * - Login como funcional com token compartilhado - PRs criados com conta de serviço
 */
@Component({
  selector: 'app-login',
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4">
      <div class="max-w-md w-full">
        <div class="card p-8 text-center">
          <!-- Logo/Ícone -->
          <div class="w-20 h-20 mx-auto mb-6 rounded-full bg-primary-100 flex items-center justify-center">
            <svg class="w-10 h-10 text-primary-600" fill="currentColor" viewBox="0 0 24 24">
              <path fill-rule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" clip-rule="evenodd"/>
            </svg>
          </div>

          <!-- Título -->
          <h1 class="text-2xl font-bold text-slate-900 mb-2">Bem-vindo ao Release Doc Helper</h1>
          <p class="text-slate-600 mb-8">
            Escolha como deseja acessar o sistema
          </p>

          <!-- Botão de Login GitHub (Devs) -->
          <button 
            (click)="loginAsDeveloper()" 
            class="w-full btn-primary flex items-center justify-center gap-3 py-3 text-lg"
            [disabled]="isLoading">
            <svg *ngIf="!isLoading" class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path fill-rule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" clip-rule="evenodd"/>
            </svg>
            <svg *ngIf="isLoading" class="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>{{ isLoading ? 'Conectando...' : 'Entrar como Desenvolvedor' }}</span>
          </button>
          <p class="text-xs text-slate-400 mt-2">
            Login com GitHub. PRs criados com sua conta.
          </p>

          <!-- Separador -->
          <div class="relative my-6">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t border-slate-200"></div>
            </div>
            <div class="relative flex justify-center text-sm">
              <span class="px-2 bg-white text-slate-500">ou</span>
            </div>
          </div>
          
          <!-- Área de login funcional -->
          <div *ngIf="!showTokenInput">
            <button 
              (click)="showTokenInput = true" 
              class="w-full btn-secondary flex items-center justify-center gap-3 py-3">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
              </svg>
              <span>Entrar como Funcional</span>
            </button>
            <p class="text-xs text-slate-400 mt-2">
              Peça o token de acesso para um desenvolvedor
            </p>
          </div>

          <!-- Input do token (funcional) -->
          <div *ngIf="showTokenInput" class="text-left">
            <label class="block text-sm font-medium text-slate-700 mb-2">
              Token de Acesso
            </label>
            <input 
              type="password"
              [(ngModel)]="serviceToken"
              placeholder="ghp_xxxxxxxxxxxx"
              class="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
              (keyup.enter)="loginAsFunctional()">
            <p class="text-xs text-slate-400 mt-2 mb-4">
              Peça este token para um desenvolvedor da equipe
            </p>
            
            <div *ngIf="tokenError" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {{ tokenError }}
            </div>

            <div class="flex gap-3">
              <button 
                (click)="showTokenInput = false; serviceToken = ''; tokenError = ''" 
                class="flex-1 btn-secondary py-2.5">
                Voltar
              </button>
              <button 
                (click)="loginAsFunctional()" 
                class="flex-1 btn-primary py-2.5"
                [disabled]="!serviceToken || isValidating">
                <svg *ngIf="isValidating" class="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                {{ isValidating ? 'Validando...' : 'Entrar' }}
              </button>
            </div>
          </div>

          <!-- Informações -->
          <div class="mt-8 p-4 bg-slate-50 rounded-lg text-left">
            <p class="text-xs text-slate-600 font-medium mb-2">ℹ️ Qual a diferença?</p>
            <ul class="text-xs text-slate-500 space-y-1">
              <li><strong>Desenvolvedor:</strong> Login com GitHub. PRs aparecem como criados por você.</li>
              <li><strong>Funcional:</strong> Token compartilhado. PRs aparecem como criados pela conta de serviço.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  `
})
export class LoginComponent implements OnInit {
  isLoading = false;
  isValidating = false;
  returnUrl = '/home';
  
  // Funcional
  showTokenInput = false;
  serviceToken = '';
  tokenError = '';

  constructor(
    private authService: GitHubAuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    // Verifica se já está autenticado com GitHub
    if (this.authService.isAuthenticated()) {
      sessionStorage.setItem('user_mode', 'developer');
      this.router.navigate(['/home']);
      return;
    }

    // Verifica se já está no modo funcional com token válido
    const userMode = sessionStorage.getItem('user_mode');
    const savedToken = sessionStorage.getItem('service_token');
    if (userMode === 'functional' && savedToken) {
      this.router.navigate(['/home']);
      return;
    }

    // Obtém a URL de retorno se houver
    this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/home';
  }

  loginAsDeveloper(): void {
    this.isLoading = true;
    sessionStorage.setItem('user_mode', 'developer');
    this.authService.login();
  }

  async loginAsFunctional(): Promise<void> {
    if (!this.serviceToken) {
      this.tokenError = 'Insira o token de acesso';
      return;
    }

    this.isValidating = true;
    this.tokenError = '';

    try {
      // Valida o token fazendo uma requisição ao GitHub
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${this.serviceToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        throw new Error('Token inválido');
      }

      const user = await response.json();
      
      // Salva o token e o modo na sessão
      sessionStorage.setItem('user_mode', 'functional');
      sessionStorage.setItem('service_token', this.serviceToken);
      sessionStorage.setItem('service_user', JSON.stringify({
        login: user.login,
        avatar_url: user.avatar_url
      }));

      this.router.navigate([this.returnUrl]);
    } catch (error) {
      this.tokenError = 'Token inválido ou expirado. Peça um novo token para o desenvolvedor.';
    } finally {
      this.isValidating = false;
    }
  }
}

