import { Injectable } from '@angular/core';
import { Observable, forkJoin, throwError, of } from 'rxjs';
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
      const branchName = `feature/upsert-release-doc`;
      const baseBranch = 'develop'; // Sempre develop, nunca main

      // 1. Cria a branch
      return this.githubService.createBranch(owner, repo, branchName, baseBranch).pipe(
        catchError(err => {
          if (err.status === 422) return of(void 0);
          results.errors?.push(`Erro ao criar branch em ${repo}: ${err.message}`);
          return of(void 0);
        }),
        // 2. Cria/atualiza o arquivo de release
        switchMap(() => {
          const markdown = this.releaseService.generateMarkdown(release);
          const filePath = `releases/release_${release.demandId}.md`;
          const message = `docs: adiciona release ${release.demandId}`;

          return this.githubService.createOrUpdateFile(owner, repo, filePath, markdown, message, branchName).pipe(
            catchError(err => {
              results.errors?.push(`Erro ao criar arquivo em ${repo}: ${err.message}`);
              return of(void 0);
            })
          );
        }),
        // 3. Cria os scripts se houver
        switchMap(() => {
          if (release.scripts.length === 0) return of(void 0);

          const scriptOperations = release.scripts
            .filter(script => script.content)
            .map(script => {
              const scriptPath = `scripts/${release.demandId}/${script.name}`;
              const message = `docs: adiciona script ${script.name} para release ${release.demandId}`;

              return this.githubService.createOrUpdateFile(owner, repo, scriptPath, script.content!, message, branchName).pipe(
                catchError(err => {
                  results.errors?.push(`Erro ao criar script ${script.name} em ${repo}: ${err.message}`);
                  return of(void 0);
                })
              );
            });

          return forkJoin(scriptOperations.length > 0 ? scriptOperations : [of(void 0)]);
        }),
        // 4. Cria o Pull Request
        switchMap(() => {
          const prTitle = `Release ${release.demandId}: ${release.title || release.description}`;
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
    body += `- \`releases/release_${release.demandId}.md\`\n`;
    if (release.scripts.length > 0) {
      release.scripts.forEach(script => body += `- \`scripts/${release.demandId}/${script.name}\`\n`);
    }
    return body;
  }
}

