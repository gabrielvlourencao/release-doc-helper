import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface GitHubUser {
  login: string;
  name: string;
  avatar_url: string;
  email: string;
}

export interface GitHubToken {
  access_token: string;
  token_type: string;
  scope: string;
}

/**
 * Serviço de autenticação GitHub usando OAuth
 */
@Injectable({
  providedIn: 'root'
})
export class GitHubAuthService {
  private readonly STORAGE_KEY = 'github_token';
  private readonly STORAGE_USER_KEY = 'github_user';
  private readonly GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
  private readonly GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
  
  private tokenSubject = new BehaviorSubject<string | null>(null);
  private userSubject = new BehaviorSubject<GitHubUser | null>(null);
  
  token$ = this.tokenSubject.asObservable();
  user$ = this.userSubject.asObservable();

  constructor() {
    // Carrega token do storage se existir (exceto na rota de callback)
    if (!window.location.pathname.includes('/auth/callback')) {
      this.loadTokenFromStorage();
    } else {
      // Apenas processa callback se estiver na rota de callback
      setTimeout(() => {
        this.handleCallback().catch(error => {
          console.error('Erro ao processar callback:', error);
        });
      }, 100);
    }
  }

  /**
   * Carrega token e usuário do storage
   */
  private loadTokenFromStorage(): void {
    const token = this.getStoredToken();
    if (token) {
      this.tokenSubject.next(token);
      // Carrega usuário também
      const user = this.getStoredUser();
      if (user) {
        this.userSubject.next(user);
      }
    }
  }

  /**
   * Inicia o fluxo de autenticação OAuth
   */
  login(): void {
    const clientId = environment.github?.clientId;
    if (!clientId) {
      console.error('GitHub Client ID não configurado');
      return;
    }

    const redirectUri = `${window.location.origin}/auth/callback`;
    const scope = 'repo user';
    const state = this.generateState();
    
    // Salva o state para validação
    sessionStorage.setItem('github_oauth_state', state);

    const authUrl = `${this.GITHUB_AUTH_URL}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}`;
    
    window.location.href = authUrl;
  }

  /**
   * Processa o callback do OAuth
   */
  private async handleCallback(): Promise<void> {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const storedState = sessionStorage.getItem('github_oauth_state');

    if (code && state && state === storedState) {
      sessionStorage.removeItem('github_oauth_state');
      try {
        await this.exchangeCodeForToken(code);
      } catch (error) {
        console.error('Erro ao processar callback:', error);
        throw error;
      }
    } else if (code) {
      // Código presente mas state inválido ou ausente
      console.warn('State inválido ou ausente no callback');
    }
  }

  /**
   * Troca o código de autorização por um token de acesso
   * Usa uma API backend para evitar problemas de CORS e manter o client_secret seguro
   */
  private async exchangeCodeForToken(code: string): Promise<void> {
    try {
      const apiUrl = environment.github?.apiUrl;
      
      if (!apiUrl) {
        throw new Error('URL da API não configurada. Configure github.apiUrl no environment.ts');
      }

      const redirectUri = `${window.location.origin}/auth/callback`;

      // Chama a API backend para trocar o código por token
      const response = await fetch(`${apiUrl}/api/github/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          code: code,
          redirectUri: redirectUri
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ 
          error: { message: 'Erro ao obter token' } 
        }));
        const errorMessage = errorData.error?.message || errorData.message || 'Erro ao obter token';
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      // Verifica o formato da resposta da API
      // Formato esperado: { success: true, data: { access_token, token_type, scope } }
      let accessToken: string | null = null;
      
      if (data.success && data.data) {
        // Tenta ambos os formatos: camelCase e snake_case
        accessToken = data.data.accessToken || data.data.access_token;
      } else if (data.access_token) {
        // Formato direto sem wrapper success/data
        accessToken = data.access_token;
      }
      
      if (accessToken) {
        this.setToken(accessToken);
        await this.loadUser(accessToken);
        // Remove o código da URL
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        console.error('Token não recebido na resposta:', data);
        throw new Error('Token não recebido na resposta da API');
      }
    } catch (error: any) {
      console.error('Erro ao trocar código por token:', error);
      // Mostra mensagem de erro mais amigável
      const errorMessage = error.message || 'Erro ao autenticar com GitHub. Tente novamente.';
      throw new Error(errorMessage);
    }
  }

  /**
   * Carrega informações do usuário autenticado
   */
  private async loadUser(token: string): Promise<void> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        throw new Error('Erro ao carregar usuário');
      }

      const user: GitHubUser = await response.json();
      this.setUser(user);
    } catch (error) {
      console.error('Erro ao carregar usuário:', error);
    }
  }

  /**
   * Verifica se o usuário está autenticado
   */
  isAuthenticated(): boolean {
    const token = this.tokenSubject.value || this.getStoredToken();
    return token !== null && token !== '';
  }

  /**
   * Retorna o token atual
   */
  getToken(): string | null {
    // Verifica primeiro no subject, depois no storage
    return this.tokenSubject.value || this.getStoredToken();
  }

  /**
   * Retorna o usuário atual
   */
  getUser(): GitHubUser | null {
    return this.userSubject.value;
  }

  /**
   * Faz logout
   */
  logout(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    localStorage.removeItem(this.STORAGE_USER_KEY);
    sessionStorage.removeItem('github_oauth_state');
    this.tokenSubject.next(null);
    this.userSubject.next(null);
  }

  /**
   * Define o token e salva no storage
   */
  private setToken(token: string): void {
    if (token) {
      localStorage.setItem(this.STORAGE_KEY, token);
      this.tokenSubject.next(token);
    }
  }

  /**
   * Define o usuário e salva no storage
   */
  private setUser(user: GitHubUser): void {
    if (user) {
      localStorage.setItem(this.STORAGE_USER_KEY, JSON.stringify(user));
      this.userSubject.next(user);
    }
  }

  /**
   * Recupera o token do storage
   */
  private getStoredToken(): string | null {
    return localStorage.getItem(this.STORAGE_KEY);
  }

  /**
   * Recupera o usuário do storage
   */
  private getStoredUser(): GitHubUser | null {
    const stored = localStorage.getItem(this.STORAGE_USER_KEY);
    return stored ? JSON.parse(stored) : null;
  }

  /**
   * Gera um state aleatório para proteção CSRF
   */
  private generateState(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}

