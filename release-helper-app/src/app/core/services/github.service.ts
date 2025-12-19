import { Injectable } from '@angular/core';
import { Observable, from, throwError, of, forkJoin, timer } from 'rxjs';
import { map, catchError, switchMap, tap } from 'rxjs/operators';
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
   * Inicializa Octokit com token de serviço do localStorage
   */
  private initializeFromServiceToken(): void {
    const serviceToken = localStorage.getItem('service_token');
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
    return !this.authService.isAuthenticated() && !!localStorage.getItem('service_token');
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

    // Função auxiliar para tentar criar/atualizar com retry em caso de erro 409
    const tryCreateOrUpdate = (retryCount: number = 0): Observable<void> => {
      // Primeiro, obtém o SHA do arquivo se existir
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
          // Erro 409 = SHA não corresponde (arquivo foi modificado)
          // Tenta novamente até 2 vezes, buscando o SHA atualizado
          if (error.status === 409 && retryCount < 2) {
            console.warn(`[createOrUpdateFile] SHA conflito (409) ao atualizar ${path}, tentando novamente (tentativa ${retryCount + 1}/2)...`);
            // Espera um pouco antes de tentar novamente (500ms * número de tentativa)
            // Isso ajuda quando múltiplos arquivos estão sendo atualizados simultaneamente
            return timer((retryCount + 1) * 500).pipe(
              switchMap(() => tryCreateOrUpdate(retryCount + 1))
            );
          }
          console.error('Erro ao criar/atualizar arquivo:', error);
          return throwError(() => error);
        })
      );
    };

    return tryCreateOrUpdate();
  }

  /**
   * Cria um único commit com múltiplos arquivos
   * Útil para versionar release + scripts em um único commit
   */
  createSingleCommitWithMultipleFiles(
    owner: string,
    repo: string,
    branch: string,
    message: string,
    files: Array<{ path: string; content: string; mode?: '100644' | '100755' | '040000' | '160000' | '120000' }>
  ): Observable<void> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    // 1. Obtém o SHA atual da branch
    return from(
      octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`
      })
    ).pipe(
      switchMap((refResponse: any) => {
        const commitSha = refResponse.data.object.sha;

        // 2. Obtém o commit para pegar o SHA da árvore
        return from(
          octokit.git.getCommit({
            owner,
            repo,
            commit_sha: commitSha
          })
        ).pipe(
          switchMap((commitResponse: any) => {
            const baseTreeSha = commitResponse.data.tree.sha;

                // 3. Cria blobs para cada arquivo
                const fileOperations = files.map(file => {
                  const contentBase64 = this.encodeBase64UTF8(file.content);
                  return from(
                    octokit.git.createBlob({
                      owner,
                      repo,
                      content: contentBase64,
                      encoding: 'base64'
                    })
                  ).pipe(
                    map((blobResponse: any) => ({
                      path: file.path,
                      mode: (file.mode || '100644') as '100644' | '100755' | '040000' | '160000' | '120000',
                      type: 'blob' as const,
                      sha: blobResponse.data.sha
                    }))
                  );
                });

            return forkJoin(fileOperations).pipe(
              switchMap((treeEntries) => {
                // 4. Cria a nova árvore usando base_tree (a API faz merge automaticamente)
                // Passamos apenas as entradas que queremos adicionar/atualizar
                return from(
                  octokit.git.createTree({
                    owner,
                    repo,
                    base_tree: baseTreeSha,
                    tree: treeEntries
                  })
                ).pipe(
                  switchMap((treeResult: any) => {
                    const newTreeSha = treeResult.data.sha;

                    // 5. Cria o commit
                    return from(
                      octokit.git.createCommit({
                        owner,
                        repo,
                        message,
                        tree: newTreeSha,
                        parents: [commitSha]
                      })
                    ).pipe(
                      switchMap((commitResult: any) => {
                        const newCommitSha = commitResult.data.sha;

                        // 6. Obtém o SHA atual da branch novamente antes de atualizar (para evitar race conditions)
                        return from(
                          octokit.git.getRef({
                            owner,
                            repo,
                            ref: `heads/${branch}`
                          })
                        ).pipe(
                          switchMap((currentRef: any) => {
                            const currentSha = currentRef.data.object.sha;
                            
                            // Se o SHA mudou desde que obtivemos inicialmente, o commit que criamos não é válido
                            // Precisa criar um novo commit baseado no SHA atual
                            if (currentSha !== commitSha) {
                              console.warn(`[createSingleCommitWithMultipleFiles] Branch ${branch} foi atualizada durante a operação, recriando commit...`);
                              // Retorna erro para que o método seja chamado novamente pelo caller
                              return throwError(() => new Error('Branch foi atualizada durante a operação. Tente novamente.'));
                            }
                            
                            // Atualiza a referência normalmente
                            return from(
                              octokit.git.updateRef({
                                owner,
                                repo,
                                ref: `heads/${branch}`,
                                sha: newCommitSha,
                                force: false
                              })
                            );
                          })
                        );
                      })
                    );
                  })
                );
              })
            );
          })
        );
      }),
      map(() => void 0),
      catchError((error: any) => {
        console.error('Erro ao criar commit com múltiplos arquivos:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Obtém a branch padrão do repositório
   */
  getDefaultBranch(owner: string, repo: string): Observable<string> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    return from(
      octokit.repos.get({
        owner,
        repo
      })
    ).pipe(
      map(response => response.data.default_branch),
      catchError((error: any) => {
        console.error('Erro ao obter branch padrão:', error);
        // Fallback para 'main' se não conseguir obter
        return of('main');
      })
    );
  }

  /**
   * Encontra uma branch base válida, tentando develop, main, master ou a branch padrão
   */
  findValidBaseBranch(owner: string, repo: string, preferredBranch: string = 'develop'): Observable<string> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    // Lista de branches para tentar, na ordem de preferência
    const branchesToTry = [preferredBranch, 'main', 'master'];
    
    // Função recursiva para tentar cada branch
    const tryBranch = (index: number): Observable<string> => {
      if (index >= branchesToTry.length) {
        // Se nenhuma branch comum funcionou, tenta obter a branch padrão do repositório
        return this.getDefaultBranch(owner, repo).pipe(
          switchMap(defaultBranch => {
            if (branchesToTry.includes(defaultBranch)) {
              // Já tentamos essa, retorna erro
              return throwError(() => new Error(`Nenhuma branch base válida encontrada. Tentei: ${branchesToTry.join(', ')}, ${defaultBranch}`));
            }
            return from(
              octokit.git.getRef({
                owner,
                repo,
                ref: `heads/${defaultBranch}`
              })
            ).pipe(
              map(() => defaultBranch),
              catchError(() => throwError(() => new Error(`Nenhuma branch base válida encontrada. Tentei: ${branchesToTry.join(', ')}, ${defaultBranch}`)))
            );
          })
        );
      }

      const branch = branchesToTry[index];
      return from(
        octokit.git.getRef({
          owner,
          repo,
          ref: `heads/${branch}`
        })
      ).pipe(
        map(() => branch),
        catchError((error: any) => {
          if (error.status === 404) {
            // Branch não existe, tenta a próxima
            return tryBranch(index + 1);
          }
          // Outro erro, propaga
          return throwError(() => error);
        })
      );
    };

    return tryBranch(0);
  }

  /**
   * Verifica se uma branch existe
   */
  branchExists(owner: string, repo: string, branchName: string): Observable<boolean> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    return from(
      octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${branchName}`
      })
    ).pipe(
      map(() => true),
      catchError((error: any) => {
        if (error.status === 404) {
          return of(false);
        }
        // Outro erro, assume que não existe
        return of(false);
      })
    );
  }

  /**
   * Cria uma branch a partir de uma branch base
   * Se a branch base não existir, tenta encontrar uma válida automaticamente
   * Se a branch já existir, retorna sucesso sem criar
   */
  createBranch(owner: string, repo: string, branchName: string, baseBranch: string = 'develop'): Observable<{ created: boolean; actualBaseBranch: string }> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    // Primeiro, encontra a branch base válida (faz isso uma vez só)
    return this.findValidBaseBranch(owner, repo, baseBranch).pipe(
      switchMap((actualBaseBranch: string) => {
        // Verifica se a branch já existe
        return this.branchExists(owner, repo, branchName).pipe(
          switchMap((exists: boolean) => {
            if (exists) {
              // Branch já existe, retorna imediatamente
              return of({ created: false, actualBaseBranch });
            }

            // Branch não existe, tenta criar
            // Obtém a referência da branch base encontrada
            return from(
              octokit.git.getRef({
                owner,
                repo,
                ref: `heads/${actualBaseBranch}`
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
                ).pipe(
                  map(() => ({ created: true, actualBaseBranch })),
                  catchError((error: any) => {
                    // Se a branch já existe (pode ter sido criada entre a verificação e a criação), não é um erro
                    if (error.status === 422) {
                      return of({ created: false, actualBaseBranch });
                    }
                    console.error('Erro ao criar branch:', error);
                    return throwError(() => error);
                  })
                );
              })
            );
          })
        );
      }),
      catchError((error: any) => {
        // Se não conseguiu encontrar branch base válida, retorna erro mais claro
        if (error.message?.includes('Nenhuma branch base válida encontrada')) {
          return throwError(() => ({
            status: 404,
            message: `Não foi possível encontrar uma branch base válida no repositório ${owner}/${repo}. Verifique se o repositório tem pelo menos uma das branches: develop, main, master ou a branch padrão configurada.`,
            originalError: error
          }));
        }
        return throwError(() => error);
      })
    );
  }

  /**
   * Deleta uma branch
   */
  deleteBranch(owner: string, repo: string, branchName: string): Observable<void> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    return from(
      octokit.git.deleteRef({
        owner,
        repo,
        ref: `heads/${branchName}`
      })
    ).pipe(
      map(() => void 0),
      catchError((error: any) => {
        // Se a branch não existe, não é um erro
        if (error.status === 404 || error.status === 422) {
          return of(void 0);
        }
        console.error('Erro ao deletar branch:', error);
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

    // Validações básicas
    if (!params.title || params.title.trim().length === 0) {
      return throwError(() => new Error('O título do PR não pode estar vazio'));
    }

    if (!params.body || params.body.trim().length === 0) {
      return throwError(() => new Error('O corpo do PR não pode estar vazio'));
    }

    // Verifica se já existe um PR entre essas branches
    return this.getExistingPR(params.owner, params.repo, params.head, params.base).pipe(
      switchMap(existingPR => {
        if (existingPR) {
          return throwError(() => ({
            status: 422,
            message: `Já existe um PR aberto (#${existingPR.number}) entre ${params.head} e ${params.base}`,
            existingPR
          }));
        }

        // Verifica se há diferenças entre as branches
        return this.hasBranchDifferences(params.owner, params.repo, params.head, params.base).pipe(
          switchMap(hasDifferences => {
            if (!hasDifferences) {
              return throwError(() => ({
                status: 422,
                message: `Não há diferenças entre a branch ${params.head} e ${params.base}. Não é possível criar um PR sem commits.`
              }));
            }

            // Cria o PR
            return from(
              octokit.pulls.create({
                owner: params.owner,
                repo: params.repo,
                title: params.title.trim(),
                body: params.body.trim(),
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
                
                // Melhora a mensagem de erro para 422
                if (error.status === 422) {
                  const errorMessage = error.response?.data?.message || error.message || 'Erro ao criar PR';
                  let userMessage = errorMessage;
                  
                  if (errorMessage.includes('No commits between')) {
                    userMessage = `Não há commits entre ${params.head} e ${params.base}. A branch precisa ter commits diferentes da base.`;
                  } else if (errorMessage.includes('A pull request already exists')) {
                    userMessage = `Já existe um PR aberto entre ${params.head} e ${params.base}`;
                  }
                  
                  return throwError(() => ({
                    ...error,
                    status: 422,
                    message: userMessage
                  }));
                }
                
                return throwError(() => error);
              })
            );
          })
        );
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
   * IMPORTANTE: Sempre busca do HEAD da branch especificada (conteúdo mais recente)
   * Usa 'ref: branch' para garantir que busca do HEAD da branch, não de um commit específico
   */
  getReleaseFileContent(owner: string, repo: string, path: string, branch: string = 'develop'): Observable<string | null> {
    console.log(`[GitHubService] 🔍 Buscando conteúdo mais recente de ${path} na branch ${branch} do repositório ${owner}/${repo}`);
    // Busca do HEAD da branch (sempre o conteúdo mais recente)
    return this.getFileContent(owner, repo, path, branch).pipe(
      tap(content => {
        if (content) {
          console.log(`[GitHubService] ✅ Conteúdo encontrado na branch ${branch}: ${content.length} caracteres`);
          // Log das primeiras linhas para debug
          const firstLines = content.split('\n').slice(0, 5).join('\n');
          console.log(`[GitHubService] 📄 Primeiras 5 linhas do conteúdo do GitHub:\n${firstLines}`);
          
          // Log: Verifica se tem scripts e secrets no markdown
          const hasScriptsSection = content.includes('## 4.') && content.includes('Scripts');
          const hasSecretsSection = content.includes('## 3.') && content.includes('Keys') || content.includes('Secrets');
          const scriptsMatches = content.match(/\|\s*([^|]+\.sql)/gi);
          const secretsMatches = content.match(/\|\s*QAS\s*\||\|\s*PRD\s*\||\|\s*DEV\s*\|/gi);
          
          console.log(`[GitHubService] 📊 Análise do markdown:`, {
            temScriptsSection: hasScriptsSection,
            temSecretsSection: hasSecretsSection,
            matchesScripts: scriptsMatches?.length || 0,
            matchesSecrets: secretsMatches?.length || 0,
            totalLinhas: content.split('\n').length
          });
        } else {
          console.warn(`[GitHubService] ⚠️ Conteúdo vazio para ${path} na branch ${branch}`);
        }
      }),
      catchError(error => {
        console.error(`[GitHubService] ❌ Erro ao buscar conteúdo de ${path} na branch ${branch}:`, {
          status: error.status,
          message: error.message,
          url: error.request?.url || 'N/A'
        });
        return throwError(() => error);
      })
    );
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
              // Cria um mapa para priorizar releases da feature/upsert-release
              // Quando uma release existe em ambas as branches, prioriza a versão da feature/upsert-release
              const releaseMap = new Map<string, { name: string; path: string; sha: string; branch: string }>();
              
              // Primeiro adiciona releases da develop
              developReleases.forEach(release => {
                releaseMap.set(release.name, release);
              });
              
              // Depois sobrescreve com releases da feature/upsert-release (prioridade)
              // Isso garante que se uma release existe em ambas as branches, 
              // a versão da feature/upsert-release será mantida (versão mais recente em edição)
              upsertReleases.forEach(release => {
                releaseMap.set(release.name, release);
              });
              
              // Converte o mapa de volta para array
              const allReleases = Array.from(releaseMap.values());
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
   * Lista commits docs: de uma branch que NÃO existem na develop
   * Retorna apenas commits que estão na branch mas não na develop
   */
  listCommitsNotInDevelop(owner: string, repo: string, branch: string, perPage: number = 100): Observable<Array<{ sha: string; message: string; author: string; date: Date; url: string }>> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    // Busca commits docs: de ambas as branches com SHA completo
    const branchCommits$ = from(
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
            sha: commit.sha, // SHA completo
            shaShort: commit.sha.substring(0, 7), // SHA curto para exibição
            message: commit.commit.message.split('\n')[0],
            author: commit.author?.login || commit.commit?.author?.name || 'Unknown',
            date: new Date(commit.commit.author.date),
            url: commit.html_url
          }))
          .filter((commit: { message: string }) => commit.message.toLowerCase().startsWith('docs:'));
      }),
      catchError((error: any) => {
        if (error.status === 404) {
          return of([]);
        }
        console.error('Erro ao listar commits da branch:', error);
        return of([]);
      })
    );

    const developCommits$ = from(
      octokit.repos.listCommits({
        owner,
        repo,
        sha: 'develop',
        per_page: perPage
      })
    ).pipe(
      map((response: any) => {
        // Filtra apenas commits docs: e retorna apenas os SHAs completos
        return response.data
          .filter((commit: any) => {
            const message = commit.commit.message.split('\n')[0];
            return message.toLowerCase().startsWith('docs:');
          })
          .map((commit: any) => commit.sha); // Apenas SHA completo para comparação
      }),
      catchError((error: any) => {
        if (error.status === 404) {
          return of([]);
        }
        console.error('Erro ao listar commits da develop:', error);
        return of([]);
      })
    );

    return forkJoin([branchCommits$, developCommits$]).pipe(
      map(([branchCommits, developShas]) => {
        // Cria um Set com os SHAs completos dos commits da develop para busca rápida
        const developShasSet = new Set(developShas);
        
        // Filtra apenas commits da branch que não estão na develop
        return branchCommits
          .filter((commit: { sha: string; shaShort: string; message: string; author: string; date: Date; url: string }) => !developShasSet.has(commit.sha))
          .map((commit: { sha: string; shaShort: string; message: string; author: string; date: Date; url: string }) => ({
            sha: commit.shaShort, // Retorna SHA curto para exibição
            message: commit.message,
            author: commit.author,
            date: commit.date,
            url: commit.url
          }));
      }),
      catchError((error: any) => {
        console.error('Erro ao comparar commits entre branches:', error);
        return of([]);
      })
    );
  }

  /**
   * Conta commits docs: de uma branch que NÃO existem na develop
   */
  countCommitsNotInDevelop(owner: string, repo: string, branch: string): Observable<number> {
    return this.listCommitsNotInDevelop(owner, repo, branch, 100).pipe(
      map(commits => commits.length)
    );
  }

  /**
   * Verifica se há diferenças entre duas branches (se a head tem commits que não estão na base)
   */
  hasBranchDifferences(owner: string, repo: string, head: string, base: string): Observable<boolean> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    return from(
      octokit.repos.compareCommits({
        owner,
        repo,
        base,
        head
      })
    ).pipe(
      map(response => {
        // Se há commits à frente (ahead > 0), há diferenças
        return response.data.ahead_by > 0;
      }),
      catchError((error: any) => {
        // Se a branch não existe ou há outro erro, retorna false
        if (error.status === 404) {
          return of(false);
        }
        console.error('Erro ao comparar branches:', error);
        return of(false);
      })
    );
  }

  /**
   * Verifica se já existe um PR aberto entre as branches especificadas
   */
  getExistingPR(owner: string, repo: string, head: string, base: string): Observable<{ number: number; html_url: string } | null> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    return from(
      octokit.pulls.list({
        owner,
        repo,
        state: 'open',
        head: `${owner}:${head}`,
        base
      })
    ).pipe(
      map(response => {
        const prs = response.data;
        if (prs.length > 0) {
          return {
            number: prs[0].number,
            html_url: prs[0].html_url
          };
        }
        return null;
      }),
      catchError((error: any) => {
        console.error('Erro ao verificar PRs existentes:', error);
        return of(null);
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

  /**
   * Desfaz o último commit relacionado à release (undo commit)
   * Se houver apenas 1 commit pendente e o estado for igual à develop, deleta a branch
   * Caso contrário, apenas desfaz o último commit
   */
  undoLastCommit(owner: string, repo: string, path: string, branch: string = 'feature/upsert-release', demandId: string): Observable<void> {
    const octokit = this.getOctokit();
    if (!octokit) {
      return throwError(() => new Error('Nenhum token disponível'));
    }

    // 1. Verifica quantos commits pendentes existem relacionados à release (que não estão na develop)
    // Busca commits da branch e filtra apenas os relacionados à release
    return from(
      octokit.repos.listCommits({
        owner,
        repo,
        sha: branch,
        per_page: 100
      })
    ).pipe(
      map((response: any) => {
        // Filtra apenas commits docs: relacionados à release
        const demandIdLower = demandId.toLowerCase();
        return response.data.filter((commit: any) => {
          const message = commit.commit.message.split('\n')[0].toLowerCase();
          const isDocsCommit = message.startsWith('docs:');
          const mentionsDemandId = message.includes(demandIdLower);
          // Verifica se menciona atualiza/cria release com o demandId
          const isReleaseCommit = mentionsDemandId && (
            message.includes('atualiza release') || 
            message.includes('cria release') ||
            message.includes('update release') ||
            message.includes('create release')
          );
          return isDocsCommit && isReleaseCommit;
        });
      }),
      switchMap((releaseCommits: any[]) => {
        // 2. Verifica quais desses commits não estão na develop
        const developCommits$ = from(
          octokit.repos.listCommits({
            owner,
            repo,
            sha: 'develop',
            per_page: 100
          })
        ).pipe(
          map((response: any) => {
            return response.data
              .filter((commit: any) => {
                const message = commit.commit.message.split('\n')[0].toLowerCase();
                return message.startsWith('docs:');
              })
              .map((commit: any) => commit.sha);
          }),
          catchError(() => of([]))
        );

        return developCommits$.pipe(
          switchMap((developShas) => {
            const developShasSet = new Set(developShas);
            // Filtra commits da release que não estão na develop
            const pendingReleaseCommits = releaseCommits.filter(commit => 
              !developShasSet.has(commit.sha)
            );

            // 3. Verifica o conteúdo atual do arquivo na branch e na develop
            const currentContent$ = this.getFileContent(owner, repo, path, branch);
            const developContent$ = this.getFileContent(owner, repo, path, 'develop');

            return forkJoin([currentContent$, developContent$]).pipe(
              switchMap(([currentContent, developContent]) => {
                // 4. Se há apenas 1 commit pendente relacionado à release E o conteúdo atual é igual ao da develop, deleta a branch
                const hasOnlyOneCommit = pendingReleaseCommits.length === 1;
                const isEqualToDevelop = currentContent === developContent;

                if (hasOnlyOneCommit && isEqualToDevelop) {
                  // Deleta a branch inteira pois não há mais nada para versionar
                  return this.deleteBranch(owner, repo, branch);
                }

                // 5. Caso contrário, apenas desfaz o último commit
                if (releaseCommits.length === 0) {
                  // Não há commits relacionados à release, nada a fazer
                  return of(void 0);
                }

                // O primeiro commit é o mais recente - este é o commit que queremos desfazer
                const lastCommit = releaseCommits[0];
                const lastCommitSha = lastCommit.sha;

                // Busca o commit anterior (pai do último commit)
                let previousCommitSha: string | null = null;
                if (lastCommit.parents && lastCommit.parents.length > 0) {
                  previousCommitSha = lastCommit.parents[0].sha;
                }

                // Busca o conteúdo do arquivo no commit anterior (ou develop se não houver parent)
                const contentSource$ = previousCommitSha 
                  ? this.getFileContent(owner, repo, path, previousCommitSha)
                  : this.getFileContent(owner, repo, path, 'develop');

                return contentSource$.pipe(
                  switchMap((previousContent: string | null) => {
                    return this.getFileSha(owner, repo, path, branch).pipe(
                      switchMap((currentSha: string | null) => {
                        // Se não há conteúdo anterior e não há arquivo atual, nada a fazer
                        if (!previousContent && !currentSha) {
                          return of(void 0);
                        }

                        // Se não há conteúdo anterior mas há arquivo atual, remove o arquivo
                        if (!previousContent && currentSha) {
                          return from(
                            octokit.repos.deleteFile({
                              owner,
                              repo,
                              path,
                              message: `docs: desfaz última edição de release ${demandId}`,
                              sha: currentSha,
                              branch
                            })
                          ).pipe(
                            map(() => void 0),
                            catchError(error => {
                              console.error('Erro ao remover arquivo:', error);
                              return throwError(() => error);
                            })
                          );
                        }

                        // Restaura para o estado do commit anterior
                        const fileContent = this.encodeBase64UTF8(previousContent!);
                        const message = `docs: desfaz última edição de release ${demandId}`;

                        return from(
                          octokit.repos.createOrUpdateFileContents({
                            owner,
                            repo,
                            path,
                            message,
                            content: fileContent,
                            branch,
                            ...(currentSha ? { sha: currentSha } : {})
                          })
                        ).pipe(
                          map(() => void 0),
                          catchError(error => {
                            console.error('Erro ao desfazer commit:', error);
                            return throwError(() => error);
                          })
                        );
                      })
                    );
                  }),
                  catchError(error => {
                    // Se não conseguiu buscar do commit anterior, tenta da develop
                    console.warn('Erro ao buscar commit anterior, tentando develop:', error);
                    return this.getFileContent(owner, repo, path, 'develop').pipe(
                      switchMap((developContent: string | null) => {
                        return this.getFileSha(owner, repo, path, branch).pipe(
                          switchMap((currentSha: string | null) => {
                            if (!developContent || !currentSha) {
                              return of(void 0);
                            }

                            const fileContent = this.encodeBase64UTF8(developContent);
                            const message = `docs: desfaz última edição de release ${demandId}`;

                            return from(
                              octokit.repos.createOrUpdateFileContents({
                                owner,
                                repo,
                                path,
                                message,
                                content: fileContent,
                                branch,
                                sha: currentSha
                              })
                            ).pipe(
                              map(() => void 0),
                              catchError(err => {
                                console.error('Erro ao desfazer commit:', err);
                                return throwError(() => err);
                              })
                            );
                          })
                        );
                      })
                    );
                  })
                );
              })
            );
          })
        );
      }),
      catchError(error => {
        console.error('Erro ao desfazer commit:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Reverte commits pendentes de um arquivo, restaurando-o para o estado da develop
   * Isso efetivamente "desfaz" as alterações pendentes na branch feature/upsert-release
   * @deprecated Use undoLastCommit para desfazer a última edição
   */
  revertPendingCommits(owner: string, repo: string, path: string, branch: string = 'feature/upsert-release', demandId: string): Observable<void> {
    // Redireciona para undoLastCommit para manter compatibilidade
    return this.undoLastCommit(owner, repo, path, branch, demandId);
  }
}

