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
import { FirestoreReleaseService } from './firestore-release.service';
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
 * Usa apenas Firestore para armazenamento, permitindo edição colaborativa
 * entre múltiplos usuários antes de versionar no GitHub.
 */
@Injectable({
  providedIn: 'root'
})
export class ReleaseService {
  // Observable de releases do Firestore
  releases$ = this.firestoreReleaseService.getAll();

  constructor(
    private firestoreReleaseService: FirestoreReleaseService,
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
   * Cria nova release e salva no Firestore para permitir edição colaborativa
   */
  create(release: Omit<Release, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'isVersioned'>): Observable<Release> {
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

    // Salva no Firestore
    return this.firestoreReleaseService.syncRelease(newRelease).pipe(
      map(() => newRelease),
      catchError(error => {
        console.error('Erro ao criar release no Firestore:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Atualiza release existente no Firestore
   * Permite edição colaborativa antes de versionar
   * Quando uma release é editada, ela é marcada como não versionada
   */
  update(id: string, changes: Partial<Release>): Observable<Release | null> {
    // Busca a release no Firestore
    return this.releases$.pipe(
      take(1),
      switchMap(releases => {
        const release = releases.find(r => r.id === id);
        
        if (!release) {
          console.warn('Release não encontrada para edição');
          return of(null);
        }

        const currentUser = this.getCurrentUserLogin();
        const updatedRelease: Release = {
          ...release,
          ...changes,
          id,
          updatedAt: new Date(),
          updatedBy: currentUser || release.updatedBy,
          // Marca como não versionada quando editada (a menos que explicitamente seja definido como versionada)
          isVersioned: changes.isVersioned !== undefined ? changes.isVersioned : false
        };

        // Atualiza no Firestore
        return this.firestoreReleaseService.syncRelease(updatedRelease).pipe(
          map(() => updatedRelease),
          catchError(error => {
            console.error('Erro ao atualizar release no Firestore:', error);
            return throwError(() => error);
          })
        );
      })
    );
  }

  /**
   * Remove release do Firestore
   */
  delete(id: string): Observable<boolean> {
    return this.firestoreReleaseService.deleteRelease(id).pipe(
      map(() => true),
      catchError(error => {
        console.error('Erro ao deletar release do Firestore:', error);
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
   * Este método é usado pelo SyncService para sincronizar releases do GitHub para o Firestore.
   * Releases sincronizadas do GitHub são marcadas como versionadas
   */
  createOrUpdateFromGitHub(releaseData: Partial<Release>, sourceRepo: string, sourcePath: string): Observable<Release> {
    // Verifica se já existe uma release com esse demandId no Firestore
    return this.firestoreReleaseService.getByDemandId(releaseData.demandId || '').pipe(
      take(1),
      switchMap(existing => {
        if (existing) {
          // Atualiza, preservando createdBy/updatedBy se vierem do releaseData
          // Mas marca como versionada porque veio do GitHub
          return this.update(existing.id, {
            ...releaseData,
            updatedAt: new Date(),
            createdBy: releaseData.createdBy || existing.createdBy,
            updatedBy: releaseData.updatedBy || existing.updatedBy,
            isVersioned: true // Releases do GitHub são versionadas
          }).pipe(map(r => r!));
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

          return this.firestoreReleaseService.syncRelease(newRelease).pipe(
            map(() => newRelease)
          );
        }
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
}
