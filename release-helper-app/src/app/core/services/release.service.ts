import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { map, delay } from 'rxjs/operators';
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

/**
 * Serviço para gerenciamento de Releases
 * 
 * Utiliza localStorage para persistência local.
 * Preparado para futura integração com API REST.
 */
@Injectable({
  providedIn: 'root'
})
export class ReleaseService {
  private readonly STORAGE_KEY = 'release_documents';
  private releasesSubject = new BehaviorSubject<Release[]>([]);
  
  releases$ = this.releasesSubject.asObservable();

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Carrega releases do localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const releases = JSON.parse(stored) as Release[];
        releases.forEach(r => {
          r.createdAt = new Date(r.createdAt);
          r.updatedAt = new Date(r.updatedAt);
        });
        this.releasesSubject.next(releases);
      }
    } catch (error) {
      console.error('Erro ao carregar releases do storage:', error);
      this.releasesSubject.next([]);
    }
  }

  /**
   * Salva releases no localStorage
   */
  private saveToStorage(releases: Release[]): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(releases));
      this.releasesSubject.next(releases);
    } catch (error) {
      console.error('Erro ao salvar releases no storage:', error);
    }
  }

  /**
   * Gera ID único
   */
  private generateId(): string {
    return `REL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
   * Cria nova release
   */
  create(release: Omit<Release, 'id' | 'createdAt' | 'updatedAt'>): Observable<Release> {
    const newRelease: Release = {
      ...release,
      id: this.generateId(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const releases = [...this.releasesSubject.value, newRelease];
    this.saveToStorage(releases);

    return of(newRelease).pipe(delay(300));
  }

  /**
   * Atualiza release existente
   */
  update(id: string, changes: Partial<Release>): Observable<Release | null> {
    const releases = this.releasesSubject.value;
    const index = releases.findIndex(r => r.id === id);

    if (index === -1) {
      return of(null);
    }

    const updatedRelease: Release = {
      ...releases[index],
      ...changes,
      id,
      updatedAt: new Date()
    };

    const updatedReleases = [
      ...releases.slice(0, index),
      updatedRelease,
      ...releases.slice(index + 1)
    ];

    this.saveToStorage(updatedReleases);
    return of(updatedRelease).pipe(delay(300));
  }

  /**
   * Remove release
   */
  delete(id: string): Observable<boolean> {
    const releases = this.releasesSubject.value;
    const filtered = releases.filter(r => r.id !== id);

    if (filtered.length === releases.length) {
      return of(false);
    }

    this.saveToStorage(filtered);
    return of(true).pipe(delay(300));
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
  createEmptyRelease(): Omit<Release, 'id' | 'createdAt' | 'updatedAt'> {
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
}
