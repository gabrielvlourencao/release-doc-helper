import { Injectable } from '@angular/core';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAnalytics, Analytics } from 'firebase/analytics';
import { getFirestore, Firestore } from 'firebase/firestore';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class FirebaseService {
  private app!: FirebaseApp;
  private analytics: Analytics | null = null;
  private firestore!: Firestore;

  constructor() {
    try {
      // Inicializa o Firebase App
      this.app = initializeApp(environment.firebase);
      
      // Inicializa o Firestore (lazy)
      this.firestore = getFirestore(this.app);
      
      // Inicializa o Analytics apenas no browser e de forma não bloqueante
      if (typeof window !== 'undefined') {
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

  getApp(): FirebaseApp {
    return this.app;
  }

  getAnalytics(): Analytics | null {
    return this.analytics;
  }

  getFirestore(): Firestore {
    return this.firestore;
  }
}

