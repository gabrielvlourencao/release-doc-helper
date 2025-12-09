import { Injectable } from '@angular/core';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAnalytics, Analytics } from 'firebase/analytics';
import { getFirestore, Firestore } from 'firebase/firestore';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class FirebaseService {
  private app: FirebaseApp | null = null;
  private analytics: Analytics | null = null;
  private firestore: Firestore | null = null;

  constructor() {
    try {
      // Verifica se o Firebase está configurado
      if (!environment.firebase || !environment.firebase.apiKey) {
        console.warn('Firebase não configurado. Configure as credenciais no environment.ts');
        return;
      }

      // Inicializa o Firebase App
      this.app = initializeApp(environment.firebase);
      
      // Inicializa o Firestore (lazy)
      this.firestore = getFirestore(this.app);
      
      // Inicializa o Analytics apenas no browser e de forma não bloqueante
      if (typeof window !== 'undefined' && this.app) {
        try {
          this.analytics = getAnalytics(this.app);
        } catch (error) {
          console.warn('Firebase Analytics não pôde ser inicializado:', error);
        }
      }
    } catch (error) {
      console.error('Erro ao inicializar Firebase:', error);
      // Continua mesmo se o Firebase falhar
    }
  }

  getApp(): FirebaseApp | null {
    return this.app;
  }

  getAnalytics(): Analytics | null {
    return this.analytics;
  }

  getFirestore(): Firestore | null {
    try {
      if (!this.firestore) {
        return null;
      }
      return this.firestore;
    } catch (error) {
      console.error('Erro ao obter Firestore:', error);
      return null;
    }
  }
}

