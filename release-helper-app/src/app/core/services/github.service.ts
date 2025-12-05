import { Injectable } from '@angular/core';
import { Observable, from, throwError, of, forkJoin } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { Octokit } from '@octokit/rest';
import { GitHubAuthService } from './github-auth.service';

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string;
  owner: {
    login: string;
    type: string;
  };
}

export interface CreatePRParams {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface FileContent {
  path: string;
  content: string;
  sha?: string; // SHA do arquivo existente para atualização
}

/**
 * Serviço para interagir com a API do GitHub
 * Suporta:
 * - Token do usuário (dev logado com GitHub OAuth)
 * - Token de serviço (funcional com token compartilhado na sessão)
 */
@Injectable({
  providedIn: 'root'
})
export class GitHubService {
  private octokit: Octokit | null = null;

  constructor(private authService: GitHubAuthService) {
    // Inicializa o Octokit quando o token do usuário estiver disponível
    this.authService.token$.subscribe(token => {
      if (token) {
        this.octokit = new Octokit({ auth: token });
      } else {
        // Tenta usar token de serviço da sessão
        this.initializeFromServiceToken();
      }
    });
    
    // Inicializa com token existente
    this.initializeOctokit();
  }

  /**
   * Inicializa o Octokit com o token disponível
   */
  private initializeOctokit(): void {
    // Primeiro tenta token do usuário
    const userToken = this.authService.getToken();
    if (userToken) {
      this.octokit = new Octokit({ auth: userToken });
      return;
    }
    
    // Depois tenta token de serviço da sessão
    this.initializeFromServiceToken();
  }

  /**
   * Inicializa Octokit com token de serviço da sessão
   */
  private initializeFromServiceToken(): void {
    const serviceToken = sessionStorage.getItem('service_token');
    if (serviceToken) {
      this.octokit = new Octokit({ auth: serviceToken });
    } else {
      this.octokit = null;
    }
  }

  /**
   * Retorna o Octokit disponível (usuário ou serviço)
   */
  private getOctokit(): Octokit | null {
    // Se não tem Octokit inicializado, tenta inicializar
    if (!this.octokit) {
      this.initializeOctokit();
    }
    return this.octokit;
  }

  /**
   * Verifica se há algum token válido (usuário ou serviço)
   */
  hasValidToken(): boolean {
    return this.getOctokit() !== null;
  }

  /**
   * Verifica se está usando token de serviço
   */
  isUsingServiceToken(): boolean {
    return !this.authService.isAuthenticated() && !!sessionStorage.getItem('service_token');
  }

  /**
   * Verifica se o usuário está logado com GitHub OAuth
   */
  isUserLoggedIn(): boolean {
    return this.authService.isAuthenticated();
  }

  /**
   * Lista TODOS os repositórios que o usuário tem acesso (com paginação)
   * Inclui: repos próprios, de organizações e onde é colaborador
   */
  getUserRepositories(): Observable<GitHubRepository[]> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível. Configure o token de serviço ou faça login com GitHub.'));
    }

    // Busca repositórios do usuário + organizações em paralelo
    return from(this.fetchAllRepositories(octokit)).pipe(
      map(repos => {
        console.log(`[getUserRepositories] Total de repositórios encontrados: ${repos.length}`);
        // Lista todos os nomes para debug
        repos.forEach(r => console.log(`  - ${r.full_name}`));
        return repos;
      }),
      catchError(error => {
        console.error('Erro ao listar repositórios:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Busca todos os repositórios: do usuário + de todas as organizações (com paginação manual)
   */
  private async fetchAllRepositories(octokit: Octokit): Promise<GitHubRepository[]> {
    const allRepos: GitHubRepository[] = [];
    const repoIds = new Set<number>(); // Para evitar duplicatas

    try {
      // 1. Busca repositórios do usuário autenticado (com paginação)
      console.log('[fetchAllRepositories] Buscando repos do usuário...');
      const userRepos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
        visibility: 'all',
        affiliation: 'owner,collaborator,organization_member',
        sort: 'updated',
        per_page: 100
      });
      
      userRepos.forEach(repo => {
        if (!repoIds.has(repo.id)) {
          repoIds.add(repo.id);
          allRepos.push(repo as GitHubRepository);
        }
      });
      console.log(`[fetchAllRepositories] Repos do usuário (paginado): ${userRepos.length}`);

      // 2. Busca organizações do usuário
      console.log('[fetchAllRepositories] Buscando organizações...');
      const orgs = await octokit.paginate(octokit.orgs.listForAuthenticatedUser, {
        per_page: 100
      });
      console.log(`[fetchAllRepositories] Organizações encontradas: ${orgs.length}`);
      orgs.forEach(o => console.log(`  - Org: ${o.login}`));

      // 3. Para cada organização, busca os repositórios COM PAGINAÇÃO MANUAL
      for (const org of orgs) {
        try {
          console.log(`[fetchAllRepositories] Buscando TODOS os repos de ${org.login}...`);
          let page = 1;
          let hasMore = true;
          let orgRepoCount = 0;

          while (hasMore) {
            const response = await octokit.repos.listForOrg({
              org: org.login,
              type: 'all',
              sort: 'updated',
              per_page: 100,
              page: page
            });

            const repos = response.data;
            console.log(`[fetchAllRepositories] ${org.login} página ${page}: ${repos.length} repos`);

            if (repos.length === 0) {
              hasMore = false;
            } else {
              repos.forEach(repo => {
                if (!repoIds.has(repo.id)) {
                  repoIds.add(repo.id);
                  allRepos.push(repo as GitHubRepository);
                  orgRepoCount++;
                }
              });
              page++;
              // Segurança: máximo de 50 páginas (5000 repos)
              if (page > 50) {
                console.warn(`[fetchAllRepositories] ${org.login}: limite de páginas atingido`);
                hasMore = false;
              }
            }
          }
          console.log(`[fetchAllRepositories] Total de ${org.login}: ${orgRepoCount} repos novos`);
        } catch (orgError: any) {
          // Se não tiver permissão para listar repos da org, ignora
          console.warn(`[fetchAllRepositories] Não foi possível listar repos de ${org.login}:`, orgError.message);
        }
      }

    } catch (error) {
      console.error('[fetchAllRepositories] Erro:', error);
      throw error;
    }

    console.log(`[fetchAllRepositories] =============================`);
    console.log(`[fetchAllRepositories] TOTAL FINAL: ${allRepos.length} repositórios`);
    console.log(`[fetchAllRepositories] =============================`);
    return allRepos;
  }

  /**
   * Decodifica Base64 para string UTF-8
   */
  private decodeBase64UTF8(base64: string): string {
    try {
      // Remove quebras de linha do base64
      const cleanBase64 = base64.replace(/\n/g, '');
      // Decodifica base64 para bytes
      const binaryString = atob(cleanBase64);
      // Converte para Uint8Array
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      // Decodifica UTF-8
      return new TextDecoder('utf-8').decode(bytes);
    } catch (error) {
      console.error('Erro ao decodificar base64:', error);
      // Fallback para decodificação simples
      return atob(base64.replace(/\n/g, ''));
    }
  }

  /**
   * Codifica string UTF-8 para Base64
   */
  private encodeBase64UTF8(str: string): string {
    try {
      // Codifica string para UTF-8 bytes
      const bytes = new TextEncoder().encode(str);
      // Converte bytes para string binária
      let binaryString = '';
      bytes.forEach(byte => {
        binaryString += String.fromCharCode(byte);
      });
      // Codifica para base64
      return btoa(binaryString);
    } catch (error) {
      console.error('Erro ao codificar base64:', error);
      // Fallback para codificação antiga
      return btoa(unescape(encodeURIComponent(str)));
    }
  }

  /**
   * Obtém o conteúdo de um arquivo
   */
  getFileContent(owner: string, repo: string, path: string, ref?: string): Observable<string | null> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    return from(
      octokit.repos.getContent({
        owner,
        repo,
        path,
        ref
      })
    ).pipe(
      map(response => {
        if (Array.isArray(response.data)) {
          return null;
        }
        // Decodifica o conteúdo base64 para UTF-8
        const content = (response.data as any).content;
        return content ? this.decodeBase64UTF8(content) : null;
      }),
      catchError(error => {
        if (error.status === 404) {
          // Arquivo não existe
          return from([null]);
        }
        console.error('Erro ao obter conteúdo do arquivo:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Obtém o SHA de um arquivo (necessário para atualização)
   */
  getFileSha(owner: string, repo: string, path: string, ref?: string): Observable<string | null> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    return from(
      octokit.repos.getContent({
        owner,
        repo,
        path,
        ref
      })
    ).pipe(
      map(response => {
        if (Array.isArray(response.data)) {
          return null;
        }
        return (response.data as any).sha || null;
      }),
      catchError(error => {
        if (error.status === 404) {
          return from([null]);
        }
        return throwError(() => error);
      })
    );
  }

  /**
   * Cria ou atualiza um arquivo em um repositório
   */
  createOrUpdateFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    branch: string = 'develop'
  ): Observable<void> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    // Primeiro, tenta obter o SHA do arquivo se existir
    return this.getFileSha(owner, repo, path, branch).pipe(
      switchMap((sha: string | null) => {
        // Codifica conteúdo UTF-8 para base64
        const fileContent = this.encodeBase64UTF8(content);
        
        return from(
          octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path,
            message,
            content: fileContent,
            branch,
            ...(sha ? { sha } : {}) // Inclui SHA apenas se o arquivo existir
          })
        );
      }),
      map(() => void 0 as void),
      catchError((error: any) => {
        console.error('Erro ao criar/atualizar arquivo:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Cria uma branch a partir de uma branch base
   */
  createBranch(owner: string, repo: string, branchName: string, baseBranch: string = 'develop'): Observable<void> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    // Primeiro, obtém a referência da branch base
    return from(
      octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${baseBranch}`
      })
    ).pipe(
      switchMap((baseRef: any) => {
        const sha = baseRef.data.object.sha;
        
        // Cria a nova branch
        return from(
          octokit.git.createRef({
            owner,
            repo,
            ref: `refs/heads/${branchName}`,
            sha
          })
        );
      }),
      map(() => void 0 as void),
      catchError((error: any) => {
        // Se a branch já existe, não é um erro
        if (error.status === 422) {
          return of(void 0);
        }
        console.error('Erro ao criar branch:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Cria um Pull Request
   */
  createPullRequest(params: CreatePRParams): Observable<{ html_url: string; number: number }> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    return from(
      octokit.pulls.create({
        owner: params.owner,
        repo: params.repo,
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base
      })
    ).pipe(
      map(response => ({
        html_url: response.data.html_url,
        number: response.data.number
      })),
      catchError(error => {
        console.error('Erro ao criar Pull Request:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Extrai owner e repo de uma URL do GitHub
   */
  parseRepositoryUrl(url: string): { owner: string; repo: string } | null {
    try {
      const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
      if (match) {
        return {
          owner: match[1],
          repo: match[2]
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Verifica regras de proteção da branch
   */
  getBranchProtection(owner: string, repo: string, branch: string = 'develop'): Observable<any> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    return from(
      octokit.repos.getBranchProtection({ owner, repo, branch })
    ).pipe(
      map(response => response.data),
      catchError(error => {
        // 404 = sem proteção configurada (ok)
        if (error.status === 404) {
          return of(null);
        }
        console.error('Erro ao verificar proteção da branch:', error);
        return of(null);
      })
    );
  }

  /**
   * Lista arquivos de release no diretório releases/ da branch develop
   */
  listReleasesFromRepo(owner: string, repo: string): Observable<{ name: string; path: string; sha: string }[]> {
    const octokit = this.getOctokit();
    if (!octokit) {
      console.error(`[listReleasesFromRepo] Sem token para ${owner}/${repo}`);
      return throwError(() => new Error('Nenhum token disponível'));
    }

    console.log(`[listReleasesFromRepo] Buscando releases em ${owner}/${repo} branch develop...`);

    return from(
      octokit.repos.getContent({
        owner,
        repo,
        path: 'releases',
        ref: 'develop'
      })
    ).pipe(
      map(response => {
        console.log(`[listReleasesFromRepo] Resposta de ${owner}/${repo}:`, response.data);
        if (Array.isArray(response.data)) {
          const files = response.data
            .filter((file: any) => file.type === 'file' && file.name.endsWith('.md'))
            .map((file: any) => ({
              name: file.name,
              path: file.path,
              sha: file.sha
            }));
          console.log(`[listReleasesFromRepo] Encontrados ${files.length} arquivos .md em ${owner}/${repo}`);
          return files;
        }
        return [];
      }),
      catchError(error => {
        console.error(`[listReleasesFromRepo] Erro em ${owner}/${repo}:`, error.status, error.message);
        // 404 = pasta releases não existe ou branch não existe
        if (error.status === 404) {
          console.log(`[listReleasesFromRepo] 404 - pasta releases/ ou branch develop não existe em ${owner}/${repo}`);
          return of([]);
        }
        return of([]);
      })
    );
  }

  /**
   * Obtém o conteúdo de um arquivo de release
   */
  getReleaseFileContent(owner: string, repo: string, path: string): Observable<string | null> {
    return this.getFileContent(owner, repo, path, 'develop');
  }

  /**
   * Lista todas as releases de todos os repositórios acessíveis
   */
  listAllReleasesFromRepos(): Observable<{ repo: string; releases: { name: string; path: string; sha: string }[] }[]> {
    console.log('[listAllReleasesFromRepos] Iniciando busca de releases...');
    
    return this.getUserRepositories().pipe(
      switchMap(repos => {
        console.log(`[listAllReleasesFromRepos] Encontrados ${repos.length} repositórios`);
        
        if (repos.length === 0) {
          console.log('[listAllReleasesFromRepos] Nenhum repositório encontrado');
          return of([]);
        }
        
        // Log dos repos encontrados
        repos.forEach(r => console.log(`[listAllReleasesFromRepos] Repo: ${r.full_name}`));
        
        const operations = repos.map(repo => {
          const repoInfo = this.parseRepositoryUrl(repo.html_url);
          if (!repoInfo) {
            console.error(`[listAllReleasesFromRepos] Não foi possível parsear URL: ${repo.html_url}`);
            return of({ repo: repo.full_name, releases: [] as { name: string; path: string; sha: string }[] });
          }
          
          return this.listReleasesFromRepo(repoInfo.owner, repoInfo.repo).pipe(
            map(releases => {
              console.log(`[listAllReleasesFromRepos] ${repo.full_name} tem ${releases.length} releases`);
              return { repo: repo.full_name, releases };
            }),
            catchError(err => {
              console.error(`[listAllReleasesFromRepos] Erro em ${repo.full_name}:`, err);
              return of({ repo: repo.full_name, releases: [] as { name: string; path: string; sha: string }[] });
            })
          );
        });
        
        return forkJoin(operations);
      }),
      map(results => {
        const filtered = results.filter(r => r.releases.length > 0);
        console.log(`[listAllReleasesFromRepos] Total de repos com releases: ${filtered.length}`);
        return filtered;
      })
    );
  }

  /**
   * Deleta um arquivo do repositório
   */
  deleteFile(owner: string, repo: string, path: string, message: string, branch: string = 'develop'): Observable<void> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    return this.getFileSha(owner, repo, path, branch).pipe(
      switchMap((sha: string | null) => {
        if (!sha) {
          return throwError(() => new Error('Arquivo não encontrado'));
        }
        
        return from(
          octokit.repos.deleteFile({
            owner,
            repo,
            path,
            message,
            sha,
            branch
          })
        );
      }),
      map(() => void 0),
      catchError(error => {
        console.error('Erro ao deletar arquivo:', error);
        return throwError(() => error);
      })
    );
  }
}

