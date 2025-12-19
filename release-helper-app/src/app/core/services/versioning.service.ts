import { Injectable } from '@angular/core';
import { Observable, forkJoin, throwError, of, timer } from 'rxjs';
import { switchMap, map, catchError } from 'rxjs/operators';
import { Release } from '../../models';
import { GitHubService } from './github.service';
import { ReleaseService } from './release.service';

export interface PRInfo {
  repo: string;
  url: string;
  number: number;
}

export interface VersioningResult {
  success: boolean;
  prs: PRInfo[];
  errors?: string[];
}

/**
 * Serviço para versionar releases nos repositórios GitHub
 * Suporta:
 * - Token do usuário (dev logado com GitHub OAuth)
 * - Token de serviço (funcional com token compartilhado na sessão)
 */
@Injectable({
  providedIn: 'root'
})
export class VersioningService {
  constructor(
    private githubService: GitHubService,
    private releaseService: ReleaseService
  ) {}

  /**
   * Obtém lista de PRs abertos relacionados a releases
   */
  getOpenPRs(): Observable<Array<{ repo: string; title: string; url: string; number: number; demandId?: string }>> {
    return this.githubService.getOpenReleasePRs();
  }

  /**
   * Versiona uma release nos repositórios selecionados
   * Cria branch, arquivos e Pull Request
   */
  versionRelease(
    release: Release,
    selectedRepos: string[]
  ): Observable<VersioningResult> {
    if (!this.githubService.hasValidToken()) {
      return throwError(() => new Error('Nenhum token disponível. Faça login ou peça um token para um desenvolvedor.'));
    }

    if (selectedRepos.length === 0) {
      return throwError(() => new Error('Nenhum repositório selecionado'));
    }

    const results: VersioningResult = {
      success: true,
      prs: [],
      errors: []
    };

    // Processa cada repositório
    const operations = selectedRepos.map(repoUrl => {
      const repoInfo = this.githubService.parseRepositoryUrl(repoUrl);
      if (!repoInfo) {
        results.errors?.push(`URL inválida: ${repoUrl}`);
        return of({ repo: repoUrl, success: false });
      }

      const { owner, repo } = repoInfo;
      const branchName = `feature/upsert-release`;
      const baseBranch = 'develop'; // Sempre develop, nunca main

      // 1. Garante que a branch feature/upsert-release existe (já deve ter commits da criação/edição)
      return this.githubService.createBranch(owner, repo, branchName, baseBranch).pipe(
        catchError(err => {
          if (err.status === 422) return of(void 0); // Branch já existe, continua
          results.errors?.push(`Erro ao criar branch em ${repo}: ${err.message}`);
          return of(void 0);
        }),
        // 2. Cria um único commit com o documento e todos os scripts
        switchMap(() => {
          const markdown = this.releaseService.generateMarkdown(release);
          const demandId = release.demandId.trim();
          const filePath = `releases/release_${demandId}.md`;
          const message = `docs: versiona release ${demandId}`;

          // Prepara lista de arquivos para o commit único
          const filesToCommit: Array<{ path: string; content: string }> = [
            { path: filePath, content: markdown }
          ];

          // Adiciona scripts se houver
          const scriptsWithContent = release.scripts.filter(script => script.content);
          const scriptsWithoutContent = release.scripts.filter(script => !script.content);
          
          if (scriptsWithoutContent.length > 0) {
            console.warn(`[versionRelease] ${scriptsWithoutContent.length} script(s) sem conteúdo serão ignorados:`, 
              scriptsWithoutContent.map(s => s.name).join(', '));
          }
          
          // Verifica quais scripts realmente precisam ser atualizados (não existem ou foram alterados)
          const scriptCheckOperations = scriptsWithContent.map(script => {
            const scriptName = script.name.trim();
            const scriptPath = `scripts/${demandId}/${scriptName}`;
            return this.githubService.getFileContent(owner, repo, scriptPath, baseBranch).pipe(
              map((existingContent: string | null) => {
                // Se o arquivo não existe ou o conteúdo é diferente, precisa ser adicionado/atualizado
                if (!existingContent || existingContent !== script.content) {
                  return { script, scriptPath, needsUpdate: true };
                }
                // Arquivo existe e conteúdo é igual, não precisa atualizar
                return { script, scriptPath, needsUpdate: false };
              }),
              catchError(() => {
                // Erro ao buscar (provavelmente não existe), precisa criar
                return of({ script, scriptPath, needsUpdate: true });
              })
            );
          });

          return forkJoin(scriptCheckOperations).pipe(
            switchMap((scriptChecks) => {
              // Adiciona apenas scripts que precisam ser atualizados
              scriptChecks.forEach(check => {
                if (check.needsUpdate) {
                  filesToCommit.push({ path: check.scriptPath, content: check.script.content! });
                }
              });

              // Cria um único commit com todos os arquivos (com retry para lidar com race conditions)
              const tryCreateCommit = (retryCount: number = 0): Observable<void> => {
                return this.githubService.createSingleCommitWithMultipleFiles(
                  owner,
                  repo,
                  branchName,
                  message,
                  filesToCommit
                ).pipe(
                  catchError((err: any) => {
                    // Se a branch foi atualizada durante a operação, tenta novamente (até 2 vezes)
                    if ((err.message?.includes('atualizada durante a operação') || err.status === 422) && retryCount < 2) {
                      console.warn(`[versionRelease] Tentando novamente criar commit (tentativa ${retryCount + 1}/2)...`);
                      return timer(1000 * (retryCount + 1)).pipe(
                        switchMap(() => tryCreateCommit(retryCount + 1))
                      );
                    }
                    results.errors?.push(`Erro ao criar commit em ${repo}: ${err.message || err}`);
                    return of(void 0);
                  })
                );
              };
              
              return tryCreateCommit();
            })
          );
        }),
        // 4. Cria o Pull Request da branch feature/upsert-release
        switchMap(() => {
          const demandId = release.demandId.trim();
          const prTitle = `Release ${demandId}: ${release.title || release.description}`;
          const prBody = this.generatePRBody(release);

          return this.githubService.createPullRequest({
            owner, repo, title: prTitle, body: prBody, head: branchName, base: baseBranch
          }).pipe(
            map(pr => {
              results.prs.push({ repo: `${owner}/${repo}`, url: pr.html_url, number: pr.number });
              return { repo, pr, success: true };
            }),
            catchError(err => {
              if (err.status === 422) {
                results.errors?.push(`PR já existe para ${repo} - verifique manualmente`);
                return of({ repo, pr: null, success: true });
              }
              results.errors?.push(`Erro ao criar PR em ${repo}: ${err.message}`);
              return of({ repo, pr: null, success: false });
            })
          );
        }),
        catchError(() => of({ repo, pr: null, success: false }))
      );
    });

    return forkJoin(operations).pipe(
      map(() => {
        if (results.errors && results.errors.length > selectedRepos.length / 2) {
          results.success = false;
        }
        // Se o versionamento foi bem-sucedido (pelo menos um PR criado), marca como versionada
        if (results.success && results.prs && results.prs.length > 0) {
          // Atualiza a release no localStorage marcando como versionada
          this.releaseService.update(release.id, { isVersioned: true }).subscribe({
            error: (err) => console.error('Erro ao atualizar status de versionamento:', err)
          });
        }
        return results;
      }),
      catchError(() => {
        results.success = false;
        return of(results);
      })
    );
  }

  /**
   * Remove uma release dos repositórios GitHub
   * Cria PRs removendo os arquivos de release e scripts relacionados
   */
  deleteReleaseFromGitHub(release: Release): Observable<VersioningResult> {
    if (!this.githubService.hasValidToken()) {
      return throwError(() => new Error('Nenhum token disponível. Faça login ou peça um token para um desenvolvedor.'));
    }

    if (!release.repositories || release.repositories.length === 0) {
      // Release não está versionada, pode deletar apenas local
      return of({ success: true, prs: [], errors: [] });
    }

    const results: VersioningResult = {
      success: true,
      prs: [],
      errors: []
    };

    // Processa cada repositório onde a release pode estar
    const operations = release.repositories.map(repo => {
      const repoInfo = this.githubService.parseRepositoryUrl(repo.url);
      if (!repoInfo) {
        results.errors?.push(`URL inválida: ${repo.url}`);
        return of({ repo: repo.url, success: false, pr: null });
      }

      const { owner, repo: repoName } = repoInfo;
      const demandId = release.demandId.trim();
      const branchName = `feature/remove-release-${demandId}`;
      const baseBranch = 'develop';
      const releaseFilePath = `releases/release_${demandId}.md`;

      // 1. Verifica se o arquivo existe no repositório
      return this.githubService.getFileSha(owner, repoName, releaseFilePath, baseBranch).pipe(
        switchMap((sha: string | null) => {
          if (!sha) {
            // Arquivo não existe neste repositório, pula
            return of({ repo: repoName, success: true, pr: null });
          }

          // 2. Cria a branch
          return this.githubService.createBranch(owner, repoName, branchName, baseBranch).pipe(
            catchError(err => {
              if (err.status === 422) return of(void 0); // Branch já existe
              results.errors?.push(`Erro ao criar branch em ${repoName}: ${err.message}`);
              return of(void 0);
            }),
            // 3. Deleta o arquivo de release
            switchMap(() => {
              return this.githubService.deleteFile(owner, repoName, releaseFilePath, `docs: remove release ${demandId}`, branchName).pipe(
                catchError(err => {
                  results.errors?.push(`Erro ao deletar arquivo em ${repoName}: ${err.message}`);
                  return of(void 0);
                })
              );
            }),
            // 4. Deleta os scripts relacionados se houver
            switchMap(() => {
              if (release.scripts.length === 0) return of(void 0);

              const scriptOperations = release.scripts
                .filter(script => script.name)
                .map(script => {
                  const demandId = release.demandId.trim();
                  const scriptName = script.name.trim();
                  const scriptPath = `scripts/${demandId}/${scriptName}`;
                  return this.githubService.getFileSha(owner, repoName, scriptPath, baseBranch).pipe(
                    switchMap((scriptSha: string | null) => {
                      if (!scriptSha) {
                        return of(void 0); // Script não existe, pula
                      }
                      return this.githubService.deleteFile(
                        owner, 
                        repoName, 
                        scriptPath, 
                        `docs: remove script ${scriptName} da release ${demandId}`, 
                        branchName
                      ).pipe(
                        catchError(err => {
                          console.warn(`Erro ao deletar script ${script.name} em ${repoName}:`, err);
                          return of(void 0);
                        })
                      );
                    })
                  );
                });

              return forkJoin(scriptOperations.length > 0 ? scriptOperations : [of(void 0)]);
            }),
            // 5. Cria o Pull Request
            switchMap(() => {
              const demandId = release.demandId.trim();
              const prTitle = `Remove Release ${demandId}`;
              const prBody = this.generateDeletePRBody(release);

              return this.githubService.createPullRequest({
                owner, 
                repo: repoName, 
                title: prTitle, 
                body: prBody, 
                head: branchName, 
                base: baseBranch
              }).pipe(
                map(pr => {
                  results.prs.push({ repo: `${owner}/${repoName}`, url: pr.html_url, number: pr.number });
                  return { repo: repoName, pr, success: true };
                }),
                catchError(err => {
                  if (err.status === 422) {
                    results.errors?.push(`PR já existe para ${repoName} - verifique manualmente`);
                    return of({ repo: repoName, pr: null, success: true });
                  }
                  results.errors?.push(`Erro ao criar PR em ${repoName}: ${err.message}`);
                  return of({ repo: repoName, pr: null, success: false });
                })
              );
            }),
            catchError(() => of({ repo: repoName, pr: null, success: false }))
          );
        }),
        catchError(() => of({ repo: repoName, pr: null, success: false }))
      );
    });

    return forkJoin(operations).pipe(
      map(() => {
        if (results.errors && results.errors.length > release.repositories.length / 2) {
          results.success = false;
        }
        return results;
      }),
      catchError(() => {
        results.success = false;
        return of(results);
      })
    );
  }

  private generatePRBody(release: Release): string {
    let body = `## Release ${release.demandId}\n\n`;
    if (release.title) body += `**${release.title}**\n\n`;
    body += `### Descrição\n${release.description}\n\n`;
    if (release.responsible.dev) {
      body += `### Responsável\n- Dev: ${release.responsible.dev}\n`;
      if (release.responsible.functional) body += `- Funcional: ${release.responsible.functional}\n`;
    }
    body += `\n### Arquivos adicionados/modificados\n`;
    const demandId = release.demandId.trim();
    body += `- \`releases/release_${demandId}.md\`\n`;
    if (release.scripts.length > 0) {
      release.scripts.forEach(script => {
        const scriptName = script.name.trim();
        body += `- \`scripts/${demandId}/${scriptName}\`\n`;
      });
    }
    return body;
  }

  private generateDeletePRBody(release: Release): string {
    const demandId = release.demandId.trim();
    let body = `## Remove Release ${demandId}\n\n`;
    if (release.title) body += `**${release.title}**\n\n`;
    body += `### Arquivos removidos\n`;
    body += `- \`releases/release_${demandId}.md\`\n`;
    if (release.scripts.length > 0) {
      release.scripts.forEach(script => {
        const scriptName = script.name.trim();
        body += `- \`scripts/${demandId}/${scriptName}\`\n`;
      });
    }
    return body;
  }
}

