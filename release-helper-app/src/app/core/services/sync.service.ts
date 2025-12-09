import { Injectable } from '@angular/core';
import { Observable, forkJoin, of, throwError } from 'rxjs';
import { switchMap, map, catchError, tap, take } from 'rxjs/operators';
import { Release } from '../../models';
import { GitHubService } from './github.service';
import { ReleaseService } from './release.service';
import { FirestoreReleaseService } from './firestore-release.service';
import { NotificationService } from './notification.service';
import { GitHubAuthService } from './github-auth.service';

/**
 * Serviço para sincronizar releases entre GitHub e Firestore
 * 
 * Fluxo:
 * 1. Busca releases de todos os repositórios no GitHub
 * 2. Faz parse dos arquivos .md
 * 3. Atualiza o Firestore com as releases encontradas
 * 4. Todos os usuários veem as mesmas releases sincronizadas
 */
@Injectable({
  providedIn: 'root'
})
export class SyncService {
  constructor(
    private githubService: GitHubService,
    private releaseService: ReleaseService,
    private firestoreReleaseService: FirestoreReleaseService,
    private notificationService: NotificationService,
    private authService: GitHubAuthService
  ) {}

  /**
   * Sincroniza releases do GitHub para o Firestore
   * Busca todos os arquivos de release nos repositórios e atualiza o Firestore
   * Remove do Firestore as releases que não foram encontradas no GitHub
   */
  syncFromGitHub(): Observable<{ synced: number; removed: number; errors: string[] }> {
    if (!this.githubService.hasValidToken()) {
      return throwError(() => new Error('Nenhum token GitHub disponível. Faça login ou configure um token de serviço.'));
    }

    if (!this.firestoreReleaseService.isAvailable()) {
      return throwError(() => new Error('Firestore não está disponível. Verifique a configuração do Firebase.'));
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

        // Coleta todos os arquivos de release
        const allReleaseFiles: Array<{ repo: string; name: string; path: string; sha: string }> = [];
        reposWithReleases.forEach(repoData => {
          repoData.releases.forEach(release => {
            allReleaseFiles.push({
              repo: repoData.repo,
              name: release.name,
              path: release.path,
              sha: release.sha
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

          return this.githubService.getReleaseFileContent(repoInfo.owner, repoInfo.repo, file.path).pipe(
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

              // Gera ID baseado no demandId para garantir unicidade
              const releaseId = `REL-${releaseData.demandId.toUpperCase()}`;
              
              // Obtém usuário atual para createdBy/updatedBy
              const currentUser = this.getCurrentUserLogin();
              
              // Verifica se já existe no Firestore para preservar createdBy
              return this.firestoreReleaseService.getByDemandId(releaseData.demandId).pipe(
                take(1),
                switchMap(existingRelease => {
                  // Cria objeto Release completo
                  // Releases sincronizadas do GitHub são sempre versionadas
                  const release: Release = {
                    id: releaseId,
                    demandId: releaseData.demandId || '',
                    title: releaseData.title || '',
                    description: releaseData.description || '',
                    responsible: releaseData.responsible || { dev: '', functional: '', lt: '', sre: '' },
                    secrets: releaseData.secrets || [],
                    scripts: releaseData.scripts || [],
                    repositories: releaseData.repositories || [],
                    observations: releaseData.observations || '',
                    createdAt: existingRelease?.createdAt || new Date(),
                    updatedAt: new Date(),
                    createdBy: existingRelease?.createdBy || currentUser,
                    updatedBy: currentUser,
                    isVersioned: true // Releases do GitHub são sempre versionadas
                  };


                  // Sincroniza no Firestore
                  return this.firestoreReleaseService.syncRelease(release).pipe(
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


            // Só remove do Firestore se não houver erros críticos
            // Erros críticos = mais de 50% das operações falharam
            const hasCriticalErrors = errors.length > operations.length * 0.5;

            if (hasCriticalErrors) {
              console.warn('[SyncService] Muitos erros detectados, não removendo releases do Firestore');
              return of({ synced, removed: 0, errors });
            }

            // Busca releases do Firestore para comparar (pega valor atual)
            return this.firestoreReleaseService.getAll().pipe(
              take(1), // Pega apenas o valor atual
              switchMap(firestoreReleases => {
                // Para cada release no Firestore que não foi encontrada na sincronização,
                // verifica diretamente no GitHub se o arquivo ainda existe
                // Isso evita remover releases de repositórios que o usuário não tem acesso
                // IMPORTANTE: Releases não versionadas (isVersioned === false) NUNCA são removidas
                const releasesToCheck = firestoreReleases.filter(firestoreRelease => {
                  const demandId = firestoreRelease.demandId.toUpperCase();
                  const notFoundInSync = !syncedDemandIds.has(demandId);
                  const isVersioned = firestoreRelease.isVersioned ?? false;
                  
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
                      this.firestoreReleaseService.deleteRelease(release.id).pipe(
                        map(() => ({ success: true, releaseId: release.id })),
                        catchError(error => {
                          console.error(`[SyncService] Erro ao remover release ${release.id} do Firestore:`, error);
                          return of({ success: false, releaseId: release.id });
                        })
                      )
                    );

                    return forkJoin(deleteOperations).pipe(
                      map(deleteResults => {
                        const removed = deleteResults.filter(r => r.success).length;

                        if (synced > 0) {
                          this.notificationService.success(
                            `${synced} release(s) sincronizada(s) e ${removed} removida(s) do Firestore!`
                          );
                        } else if (removed > 0) {
                          this.notificationService.success(`${removed} release(s) removida(s) do Firestore!`);
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
    // Tenta obter do sessionStorage (usuário funcional)
    const serviceUserStr = sessionStorage.getItem('service_user');
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

