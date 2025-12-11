import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, forkJoin, of } from 'rxjs';
import { takeUntil, map } from 'rxjs/operators';
import { Release } from '../../models';
import { ReleaseService, GitHubService, VersioningService, SyncService, NotificationService } from '../../core';

interface Metrics {
  totalReleases: number;
  versionedReleases: number;
  nonVersionedReleases: number;
  pendingCommitsReleases: number;
  openPRs: number;
  releasesByRepo: { repo: string; count: number }[];
  releasesByResponsible: { responsible: string; count: number }[];
  recentReleases: Release[];
  oldestReleases: Release[];
}

@Component({
  selector: 'app-metrics',
  template: `
    <div class="page-container animate-fade-in">
      <!-- Header -->
      <div class="mb-6 flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">Métricas de Releases</h1>
          <p class="text-slate-500 mt-1">Estatísticas baseadas nos dados do localStorage e GitHub</p>
        </div>
        <button 
          *ngIf="canSync"
          (click)="syncWithGitHub()" 
          [disabled]="isSyncing"
          class="inline-flex items-center gap-2 bg-primary-500 text-white px-4 py-2 rounded-xl font-medium hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md">
          <svg *ngIf="!isSyncing" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          <svg *ngIf="isSyncing" class="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          <span>{{ isSyncing ? 'Sincronizando...' : 'Sincronizar' }}</span>
        </button>
      </div>

      <!-- Loading -->
      <div *ngIf="isLoading" class="flex flex-col items-center justify-center py-24">
        <div class="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p class="text-slate-500">Carregando métricas...</p>
      </div>

      <!-- Metrics Content -->
      <div *ngIf="!isLoading && metrics" class="space-y-6">
        <!-- Overview Cards -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="card p-6">
            <div class="flex items-center justify-between">
              <div class="flex-1">
                <p class="text-sm text-slate-500 mb-2">Total de Releases</p>
                <p class="text-4xl font-bold text-slate-900 leading-none mb-1">{{ metrics.totalReleases }}</p>
              </div>
              <div class="w-14 h-14 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0 ml-4">
                <svg class="w-7 h-7 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
              </div>
            </div>
          </div>

          <div class="card p-6">
            <div class="flex items-center justify-between">
              <div class="flex-1">
                <p class="text-sm text-slate-500 mb-2">Versionadas</p>
                <p class="text-4xl font-bold text-green-600 leading-none mb-1">{{ metrics.versionedReleases }}</p>
                <p class="text-xs text-slate-400 mt-1">{{ getPercentage(metrics.versionedReleases, metrics.totalReleases) }}% do total</p>
              </div>
              <div class="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0 ml-4">
                <svg class="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              </div>
            </div>
          </div>

          <div class="card p-6">
            <div class="flex items-center justify-between">
              <div class="flex-1">
                <p class="text-sm text-slate-500 mb-2">Não Versionadas</p>
                <p class="text-4xl font-bold text-red-600 leading-none mb-1">{{ metrics.nonVersionedReleases }}</p>
                <p class="text-xs text-slate-400 mt-1">{{ getPercentage(metrics.nonVersionedReleases, metrics.totalReleases) }}% do total</p>
              </div>
              <div class="w-14 h-14 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0 ml-4">
                <svg class="w-7 h-7 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
              </div>
            </div>
          </div>

          <div class="card p-6">
            <div class="flex items-center justify-between">
              <div class="flex-1">
                <p class="text-sm text-slate-500 mb-2">Commits Pendentes</p>
                <p class="text-4xl font-bold text-amber-600 leading-none mb-1">{{ metrics.pendingCommitsReleases }}</p>
                <p class="text-xs text-slate-400 mt-1">Aguardando PR</p>
              </div>
              <div class="w-14 h-14 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0 ml-4">
                <svg class="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              </div>
            </div>
          </div>
        </div>

        <!-- PRs Abertos -->
        <div class="card" *ngIf="metrics.openPRs > 0">
          <div class="card-header">
            <div class="section-icon">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
            </div>
            <h2 class="font-semibold text-slate-900">Pull Requests Abertos</h2>
          </div>
          <div class="card-body">
            <div class="text-center py-8">
              <p class="text-4xl font-bold text-primary-600 mb-2">{{ metrics.openPRs }}</p>
              <p class="text-sm text-slate-500">PRs aguardando revisão</p>
            </div>
          </div>
        </div>

        <!-- Releases por Repositório -->
        <div class="card" *ngIf="metrics.releasesByRepo && metrics.releasesByRepo.length > 0">
          <div class="card-header">
            <div class="section-icon">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
              </svg>
            </div>
            <h2 class="font-semibold text-slate-900">Releases por Repositório</h2>
          </div>
          <div class="card-body">
            <div class="space-y-3">
              <div *ngFor="let repo of metrics.releasesByRepo.slice(0, 10)" class="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <span class="font-mono text-sm text-slate-700">{{ repo.repo }}</span>
                <span class="text-sm font-semibold text-primary-600">{{ repo.count }} release(s)</span>
              </div>
              <p *ngIf="metrics.releasesByRepo.length > 10" class="text-xs text-slate-500 text-center mt-2">
                E mais {{ metrics.releasesByRepo.length - 10 }} repositório(s)
              </p>
            </div>
          </div>
        </div>

        <!-- Releases por Responsável -->
        <div class="card" *ngIf="metrics.releasesByResponsible && metrics.releasesByResponsible.length > 0">
          <div class="card-header">
            <div class="section-icon">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>
              </svg>
            </div>
            <h2 class="font-semibold text-slate-900">Releases por Responsável (LT)</h2>
          </div>
          <div class="card-body">
            <div class="space-y-3">
              <div *ngFor="let resp of metrics.releasesByResponsible.slice(0, 10)" class="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <span class="text-sm text-slate-700">{{ resp.responsible || 'Não informado' }}</span>
                <span class="text-sm font-semibold text-primary-600">{{ resp.count }} release(s)</span>
              </div>
              <p *ngIf="metrics.releasesByResponsible.length > 10" class="text-xs text-slate-500 text-center mt-2">
                E mais {{ metrics.releasesByResponsible.length - 10 }} responsável(is)
              </p>
            </div>
          </div>
        </div>

        <!-- Releases Recentes -->
        <div class="card" *ngIf="metrics.recentReleases && metrics.recentReleases.length > 0">
          <div class="card-header">
            <div class="section-icon">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
            <h2 class="font-semibold text-slate-900">Releases Recentes</h2>
          </div>
          <div class="card-body">
            <div class="space-y-2">
              <div *ngFor="let release of metrics.recentReleases.slice(0, 5)" class="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div class="flex-1 min-w-0">
                  <p class="font-mono text-sm font-semibold text-slate-900">{{ release.demandId }}</p>
                  <p class="text-xs text-slate-500 truncate">{{ release.title || release.description }}</p>
                </div>
                <div class="flex items-center gap-2 ml-4">
                  <span *ngIf="release.isVersioned" class="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">Versionada</span>
                  <span *ngIf="!release.isVersioned" class="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">Não Versionada</span>
                  <span class="text-xs text-slate-400">{{ release.updatedAt | date:'dd/MM/yy' }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div *ngIf="metrics.totalReleases === 0" class="card">
          <div class="text-center py-16">
            <svg class="w-16 h-16 mx-auto text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
            </svg>
            <h3 class="text-lg font-semibold text-slate-900 mb-2">Nenhuma release encontrada</h3>
            <p class="text-slate-500 mb-4">Crie releases ou sincronize do GitHub para ver métricas</p>
            <a routerLink="/releases/new" class="btn-primary inline-flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
              Criar Release
            </a>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
  `]
})
export class MetricsComponent implements OnInit, OnDestroy {
  private readonly METRICS_STORAGE_KEY = 'release_doc_helper_metrics';

  metrics?: Metrics;
  isLoading = true;
  isSyncing = false;
  canSync = false;
  private destroy$ = new Subject<void>();

  constructor(
    public router: Router,
    private releaseService: ReleaseService,
    private githubService: GitHubService,
    private versioningService: VersioningService,
    private syncService: SyncService,
    private notificationService: NotificationService
  ) {
    this.canSync = this.githubService.hasValidToken();
  }

  ngOnInit(): void {
    // SEMPRE tenta carregar do cache primeiro - confiamos no localStorage
    const cachedData = this.loadCachedMetrics();
    if (cachedData && cachedData.metrics) {
      // Usa diretamente os metrics do cache
      // Garante que arrays existam para evitar erros
      this.metrics = this.ensureMetricsStructure(cachedData.metrics);
      this.isLoading = false;
      
      // IMPORTANTE: NÃO recarrega automaticamente - confiamos 100% no cache
      // O cache só é atualizado quando:
      // 1. O usuário clica explicitamente no botão "Sincronizar"
      // 2. O cache não existe (primeira vez)
      // Não faz subscribe ao Observable de releases quando tem cache válido
      return; // Para aqui - usa o cache, não faz mais nada
    }
    
    // Se não tem cache, calcula pela primeira vez
    this.loadMetrics();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Garante que a estrutura de métricas tenha todos os arrays necessários
   */
  private ensureMetricsStructure(metrics: Metrics): Metrics {
    return {
      totalReleases: metrics?.totalReleases ?? 0,
      versionedReleases: metrics?.versionedReleases ?? 0,
      nonVersionedReleases: metrics?.nonVersionedReleases ?? 0,
      pendingCommitsReleases: metrics?.pendingCommitsReleases ?? 0,
      openPRs: metrics?.openPRs ?? 0,
      releasesByRepo: metrics?.releasesByRepo ?? [],
      releasesByResponsible: metrics?.releasesByResponsible ?? [],
      recentReleases: metrics?.recentReleases ?? [],
      oldestReleases: metrics?.oldestReleases ?? []
    };
  }

  loadMetrics(showLoading: boolean = true): void {
    // Mostra loading apenas se necessário
    if (showLoading) {
      this.isLoading = true;
    }
    
    // Busca releases do localStorage
    this.releaseService.getAll()
      .pipe(
        takeUntil(this.destroy$),
        // Garante que sempre temos um array válido
        map(releases => releases || [])
      )
      .subscribe(releases => {
        this.calculateMetrics(releases, showLoading);
      });
  }

  private loadCachedMetrics(): { metrics: Metrics; _cacheTimestamp: number } | null {
    try {
      const cached = localStorage.getItem(this.METRICS_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        const { metrics, timestamp } = parsed;
        
        // Verifica se os dados estão válidos
        if (!metrics || typeof metrics !== 'object') {
          console.warn('Cache de métricas inválido, ignorando');
          return null;
        }
        
        // SEMPRE retorna o cache, independente da idade
        // O cache só é invalidado quando o usuário sincroniza manualmente
        // Retorna com timestamp para referência
        return { metrics: metrics as Metrics, _cacheTimestamp: timestamp };
      }
    } catch (error) {
      console.error('Erro ao carregar métricas do cache:', error);
    }
    return null;
  }

  private saveMetricsToCache(metrics: Metrics): void {
    try {
      const data = {
        metrics,
        timestamp: Date.now()
      };
      localStorage.setItem(this.METRICS_STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Erro ao salvar métricas no cache:', error);
    }
  }

  private calculateMetrics(releases: Release[], showLoading: boolean = true): void {
    const totalReleases = releases.length;
    const versionedReleases = releases.filter(r => r.isVersioned).length;
    const nonVersionedReleases = totalReleases - versionedReleases;

    // Releases por repositório
    const repoMap = new Map<string, number>();
    releases.forEach(release => {
      release.repositories?.forEach(repo => {
        const repoName = repo.name || repo.url.split('/').pop() || repo.url;
        repoMap.set(repoName, (repoMap.get(repoName) || 0) + 1);
      });
    });
    const releasesByRepo = Array.from(repoMap.entries())
      .map(([repo, count]) => ({ repo, count }))
      .sort((a, b) => b.count - a.count);

    // Releases por responsável (LT)
    const responsibleMap = new Map<string, number>();
    releases.forEach(release => {
      const lt = release.responsible?.lt || 'Não informado';
      responsibleMap.set(lt, (responsibleMap.get(lt) || 0) + 1);
    });
    const releasesByResponsible = Array.from(responsibleMap.entries())
      .map(([responsible, count]) => ({ responsible, count }))
      .sort((a, b) => b.count - a.count);

    // Releases recentes (ordenadas por updatedAt)
    const recentReleases = [...releases]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);

    // Conta releases com commits pendentes e carrega PRs abertos
    if (this.githubService.hasValidToken()) {
      const versionedReleasesList = releases.filter(r => r.isVersioned && r.repositories && r.repositories.length > 0);
      
      // Verifica commits pendentes
      const pendingChecks = versionedReleasesList.map(release => 
        this.releaseService.hasPendingCommits(release).pipe(
          map(hasPending => hasPending ? 1 : 0),
          takeUntil(this.destroy$)
        )
      );

      // Carrega PRs abertos
      const prs$ = this.versioningService.getOpenPRs().pipe(
        takeUntil(this.destroy$)
      );

      // Combina todas as verificações
      const pendingCount$ = pendingChecks.length > 0 
        ? forkJoin(pendingChecks).pipe(map(counts => counts.reduce<number>((sum, count) => sum + count, 0)))
        : of(0);

      forkJoin([pendingCount$, prs$])
        .pipe(takeUntil(this.destroy$))
        .subscribe(([pendingCommitsCount, prs]) => {
          this.metrics = {
            totalReleases,
            versionedReleases,
            nonVersionedReleases,
            pendingCommitsReleases: pendingCommitsCount,
            openPRs: prs.length,
            releasesByRepo,
            releasesByResponsible,
            recentReleases,
            oldestReleases: []
          };
          // Salva no cache
          this.saveMetricsToCache(this.metrics);
          if (showLoading) {
            this.isLoading = false;
          }
        });
    } else {
      this.metrics = {
        totalReleases,
        versionedReleases,
        nonVersionedReleases,
        pendingCommitsReleases: 0,
        openPRs: 0,
        releasesByRepo,
        releasesByResponsible,
        recentReleases,
        oldestReleases: []
      };
      // Salva no cache
      this.saveMetricsToCache(this.metrics);
      if (showLoading) {
        this.isLoading = false;
      }
    }
  }

  getPercentage(value: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((value / total) * 100);
  }

  syncWithGitHub(): void {
    if (this.isSyncing || !this.canSync) {
      return;
    }

    this.isSyncing = true;
    this.syncService.syncFromGitHub().subscribe({
      next: (result) => {
        this.isSyncing = false;
        
        if (result.synced > 0 || result.removed > 0) {
          let message = 'Sincronização concluída!';
          if (result.synced > 0) {
            message += ` ${result.synced} release(s) atualizada(s).`;
          }
          if (result.removed > 0) {
            message += ` ${result.removed} release(s) removida(s) do localStorage.`;
          }
          this.notificationService.success(message);
          
          // Limpa o cache e recarrega as métricas para mostrar as atualizadas
          this.clearMetricsCache();
          this.loadMetrics();
        } else if (result.errors && result.errors.length > 0) {
          this.notificationService.warning('Sincronização concluída com alguns erros. Verifique o console.');
          this.clearMetricsCache();
          this.loadMetrics();
        } else {
          this.notificationService.info('Sincronização concluída. Nenhuma alteração encontrada.');
          // Não precisa recalcular se não houve mudanças
        }
      },
      error: (error) => {
        this.isSyncing = false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.notificationService.error(`Erro ao sincronizar: ${errorMessage}`);
      }
    });
  }

  private clearMetricsCache(): void {
    try {
      localStorage.removeItem(this.METRICS_STORAGE_KEY);
    } catch (error) {
      console.error('Erro ao limpar cache de métricas:', error);
    }
  }
}

