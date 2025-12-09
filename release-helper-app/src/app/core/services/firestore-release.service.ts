import { Injectable } from '@angular/core';
import { 
  Firestore, 
  collection, 
  doc, 
  getDocs, 
  setDoc, 
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  Timestamp
} from 'firebase/firestore';
import { Observable, BehaviorSubject, from } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { Release } from '../../models';
import { FirebaseService } from './firebase.service';

/**
 * Serviço para gerenciar releases compartilhadas no Firestore
 * Todas as releases sincronizadas do GitHub ficam aqui para todos visualizarem
 */
@Injectable({
  providedIn: 'root'
})
export class FirestoreReleaseService {
  private readonly COLLECTION_NAME = 'releases';
  private releasesSubject = new BehaviorSubject<Release[]>([]);
  
  releases$ = this.releasesSubject.asObservable();

  constructor(private firebaseService: FirebaseService) {
    this.subscribeToReleases();
  }

  /**
   * Obtém instância do Firestore
   */
  private getFirestore(): Firestore | null {
    try {
      return this.firebaseService.getFirestore();
    } catch (error) {
      console.error('Firestore não disponível:', error);
      return null;
    }
  }

  /**
   * Converte Release para formato Firestore (converte Date para Timestamp)
   */
  private releaseToFirestore(release: Release): any {
    return {
      ...release,
      createdAt: release.createdAt instanceof Date 
        ? Timestamp.fromDate(release.createdAt) 
        : release.createdAt,
      updatedAt: release.updatedAt instanceof Date 
        ? Timestamp.fromDate(release.updatedAt) 
        : release.updatedAt
    };
  }

  /**
   * Converte documento Firestore para Release (converte Timestamp para Date)
   */
  private firestoreToRelease(docData: any): Release {
    const data = docData.data();
    return {
      ...data,
      id: docData.id,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
      updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt)
    } as Release;
  }

  /**
   * Inscreve-se em mudanças em tempo real no Firestore
   */
  private subscribeToReleases(): void {
    const firestore = this.getFirestore();
    if (!firestore) {
      console.warn('Firestore não disponível, usando apenas localStorage');
      return;
    }

    try {
      const releasesRef = collection(firestore, this.COLLECTION_NAME);
      const q = query(releasesRef, orderBy('updatedAt', 'desc'));

      onSnapshot(q, 
        (snapshot) => {
          const releases: Release[] = [];
          snapshot.forEach((doc) => {
            releases.push(this.firestoreToRelease(doc));
          });
          this.releasesSubject.next(releases);
        },
        (error) => {
          console.error('Erro ao escutar mudanças do Firestore:', error);
        }
      );
    } catch (error) {
      console.error('Erro ao configurar listener do Firestore:', error);
    }
  }

  /**
   * Carrega todas as releases do Firestore
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
   * Sincroniza uma release no Firestore (cria ou atualiza)
   * Usado após sincronização com GitHub
   */
  syncRelease(release: Release): Observable<void> {
    const firestore = this.getFirestore();
    if (!firestore) {
      return new Observable(observer => {
        observer.error(new Error('Firestore não disponível'));
        observer.complete();
      });
    }

    return from(
      setDoc(
        doc(firestore, this.COLLECTION_NAME, release.id),
        this.releaseToFirestore(release)
      )
    ).pipe(
      map(() => void 0),
      catchError(error => {
        console.error('Erro ao sincronizar release no Firestore:', error);
        throw error;
      })
    );
  }

  /**
   * Sincroniza múltiplas releases (usado na sincronização em lote do GitHub)
   */
  syncReleases(releases: Release[]): Observable<void> {
    const firestore = this.getFirestore();
    if (!firestore) {
      return new Observable(observer => {
        observer.error(new Error('Firestore não disponível'));
        observer.complete();
      });
    }

    const operations = releases.map(release =>
      setDoc(
        doc(firestore, this.COLLECTION_NAME, release.id),
        this.releaseToFirestore(release)
      )
    );

    return from(Promise.all(operations)).pipe(
      map(() => void 0),
      catchError(error => {
        console.error('Erro ao sincronizar releases no Firestore:', error);
        throw error;
      })
    );
  }

  /**
   * Remove uma release do Firestore
   */
  deleteRelease(releaseId: string): Observable<void> {
    const firestore = this.getFirestore();
    if (!firestore) {
      return new Observable(observer => {
        observer.error(new Error('Firestore não disponível'));
        observer.complete();
      });
    }

    return from(
      deleteDoc(doc(firestore, this.COLLECTION_NAME, releaseId))
    ).pipe(
      map(() => void 0),
      catchError(error => {
        console.error('Erro ao deletar release do Firestore:', error);
        throw error;
      })
    );
  }

  /**
   * Verifica se Firestore está disponível
   */
  isAvailable(): boolean {
    return this.getFirestore() !== null;
  }
}

