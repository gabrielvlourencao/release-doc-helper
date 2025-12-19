import { Injectable } from '@angular/core';
import {
  Release,
  Environment,
  SecretStatus,
  ReleaseSecret,
  ReleaseScript,
  ReleaseRepository
} from '../../models';

/**
 * Serviço para importação de documentos Markdown
 * Faz parsing do arquivo .md para extrair dados da release
 */
@Injectable({
  providedIn: 'root'
})
export class ImportService {

  /**
   * Faz parse do conteúdo Markdown e extrai os dados da release
   */
  parseMarkdown(content: string): Partial<Release> {
    const release: Partial<Release> = {
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

    // Extrair ID da demanda do título (# Release DMND0014560)
    const titleMatch = content.match(/^#\s*Release\s+(\w+)/im);
    if (titleMatch) {
      release.demandId = titleMatch[1];
    }

    // Extrair título (linha com ** após o título principal)
    const subtitleMatch = content.match(/^\*\*(.+)\*\*$/m);
    if (subtitleMatch) {
      release.title = subtitleMatch[1];
    }

    // Extrair Responsáveis da tabela
    const responsaveisMatch = content.match(/\|\s*Dev\s*\|\s*([^|]+)\s*\|/i);
    if (responsaveisMatch && release.responsible) {
      release.responsible.dev = responsaveisMatch[1].trim();
    }

    const funcionalMatch = content.match(/\|\s*Funcional\s*\|\s*([^|]+)\s*\|/i);
    if (funcionalMatch && release.responsible) {
      release.responsible.functional = funcionalMatch[1].trim() === '-' ? '' : funcionalMatch[1].trim();
    }

    const ltMatch = content.match(/\|\s*LT\s*\|\s*([^|]+)\s*\|/i);
    if (ltMatch && release.responsible) {
      release.responsible.lt = ltMatch[1].trim() === '-' ? '' : ltMatch[1].trim();
    }

    const sreMatch = content.match(/\|\s*SRE\s*\|\s*([^|]+)\s*\|/i);
    if (sreMatch && release.responsible) {
      release.responsible.sre = sreMatch[1].trim() === '-' ? '' : sreMatch[1].trim();
    }

    // Extrair Descrição (entre ## 2. Descrição e ## 3.)
    const descMatch = content.match(/##\s*2\.\s*Descrição[^\n]*\n>\s*(.+?)(?=\n\n##|\n##)/is);
    if (descMatch) {
      release.description = descMatch[1].trim();
    }

    // Extrair Secrets da tabela (## 3. Keys ou Secrets)
    release.secrets = this.parseSecretsTable(content);

    // Extrair Scripts da tabela (## 4. Scripts)
    release.scripts = this.parseScriptsTable(content, release.demandId || '');

    // Extrair Repositórios da tabela (## 5. Projetos Impactados)
    release.repositories = this.parseRepositoriesTable(content);

    // Extrair Observações (## 6. Observações)
    const obsMatch = content.match(/##\s*6\.\s*Observa[çc][õo]es[^\n]*\n([\s\S]+?)(?=\n---|\n##|$)/i);
    if (obsMatch) {
      release.observations = obsMatch[1].trim();
    }

    return release;
  }

  /**
   * Parse da tabela de secrets
   */
  private parseSecretsTable(content: string): ReleaseSecret[] {
    const secrets: ReleaseSecret[] = [];
    
    // Encontrar a seção de secrets
    const secretsSection = content.match(/##\s*3\.\s*Keys[^\n]*\n([\s\S]+?)(?=\n##)/i);
    if (!secretsSection) return secrets;

    // Encontrar linhas da tabela (ignorando header e separador)
    const tableLines = secretsSection[1].split('\n').filter(line => 
      line.includes('|') && 
      !line.includes('---') && 
      !line.includes('Ambiente') &&
      !line.includes('Nenhuma secret')
    );

    tableLines.forEach((line, index) => {
      const cols = line.split('|').map(c => c.trim()).filter(c => c);
      if (cols.length >= 4 && cols[0] !== '-') {
        secrets.push({
          id: `secret-${Date.now()}-${index}`,
          environment: this.parseEnvironment(cols[0]),
          key: cols[1],
          description: cols[2],
          status: this.parseSecretStatus(cols[3])
        });
      }
    });

    return secrets;
  }

  /**
   * Parse da tabela de scripts
   */
  private parseScriptsTable(content: string, demandId: string): ReleaseScript[] {
    const scripts: ReleaseScript[] = [];
    
    // Encontrar a seção de scripts
    const scriptsSection = content.match(/##\s*4\.\s*Scripts[^\n]*\n([\s\S]+?)(?=\n##)/i);
    if (!scriptsSection) return scripts;

    // Encontrar linhas da tabela
    const tableLines = scriptsSection[1].split('\n').filter(line => 
      line.includes('|') && 
      !line.includes('---') && 
      !line.includes('Script') &&
      !line.includes('Caminho')
    );

    tableLines.forEach((line, index) => {
      const cols = line.split('|').map(c => c.trim()).filter(c => c);
      if (cols.length >= 2 && cols[0] !== 'Nenhum') {
        const demandIdTrimmed = demandId.trim();
        const scriptName = cols[0].trim();
        scripts.push({
          id: `script-${Date.now()}-${index}`,
          name: scriptName,
          path: `scripts/${demandIdTrimmed}/${scriptName}`,
          content: '',
          changeId: cols.length >= 3 && cols[2] !== '-' ? cols[2].trim() : ''
        });
      }
    });

    return scripts;
  }

  /**
   * Parse da tabela de repositórios
   */
  private parseRepositoriesTable(content: string): ReleaseRepository[] {
    const repos: ReleaseRepository[] = [];
    
    // Encontrar a seção de repositórios
    const reposSection = content.match(/##\s*5\.\s*Projetos[^\n]*\n([\s\S]+?)(?=\n##|\n---)/i);
    if (!reposSection) return repos;

    // Encontrar linhas da tabela
    const tableLines = reposSection[1].split('\n').filter(line => 
      line.includes('|') && 
      !line.includes('---') && 
      !line.includes('Repositório') &&
      !line.includes('Impacto')
    );

    tableLines.forEach((line, index) => {
      const cols = line.split('|').map(c => c.trim()).filter(c => c);
      if (cols.length >= 2) {
        const url = cols[0];
        repos.push({
          id: `repo-${Date.now()}-${index}`,
          url: url,
          name: this.extractRepoName(url),
          impact: cols[1],
          releaseBranch: cols.length >= 3 && cols[2] !== '-' ? cols[2] : ''
        });
      }
    });

    return repos;
  }

  /**
   * Converte string para Environment enum
   */
  private parseEnvironment(env: string): Environment {
    const normalized = env.toUpperCase().trim();
    switch (normalized) {
      case 'DEV': return Environment.DEV;
      case 'QAS': return Environment.QAS;
      case 'PRD': return Environment.PRD;
      default: return Environment.DEV;
    }
  }

  /**
   * Converte string para SecretStatus enum
   */
  private parseSecretStatus(status: string): SecretStatus {
    const normalized = status.toUpperCase().trim();
    if (normalized.includes('PENDING') || normalized.includes('PENDENTE')) {
      return SecretStatus.PENDING;
    }
    if (normalized.includes('CONFIGURED') || normalized.includes('CONFIGURADO')) {
      return SecretStatus.CONFIGURED;
    }
    return SecretStatus.NOT_REQUIRED;
  }

  /**
   * Extrai nome do repositório da URL
   */
  private extractRepoName(url: string): string {
    try {
      const cleanUrl = url.replace(/\.git$/, '');
      const parts = cleanUrl.split('/');
      return parts[parts.length - 1] || '';
    } catch {
      return '';
    }
  }

  /**
   * Lê arquivo do input e retorna o conteúdo
   */
  readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }
}

