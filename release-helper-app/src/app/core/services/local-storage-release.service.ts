import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { Release } from '../../models';

const STORAGE_KEY = 'release_doc_helper_releases';

/**
 * Serviço para gerenciar releases no localStorage
 * Substitui o Firestore para armazenamento local
 */
@Injectable({
  providedIn: 'root'
})
export class LocalStorageReleaseService {
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
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const releases = JSON.parse(stored).map((r: any) => ({
          ...r,
          createdAt: new Date(r.createdAt),
          updatedAt: new Date(r.updatedAt)
        }));
        this.releasesSubject.next(releases);
      } else {
        this.releasesSubject.next([]);
      }
    } catch (error) {
      console.error('Erro ao carregar releases do localStorage:', error);
      this.releasesSubject.next([]);
    }
  }

  /**
   * Salva releases no localStorage
   */
  private saveToStorage(releases: Release[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(releases));
      this.releasesSubject.next(releases);
    } catch (error) {
      console.error('Erro ao salvar releases no localStorage:', error);
      throw error;
    }
  }

  /**
   * Retorna todas as releases
   */
  getAll(): Observable<Release[]> {
    return this.releases$;
  }

  /**
   * Busca release por ID da demanda
   */
  getByDemandId(demandId: string): Observable<Release | null> {
    return this.releases$.pipe(
      map(releases => releases.find(r => r.demandId.toUpperCase() === demandId.toUpperCase()) || null)
    );
  }

  /**
   * Sincroniza uma release (cria ou atualiza)
   * Verifica primeiro por demandId para agrupar releases do mesmo DMND em múltiplos repositórios
   */
  syncRelease(release: Release): Observable<void> {
    const current = this.releasesSubject.value;
    
    // Busca por demandId primeiro (para agrupar releases do mesmo DMND)
    let index = current.findIndex(r => r.demandId.toUpperCase() === release.demandId.toUpperCase());
    
    // Se não encontrou por demandId, tenta por id
    if (index < 0) {
      index = current.findIndex(r => r.id === release.id);
    }
    
    if (index >= 0) {
      // Atualiza a release existente, preservando o id original
      const existingRelease = current[index];
      current[index] = {
        ...release,
        id: existingRelease.id // Preserva o ID original
      };
    } else {
      // Adiciona nova release
      current.push(release);
    }
    
    this.saveToStorage(current);
    return of(void 0);
  }

  /**
   * Sincroniza múltiplas releases
   */
  syncReleases(releases: Release[]): Observable<void> {
    const current = this.releasesSubject.value;
    const releasesMap = new Map<string, Release>();
    
    // Adiciona releases existentes
    current.forEach(r => releasesMap.set(r.id, r));
    
    // Atualiza ou adiciona novas releases
    releases.forEach(r => releasesMap.set(r.id, r));
    
    this.saveToStorage(Array.from(releasesMap.values()));
    return of(void 0);
  }

  /**
   * Remove uma release
   */
  deleteRelease(releaseId: string): Observable<void> {
    const current = this.releasesSubject.value;
    const filtered = current.filter(r => r.id !== releaseId);
    this.saveToStorage(filtered);
    return of(void 0);
  }

  /**
   * Limpa todas as releases do localStorage
   */
  clearAll(): Observable<void> {
    localStorage.removeItem(STORAGE_KEY);
    this.releasesSubject.next([]);
    return of(void 0);
  }

  /**
   * Verifica se há releases no localStorage
   */
  hasReleases(): boolean {
    return this.releasesSubject.value.length > 0;
  }
}

