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
   * Lista APENAS repositórios de organizações (ignora repositórios pessoais)
   * Apenas repositórios de organizações são sincronizados no Firestore
   */
  getUserRepositories(): Observable<GitHubRepository[]> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível. Configure o token de serviço ou faça login com GitHub.'));
    }

    // Busca APENAS repositórios de organizações (ignora pessoais)
    return from(this.fetchOrganizationRepositories(octokit)).pipe(
      map(repos => repos),
      catchError(error => {
        console.error('Erro ao listar repositórios:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Busca APENAS repositórios de organizações (ignora repositórios pessoais)
   * Repositórios pessoais não são sincronizados no Firestore
   */
  private async fetchOrganizationRepositories(octokit: Octokit): Promise<GitHubRepository[]> {
    const allRepos: GitHubRepository[] = [];
    const repoIds = new Set<number>(); // Para evitar duplicatas

    try {
      // 1. Busca organizações do usuário
      const orgs = await octokit.paginate(octokit.orgs.listForAuthenticatedUser, {
        per_page: 100
      });

      if (orgs.length === 0) {
        return [];
      }

      // 2. Para cada organização, busca os repositórios COM PAGINAÇÃO MANUAL
      for (const org of orgs) {
        try {
          let page = 1;
          let hasMore = true;

          while (hasMore) {
            const response = await octokit.repos.listForOrg({
              org: org.login,
              type: 'all',
              sort: 'updated',
              per_page: 100,
              page: page
            });

            const repos = response.data;

            if (repos.length === 0) {
              hasMore = false;
            } else {
              repos.forEach(repo => {
                // Garante que é de uma organização (não pessoal)
                if (!repoIds.has(repo.id) && repo.owner.type === 'Organization') {
                  repoIds.add(repo.id);
                  allRepos.push(repo as GitHubRepository);
                }
              });
              page++;
              // Segurança: máximo de 50 páginas (5000 repos)
              if (page > 50) {
                console.warn(`[fetchOrganizationRepositories] ${org.login}: limite de páginas atingido`);
                hasMore = false;
              }
            }
          }
        } catch (orgError: any) {
          // Se não tiver permissão para listar repos da org, ignora
          console.warn(`[fetchOrganizationRepositories] Não foi possível listar repos de ${org.login}:`, orgError.message);
        }
      }

    } catch (error) {
      console.error('[fetchOrganizationRepositories] Erro:', error);
      throw error;
    }

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
   * Busca PRs abertos relacionados a releases (título contém "Release" ou "Remove Release")
   * Apenas PRs com base branch "develop"
   * @param specificRepos Lista opcional de repositórios no formato "owner/repo". Se não fornecido, busca em todos.
   */
  getOpenReleasePRs(specificRepos?: string[]): Observable<Array<{ repo: string; title: string; url: string; number: number; demandId?: string }>> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    // Se foram fornecidos repositórios específicos, usa eles. Senão, busca todos.
    const reposObservable = specificRepos && specificRepos.length > 0
      ? of(specificRepos.map(repoFullName => ({ full_name: repoFullName })))
      : this.getUserRepositories();

    return reposObservable.pipe(
      switchMap(repos => {
        if (repos.length === 0) {
          return of([]);
        }

        // Busca PRs abertos apenas dos repositórios especificados
        const prOperations = repos.map(repo => {
          const [owner, repoName] = repo.full_name.split('/');
          
          return from(
            octokit.pulls.list({
              owner,
              repo: repoName,
              state: 'open',
              base: 'develop',
              per_page: 100
            })
          ).pipe(
            map(response => {
              // Filtra apenas PRs relacionados a releases
              return response.data
                .filter(pr => {
                  const title = pr.title || '';
                  return title.startsWith('Release ') || title.startsWith('Remove Release ');
                })
                .map(pr => {
                  // Tenta extrair o demandId do título
                  const demandIdMatch = pr.title.match(/Release\s+([A-Z0-9-]+)/i) || 
                                       pr.title.match(/Remove Release\s+([A-Z0-9-]+)/i);
                  
                  return {
                    repo: repo.full_name,
                    title: pr.title,
                    url: pr.html_url,
                    number: pr.number,
                    demandId: demandIdMatch ? demandIdMatch[1] : undefined
                  };
                });
            }),
            catchError(error => {
              // Se não tiver permissão ou erro, retorna array vazio
              console.warn(`Erro ao buscar PRs de ${repo.full_name}:`, error.message);
              return of([]);
            })
          );
        });

        return forkJoin(prOperations).pipe(
          map(results => {
            // Flatten e ordena por repositório
            const allPRs = results.flat();
            return allPRs.sort((a, b) => a.repo.localeCompare(b.repo));
          })
        );
      }),
      catchError(error => {
        console.error('Erro ao buscar PRs de releases:', error);
        return of([]);
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
   * Lista arquivos de release no diretório releases/ de uma branch específica
   */
  listReleasesFromRepo(owner: string, repo: string, branch: string = 'develop'): Observable<{ name: string; path: string; sha: string; branch: string }[]> {
    const octokit = this.getOctokit();
    if (!octokit) {
      console.error(`[listReleasesFromRepo] Sem token para ${owner}/${repo}`);
      return throwError(() => new Error('Nenhum token disponível'));
    }

    return from(
      octokit.repos.getContent({
        owner,
        repo,
        path: 'releases',
        ref: branch
      })
    ).pipe(
      map(response => {
        if (Array.isArray(response.data)) {
          const files = response.data
            .filter((file: any) => file.type === 'file' && file.name.endsWith('.md'))
            .map((file: any) => ({
              name: file.name,
              path: file.path,
              sha: file.sha,
              branch: branch
            }));
          return files;
        }
        return [];
      }),
      catchError(error => {
        console.error(`[listReleasesFromRepo] Erro em ${owner}/${repo} (branch ${branch}):`, error.status, error.message);
        // 404 = pasta releases não existe ou branch não existe
        if (error.status === 404) {
          return of([]);
        }
        return of([]);
      })
    );
  }

  /**
   * Obtém o conteúdo de um arquivo de release de uma branch específica
   */
  getReleaseFileContent(owner: string, repo: string, path: string, branch: string = 'develop'): Observable<string | null> {
    return this.getFileContent(owner, repo, path, branch);
  }

  /**
   * Lista todas as releases de todos os repositórios acessíveis
   * Busca tanto na branch develop (versionadas) quanto na branch feature/upsert-release (não versionadas)
   */
  listAllReleasesFromRepos(): Observable<{ repo: string; releases: { name: string; path: string; sha: string; branch: string }[] }[]> {
    return this.getUserRepositories().pipe(
      switchMap(repos => {
        if (repos.length === 0) {
          return of([]);
        }
        
        const operations = repos.map(repo => {
          const repoInfo = this.parseRepositoryUrl(repo.html_url);
          if (!repoInfo) {
            console.error(`[listAllReleasesFromRepos] Não foi possível parsear URL: ${repo.html_url}`);
            return of({ repo: repo.full_name, releases: [] as { name: string; path: string; sha: string; branch: string }[] });
          }
          
          // Busca releases na branch develop (versionadas)
          const developReleases$ = this.listReleasesFromRepo(repoInfo.owner, repoInfo.repo, 'develop').pipe(
            catchError(() => of([]))
          );
          
          // Busca releases na branch feature/upsert-release (não versionadas)
          const upsertReleases$ = this.listReleasesFromRepo(repoInfo.owner, repoInfo.repo, 'feature/upsert-release').pipe(
            catchError(() => of([]))
          );
          
          return forkJoin([developReleases$, upsertReleases$]).pipe(
            map(([developReleases, upsertReleases]) => {
              // Combina releases de ambas as branches
              const allReleases = [...developReleases, ...upsertReleases];
              return { repo: repo.full_name, releases: allReleases };
            }),
            catchError(err => {
              console.error(`[listAllReleasesFromRepos] Erro em ${repo.full_name}:`, err);
              return of({ repo: repo.full_name, releases: [] as { name: string; path: string; sha: string; branch: string }[] });
            })
          );
        });
        
        return forkJoin(operations);
      }),
      map(results => {
        return results.filter(r => r.releases.length > 0);
      })
    );
  }

  /**
   * Busca informações do último commit de um arquivo em uma branch específica
   * Retorna o autor do commit (login do GitHub)
   */
  getFileLastCommit(owner: string, repo: string, path: string, branch: string = 'develop'): Observable<{ author: string; date: Date } | null> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    return from(
      octokit.repos.listCommits({
        owner,
        repo,
        path,
        sha: branch,
        per_page: 1
      })
    ).pipe(
      map((response: any) => {
        if (response.data.length === 0) {
          return null;
        }
        const commit = response.data[0];
        const author = commit.author?.login || commit.commit?.author?.name || null;
        const date = commit.commit?.author?.date ? new Date(commit.commit.author.date) : new Date();
        
        if (!author) {
          return null;
        }
        
        return { author, date };
      }),
      catchError((error: any) => {
        if (error.status === 404) {
          return of(null);
        }
        console.error('Erro ao buscar commit do arquivo:', error);
        return of(null);
      })
    );
  }

  /**
   * Busca informações do primeiro commit de um arquivo em uma branch específica
   * Retorna o autor do commit (login do GitHub)
   * Nota: A API do GitHub retorna commits do mais recente para o mais antigo.
   * Busca até 10 páginas para encontrar o commit mais antigo.
   */
  getFileFirstCommit(owner: string, repo: string, path: string, branch: string = 'develop'): Observable<{ author: string; date: Date } | null> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    // Busca commits paginados até encontrar todos (ou até 10 páginas)
    const fetchAllCommits = async (page: number = 1, allCommits: any[] = []): Promise<any[]> => {
      try {
        const response = await octokit.repos.listCommits({
          owner,
          repo,
          path,
          sha: branch,
          per_page: 100,
          page
        });

        if (response.data.length === 0) {
          return allCommits;
        }

        allCommits = [...allCommits, ...response.data];

        // Se retornou menos de 100, chegou ao fim
        if (response.data.length < 100 || page >= 10) {
          return allCommits;
        }

        // Continua buscando na próxima página
        return fetchAllCommits(page + 1, allCommits);
      } catch (error) {
        const err = error as { status?: number };
        if (err.status === 404) {
          return allCommits;
        }
        throw error;
      }
    };

    return from(fetchAllCommits()).pipe(
      map((commits: any[]) => {
        if (commits.length === 0) {
          return null;
        }
        // Pega o último commit da lista (que é o primeiro commit do arquivo, mais antigo)
        const commit = commits[commits.length - 1];
        const author = commit.author?.login || commit.commit?.author?.name || null;
        const date = commit.commit?.author?.date ? new Date(commit.commit.author.date) : new Date();
        
        if (!author) {
          return null;
        }
        
        return { author, date };
      }),
      catchError((error: any) => {
        if (error.status === 404) {
          return of(null);
        }
        console.error('Erro ao buscar primeiro commit do arquivo:', error);
        return of(null);
      })
    );
  }

  /**
   * Lista commits de uma branch específica
   * Filtra apenas commits que começam com "docs:"
   */
  listBranchCommits(owner: string, repo: string, branch: string, perPage: number = 30): Observable<Array<{ sha: string; message: string; author: string; date: Date; url: string }>> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    return from(
      octokit.repos.listCommits({
        owner,
        repo,
        sha: branch,
        per_page: perPage
      })
    ).pipe(
      map((response: any) => {
        return response.data
          .map((commit: any) => ({
            sha: commit.sha.substring(0, 7),
            message: commit.commit.message.split('\n')[0], // Primeira linha da mensagem
            author: commit.author?.login || commit.commit?.author?.name || 'Unknown',
            date: new Date(commit.commit.author.date),
            url: commit.html_url
          }))
          .filter((commit: { message: string }) => commit.message.toLowerCase().startsWith('docs:'));
      }),
      catchError((error: any) => {
        if (error.status === 404) {
          return of([]); // Branch não existe
        }
        console.error('Erro ao listar commits da branch:', error);
        return of([]);
      })
    );
  }

  /**
   * Conta commits com "docs:" em uma branch específica
   */
  countDocsCommits(owner: string, repo: string, branch: string): Observable<number> {
    return this.listBranchCommits(owner, repo, branch, 100).pipe(
      map(commits => commits.length)
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

