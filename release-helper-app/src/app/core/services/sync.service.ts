import { Injectable } from '@angular/core';
import { Observable, forkJoin, of, throwError } from 'rxjs';
import { switchMap, map, catchError, tap, take } from 'rxjs/operators';
import { Release } from '../../models';
import { GitHubService } from './github.service';
import { ReleaseService } from './release.service';
import { LocalStorageReleaseService } from './local-storage-release.service';
import { NotificationService } from './notification.service';
import { GitHubAuthService } from './github-auth.service';

/**
 * Serviço para sincronizar releases entre GitHub e localStorage
 * 
 * Fluxo:
 * 1. Busca releases de todos os repositórios no GitHub
 * 2. Faz parse dos arquivos .md
 * 3. Atualiza o localStorage com as releases encontradas
 * 4. Releases versionadas são sincronizadas do GitHub
 */
@Injectable({
  providedIn: 'root'
})
export class SyncService {
  constructor(
    private githubService: GitHubService,
    private releaseService: ReleaseService,
    private localStorageReleaseService: LocalStorageReleaseService,
    private notificationService: NotificationService,
    private authService: GitHubAuthService
  ) {}

  /**
   * Sincroniza releases do GitHub para o localStorage
   * Busca todos os arquivos de release nos repositórios e atualiza o localStorage
   * Remove do localStorage as releases versionadas que não foram encontradas no GitHub
   */
  syncFromGitHub(): Observable<{ synced: number; removed: number; errors: string[] }> {
    if (!this.githubService.hasValidToken()) {
      return throwError(() => new Error('Nenhum token GitHub disponível. Faça login ou configure um token de serviço.'));
    }

    this.notificationService.info('Iniciando sincronização com GitHub...');

    return this.githubService.listAllReleasesFromRepos().pipe(
      switchMap(reposWithReleases => {
        // Se não encontrou nenhuma release, não remove nada do Firestore
        // Pode ser que o usuário não tenha acesso aos repositórios
        if (reposWithReleases.length === 0) {
          this.notificationService.info('Nenhuma release encontrada nos repositórios acessíveis. Verifique se você tem acesso aos repositórios das organizações.');
          return of({ synced: 0, removed: 0, errors: [] });
        }

        // Coleta todos os arquivos de release (com informação da branch)
        const allReleaseFiles: Array<{ repo: string; name: string; path: string; sha: string; branch: string }> = [];
        reposWithReleases.forEach(repoData => {
          repoData.releases.forEach(release => {
            allReleaseFiles.push({
              repo: repoData.repo,
              name: release.name,
              path: release.path,
              sha: release.sha,
              branch: release.branch || 'develop' // Default para develop se não tiver branch
            });
          });
        });

        // Processa cada arquivo
        // Nota: getUserRepositories() já filtra apenas repositórios de organizações,
        // então todos os arquivos aqui são de orgs, não pessoais
        const operations = allReleaseFiles.map(file => {
          const repoInfo = this.githubService.parseRepositoryUrl(`https://github.com/${file.repo}`);
          if (!repoInfo) {
            return of({ success: false, error: `URL inválida: ${file.repo}` });
          }

          // Busca o conteúdo do arquivo na branch correta
          const branch = file.branch || 'develop';
          return this.githubService.getReleaseFileContent(repoInfo.owner, repoInfo.repo, file.path, branch).pipe(
            switchMap(content => {
              if (!content) {
                return of({ success: false, error: `Conteúdo vazio: ${file.path}` });
              }

              // Faz parse do markdown
              const releaseData = this.releaseService.parseMarkdownToRelease(
                content,
                file.name,
                file.repo
              );

              if (!releaseData.demandId) {
                return of({ success: false, error: `Não foi possível extrair demandId de ${file.name}` });
              }

              // Gera ID baseado apenas no demandId (mesma release pode estar em múltiplos repositórios)
              const releaseId = `REL-${releaseData.demandId.toUpperCase()}`;
              const repoFullName = `${repoInfo.owner}/${repoInfo.repo}`;
              const repoUrl = `https://github.com/${repoFullName}`;
              
              // Busca informações dos commits para obter createdBy e updatedBy
              const lastCommit$ = this.githubService.getFileLastCommit(repoInfo.owner, repoInfo.repo, file.path, branch);
              const firstCommit$ = this.githubService.getFileFirstCommit(repoInfo.owner, repoInfo.repo, file.path, branch);
              
              return forkJoin([lastCommit$, firstCommit$]).pipe(
                switchMap(([lastCommit, firstCommit]) => {
                  // Verifica se já existe no localStorage por demandId
                  const demandId = releaseData.demandId || '';
                  return this.localStorageReleaseService.getByDemandId(demandId).pipe(
                    take(1),
                    switchMap(existingRelease => {
                      // Determina se está versionada baseado na branch
                      // Releases na branch develop são versionadas, na feature/upsert-release não são
                      const isVersioned = branch === 'develop';
                      
                      // Usa o autor do primeiro commit como createdBy, ou mantém o existente se já houver
                      const createdBy = existingRelease?.createdBy || firstCommit?.author || this.getCurrentUserLogin();
                      // Usa o autor do último commit como updatedBy
                      const updatedBy = lastCommit?.author || this.getCurrentUserLogin();
                      
                      // Usa a data do primeiro commit como createdAt, ou mantém o existente
                      const createdAt = existingRelease?.createdAt || firstCommit?.date || new Date();
                      // Usa a data do último commit como updatedAt
                      const updatedAt = lastCommit?.date || new Date();
                      
                      // Mescla repositórios: adiciona o repositório atual se não estiver na lista
                      const existingRepos = existingRelease?.repositories || [];
                      const newRepos = releaseData.repositories || [];
                      const mergedRepos = [...existingRepos];
                      
                      // Verifica se o repositório atual já está na lista
                      const repoExists = mergedRepos.some(r => 
                        r.url === repoUrl || 
                        r.url.includes(repoFullName) ||
                        r.name === repoFullName
                      );
                      
                      if (!repoExists) {
                        // Adiciona o repositório atual à lista
                        mergedRepos.push({
                          id: `repo-${Date.now()}`,
                          url: repoUrl,
                          name: repoFullName,
                          impact: 'Release sincronizada do GitHub',
                          releaseBranch: branch
                        });
                      }
                      
                      // Adiciona outros repositórios novos que não estão na lista
                      newRepos.forEach(newRepo => {
                        const exists = mergedRepos.some(existingRepo => 
                          existingRepo.url === newRepo.url || 
                          existingRepo.name === newRepo.name
                        );
                        if (!exists) {
                          mergedRepos.push(newRepo);
                        }
                      });
                      
                      // Usa o ID existente se houver, senão usa o novo
                      const finalId = existingRelease?.id || releaseId;
                      
                      // Cria objeto Release completo (mesma release, múltiplos repositórios)
                      const release: Release = {
                        id: finalId,
                        demandId: releaseData.demandId || '',
                        title: releaseData.title || existingRelease?.title || '',
                        description: releaseData.description || existingRelease?.description || '',
                        responsible: releaseData.responsible || existingRelease?.responsible || { dev: '', functional: '', lt: '', sre: '' },
                        secrets: releaseData.secrets || existingRelease?.secrets || [],
                        scripts: releaseData.scripts || existingRelease?.scripts || [],
                        repositories: mergedRepos,
                        observations: releaseData.observations || existingRelease?.observations || '',
                        createdAt: createdAt,
                        updatedAt: updatedAt,
                        createdBy: createdBy,
                        updatedBy: updatedBy,
                        isVersioned: isVersioned || existingRelease?.isVersioned || false
                      };

                      // Sincroniza no localStorage
                      return this.localStorageReleaseService.syncRelease(release).pipe(
                        map(() => ({ success: true, release })),
                        catchError(error => {
                          console.error(`Erro ao sincronizar ${file.name}:`, error);
                          const errorMessage = error instanceof Error ? error.message : String(error);
                          return of({ success: false, error: `Erro ao sincronizar ${file.name}: ${errorMessage}` });
                        })
                      );
                    })
                  );
                }),
                catchError(error => {
                  // Se falhar ao buscar commits, usa fallback com usuário atual
                  console.warn(`Erro ao buscar commits de ${file.path}, usando fallback:`, error);
                  const currentUser = this.getCurrentUserLogin();
                  const demandId = releaseData.demandId || '';
                  
                  return this.localStorageReleaseService.getByDemandId(demandId).pipe(
                    take(1),
                    switchMap(existingRelease => {
                      const isVersioned = branch === 'develop';
                      
                      // Mescla repositórios: adiciona o repositório atual se não estiver na lista
                      const existingRepos = existingRelease?.repositories || [];
                      const newRepos = releaseData.repositories || [];
                      const mergedRepos = [...existingRepos];
                      
                      // Verifica se o repositório atual já está na lista
                      const repoExists = mergedRepos.some(r => 
                        r.url === repoUrl || 
                        r.url.includes(repoFullName) ||
                        r.name === repoFullName
                      );
                      
                      if (!repoExists) {
                        // Adiciona o repositório atual à lista
                        mergedRepos.push({
                          id: `repo-${Date.now()}`,
                          url: repoUrl,
                          name: repoFullName,
                          impact: 'Release sincronizada do GitHub',
                          releaseBranch: branch
                        });
                      }
                      
                      // Adiciona outros repositórios novos que não estão na lista
                      newRepos.forEach(newRepo => {
                        const exists = mergedRepos.some(existingRepo => 
                          existingRepo.url === newRepo.url || 
                          existingRepo.name === newRepo.name
                        );
                        if (!exists) {
                          mergedRepos.push(newRepo);
                        }
                      });
                      
                      const finalId = existingRelease?.id || releaseId;
                      
                      const release: Release = {
                        id: finalId,
                        demandId: releaseData.demandId || '',
                        title: releaseData.title || existingRelease?.title || '',
                        description: releaseData.description || existingRelease?.description || '',
                        responsible: releaseData.responsible || existingRelease?.responsible || { dev: '', functional: '', lt: '', sre: '' },
                        secrets: releaseData.secrets || existingRelease?.secrets || [],
                        scripts: releaseData.scripts || existingRelease?.scripts || [],
                        repositories: mergedRepos,
                        observations: releaseData.observations || existingRelease?.observations || '',
                        createdAt: existingRelease?.createdAt || new Date(),
                        updatedAt: new Date(),
                        createdBy: existingRelease?.createdBy || currentUser,
                        updatedBy: currentUser,
                        isVersioned: isVersioned || existingRelease?.isVersioned || false
                      };

                      return this.localStorageReleaseService.syncRelease(release).pipe(
                        map(() => ({ success: true, release })),
                        catchError(syncError => {
                          console.error(`Erro ao sincronizar ${file.name}:`, syncError);
                          const errorMessage = syncError instanceof Error ? syncError.message : String(syncError);
                          return of({ success: false, error: `Erro ao sincronizar ${file.name}: ${errorMessage}` });
                        })
                      );
                    })
                  );
                })
              );
            }),
            catchError(error => {
              console.error(`Erro ao buscar conteúdo de ${file.path}:`, error);
              const errorMessage = error instanceof Error ? error.message : String(error);
              return of({ success: false, error: `Erro ao buscar ${file.path}: ${errorMessage}` });
            })
          );
        });

        return forkJoin(operations).pipe(
          switchMap(results => {
            const synced = results.filter(r => r.success).length;
            const errors = results
              .filter((r): r is { success: false; error: string } => !r.success && 'error' in r)
              .map(r => r.error);

            // Coleta os demandIds das releases que foram sincronizadas com sucesso
            const syncedDemandIds = new Set<string>();
            results.forEach(r => {
              if (r.success && 'release' in r && r.release) {
                syncedDemandIds.add(r.release.demandId.toUpperCase());
              }
            });


            // Só remove do localStorage se não houver erros críticos
            // Erros críticos = mais de 50% das operações falharam
            const hasCriticalErrors = errors.length > operations.length * 0.5;

            if (hasCriticalErrors) {
              console.warn('[SyncService] Muitos erros detectados, não removendo releases do localStorage');
              return of({ synced, removed: 0, errors });
            }

            // Busca releases do localStorage para comparar (pega valor atual)
            return this.localStorageReleaseService.getAll().pipe(
              take(1), // Pega apenas o valor atual
              switchMap(localReleases => {
                // Para cada release no localStorage que não foi encontrada na sincronização,
                // verifica diretamente no GitHub se o arquivo ainda existe
                // Isso evita remover releases de repositórios que o usuário não tem acesso
                // IMPORTANTE: Releases não versionadas (isVersioned === false) NUNCA são removidas
                const releasesToCheck = localReleases.filter(localRelease => {
                  const demandId = localRelease.demandId.toUpperCase();
                  const notFoundInSync = !syncedDemandIds.has(demandId);
                  const isVersioned = localRelease.isVersioned ?? false;
                  
                  // Só verifica se deve remover se:
                  // 1. Não foi encontrada na sincronização E
                  // 2. Está marcada como versionada (releases não versionadas são sempre preservadas)
                  return notFoundInSync && isVersioned;
                });


                if (releasesToCheck.length === 0) {
                  return of({ synced, removed: 0, errors });
                }

                // Para cada release, verifica se o arquivo existe nos repositórios onde deveria estar
                const checkOperations = releasesToCheck.map(release => {
                  // Se a release tem repositórios definidos, verifica neles
                  if (release.repositories && release.repositories.length > 0) {
                    const checkOps = release.repositories.map(repo => {
                      const repoInfo = this.githubService.parseRepositoryUrl(repo.url);
                      if (!repoInfo) {
                        return of({ exists: false, repo: repo.url, reason: 'invalid_url' });
                      }

                      const releaseFilePath = `releases/release_${release.demandId}.md`;
                      return this.githubService.getFileSha(repoInfo.owner, repoInfo.repo, releaseFilePath, 'develop').pipe(
                        map((sha: string | null) => ({ 
                          exists: sha !== null, 
                          repo: repoInfo.repo, 
                          reason: sha !== null ? 'found' : 'not_found' 
                        })),
                        catchError(error => {
                          // 404 = arquivo não existe, outros erros podem ser permissão
                          if (error.status === 404) {
                            return of({ exists: false, repo: repoInfo.repo, reason: 'not_found' });
                          }
                          // Se for erro de permissão ou outro, assume que pode existir (não remove)
                          console.warn(`[SyncService] Erro ao verificar ${release.demandId} em ${repoInfo.repo}:`, error.status);
                          return of({ exists: true, repo: repoInfo.repo, reason: 'error_checking' });
                        })
                      );
                    });

                    return forkJoin(checkOps).pipe(
                      map(results => {
                        // Só remove se NENHUM repositório tem o arquivo (todos retornaram not_found)
                        const allNotFound = results.every(r => r.exists === false && r.reason === 'not_found');
                        return { release, shouldRemove: allNotFound, checks: results };
                      })
                    );
                  } else {
                    // Release sem repositórios definidos, não remove (pode ser antiga ou local)
                    return of({ release, shouldRemove: false, checks: [] });
                  }
                });

                return forkJoin(checkOperations).pipe(
                  switchMap(checkResults => {
                    const releasesToRemove = checkResults
                      .filter(result => result.shouldRemove)
                      .map(result => result.release);


                    if (releasesToRemove.length === 0) {
                      return of({ synced, removed: 0, errors });
                    }

                    // Remove apenas as releases confirmadas como inexistentes
                    const deleteOperations = releasesToRemove.map(release => 
                      this.localStorageReleaseService.deleteRelease(release.id).pipe(
                        map(() => ({ success: true, releaseId: release.id })),
                        catchError(error => {
                          console.error(`[SyncService] Erro ao remover release ${release.id} do localStorage:`, error);
                          return of({ success: false, releaseId: release.id });
                        })
                      )
                    );

                    return forkJoin(deleteOperations).pipe(
                      map(deleteResults => {
                        const removed = deleteResults.filter(r => r.success).length;

                        if (synced > 0) {
                          this.notificationService.success(
                            `${synced} release(s) sincronizada(s) e ${removed} removida(s) do localStorage!`
                          );
                        } else if (removed > 0) {
                          this.notificationService.success(`${removed} release(s) removida(s) do localStorage!`);
                        }
                        
                        if (errors.length > 0) {
                          console.warn('[SyncService] Erros durante sincronização:', errors);
                          if (synced === 0 && removed === 0) {
                            this.notificationService.error(`Erro ao sincronizar: ${errors[0]}`);
                          }
                        }

                        return { synced, removed, errors };
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
        console.error('[SyncService] Erro na sincronização:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.notificationService.error(`Erro ao sincronizar: ${errorMessage}`);
        return throwError(() => error);
      })
    );
  }

  /**
   * Obtém o login do usuário atual (GitHub ou funcional)
   */
  private getCurrentUserLogin(): string | undefined {
    const user = this.authService.getUser();
    if (user) {
      return user.login;
    }
    // Tenta obter do localStorage (usuário funcional)
    const serviceUserStr = localStorage.getItem('service_user');
    if (serviceUserStr) {
      try {
        const serviceUser = JSON.parse(serviceUserStr);
        return serviceUser.login;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Verifica se há novas releases no GitHub comparando com o Firestore
   */
  checkForUpdates(): Observable<boolean> {
    // Implementação futura: comparar SHAs dos arquivos
    return of(false);
  }
}

