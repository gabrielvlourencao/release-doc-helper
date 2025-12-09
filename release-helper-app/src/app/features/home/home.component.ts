import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { Release } from '../../models';
import { ReleaseService, SyncService, GitHubService, NotificationService } from '../../core';

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

      <!-- Aviso sobre Sincronização -->
      <section class="mb-8">
        <div class="card border-2 border-blue-200 bg-blue-50">
          <div class="p-6">
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0 w-10 h-10 rounded-xl bg-blue-500 text-white flex items-center justify-center">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              </div>
              <div class="flex-1">
                <h3 class="text-lg font-bold text-blue-900 mb-2">Como funciona a sincronização?</h3>
                <div class="text-blue-800 space-y-3">
                  <p class="font-medium">📝 <strong>Releases Compartilhadas:</strong></p>
                  <p class="text-sm ml-6">
                    Quando você cria uma nova release, ela é salva no banco compartilhado (Firestore). 
                    <strong>Todos os usuários podem ver e editar</strong> as releases antes mesmo de versioná-las.
                  </p>
                  
                  <p class="font-medium">🚀 <strong>Versionamento:</strong></p>
                  <p class="text-sm ml-6">
                    Você pode editar e revisar releases antes de versionar. Ao clicar em "Versionar", 
                    o sistema cria os arquivos e abre Pull Requests no GitHub. 
                    As releases já estão visíveis para todos antes do versionamento!
                  </p>
                  
                  <p class="font-medium">🔄 <strong>Sincronização:</strong></p>
                  <p class="text-sm ml-6">
                    Após fazer merge do PR no GitHub, clique no botão "Sincronizar com GitHub" abaixo. 
                    O sistema buscará todas as releases dos repositórios e atualizará o banco compartilhado (Firestore). 
                    <strong>Isso garante que as releases versionadas estejam sempre sincronizadas!</strong>
                  </p>
                  
                  <div class="mt-4 pt-4 border-t border-blue-200">
                    <button 
                      (click)="syncWithGitHub()" 
                      [disabled]="isSyncing || !canSync"
                      class="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                      <svg *ngIf="!isSyncing" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                      </svg>
                      <svg *ngIf="isSyncing" class="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                      </svg>
                      <span>{{ isSyncing ? 'Sincronizando...' : 'Sincronizar com GitHub' }}</span>
                    </button>
                    <p *ngIf="!canSync" class="text-xs text-blue-600 mt-2">
                      ⚠️ Faça login com GitHub ou configure um token de serviço para sincronizar
                    </p>
                  </div>
                </div>
              </div>
            </div>
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

          <div class="card p-6 cursor-pointer hover:border-primary-300 transition-colors" (click)="scrollToHowToUse()">
            <div class="flex items-center gap-4">
              <div class="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              </div>
              <div>
                <p class="text-lg font-semibold text-slate-900">Como usar</p>
                <p class="text-sm text-slate-500">Entenda o processo</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Como Usar - Seção Detalhada -->
      <section id="how-to-use" class="mb-8">
        <div class="card overflow-hidden">
          <!-- Header -->
          <div class="bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100 px-6 py-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                </svg>
              </div>
              <div>
                <h2 class="text-xl font-bold text-slate-900">Por que usar Documentos de Release?</h2>
                <p class="text-sm text-slate-600">Padronização e rastreabilidade em entregas</p>
              </div>
            </div>
          </div>

          <div class="p-6">
            <!-- Motivo / Propósito -->
            <div class="mb-8">
              <h3 class="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <svg class="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                Objetivo
              </h3>
              <div class="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <p class="text-slate-700 leading-relaxed mb-3">
                  O <strong>Documento de Release</strong> serve para <strong>padronizar e documentar</strong> todas as informações necessárias para uma entrega em produção, garantindo:
                </p>
                <ul class="space-y-2 text-slate-600">
                  <li class="flex items-start gap-2">
                    <svg class="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                    </svg>
                    <span><strong>Rastreabilidade:</strong> Histórico de todas as releases em cada repositório</span>
                  </li>
                  <li class="flex items-start gap-2">
                    <svg class="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                    </svg>
                    <span><strong>Responsabilidades:</strong> Quem são os responsáveis (Dev, Funcional, LT, SRE)</span>
                  </li>
                  <li class="flex items-start gap-2">
                    <svg class="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                    </svg>
                    <span><strong>Dependências:</strong> Keys, secrets e scripts necessários para deploy</span>
                  </li>
                  <li class="flex items-start gap-2">
                    <svg class="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                    </svg>
                    <span><strong>Comunicação:</strong> Documentação centralizada para todos os envolvidos</span>
                  </li>
                </ul>
              </div>
            </div>

            <!-- Fluxo de Trabalho -->
            <div class="mb-8">
              <h3 class="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <svg class="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                </svg>
                Fluxo de Trabalho
              </h3>
              <div class="grid md:grid-cols-3 gap-4">
                <div class="bg-primary-50 rounded-xl p-4 border border-primary-100 text-center">
                  <div class="w-10 h-10 bg-primary-500 text-white rounded-full flex items-center justify-center mx-auto mb-3 text-lg font-bold">1</div>
                  <h4 class="font-semibold text-primary-900 mb-1">Criar Documento</h4>
                  <p class="text-sm text-primary-700">Preencha os dados da release: demanda, responsáveis, secrets, scripts e repositórios impactados</p>
                </div>
                <div class="bg-emerald-50 rounded-xl p-4 border border-emerald-100 text-center">
                  <div class="w-10 h-10 bg-emerald-500 text-white rounded-full flex items-center justify-center mx-auto mb-3 text-lg font-bold">2</div>
                  <h4 class="font-semibold text-emerald-900 mb-1">Revisar e Editar</h4>
                  <p class="text-sm text-emerald-700">Exporte como PDF/MD para revisão. Ajuste conforme necessário antes de versionar</p>
                </div>
                <div class="bg-amber-50 rounded-xl p-4 border border-amber-100 text-center">
                  <div class="w-10 h-10 bg-amber-500 text-white rounded-full flex items-center justify-center mx-auto mb-3 text-lg font-bold">3</div>
                  <h4 class="font-semibold text-amber-900 mb-1">Versionar</h4>
                  <p class="text-sm text-amber-700">Clique em "Versionar" para criar automaticamente os arquivos e abrir PRs nos repositórios</p>
                </div>
              </div>
            </div>

            <!-- Estrutura no Repositório -->
            <div class="mb-6">
              <h3 class="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <svg class="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
                </svg>
                Estrutura no Repositório
              </h3>
              <p class="text-slate-600 mb-4">Quando você versiona um documento, a seguinte estrutura é criada automaticamente no repositório:</p>
              
              <div class="bg-slate-900 rounded-xl p-5 text-sm font-mono overflow-x-auto">
                <div class="text-slate-300">
                  <div class="text-slate-500 mb-2"># Estrutura do repositório após versionamento</div>
                  <div class="flex items-center gap-2 text-slate-400">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
                    <span>meu-repositorio/</span>
                  </div>
                  <div class="ml-6 mt-1">
                    <div class="text-slate-400">├── src/</div>
                    <div class="text-slate-400">├── ...</div>
                    <div class="text-amber-400 font-semibold">├── releases/</div>
                    <div class="ml-6">
                      <div class="text-emerald-400">│   ├── release_DEM-1234.md</div>
                      <div class="text-emerald-400">│   ├── release_DEM-1235.md</div>
                      <div class="text-slate-500">│   └── ...</div>
                    </div>
                    <div class="text-amber-400 font-semibold">├── scripts/</div>
                    <div class="ml-6">
                      <div class="text-slate-400">│   ├── DEM-1234/</div>
                      <div class="ml-6">
                        <div class="text-cyan-400">│   │   ├── migrate_db.sql</div>
                        <div class="text-cyan-400">│   │   └── update_config.sh</div>
                      </div>
                      <div class="text-slate-400">│   └── DEM-1235/</div>
                      <div class="ml-6">
                        <div class="text-cyan-400">│       └── seed_data.sql</div>
                      </div>
                    </div>
                    <div class="text-slate-400">└── README.md</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Exemplo de Conteúdo -->
            <div>
              <h3 class="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <svg class="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                Exemplo: release_DEM-1234.md
              </h3>
              
              <div class="bg-slate-900 rounded-xl p-5 text-sm font-mono overflow-x-auto max-h-80">
                <pre class="text-slate-300 whitespace-pre-wrap"><span class="text-cyan-400"># Release DEM-1234</span>

<span class="text-amber-400">**Implementação do módulo de pagamentos**</span>

<span class="text-cyan-400">## 1. Responsáveis</span>
| Função    | Nome          |
|-----------|---------------|
| Dev       | João Silva    |
| Funcional | Maria Santos  |
| LT        | Carlos Lima   |
| SRE       | Ana Costa     |

<span class="text-cyan-400">## 2. Descrição da Release</span>
> Implementação do novo módulo de pagamentos com integração 
> ao gateway de pagamentos e suporte a PIX.

<span class="text-cyan-400">## 3. Keys ou Secrets Necessárias</span>
| Ambiente | Key/Secret           | Descrição           | Status     |
|----------|----------------------|---------------------|------------|
| PROD     | PAYMENT_API_KEY      | Chave do gateway    | PENDING    |
| PROD     | PIX_CERTIFICATE      | Certificado PIX     | CONFIGURED |

<span class="text-cyan-400">## 4. Scripts Necessários</span>
| Script          | Caminho                              | CHG       |
|-----------------|--------------------------------------|-----------|
| migrate_db.sql  | scripts/DEM-1234/migrate_db.sql     | CHG-9876  |

<span class="text-cyan-400">## 5. Projetos Impactados (Repositórios)</span>
| Repositório                     | Impacto            | Branch    |
|---------------------------------|--------------------|-----------|
| org/payment-service             | Novo módulo        | develop   |
| org/api-gateway                 | Nova rota          | develop   |

---
<span class="text-slate-500">*Documento gerado em 05/12/2024 às 14:30*</span></pre>
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
              {{ release.updatedBy || release.createdBy || '-' }}
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
  isSyncing = false;
  canSync = false;

  private destroy$ = new Subject<void>();

  constructor(
    private releaseService: ReleaseService,
    private router: Router,
    private syncService: SyncService,
    private githubService: GitHubService,
    private notificationService: NotificationService
  ) {
    // Verifica se pode sincronizar
    this.canSync = this.githubService.hasValidToken();
  }

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

  scrollToHowToUse(): void {
    const element = document.getElementById('how-to-use');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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
            message += ` ${result.removed} release(s) removida(s) do Firestore.`;
          }
          this.notificationService.success(message);
          // Recarrega as releases para mostrar as atualizadas
          this.loadReleases();
        } else if (result.errors && result.errors.length > 0) {
          this.notificationService.warning('Sincronização concluída com alguns erros. Verifique o console.');
        }
      },
      error: (error) => {
        this.isSyncing = false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.notificationService.error(`Erro ao sincronizar: ${errorMessage}`);
      }
    });
  }
}
