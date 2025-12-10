import { Injectable } from '@angular/core';
import { Observable, of, forkJoin } from 'rxjs';
import { map, switchMap, catchError, take } from 'rxjs/operators';
import { throwError } from 'rxjs';
import {
  Release,
  ReleaseResponsible,
  ReleaseSecret,
  ReleaseScript,
  ReleaseRepository,
  Environment,
  SecretStatus,
  VersioningResult,
  VersionedFile
} from '../../models';
import { LocalStorageReleaseService } from './local-storage-release.service';
import { GitHubAuthService } from './github-auth.service';
import { GitHubService } from './github.service';

export interface GitHubReleaseFile {
  repo: string;
  owner: string;
  repoName: string;
  name: string;
  path: string;
  sha: string;
}

/**
 * Serviço para gerenciamento de Releases
 * 
 * Usa localStorage para armazenamento local e cria commits na branch
 * feature/upsert-release quando criar/editar releases não versionadas.
 */
@Injectable({
  providedIn: 'root'
})
export class ReleaseService {
  // Observable de releases do localStorage
  releases$ = this.localStorageReleaseService.getAll();

  private readonly UPSERT_BRANCH = 'feature/upsert-release';

  constructor(
    private localStorageReleaseService: LocalStorageReleaseService,
    private authService: GitHubAuthService,
    private githubService: GitHubService
  ) {}

  /**
   * Gera ID único
   */
  private generateId(): string {
    return `REL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
   * Retorna todas as releases
   */
  getAll(): Observable<Release[]> {
    return this.releases$;
  }

  /**
   * Retorna release por ID
   */
  getById(id: string): Observable<Release | undefined> {
    return this.releases$.pipe(
      map(releases => releases.find(r => r.id === id))
    );
  }

  /**
   * Retorna release por ID da demanda
   */
  getByDemandId(demandId: string): Observable<Release | undefined> {
    return this.releases$.pipe(
      map(releases => releases.find(r => r.demandId.toUpperCase() === demandId.toUpperCase()))
    );
  }

  /**
   * Busca releases por termo
   */
  search(term: string): Observable<Release[]> {
    const searchTerm = term.toLowerCase();
    return this.releases$.pipe(
      map(releases => releases.filter(r =>
        r.demandId.toLowerCase().includes(searchTerm) ||
        r.title.toLowerCase().includes(searchTerm) ||
        r.description.toLowerCase().includes(searchTerm) ||
        r.responsible.dev.toLowerCase().includes(searchTerm) ||
        r.responsible.functional.toLowerCase().includes(searchTerm)
      ))
    );
  }

  /**
   * Cria nova release e salva no localStorage e cria commit na branch feature/upsert-release
   */
  create(release: Omit<Release, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isVersioned'>): Observable<Release> {
    // Verifica se já existe uma release com o mesmo demandId
    return this.localStorageReleaseService.getByDemandId(release.demandId).pipe(
      take(1),
      switchMap(existingRelease => {
        if (existingRelease) {
          // Se já existe, atualiza ao invés de criar nova
          return this.update(existingRelease.id, {
            ...release,
            isVersioned: false
          }).pipe(
            map(updated => updated!),
            catchError(error => {
              console.error('Erro ao atualizar release existente:', error);
              return throwError(() => error);
            })
          );
        }
        
        // Cria nova release
        const currentUser = this.getCurrentUserLogin();
        const newRelease: Release = {
          ...release,
          id: this.generateId(),
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: currentUser,
          updatedBy: currentUser,
          isVersioned: false // Nova release sempre começa como não versionada
        };

        // Salva no localStorage
        return this.localStorageReleaseService.syncRelease(newRelease).pipe(
          switchMap(() => {
            // Se tem repositórios e token GitHub, cria commit na branch feature/upsert-release
            if (release.repositories && release.repositories.length > 0 && this.githubService.hasValidToken()) {
              return this.commitToUpsertBranch(newRelease, 'create').pipe(
                map(() => newRelease),
                catchError(error => {
                  console.warn('Erro ao criar commit na branch feature/upsert-release:', error);
                  // Continua mesmo se falhar o commit, a release já está salva no localStorage
                  return of(newRelease);
                })
              );
            }
            return of(newRelease);
          }),
          catchError(error => {
            console.error('Erro ao criar release:', error);
            return throwError(() => error);
          })
        );
      })
    );
  }

  /**
   * Atualiza release existente no localStorage e cria commit na branch feature/upsert-release
   * Quando uma release é editada, ela é marcada como não versionada
   */
  update(id: string, changes: Partial<Release>): Observable<Release | null> {
    // Busca a release no localStorage
    return this.releases$.pipe(
      take(1),
      switchMap(releases => {
        const release = releases.find(r => r.id === id);
        
        if (!release) {
          console.warn('Release não encontrada para edição');
          return of(null);
        }

        const currentUser = this.getCurrentUserLogin();
        const wasVersioned = release.isVersioned ?? false;
        
        const updatedRelease: Release = {
          ...release,
          ...changes,
          id,
          updatedAt: new Date(),
          updatedBy: currentUser || release.updatedBy,
          // Se estava versionada, mantém como versionada (agora terá commits pendentes)
          // Se não estava versionada, mantém como não versionada
          isVersioned: changes.isVersioned !== undefined ? changes.isVersioned : wasVersioned
        };

        // Atualiza no localStorage
        return this.localStorageReleaseService.syncRelease(updatedRelease).pipe(
          switchMap(() => {
            // Se tem repositórios e token GitHub, cria commit na branch feature/upsert-release
            if (updatedRelease.repositories && updatedRelease.repositories.length > 0 && this.githubService.hasValidToken()) {
              return this.commitToUpsertBranch(updatedRelease, 'update').pipe(
                map(() => updatedRelease),
                catchError(error => {
                  console.warn('Erro ao criar commit na branch feature/upsert-release:', error);
                  // Continua mesmo se falhar o commit, a release já está salva no localStorage
                  return of(updatedRelease);
                })
              );
            }
            return of(updatedRelease);
          }),
          catchError(error => {
            console.error('Erro ao atualizar release:', error);
            return throwError(() => error);
          })
        );
      })
    );
  }

  /**
   * Remove release do localStorage
   */
  delete(id: string): Observable<boolean> {
    return this.localStorageReleaseService.deleteRelease(id).pipe(
      map(() => true),
      catchError(error => {
        console.error('Erro ao deletar release:', error);
        return of(false);
      })
    );
  }

  /**
   * Gera documento Markdown da release
   */
  generateMarkdown(release: Release): string {
    let md = `# Release ${release.demandId}\n\n`;

    if (release.title) {
      md += `**${release.title}**\n\n`;
    }

    // Responsáveis
    md += `## 1. Responsáveis\n`;
    md += `| Função | Nome |\n`;
    md += `|--------|------|\n`;
    md += `| Dev    | ${release.responsible.dev} |\n`;
    md += `| Funcional | ${release.responsible.functional || '-'} |\n`;
    md += `| LT     | ${release.responsible.lt || '-'} |\n`;
    md += `| SRE    | ${release.responsible.sre || '-'} |\n\n`;

    // Descrição
    md += `## 2. Descrição da Release\n`;
    md += `> ${release.description}\n\n`;

    // Keys/Secrets
    md += `## 3. Keys ou Secrets Necessárias\n`;
    md += `| Ambiente | Key/Secret | Descrição | Status |\n`;
    md += `|----------|------------|-----------|--------|\n`;
    if (release.secrets.length > 0) {
      release.secrets.forEach(s => {
        md += `| ${s.environment} | ${s.key} | ${s.description} | ${s.status} |\n`;
      });
    } else {
      md += `| - | Nenhuma secret necessária | - | - |\n`;
    }
    md += '\n';

    // Scripts
    md += `## 4. Scripts Necessários\n`;
    if (release.scripts.length > 0) {
      md += `| Script | Caminho (Path) | CHG |\n`;
      md += `|--------|----------------|-----|\n`;
      release.scripts.forEach(s => {
        md += `| ${s.name} | \`scripts/${release.demandId}/${s.name}\` | ${s.changeId || '-'} |\n`;
      });
    } else {
      md += `Nenhum script necessário.\n`;
    }
    md += '\n';

    // Repositórios
    md += `## 5. Projetos Impactados (Repositórios)\n`;
    md += `| Repositório | Impacto/Alteração | Branch Release |\n`;
    md += `|-------------|-------------------|----------------|\n`;
    release.repositories.forEach(r => {
      md += `| ${r.url} | ${r.impact} | ${r.releaseBranch || '-'} |\n`;
    });
    md += '\n';

    // Observações
    if (release.observations) {
      md += `## 6. Observações Gerais\n`;
      md += `${release.observations}\n\n`;
    }

    md += `---\n`;
    md += `*Documento gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}*\n`;

    return md;
  }

  /**
   * Gera estrutura de arquivos para versionamento por repositório
   */
  generateVersioningStructure(release: Release): VersioningResult[] {
    const results: VersioningResult[] = [];

    // Para cada repositório impactado, gerar a estrutura de arquivos
    release.repositories.forEach(repo => {
      const repoName = this.extractRepoName(repo.url);
      const files: VersionedFile[] = [];

      // Arquivo markdown da release
      files.push({
        path: `releases/release_${release.demandId}.md`,
        content: this.generateMarkdown(release),
        type: 'markdown'
      });

      // Scripts relacionados ao repositório
      release.scripts.forEach(script => {
        if (script.content) {
          files.push({
            path: `scripts/${release.demandId}/${script.name}`,
            content: script.content,
            type: 'script'
          });
        }
      });

      results.push({
        repoName: repoName || repo.url,
        files
      });
    });

    return results;
  }

  /**
   * Extrai nome do repositório da URL
   */
  private extractRepoName(url: string): string {
    try {
      // Remove .git do final se houver
      const cleanUrl = url.replace(/\.git$/, '');
      // Pega a última parte da URL
      const parts = cleanUrl.split('/');
      return parts[parts.length - 1] || '';
    } catch {
      return '';
    }
  }

  /**
   * Cria release vazia para formulário
   */
  createEmptyRelease(): Omit<Release, 'id' | 'createdAt' | 'updatedAt' | 'isVersioned'> {
    return {
      demandId: '',
      title: '',
      description: '',
      responsible: {
        dev: '',
        functional: '',
        lt: '',
        sre: ''
      },
      secrets: [],
      scripts: [],
      repositories: [],
      observations: ''
    };
  }

  /**
   * Cria secret vazia
   */
  createEmptySecret(): Omit<ReleaseSecret, 'id'> {
    return {
      environment: Environment.DEV,
      key: '',
      description: '',
      status: SecretStatus.PENDING
    };
  }

  /**
   * Cria script vazio
   */
  createEmptyScript(): Omit<ReleaseScript, 'id'> {
    return {
      name: '',
      path: '',
      content: '',
      changeId: ''
    };
  }

  /**
   * Cria repositório vazio
   */
  createEmptyRepository(): Omit<ReleaseRepository, 'id'> {
    return {
      url: '',
      name: '',
      impact: '',
      releaseBranch: ''
    };
  }

  /**
   * Faz parse de um markdown de release para objeto Release
   */
  parseMarkdownToRelease(markdown: string, fileName: string, repoFullName: string): Partial<Release> {
    const lines = markdown.split('\n');
    
    // Extrai demandId do nome do arquivo (release_XXXX.md)
    const demandIdMatch = fileName.match(/release_(.+)\.md$/);
    const demandId = demandIdMatch ? demandIdMatch[1] : fileName.replace('.md', '');
    
    // Extrai título
    let title = '';
    let description = '';
    const responsible: ReleaseResponsible = { dev: '', functional: '', lt: '', sre: '' };
    const secrets: ReleaseSecret[] = [];
    const scripts: ReleaseScript[] = [];
    const repositories: ReleaseRepository[] = [];
    let observations = '';

    let currentSection = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Detecta seções
      if (line.startsWith('## 1.') || line.toLowerCase().includes('responsáveis')) {
        currentSection = 'responsible';
        continue;
      }
      if (line.startsWith('## 2.') || line.toLowerCase().includes('descrição')) {
        currentSection = 'description';
        continue;
      }
      if (line.startsWith('## 3.') || line.toLowerCase().includes('keys') || line.toLowerCase().includes('secrets')) {
        currentSection = 'secrets';
        continue;
      }
      if (line.startsWith('## 4.') || line.toLowerCase().includes('scripts')) {
        currentSection = 'scripts';
        continue;
      }
      if (line.startsWith('## 5.') || line.toLowerCase().includes('repositórios') || line.toLowerCase().includes('projetos')) {
        currentSection = 'repositories';
        continue;
      }
      if (line.startsWith('## 6.') || line.toLowerCase().includes('observações')) {
        currentSection = 'observations';
        continue;
      }
      
      // Extrai título (linha com **)
      if (line.startsWith('**') && line.endsWith('**') && !title) {
        title = line.replace(/\*\*/g, '');
        continue;
      }
      
      // Processa seções
      if (currentSection === 'description' && line.startsWith('>')) {
        description = line.replace(/^>\s*/, '');
      }
      
      if (currentSection === 'responsible' && line.startsWith('|') && !line.includes('Função')) {
        const parts = line.split('|').map(p => p.trim()).filter(p => p);
        if (parts.length >= 2) {
          const role = parts[0].toLowerCase();
          const name = parts[1];
          if (role.includes('dev')) responsible.dev = name;
          if (role.includes('funcional')) responsible.functional = name;
          if (role.includes('lt')) responsible.lt = name;
          if (role.includes('sre')) responsible.sre = name;
        }
      }
      
      if (currentSection === 'observations' && line && !line.startsWith('#') && !line.startsWith('---')) {
        observations += (observations ? '\n' : '') + line;
      }
    }

    // Adiciona o repo de origem
    repositories.push({
      id: `repo-${Date.now()}`,
      url: `https://github.com/${repoFullName}`,
      name: repoFullName,
      impact: 'Origem do documento',
      releaseBranch: 'develop'
    });

    return {
      demandId,
      title: title || demandId,
      description,
      responsible,
      secrets,
      scripts,
      repositories,
      observations
    };
  }

  /**
   * Cria/atualiza release a partir de dados do GitHub
   * Este método é usado pelo SyncService para sincronizar releases do GitHub para o localStorage.
   * Releases sincronizadas do GitHub são marcadas como versionadas
   */
  createOrUpdateFromGitHub(releaseData: Partial<Release>, sourceRepo: string, sourcePath: string): Observable<Release> {
    // Verifica se já existe uma release com esse demandId no localStorage
    return this.localStorageReleaseService.getByDemandId(releaseData.demandId || '').pipe(
      take(1),
      switchMap(existing => {
        if (existing) {
          // Atualiza, preservando createdBy/updatedBy se vierem do releaseData
          // Mas marca como versionada porque veio do GitHub
          return this.localStorageReleaseService.syncRelease({
            ...existing,
            ...releaseData,
            id: existing.id,
            updatedAt: new Date(),
            createdBy: releaseData.createdBy || existing.createdBy,
            updatedBy: releaseData.updatedBy || existing.updatedBy,
            isVersioned: true // Releases do GitHub são versionadas
          }).pipe(map(() => ({ ...existing, ...releaseData, isVersioned: true } as Release)));
        } else {
          // Cria nova, preservando createdBy/updatedBy se vierem do releaseData
          const newRelease: Release = {
            id: this.generateId(),
            demandId: releaseData.demandId || '',
            title: releaseData.title || '',
            description: releaseData.description || '',
            responsible: releaseData.responsible || { dev: '', functional: '', lt: '', sre: '' },
            secrets: releaseData.secrets || [],
            scripts: releaseData.scripts || [],
            repositories: releaseData.repositories || [],
            observations: releaseData.observations || '',
            createdAt: releaseData.createdAt || new Date(),
            updatedAt: new Date(),
            createdBy: releaseData.createdBy,
            updatedBy: releaseData.updatedBy,
            isVersioned: true // Releases do GitHub são versionadas
          };

          return this.localStorageReleaseService.syncRelease(newRelease).pipe(
            map(() => newRelease)
          );
        }
      })
    );
  }

  /**
   * Cria commit na branch feature/upsert-release para releases não versionadas
   */
  private commitToUpsertBranch(release: Release, action: 'create' | 'update'): Observable<void> {
    if (!release.repositories || release.repositories.length === 0) {
      return of(void 0);
    }

    const operations = release.repositories.map(repo => {
      const repoInfo = this.githubService.parseRepositoryUrl(repo.url);
      if (!repoInfo) {
        return of(void 0);
      }

      const { owner, repo: repoName } = repoInfo;
      const baseBranch = 'develop';

      // 1. Cria a branch feature/upsert-release se não existir
      return this.githubService.createBranch(owner, repoName, this.UPSERT_BRANCH, baseBranch).pipe(
        catchError(() => of(void 0)), // Branch já existe, continua
        // 2. Cria/atualiza o arquivo de release
        switchMap(() => {
          const markdown = this.generateMarkdown(release);
          const filePath = `releases/release_${release.demandId}.md`;
          const message = action === 'create' 
            ? `docs: cria release ${release.demandId}`
            : `docs: atualiza release ${release.demandId}`;

          return this.githubService.createOrUpdateFile(owner, repoName, filePath, markdown, message, this.UPSERT_BRANCH).pipe(
            catchError(err => {
              console.warn(`Erro ao criar/atualizar arquivo em ${repoName}:`, err);
              return of(void 0);
            })
          );
        }),
        // 3. Cria/atualiza os scripts se houver
        switchMap(() => {
          if (release.scripts.length === 0) return of(void 0);

          const scriptOperations = release.scripts
            .filter(script => script.content)
            .map(script => {
              const scriptPath = `scripts/${release.demandId}/${script.name}`;
              const message = `docs: ${action === 'create' ? 'adiciona' : 'atualiza'} script ${script.name} para release ${release.demandId}`;

              return this.githubService.createOrUpdateFile(owner, repoName, scriptPath, script.content!, message, this.UPSERT_BRANCH).pipe(
                catchError(err => {
                  console.warn(`Erro ao criar/atualizar script ${script.name} em ${repoName}:`, err);
                  return of(void 0);
                })
              );
            });

          return forkJoin(scriptOperations.length > 0 ? scriptOperations : [of(void 0)]);
        })
      );
    });

    return forkJoin(operations).pipe(
      map(() => void 0),
      catchError(error => {
        console.error('Erro ao criar commits na branch feature/upsert-release:', error);
        return of(void 0);
      })
    );
  }

  /**
   * Verifica se uma release foi versionada (tem arquivo no GitHub)
   * Retorna true se pelo menos um dos repositórios associados tem o arquivo de release
   */
  isReleaseVersioned(release: Release): Observable<boolean> {
    // Se não tem repositórios associados, não foi versionada
    if (!release.repositories || release.repositories.length === 0) {
      return of(false);
    }

    // Verifica se tem token GitHub disponível
    if (!this.githubService.hasValidToken()) {
      return of(false);
    }

    // Verifica em cada repositório se o arquivo existe
    const checks = release.repositories.map(repo => {
      const repoInfo = this.githubService.parseRepositoryUrl(repo.url);
      if (!repoInfo) {
        return of(false);
      }

      const releaseFilePath = `releases/release_${release.demandId}.md`;
      return this.githubService.getFileSha(repoInfo.owner, repoInfo.repo, releaseFilePath, 'develop').pipe(
        map((sha: string | null) => sha !== null),
        catchError(() => of(false))
      );
    });

    return forkJoin(checks).pipe(
      map(results => results.some(exists => exists === true))
    );
  }

  /**
   * Verifica se uma release tem commits pendentes de PR
   * Retorna true se a release está versionada (em develop) mas o arquivo na feature/upsert-release é diferente (não mergeado)
   */
  hasPendingCommits(release: Release): Observable<boolean> {
    // Se não tem repositórios associados, não tem commits pendentes
    if (!release.repositories || release.repositories.length === 0) {
      return of(false);
    }

    // Verifica se tem token GitHub disponível
    if (!this.githubService.hasValidToken()) {
      return of(false);
    }

    // Primeiro verifica se está versionada
    return this.isReleaseVersioned(release).pipe(
      switchMap(isVersioned => {
        if (!isVersioned) {
          return of(false); // Se não está versionada, não tem commits pendentes
        }

        // Se está versionada, verifica se o arquivo na feature/upsert-release é diferente do develop (não mergeado)
        const checks = release.repositories.map(repo => {
          const repoInfo = this.githubService.parseRepositoryUrl(repo.url);
          if (!repoInfo) {
            return of(false);
          }

          const releaseFilePath = `releases/release_${release.demandId}.md`;
          
          // Busca SHA do arquivo em ambas as branches
          const developSha$ = this.githubService.getFileSha(repoInfo.owner, repoInfo.repo, releaseFilePath, 'develop');
          const upsertSha$ = this.githubService.getFileSha(repoInfo.owner, repoInfo.repo, releaseFilePath, this.UPSERT_BRANCH);
          
          return forkJoin([developSha$, upsertSha$]).pipe(
            map(([developSha, upsertSha]) => {
              // Tem commits pendentes se o arquivo existe na upsert e é diferente do develop
              return upsertSha !== null && developSha !== null && upsertSha !== developSha;
            }),
            catchError(() => of(false))
          );
        });

        return forkJoin(checks).pipe(
          map(results => results.some(hasPending => hasPending === true))
        );
      })
    );
  }
}
