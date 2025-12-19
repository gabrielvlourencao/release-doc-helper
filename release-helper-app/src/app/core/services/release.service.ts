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
        // Garante que demandId e nomes de scripts sejam trimados
        const trimmedRelease = {
          ...release,
          demandId: release.demandId.trim(),
          scripts: release.scripts?.map(script => ({
            ...script,
            name: script.name.trim()
          })) || []
        };
        const newRelease: Release = {
          ...trimmedRelease,
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
   * 
   * IMPORTANTE: Cria commits APENAS quando é uma edição manual do usuário.
   * NÃO cria commits durante sincronização (syncFromGitHub usa localStorageReleaseService diretamente).
   */
  update(id: string, changes: Partial<Release>, skipCommit: boolean = false): Observable<Release | null> {
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
        
        // Verifica se realmente houve mudança de conteúdo (não apenas metadata)
        const hasContentChanged = 
          (changes.title !== undefined && changes.title !== release.title) ||
          (changes.description !== undefined && changes.description !== release.description) ||
          (changes.responsible !== undefined && JSON.stringify(changes.responsible) !== JSON.stringify(release.responsible)) ||
          (changes.secrets !== undefined && JSON.stringify(changes.secrets) !== JSON.stringify(release.secrets)) ||
          (changes.scripts !== undefined && JSON.stringify(changes.scripts) !== JSON.stringify(release.scripts)) ||
          (changes.observations !== undefined && changes.observations !== release.observations) ||
          (changes.repositories !== undefined && JSON.stringify(changes.repositories) !== JSON.stringify(release.repositories));
        
        // Garante que demandId e nomes de scripts sejam trimados
        const trimmedChanges: Partial<Release> = { ...changes };
        if (trimmedChanges.demandId) {
          trimmedChanges.demandId = trimmedChanges.demandId.trim();
        }
        if (trimmedChanges.scripts) {
          trimmedChanges.scripts = trimmedChanges.scripts.map(script => ({
            ...script,
            name: script.name.trim()
          }));
        }
        
        const updatedRelease: Release = {
          ...release,
          ...trimmedChanges,
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
            // REGRA CRÍTICA: Só cria commits se:
            // 1. skipCommit é false (não é sincronização)
            // 2. REALMENTE mudou o conteúdo (não apenas metadata como isVersioned, updatedAt, etc)
            // 3. Tem repositórios
            // 4. Tem token GitHub
            
            // Se skipCommit é true, NÃO cria commits (usado durante sincronização)
            if (skipCommit) {
              return of(updatedRelease);
            }
            
            // Se não mudou conteúdo, NÃO cria commits
            // (evita commits quando apenas atualiza flags ou metadata)
            if (!hasContentChanged) {
              return of(updatedRelease);
            }
            
            // Se tem repositórios e token GitHub E mudou conteúdo, cria commit
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
        const demandId = release.demandId.trim();
        const scriptName = s.name.trim();
        md += `| ${scriptName} | \`scripts/${demandId}/${scriptName}\` | ${s.changeId || '-'} |\n`;
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
    md += `*Documento ATUALIZADO EM ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}*\n`;

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
      const demandId = release.demandId.trim();
      files.push({
        path: `releases/release_${demandId}.md`,
        content: this.generateMarkdown(release),
        type: 'markdown'
      });

      // Scripts relacionados ao repositório
      release.scripts.forEach(script => {
        if (script.content) {
          const demandId = release.demandId.trim();
          const scriptName = script.name.trim();
          files.push({
            path: `scripts/${demandId}/${scriptName}`,
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
          if (role.includes('dev')) responsible.dev = name === '-' ? '' : name;
          if (role.includes('funcional')) responsible.functional = name === '-' ? '' : name;
          if (role.includes('lt')) responsible.lt = name === '-' ? '' : name;
          if (role.includes('sre')) responsible.sre = name === '-' ? '' : name;
        }
      }
      
      // Parse de secrets e scripts será feito depois do loop usando regex (mais robusto)
      
      // Parse tabela de repositórios (## 5. Projetos Impactados)
      if (currentSection === 'repositories' && line.startsWith('|') && !line.includes('Repositório') && !line.includes('---')) {
        const parts = line.split('|').map(p => p.trim()).filter(p => p);
        if (parts.length >= 2) {
          const repoUrl = parts[0] || '';
          const impact = parts[1] || '';
          const branch = parts.length >= 3 ? (parts[2] || 'develop') : 'develop';
          
          if (repoUrl && repoUrl.includes('github.com')) {
            // Verifica se já não existe
            const repoName = repoUrl.replace(/https?:\/\/github.com\//, '').replace(/\/$/, '');
            if (!repositories.some(r => r.url === repoUrl || r.name === repoName)) {
              repositories.push({
                id: `repo-${repositories.length + 1}`,
                url: repoUrl,
                name: repoName,
                impact: impact || 'Release sincronizada do GitHub',
                releaseBranch: branch
              });
            }
          }
        }
      }
      
      if (currentSection === 'observations' && line && !line.startsWith('#') && !line.startsWith('---') && !line.startsWith('*Documento gerado') && !line.startsWith('*Documento ATUALIZADO')) {
        observations += (observations ? '\n' : '') + line;
      }
    }

    // Parse tabelas usando regex (mais robusto que linha por linha)
    const parsedSecrets = this.parseSecretsTableFromMarkdown(markdown);
    const parsedScripts = this.parseScriptsTableFromMarkdown(markdown, demandId);
    const parsedObservations = this.parseObservationsFromMarkdown(markdown);
    
    // Usa os dados parseados por regex se encontrou
    if (parsedSecrets.length > 0) {
      secrets.length = 0; // Limpa e usa os parseados
      secrets.push(...parsedSecrets);
    }
    
    if (parsedScripts.length > 0) {
      scripts.length = 0; // Limpa e usa os parseados
      scripts.push(...parsedScripts);
    }
    
    // Usa observações parseadas por regex se encontrou (mais robusto)
    if (parsedObservations) {
      observations = parsedObservations;
    }

    // Adiciona o repo de origem apenas se não existe na lista
    const repoExists = repositories.some(r => r.url.includes(repoFullName) || r.name === repoFullName);
    if (!repoExists) {
    repositories.push({
      id: `repo-${Date.now()}`,
      url: `https://github.com/${repoFullName}`,
      name: repoFullName,
        impact: 'Release sincronizada do GitHub',
      releaseBranch: 'develop'
      });
    }


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
   * Parse da tabela de secrets usando regex (mais robusto)
   */
  private parseSecretsTableFromMarkdown(content: string): ReleaseSecret[] {
    const secrets: ReleaseSecret[] = [];
    
    // Encontrar a seção de secrets (## 3. Keys ou Secrets)
    const secretsSection = content.match(/##\s*3\.\s*(Keys|Secrets)[^\n]*\n([\s\S]+?)(?=\n##)/i);
    if (!secretsSection || !secretsSection[2]) {
      console.warn(`[ReleaseService] ⚠️ Seção de secrets não encontrada no markdown`);
      return secrets;
    }

    // Encontrar linhas da tabela (ignorando header e separador)
    const tableLines = secretsSection[2].split('\n').filter(line => 
      line.trim().includes('|') && 
      !line.includes('---') && 
      !line.toLowerCase().includes('ambiente') &&
      !line.toLowerCase().includes('nenhuma secret')
    );


    tableLines.forEach((line, index) => {
      const cols = line.split('|').map(c => c.trim()).filter(c => c);
      if (cols.length >= 4 && cols[0] && cols[0] !== '-') {
        // Converte environment para enum
        const envStr = cols[0].toUpperCase();
        let environment: Environment = Environment.DEV;
        if (envStr.includes('QAS') || envStr.includes('QA')) {
          environment = Environment.QAS;
        } else if (envStr.includes('PRD') || envStr.includes('PROD')) {
          environment = Environment.PRD;
        }
        
        // Converte status para enum
        const statusStr = (cols[3] || '').toUpperCase();
        let status: SecretStatus = SecretStatus.PENDING;
        if (statusStr.includes('CONFIGURED') || statusStr.includes('CONFIGURADO') || statusStr.includes('OK')) {
          status = SecretStatus.CONFIGURED;
        } else if (statusStr.includes('NOT_REQUIRED') || statusStr.includes('NÃO NECESSÁRIO') || statusStr.includes('NAO NECESSARIO')) {
          status = SecretStatus.NOT_REQUIRED;
        }
        
        secrets.push({
          id: `secret-${Date.now()}-${index}`,
          environment: environment,
          key: cols[1] || '',
          description: cols[2] || '',
          status: status
        });
      }
    });

    return secrets;
  }

  /**
   * Parse da tabela de scripts usando regex (mais robusto)
   */
  private parseScriptsTableFromMarkdown(content: string, demandId: string): ReleaseScript[] {
    const scripts: ReleaseScript[] = [];
    
    // Encontrar a seção de scripts (## 4. Scripts ou Scripts Necessários)
    const scriptsSection = content.match(/##\s*4\.\s*Scripts[^\n]*\n([\s\S]+?)(?=\n##|\n---|$)/i);
    if (!scriptsSection || !scriptsSection[1]) {
      return scripts;
    }

    const sectionContent = scriptsSection[1];

    // Encontrar linhas da tabela - filtra mais cuidadosamente
    const allLines = sectionContent.split('\n');
    const tableLines = allLines.filter(line => {
      const trimmed = line.trim();
      // Deve ter | mas não ser linha de separador ou header
      if (!trimmed.includes('|')) return false;
      if (trimmed.match(/^\|[\s\-:]+\|/)) return false; // Linha separadora ---
      
      const lower = trimmed.toLowerCase();
      // Não pode ser header (mas pode ter a palavra script no nome do arquivo!)
      if (lower.includes('script') && (lower.includes('caminho') || lower.includes('path') || lower.includes('chg'))) {
        return false; // É header
      }
      
      return true;
    });


    tableLines.forEach((line, index) => {
      const cols = line.split('|').map(c => c.trim()).filter(c => c);
      
      
      if (cols.length >= 2 && cols[0] && cols[0] !== 'Nenhum' && cols[0] !== '-') {
        const scriptName = cols[0];
        
        // O path pode estar na segunda coluna entre backticks ou podemos construir
        let scriptPath = cols[1] || '';
        if (scriptPath.includes('`')) {
          scriptPath = scriptPath.replace(/`/g, '').trim();
        }
        // Se não tem path explícito, constrói baseado no nome
        if (!scriptPath || scriptPath === '-' || scriptPath === '') {
          const demandIdTrimmed = demandId.trim();
          const scriptNameTrimmed = scriptName.trim();
          scriptPath = `scripts/${demandIdTrimmed}/${scriptNameTrimmed}`;
        }
        
        const changeId = cols.length >= 3 ? (cols[2] === '-' ? '' : cols[2]) : '';
        
        scripts.push({
          id: `script-${Date.now()}-${index}`,
          name: scriptName,
          path: scriptPath,
          content: '', // Conteúdo não está no markdown, só o nome
          changeId: changeId
        });
      }
    });


    return scripts;
  }

  /**
   * Parse de observações usando regex (mais robusto)
   */
  private parseObservationsFromMarkdown(content: string): string | null {
    // Busca a seção de observações (## 6. Observações, Observações Gerais, etc)
    // Captura tudo até encontrar ---, ## (próxima seção) ou fim do arquivo
    // Aceita variações: "## 6. Observações", "## 6. Observações Gerais", etc
    const obsMatch = content.match(/##\s*6\.\s*Observa[çc][õo]es[^\n]*\n([\s\S]+?)(?=\n---|\n##|$)/i);
    
    if (obsMatch && obsMatch[1]) {
      let observations = obsMatch[1].trim();
      
      // Remove linhas que são apenas separadores ou metadados
      observations = observations
        .split('\n')
        .filter(line => {
          const trimmed = line.trim();
          // Remove linhas vazias no início/fim, separadores e metadados
          return trimmed && 
                 !trimmed.startsWith('*Documento gerado') && !trimmed.startsWith('*Documento ATUALIZADO') &&
                 !trimmed.startsWith('---') &&
                 !trimmed.match(/^[-*_]{3,}$/); // Remove separadores de markdown
        })
        .join('\n')
        .trim();
      
      return observations || null;
    }
    
    return null;
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
          const demandId = release.demandId.trim();
          const filePath = `releases/release_${demandId}.md`;
          const message = action === 'create' 
            ? `docs: cria release ${demandId}`
            : `docs: atualiza release ${demandId}`;

          return this.githubService.createOrUpdateFile(owner, repoName, filePath, markdown, message, this.UPSERT_BRANCH).pipe(
            catchError(err => {
              console.warn(`Erro ao criar/atualizar arquivo em ${repoName}:`, err);
              return of(void 0);
            })
          );
        }),
        // 3. Cria/atualiza os scripts se houver (agrupados em um único commit se múltiplos)
        switchMap(() => {
          if (release.scripts.length === 0) return of(void 0);

          const scriptsToUpdate = release.scripts.filter(script => script.content);
          if (scriptsToUpdate.length === 0) return of(void 0);

          // Se tem múltiplos scripts, agrupa em um único commit
          if (scriptsToUpdate.length > 1) {
            const demandId = release.demandId.trim();
            const message = `docs: ${action === 'create' ? 'adiciona' : 'atualiza'} ${scriptsToUpdate.length} scripts para release ${demandId}`;
            
            // Para agrupar, precisamos fazer commits sequenciais na mesma branch
            // O GitHub API não suporta múltiplos arquivos em um único commit diretamente
            // Então fazemos todos os commits sequencialmente com a mesma mensagem
            // Isso cria commits separados, mas com mensagens idênticas (visíveis como um grupo)
            let scriptChain$: Observable<void> = of(void 0);
            
            scriptsToUpdate.forEach((script) => {
              const scriptName = script.name.trim();
              const scriptPath = `scripts/${demandId}/${scriptName}`;
              scriptChain$ = scriptChain$.pipe(
                switchMap(() => this.githubService.createOrUpdateFile(owner, repoName, scriptPath, script.content!, message, this.UPSERT_BRANCH).pipe(
                  catchError(err => {
                    console.warn(`Erro ao criar/atualizar script ${scriptName} em ${repoName}:`, err);
                    return of(void 0);
                  }),
                  map(() => void 0 as void)
                ))
              );
            });

            return scriptChain$;
          } else {
            // Apenas um script, cria commit individual
            const script = scriptsToUpdate[0];
              const demandId = release.demandId.trim();
              const scriptName = script.name.trim();
              const scriptPath = `scripts/${demandId}/${scriptName}`;
              const message = `docs: ${action === 'create' ? 'adiciona' : 'atualiza'} script ${scriptName} para release ${demandId}`;

              return this.githubService.createOrUpdateFile(owner, repoName, scriptPath, script.content!, message, this.UPSERT_BRANCH).pipe(
                catchError(err => {
                  console.warn(`Erro ao criar/atualizar script ${scriptName} em ${repoName}:`, err);
                  return of(void 0);
                })
              );
          }
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

      const demandId = release.demandId.trim();
      const releaseFilePath = `releases/release_${demandId}.md`;
      return this.githubService.getFileSha(repoInfo.owner, repoInfo.repo, releaseFilePath, 'develop').pipe(
        map((sha: string | null) => sha !== null),
        catchError(() => of(false))
      );
    });

    return forkJoin(checks).pipe(
      map(results => results.some(exists => exists === true))
    );
  }

  // Removido: hasPendingCommits (consumia muita memória com requisições ao GitHub)
  // Agora usa apenas isVersioned do localStorage: se isVersioned === false, está pendente de versionar

  /**
   * Desfaz a última edição de uma release (undo commit)
   * Restaura os arquivos para o estado anterior ao último commit de edição
   */
  revertPendingCommits(release: Release): Observable<{ success: boolean; errors: string[] }> {
    if (!release.repositories || release.repositories.length === 0) {
      return of({ success: false, errors: ['Release não tem repositórios associados'] });
    }

    if (!this.githubService.hasValidToken()) {
      return of({ success: false, errors: ['Token GitHub não disponível'] });
    }

    const errors: string[] = [];
    const operations = release.repositories.map(repo => {
      const repoInfo = this.githubService.parseRepositoryUrl(repo.url);
      if (!repoInfo) {
        errors.push(`URL inválida: ${repo.url}`);
        return of({ success: false, repo: repo.url });
      }

      const { owner, repo: repoName } = repoInfo;
      const demandId = release.demandId.trim();
      const releaseFilePath = `releases/release_${demandId}.md`;

      // Desfaz o último commit do arquivo de release
      // Por enquanto, reverte apenas o arquivo de release para evitar múltiplos commits
      // Os scripts geralmente não são editados separadamente, então não precisam ser revertidos
      return this.githubService.undoLastCommit(owner, repoName, releaseFilePath, this.UPSERT_BRANCH, release.demandId).pipe(
        map(() => ({ success: true, repo: repoName })),
        catchError(err => {
          const errorMsg = `Erro ao reverter commits em ${repoName}: ${err.message || err}`;
          errors.push(errorMsg);
          console.error(errorMsg, err);
          return of({ success: false, repo: repoName });
        })
      );
    });

    return forkJoin(operations).pipe(
      map(results => {
        const allSuccess = results.every(r => r.success);
        return { success: allSuccess, errors };
      })
    );
  }
}
