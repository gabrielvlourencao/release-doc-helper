import { Injectable } from '@angular/core';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAnalytics, Analytics } from 'firebase/analytics';
import { getFirestore, Firestore } from 'firebase/firestore';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class FirebaseService {
  private app: FirebaseApp;
  private analytics: Analytics | null = null;
  private firestore: Firestore;

  constructor() {
    // Inicializa o Firebase App
    this.app = initializeApp(environment.firebase);
    
    // Inicializa o Firestore
    this.firestore = getFirestore(this.app);
    
    // Inicializa o Analytics apenas no browser (não em SSR)
    if (typeof window !== 'undefined') {
      this.analytics = getAnalytics(this.app);
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

