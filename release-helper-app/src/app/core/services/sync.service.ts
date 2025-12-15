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
 * REGRAS:
 * - Releases NÃO versionadas: SEMPRE buscam na branch feature/upsert-release
 * - Releases versionadas: buscam na branch develop (só se já existem versionadas em tela - otimização)
 * - feature/upsert-release SEMPRE atualiza o documento (não compara, força atualização)
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
   * 
   * IMPORTANTE: Este método APENAS LÊ do GitHub e salva no localStorage.
   * NUNCA cria commits no GitHub. Apenas sincroniza (read-only).
   */
  syncFromGitHub(): Observable<{ synced: number; removed: number; errors: string[] }> {
    if (!this.githubService.hasValidToken()) {
      return throwError(() => new Error('Nenhum token GitHub disponível. Faça login ou configure um token de serviço.'));
    }

    this.notificationService.info('Iniciando sincronização com GitHub...');

    // Primeiro pega releases existentes para saber quais são versionadas
    return this.localStorageReleaseService.getAll().pipe(
      take(1),
      switchMap(existingReleases => {
        // Coleta demandIds das releases versionadas (para otimizar busca na develop)
        const versionedDemandIds = new Set(
          existingReleases
            .filter(r => r.isVersioned === true)
            .map(r => r.demandId.toUpperCase())
        );

        return this.githubService.listAllReleasesFromRepos().pipe(
          switchMap(reposWithReleases => {
            if (reposWithReleases.length === 0) {
              this.notificationService.info('Nenhuma release encontrada nos repositórios acessíveis.');
              return of({ synced: 0, removed: 0, errors: [] });
            }

            // REGRA CRÍTICA: 
            // 1. Se existe em feature/upsert-release, SEMPRE prioriza ela (releases não versionadas)
            // 2. Se não existe em feature/upsert-release mas existe em develop, usa develop (releases versionadas)
            // 3. Não busca na develop se já existe em feature/upsert-release (evita 403 e duplicatas)
            
            const releaseMap = new Map<string, { repo: string; name: string; path: string; sha: string; branch: string }>();
            
            // Primeiro, coleta TODAS as releases de feature/upsert-release (prioridade máxima)
            reposWithReleases.forEach(repoData => {
              repoData.releases.forEach(release => {
                if (release.branch === 'feature/upsert-release') {
                  const key = `${repoData.repo}:${release.name}`;
                  // SEMPRE adiciona feature/upsert-release
                  releaseMap.set(key, {
                    repo: repoData.repo,
                    name: release.name,
                    path: release.path,
                    sha: release.sha,
                    branch: 'feature/upsert-release'
                  });
                }
              });
            });
            
            // Depois, adiciona releases da develop APENAS se NÃO existe em feature/upsert-release
            // Isso evita buscar arquivos que não existem (403) e garante que feature/upsert-release sempre prevalece
            reposWithReleases.forEach(repoData => {
              repoData.releases.forEach(release => {
                if (release.branch === 'develop') {
                  const key = `${repoData.repo}:${release.name}`;
                  
                  // Só adiciona develop se NÃO existe feature/upsert-release para esta release
                  if (!releaseMap.has(key)) {
                    releaseMap.set(key, {
                      repo: repoData.repo,
                      name: release.name,
                      path: release.path,
                      sha: release.sha,
                      branch: 'develop'
                    });
                  }
                }
              });
            });

            const uniqueReleaseFiles = Array.from(releaseMap.values());
            
            // Processa primeiro develop, depois feature/upsert-release (para que upsert sobrescreva develop se ambas existirem)
            uniqueReleaseFiles.sort((a, b) => {
              if (a.branch === 'feature/upsert-release' && b.branch === 'develop') return 1;
              if (a.branch === 'develop' && b.branch === 'feature/upsert-release') return -1;
              return 0;
            });
            

            // Processa cada arquivo
            const operations = uniqueReleaseFiles.map(file => {
              const repoInfo = this.githubService.parseRepositoryUrl(`https://github.com/${file.repo}`);
              if (!repoInfo) {
                return of({ success: false, error: `URL inválida: ${file.repo}` });
              }

              const branch = file.branch || 'develop';
              
              // Busca SEMPRE do HEAD da branch (conteúdo mais recente do commit mais recente)
              return this.githubService.getReleaseFileContent(repoInfo.owner, repoInfo.repo, file.path, branch).pipe(
                switchMap(content => {
                  if (!content) {
                    console.warn(`[SyncService] ⚠️ Conteúdo vazio para ${file.path} na branch ${branch}`);
                    return of({ success: false, error: `Conteúdo vazio: ${file.path}` });
                  }

                  // Faz parse do markdown (converte markdown para objeto Release)
                  const releaseData = this.releaseService.parseMarkdownToRelease(
                    content,
                    file.name,
                    file.repo
                  );

                  if (!releaseData.demandId) {
                    return of({ success: false, error: `Não foi possível extrair demandId de ${file.name}` });
                  }

                  // Busca o conteúdo dos scripts do GitHub APENAS se houver scripts referenciados no .md
                  // IMPORTANTE: Só busca scripts que foram parseados da tabela de scripts do markdown
                  const demandId = releaseData.demandId || '';
                  if (releaseData.scripts && releaseData.scripts.length > 0) {
                    // Filtra apenas scripts com nome válido (garantindo que vieram do parse do markdown)
                    const validScripts = releaseData.scripts.filter(script => script.name && script.name.trim() !== '');
                    if (validScripts.length > 0) {
                      const scriptOperations = validScripts.map(script => {
                        // Busca da pasta scripts/${demandId}/ apenas para scripts que estão no markdown
                        // O script.name vem do parse da tabela de scripts do .md
                        const scriptPath = `scripts/${demandId}/${script.name}`;
                        return this.githubService.getFileContent(repoInfo.owner, repoInfo.repo, scriptPath, branch).pipe(
                        map((scriptContent: string | null) => {
                          if (scriptContent) {
                            script.content = scriptContent;
                          }
                          return script;
                        }),
                        catchError((err: any) => {
                          // 404 = arquivo não existe, isso é OK (pode ser novo)
                          if (err.status !== 404) {
                            console.warn(`[SyncService] ⚠️ Erro ao buscar script ${script.name}:`, err.message);
                          }
                          return of(script);
                        })
                      );
                      });
                      
                      return forkJoin(scriptOperations).pipe(
                        switchMap((scriptsWithContent) => {
                          // Atualiza apenas os scripts que foram buscados, mantendo os outros
                          if (releaseData.scripts) {
                            releaseData.scripts = releaseData.scripts.map(script => {
                              const found = scriptsWithContent.find(s => s.name === script.name);
                              return found || script;
                            });
                          } else {
                            releaseData.scripts = scriptsWithContent;
                          }
                          // Continua com o processamento normal da release - busca existingRelease primeiro
                          return this.localStorageReleaseService.getByDemandId(demandId).pipe(
                            take(1),
                            switchMap(existingRelease => {
                              return this.processReleaseAfterParse(releaseData, file, repoInfo, branch, demandId, existingRelease);
                            })
                          );
                        })
                      );
                    }
                  }

                  // Se não há scripts, continua normalmente - busca existingRelease primeiro
                  return this.localStorageReleaseService.getByDemandId(demandId).pipe(
                    take(1),
                    switchMap(existingRelease => {
                      return this.processReleaseAfterParse(releaseData, file, repoInfo, branch, demandId, existingRelease);
                    })
                  );
                })
              );
            });

            return forkJoin(operations).pipe(
              switchMap(results => {
                type ResultType = { success: boolean; release?: Release; error?: string; skipped?: boolean };
                const typedResults = results as ResultType[];
                
                const synced = typedResults.filter(r => r.success && !('skipped' in r && r.skipped)).length;
                const skipped = typedResults.filter(r => r.success && 'skipped' in r && r.skipped).length;
                const errors = typedResults
                  .filter((r): r is { success: false; error: string } => !r.success && 'error' in r)
                  .map(r => r.error);

                const syncedDemandIds = new Set<string>();
                typedResults.forEach(r => {
                  if (r.success && 'release' in r && r.release) {
                    syncedDemandIds.add(r.release.demandId.toUpperCase());
                  }
                });

                const hasCriticalErrors = errors.length > operations.length * 0.5;

                if (hasCriticalErrors) {
                  console.warn('[SyncService] Muitos erros detectados, não removendo releases do localStorage');
                  return of({ synced, removed: 0, errors });
                }

                return this.localStorageReleaseService.getAll().pipe(
                  take(1),
                  switchMap(localReleases => {
                    const releasesToCheck = localReleases.filter(localRelease => {
                      const demandId = localRelease.demandId.toUpperCase();
                      const notFoundInSync = !syncedDemandIds.has(demandId);
                      const isVersioned = localRelease.isVersioned ?? false;
                      return notFoundInSync && isVersioned;
                    });

                    if (releasesToCheck.length === 0) {
                      return of({ synced, removed: 0, errors });
                    }

                    const checkOperations = releasesToCheck.map(release => {
                      if (release.repositories && release.repositories.length > 0) {
                        const checkOps = release.repositories.map(repo => {
                          const repoInfo = this.githubService.parseRepositoryUrl(repo.url);
                          if (!repoInfo) {
                            return of(false);
                          }

                          const filePath = `releases/release_${release.demandId}.md`;
                          return forkJoin([
                            this.githubService.getFileSha(repoInfo.owner, repoInfo.repo, filePath, 'feature/upsert-release'),
                            this.githubService.getFileSha(repoInfo.owner, repoInfo.repo, filePath, 'develop')
                          ]).pipe(
                            map(([sha1, sha2]) => sha1 !== null || sha2 !== null),
                            catchError(() => of(false))
                          );
                        });

                        return forkJoin(checkOps).pipe(
                          map(results => results.some(exists => exists))
                        );
                      }
                      return of(false);
                    });

                    return forkJoin(checkOperations).pipe(
                      map(checkResults => {
                        const releasesToRemove = releasesToCheck.filter((_, index) => !checkResults[index]);
                        const removed = releasesToRemove.length;

                        if (removed > 0) {
                          releasesToRemove.forEach(release => {
                            this.localStorageReleaseService.deleteRelease(release.id).subscribe();
                          });
                        }

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

                        // Salva a data da última sincronização geral no localStorage
                        localStorage.setItem('last_sync_date', new Date().toISOString());
                        
                        return { synced, removed, errors };
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
  }

  // Método auxiliar para processar release após parse e carregamento de scripts
  private processReleaseAfterParse(
    releaseData: Partial<Release>,
    file: { name: string; path: string; repo: string; branch: string },
    repoInfo: { owner: string; repo: string },
    branch: string,
    demandId: string,
    existingRelease: Release | null
  ): Observable<{ success: boolean; release?: Release; error?: string; skipped?: boolean }> {
    const releaseId = `REL-${demandId.toUpperCase()}`;
    const repoFullName = `${repoInfo.owner}/${repoInfo.repo}`;
    const repoUrl = `https://github.com/${repoFullName}`;
    
    const isUpsertBranch = branch === 'feature/upsert-release';
    
    // REGRA CRÍTICA: feature/upsert-release SEMPRE atualiza (não compara, força atualização)
    // develop só atualiza se conteúdo mudou (otimização)
    if (!isUpsertBranch && existingRelease) {
            // Para develop, verifica se mudou
            const hasContentChanged = 
              JSON.stringify(existingRelease.title) !== JSON.stringify(releaseData.title) ||
              JSON.stringify(existingRelease.description) !== JSON.stringify(releaseData.description) ||
              JSON.stringify(existingRelease.responsible) !== JSON.stringify(releaseData.responsible) ||
              JSON.stringify(existingRelease.secrets) !== JSON.stringify(releaseData.secrets) ||
              JSON.stringify(existingRelease.scripts) !== JSON.stringify(releaseData.scripts) ||
              JSON.stringify(existingRelease.observations) !== JSON.stringify(releaseData.observations);
            
            if (!hasContentChanged) {
              // Conteúdo não mudou na develop, pula
              return of({
                success: true,
                release: existingRelease,
                skipped: true
              });
            }
          }
          
          // Busca commits apenas se necessário
          const lastCommit$ = this.githubService.getFileLastCommit(repoInfo.owner, repoInfo.repo, file.path, branch);
          const firstCommit$ = existingRelease 
            ? of(null)
            : this.githubService.getFileFirstCommit(repoInfo.owner, repoInfo.repo, file.path, branch);
                      
          return forkJoin([lastCommit$, firstCommit$]).pipe(
            switchMap(([lastCommit, firstCommit]) => {
              const isVersioned = branch === 'develop';
              
              // SEMPRE usa dados do commit para updatedAt/updatedBy quando sincronizando
              // Não atualiza como se fosse edição local
              const createdBy = existingRelease?.createdBy || firstCommit?.author || this.getCurrentUserLogin();
              // updatedBy sempre vem do último commit (ou mantém o existente se não houver commit)
              const updatedBy = lastCommit?.author || existingRelease?.updatedBy;
              const createdAt = existingRelease?.createdAt || firstCommit?.date || new Date();
              // updatedAt SEMPRE vem do último commit quando sincronizando (não usa data atual se não houver commit)
              // Se não houver lastCommit ou lastCommit.date, mantém a data existente (não cria nova data)
              const updatedAt = (lastCommit?.date) ? lastCommit.date : (existingRelease?.updatedAt || new Date());
              
              // Mescla repositórios
              const existingRepos = existingRelease?.repositories || [];
              const newRepos = releaseData.repositories || [];
              const mergedRepos = [...existingRepos];
              
              const existingRepoIndex = mergedRepos.findIndex(r => 
                r.url === repoUrl || 
                r.url.includes(repoFullName) ||
                r.name === repoFullName
              );
              
              if (existingRepoIndex === -1) {
                mergedRepos.push({
                  id: `repo-${Date.now()}`,
                  url: repoUrl,
                  name: repoFullName,
                  impact: 'Release sincronizada do GitHub',
                  releaseBranch: branch
                });
              } else {
                if (branch === 'feature/upsert-release') {
                  mergedRepos[existingRepoIndex].releaseBranch = branch;
                } else if (!mergedRepos[existingRepoIndex].releaseBranch) {
                  mergedRepos[existingRepoIndex].releaseBranch = branch;
                }
              }
              
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
              
              // REGRA CRÍTICA: feature/upsert-release USA 100% dos dados do releaseData (conteúdo mais recente)
              // develop: mescla (preserva dados que não estão no markdown)
              const release: Release = isUpsertBranch ? {
                // feature/upsert-release: USA TUDO do releaseData parseado do markdown mais recente
                // FORÇA atualização completa, substituindo qualquer conteúdo antigo no localStorage
                id: finalId,
                demandId: releaseData.demandId || '',
                title: releaseData.title || '',
                description: releaseData.description || '',
                responsible: releaseData.responsible || { dev: '', functional: '', lt: '', sre: '' },
                secrets: releaseData.secrets || [],
                scripts: releaseData.scripts || [],
                repositories: mergedRepos,
                observations: releaseData.observations || '',
                createdAt: createdAt,
                updatedAt: updatedAt,
                createdBy: createdBy,
                updatedBy: updatedBy,
                isVersioned: false
              } : {
                // develop: mescla (preserva dados que não estão no markdown)
                id: finalId,
                demandId: releaseData.demandId || '',
                title: releaseData.title || existingRelease?.title || '',
                description: releaseData.description || existingRelease?.description || '',
                responsible: releaseData.responsible || existingRelease?.responsible || { dev: '', functional: '', lt: '', sre: '' },
                // CORREÇÃO: usa dados do parse do markdown quando disponíveis (secrets e observations)
                secrets: releaseData.secrets || existingRelease?.secrets || [],
                scripts: releaseData.scripts || existingRelease?.scripts || [],
                repositories: mergedRepos,
                observations: releaseData.observations !== undefined ? releaseData.observations : (existingRelease?.observations || ''),
                createdAt: createdAt,
                updatedAt: updatedAt,
                createdBy: createdBy,
                updatedBy: updatedBy,
                isVersioned: true
              };
              

              // IMPORTANTE: syncRelease apenas salva no localStorage, NÃO cria commits
              // Usamos localStorageReleaseService diretamente, NÃO releaseService.update/create
              return this.localStorageReleaseService.syncRelease(release).pipe(
                map(() => {
                  return { success: true, release };
                }),
                catchError(error => {
                  console.error(`Erro ao sincronizar ${file.name}:`, error);
                  const errorMessage = error instanceof Error ? error.message : String(error);
                  return of({ success: false, error: `Erro ao sincronizar ${file.name}: ${errorMessage}` });
                })
              );
            }),
            catchError(error => {
              // Se erro ao buscar commits, ainda tenta salvar com dados disponíveis
              console.warn(`[SyncService] Erro ao buscar commits para ${file.path}:`, error);
              const currentUser = this.getCurrentUserLogin();
              const isUpsertBranch = branch === 'feature/upsert-release';
              
              const existingRepos = existingRelease?.repositories || [];
              const newRepos = releaseData.repositories || [];
              const mergedRepos = [...existingRepos];
              
              const existingRepoIndex = mergedRepos.findIndex(r => 
                r.url === repoUrl || 
                r.url.includes(repoFullName) ||
                r.name === repoFullName
              );
              
              if (existingRepoIndex === -1) {
                mergedRepos.push({
                  id: `repo-${Date.now()}`,
                  url: repoUrl,
                  name: repoFullName,
                  impact: 'Release sincronizada do GitHub',
                  releaseBranch: branch
                });
              } else {
                if (branch === 'feature/upsert-release') {
                  mergedRepos[existingRepoIndex].releaseBranch = branch;
                } else if (!mergedRepos[existingRepoIndex].releaseBranch) {
                  mergedRepos[existingRepoIndex].releaseBranch = branch;
                }
              }
              
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
              
              // Em caso de erro, mantém dados existentes mas não atualiza updatedAt/updatedBy (não é edição local)
              const release: Release = isUpsertBranch ? {
                id: finalId,
                demandId: releaseData.demandId || '',
                title: releaseData.title || '',
                description: releaseData.description || '',
                responsible: releaseData.responsible || { dev: '', functional: '', lt: '', sre: '' },
                secrets: releaseData.secrets || [],
                scripts: releaseData.scripts || [],
                repositories: mergedRepos,
                observations: releaseData.observations || '',
                createdAt: existingRelease?.createdAt || new Date(),
                // Não atualiza updatedAt/updatedBy em caso de erro (mantém existentes)
                updatedAt: existingRelease?.updatedAt || new Date(),
                createdBy: existingRelease?.createdBy || currentUser,
                updatedBy: existingRelease?.updatedBy,
                isVersioned: false
              } : {
                id: finalId,
                demandId: releaseData.demandId || '',
                title: releaseData.title || existingRelease?.title || '',
                description: releaseData.description || existingRelease?.description || '',
                responsible: releaseData.responsible || existingRelease?.responsible || { dev: '', functional: '', lt: '', sre: '' },
                secrets: releaseData.secrets || existingRelease?.secrets || [],
                scripts: releaseData.scripts || existingRelease?.scripts || [],
                repositories: mergedRepos,
                observations: releaseData.observations !== undefined ? releaseData.observations : (existingRelease?.observations || ''),
                createdAt: existingRelease?.createdAt || new Date(),
                // Não atualiza updatedAt/updatedBy em caso de erro (mantém existentes)
                updatedAt: existingRelease?.updatedAt || new Date(),
                createdBy: existingRelease?.createdBy || currentUser,
                updatedBy: existingRelease?.updatedBy,
                isVersioned: true
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
        }

  /**
   * Obtém o login do usuário atual (GitHub ou funcional)
   */
  private getCurrentUserLogin(): string | undefined {
    const user = this.authService?.getUser();
    if (user) {
      return user.login;
    }
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
    return of(false);
  }

  /**
   * Sincroniza apenas uma demanda específica dos seus repositórios
   * Evita rate limit ao sincronizar apenas os arquivos relacionados a uma release
   */
  syncDemand(demandId: string): Observable<{ synced: number; errors: string[] }> {
    if (!this.githubService.hasValidToken()) {
      return throwError(() => new Error('Nenhum token GitHub disponível. Faça login ou configure um token de serviço.'));
    }

    const demandIdUpper = demandId.toUpperCase();
    this.notificationService.info(`Sincronizando release ${demandIdUpper}...`);

    // Busca a release no localStorage para obter os repositórios
    return this.localStorageReleaseService.getByDemandId(demandId).pipe(
      take(1),
      switchMap(existingRelease => {
        if (!existingRelease || !existingRelease.repositories || existingRelease.repositories.length === 0) {
          this.notificationService.warning(`Release ${demandIdUpper} não encontrada ou sem repositórios associados.`);
          return of({ synced: 0, errors: [`Release ${demandIdUpper} não tem repositórios configurados`] });
        }

        // Busca releases apenas nos repositórios dessa demanda
        const repoUrls = existingRelease.repositories.map(r => r.url);
        const repoFullNames = repoUrls
          .map(url => {
            const repoInfo = this.githubService.parseRepositoryUrl(url);
            return repoInfo ? `${repoInfo.owner}/${repoInfo.repo}` : null;
          })
          .filter((name): name is string => name !== null);

        if (repoFullNames.length === 0) {
          return of({ synced: 0, errors: [`Nenhum repositório válido para ${demandIdUpper}`] });
        }

        // Busca releases apenas nesses repositórios específicos
        const releaseFileName = `release_${demandIdUpper}.md`;
        const filePath = `releases/${releaseFileName}`;

        const operations = repoFullNames.map(repoFullName => {
          const repoInfo = this.githubService.parseRepositoryUrl(`https://github.com/${repoFullName}`);
          if (!repoInfo) {
            return of({ success: false, error: `URL inválida: ${repoFullName}` });
          }

          // Tenta buscar da feature/upsert-release primeiro (prioridade)
          const upsertBranch$ = this.githubService.getReleaseFileContent(repoInfo.owner, repoInfo.repo, filePath, 'feature/upsert-release').pipe(
            map(content => ({ content, branch: 'feature/upsert-release' as const, repo: repoFullName })),
            catchError(() => of(null))
          );

          // Se não encontrar, tenta develop
          const developBranch$ = this.githubService.getReleaseFileContent(repoInfo.owner, repoInfo.repo, filePath, 'develop').pipe(
            map(content => ({ content, branch: 'develop' as const, repo: repoFullName })),
            catchError(() => of(null))
          );

          return forkJoin([upsertBranch$, developBranch$]).pipe(
            switchMap(([upsertResult, developResult]) => {
              // Prioriza feature/upsert-release
              const result = upsertResult?.content ? upsertResult : developResult;
              
              if (!result || !result.content) {
                return of({ success: false, error: `Arquivo não encontrado em ${repoFullName}` });
              }

              const releaseData = this.releaseService.parseMarkdownToRelease(result.content, releaseFileName, repoFullName);
              
              if (!releaseData.demandId || releaseData.demandId.toUpperCase() !== demandIdUpper) {
                return of({ success: false, error: `DemandId não confere: ${releaseData.demandId}` });
              }

              const isUpsertBranch = result.branch === 'feature/upsert-release';
              
              // Busca o conteúdo dos scripts do GitHub APENAS se houver scripts referenciados no .md
              // IMPORTANTE: Só busca scripts que foram parseados da tabela de scripts do markdown
              if (releaseData.scripts && releaseData.scripts.length > 0) {
                // Filtra apenas scripts com nome válido (garantindo que vieram do parse do markdown)
                const validScripts = releaseData.scripts.filter(script => script.name && script.name.trim() !== '');
                if (validScripts.length > 0) {
                  const scriptOperations = validScripts.map(script => {
                    // Busca da pasta scripts/${demandId}/ apenas para scripts que estão no markdown
                    // O script.name vem do parse da tabela de scripts do .md
                    const scriptPath = `scripts/${demandIdUpper}/${script.name}`;
                    return this.githubService.getFileContent(repoInfo.owner, repoInfo.repo, scriptPath, result.branch).pipe(
                    map((scriptContent: string | null) => {
                      if (scriptContent) {
                        script.content = scriptContent;
                      }
                      return script;
                    }),
                    catchError((err: any) => {
                      // 404 = arquivo não existe, isso é OK (pode ser novo)
                      if (err.status !== 404) {
                        console.warn(`[SyncService] ⚠️ Erro ao buscar script ${script.name}:`, err.message);
                      }
                      return of(script);
                    })
                  );
                  });
                  
                  return forkJoin(scriptOperations).pipe(
                    switchMap((scriptsWithContent) => {
                      // Atualiza apenas os scripts que foram buscados, mantendo os outros
                      if (releaseData.scripts) {
                        releaseData.scripts = releaseData.scripts.map(script => {
                          const found = scriptsWithContent.find(s => s.name === script.name);
                          return found || script;
                        });
                      } else {
                        releaseData.scripts = scriptsWithContent;
                      }
                      // Continua com o processamento normal da release
                      return this.processReleaseDataForSyncDemand(releaseData, existingRelease, repoInfo, result.branch, demandIdUpper, isUpsertBranch, filePath);
                    })
                  );
                }
              }
              
              // Se não há scripts, continua normalmente
              return this.processReleaseDataForSyncDemand(releaseData, existingRelease, repoInfo, result.branch, demandIdUpper, isUpsertBranch, filePath);
            })
          );
        });

        return forkJoin(operations).pipe(
          map(results => {
            const synced = results.filter(r => r.success).length;
            const errors = results
              .filter((r): r is { success: false; error: string } => !r.success && 'error' in r)
              .map(r => r.error);

            // Salva a data da última sincronização individual no localStorage
            if (synced > 0) {
              localStorage.setItem('last_sync_date', new Date().toISOString());
              this.notificationService.success(`Release ${demandIdUpper} sincronizada com sucesso!`);
            } else if (errors.length > 0) {
              this.notificationService.error(`Erro ao sincronizar ${demandIdUpper}: ${errors[0]}`);
            }

            return { synced, errors };
          }),
          catchError(error => {
            console.error(`[SyncService] Erro ao sincronizar demanda ${demandIdUpper}:`, error);
            this.notificationService.error(`Erro ao sincronizar: ${error.message}`);
            return throwError(() => error);
          })
        );
      })
    );
  }

  /**
   * Método auxiliar para processar release após buscar scripts (usado em syncDemand)
   */
  private processReleaseDataForSyncDemand(
    releaseData: Partial<Release>,
    existingRelease: Release | null,
    repoInfo: { owner: string; repo: string },
    branch: string,
    demandIdUpper: string,
    isUpsertBranch: boolean,
    filePath: string
  ): Observable<{ success: boolean; release?: Release; error?: string }> {
    const repoFullName = `${repoInfo.owner}/${repoInfo.repo}`;
    
    // Busca commits
    const lastCommit$ = this.githubService.getFileLastCommit(repoInfo.owner, repoInfo.repo, filePath, branch);
    const firstCommit$ = existingRelease 
      ? of(null)
      : this.githubService.getFileFirstCommit(repoInfo.owner, repoInfo.repo, filePath, branch);
    
    return forkJoin([lastCommit$, firstCommit$]).pipe(
      switchMap(([lastCommit, firstCommit]) => {
        // SEMPRE usa dados do commit para updatedAt/updatedBy quando sincronizando
        // Não atualiza como se fosse edição local
        const createdBy = existingRelease?.createdBy || firstCommit?.author || this.getCurrentUserLogin();
        // updatedBy sempre vem do último commit (ou mantém o existente se não houver commit)
        const updatedBy = lastCommit?.author || existingRelease?.updatedBy;
        const createdAt = existingRelease?.createdAt || firstCommit?.date || new Date();
        // updatedAt SEMPRE vem do último commit quando sincronizando (não usa data atual se não houver commit)
        // Se não houver lastCommit ou lastCommit.date, mantém a data existente (não cria nova data)
        const updatedAt = (lastCommit?.date) ? lastCommit.date : (existingRelease?.updatedAt || new Date());
        
        // Mescla repositórios
        const existingRepos = existingRelease?.repositories || [];
        const newRepos = releaseData.repositories || [];
        const mergedRepos = [...existingRepos];
        
        const existingRepoIndex = mergedRepos.findIndex(r => 
          r.url.includes(repoFullName) || r.name === repoFullName
        );
        
        if (existingRepoIndex === -1) {
          mergedRepos.push({
            id: `repo-${Date.now()}`,
            url: `https://github.com/${repoFullName}`,
            name: repoFullName,
            impact: 'Release sincronizada do GitHub',
            releaseBranch: branch
          });
        } else {
          if (branch === 'feature/upsert-release') {
            mergedRepos[existingRepoIndex].releaseBranch = branch;
          }
        }
        
        const finalId = existingRelease?.id || `REL-${demandIdUpper}`;
        
        // feature/upsert-release: sempre usa dados do GitHub (parse do markdown)
        // develop: mescla - usa dados do GitHub quando disponíveis, senão mantém existentes
        const release: Release = isUpsertBranch ? {
          id: finalId,
          demandId: releaseData.demandId || demandIdUpper,
          title: releaseData.title || '',
          description: releaseData.description || '',
          responsible: releaseData.responsible || { dev: '', functional: '', lt: '', sre: '' },
          secrets: releaseData.secrets || [],
          scripts: releaseData.scripts || [],
          repositories: mergedRepos,
          observations: releaseData.observations || '',
          createdAt: createdAt,
          updatedAt: updatedAt,
          createdBy: createdBy,
          updatedBy: updatedBy,
          isVersioned: false
        } : {
          id: finalId,
          demandId: releaseData.demandId || demandIdUpper,
          title: releaseData.title || existingRelease?.title || '',
          description: releaseData.description || existingRelease?.description || '',
          responsible: releaseData.responsible || existingRelease?.responsible || { dev: '', functional: '', lt: '', sre: '' },
          // CORREÇÃO: usa dados do parse do markdown quando disponíveis (secrets e observations)
          secrets: releaseData.secrets || existingRelease?.secrets || [],
          scripts: releaseData.scripts || existingRelease?.scripts || [],
          repositories: mergedRepos,
          observations: releaseData.observations !== undefined ? releaseData.observations : (existingRelease?.observations || ''),
          createdAt: createdAt,
          updatedAt: updatedAt,
          createdBy: createdBy,
          updatedBy: updatedBy,
          isVersioned: true
        };

        return this.localStorageReleaseService.syncRelease(release).pipe(
          map(() => ({ success: true, release })),
          catchError(error => {
            console.error(`[SyncService] Erro ao sincronizar release ${demandIdUpper}:`, error);
            return of({ success: false, error: `Erro ao salvar: ${error.message}` });
          })
        );
      }),
      catchError(error => {
        console.warn(`[SyncService] Erro ao buscar commits para ${demandIdUpper}:`, error);
        // Tenta salvar mesmo sem commits
        const currentUser = this.getCurrentUserLogin();
        const finalId = existingRelease?.id || `REL-${demandIdUpper}`;
        const repoFullName = `${repoInfo.owner}/${repoInfo.repo}`;
        
        // Mescla repositórios novamente
        const existingReposError = existingRelease?.repositories || [];
        const newReposError = releaseData.repositories || [];
        const mergedReposError = [...existingReposError];
        
        const existingRepoIndexError = mergedReposError.findIndex(r => 
          r.url.includes(repoFullName) || r.name === repoFullName
        );
        
        if (existingRepoIndexError === -1) {
          mergedReposError.push({
            id: `repo-${Date.now()}`,
            url: `https://github.com/${repoFullName}`,
            name: repoFullName,
            impact: 'Release sincronizada do GitHub',
            releaseBranch: branch
          });
        } else {
          if (branch === 'feature/upsert-release') {
            mergedReposError[existingRepoIndexError].releaseBranch = branch;
          }
        }
        
        // Em caso de erro, mantém dados existentes mas não atualiza updatedAt/updatedBy (não é edição local)
        const release: Release = isUpsertBranch ? {
          id: finalId,
          demandId: releaseData.demandId || demandIdUpper,
          title: releaseData.title || '',
          description: releaseData.description || '',
          responsible: releaseData.responsible || { dev: '', functional: '', lt: '', sre: '' },
          secrets: releaseData.secrets || [],
          scripts: releaseData.scripts || [],
          repositories: mergedReposError,
          observations: releaseData.observations || '',
          createdAt: existingRelease?.createdAt || new Date(),
          // Não atualiza updatedAt/updatedBy em caso de erro (mantém existentes)
          updatedAt: existingRelease?.updatedAt || new Date(),
          createdBy: existingRelease?.createdBy || currentUser,
          updatedBy: existingRelease?.updatedBy,
          isVersioned: false
        } : {
          id: finalId,
          demandId: releaseData.demandId || demandIdUpper,
          title: releaseData.title || existingRelease?.title || '',
          description: releaseData.description || existingRelease?.description || '',
          responsible: releaseData.responsible || existingRelease?.responsible || { dev: '', functional: '', lt: '', sre: '' },
          secrets: releaseData.secrets || existingRelease?.secrets || [],
          scripts: releaseData.scripts || existingRelease?.scripts || [],
          repositories: mergedReposError,
          observations: releaseData.observations !== undefined ? releaseData.observations : (existingRelease?.observations || ''),
          createdAt: existingRelease?.createdAt || new Date(),
          // Não atualiza updatedAt/updatedBy em caso de erro (mantém existentes)
          updatedAt: existingRelease?.updatedAt || new Date(),
          createdBy: existingRelease?.createdBy || currentUser,
          updatedBy: existingRelease?.updatedBy,
          isVersioned: true
        };
        
        return this.localStorageReleaseService.syncRelease(release).pipe(
          map(() => ({ success: true, release })),
          catchError(syncError => {
            return of({ success: false, error: `Erro ao salvar: ${syncError.message}` });
          })
        );
      })
    );
  }
}
