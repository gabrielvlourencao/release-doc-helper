import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { Release } from '../../models';
import { ReleaseService } from '../../core';

/**
 * Componente da página inicial
 * Simples e direto - focado em criar e gerenciar documentos de release
 */
@Component({
  selector: 'app-home',
  template: `
    <div class="page-container animate-fade-in">
      <!-- Hero Section - Simples e direto -->
      <section class="bg-gradient-to-br from-primary-500 to-primary-600 rounded-2xl p-8 mb-8 text-white">
        <div class="max-w-xl">
          <h1 class="text-3xl font-bold mb-3">Release Doc Helper</h1>
          <p class="text-primary-100 text-lg mb-6">
            Crie e versione documentos de release nos repositórios de forma simples.
          </p>
          <div class="flex flex-wrap gap-3">
            <a routerLink="/releases/new" class="inline-flex items-center gap-2 bg-white text-primary-600 px-5 py-2.5 rounded-xl font-medium hover:bg-primary-50 transition-colors">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
              Criar Documento
            </a>
            <a routerLink="/releases" class="inline-flex items-center gap-2 bg-primary-400/30 text-white px-5 py-2.5 rounded-xl font-medium hover:bg-primary-400/40 transition-colors">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/>
              </svg>
              Ver Documentos
            </a>
          </div>
        </div>
      </section>

      <!-- Quick Stats -->
      <section class="mb-8">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="card p-6 cursor-pointer hover:border-primary-300 transition-colors" routerLink="/releases">
            <div class="flex items-center gap-4">
              <div class="w-12 h-12 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
              </div>
              <div>
                <p class="text-3xl font-bold text-slate-900">{{ totalReleases }}</p>
                <p class="text-sm text-slate-500">Documentos criados</p>
              </div>
            </div>
          </div>

          <div class="card p-6 cursor-pointer hover:border-primary-300 transition-colors" routerLink="/releases/new">
            <div class="flex items-center gap-4">
              <div class="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
              </div>
              <div>
                <p class="text-lg font-semibold text-slate-900">Criar Novo</p>
                <p class="text-sm text-slate-500">Documento de release</p>
              </div>
            </div>
          </div>

          <div class="card p-6">
            <div class="flex items-center gap-4">
              <div class="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              </div>
              <div>
                <p class="text-lg font-semibold text-slate-900">Como usar</p>
                <p class="text-sm text-slate-500">Crie → Edite → Versione</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Recent Documents -->
      <section *ngIf="recentReleases.length > 0">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-slate-900">Documentos Recentes</h2>
          <a routerLink="/releases" class="text-sm text-primary-500 hover:text-primary-600 font-medium flex items-center gap-1">
            Ver todos
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
          </a>
        </div>
        
        <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div *ngFor="let release of recentReleases" 
               class="card p-5 cursor-pointer hover:border-primary-300 hover:shadow-soft transition-all"
               (click)="openRelease(release)">
            <div class="flex items-center justify-between mb-3">
              <span class="font-mono text-sm font-semibold text-primary-500 bg-primary-50 px-2 py-1 rounded">
                {{ release.demandId }}
              </span>
              <span class="text-xs text-slate-400">
                {{ release.updatedAt | date:'dd/MM/yy' }}
              </span>
            </div>
            <h3 class="text-sm font-medium text-slate-900 mb-2 line-clamp-2">
              {{ release.title || release.description | slice:0:80 }}...
            </h3>
            <div class="flex items-center gap-2 text-xs text-slate-500">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
              </svg>
              {{ release.responsible.dev }}
            </div>
          </div>
        </div>
      </section>

      <!-- Empty State -->
      <section *ngIf="recentReleases.length === 0" class="card">
        <div class="text-center py-16">
          <div class="w-16 h-16 mx-auto text-slate-300 mb-4">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
          </div>
          <h3 class="text-lg font-semibold text-slate-900 mb-2">Nenhum documento ainda</h3>
          <p class="text-slate-500 max-w-sm mx-auto mb-6">
            Crie seu primeiro documento de release para começar a versionar nos repositórios.
          </p>
          <a routerLink="/releases/new" class="btn-primary">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
            Criar Primeiro Documento
          </a>
        </div>
      </section>
    </div>
  `
})
export class HomeComponent implements OnInit, OnDestroy {
  totalReleases = 0;
  recentReleases: Release[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private releaseService: ReleaseService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadReleases();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadReleases(): void {
    this.releaseService.getAll()
      .pipe(takeUntil(this.destroy$))
      .subscribe(releases => {
        this.totalReleases = releases.length;
        this.recentReleases = releases
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, 6);
      });
  }

  openRelease(release: Release): void {
    this.router.navigate(['/releases', release.id]);
  }
}
