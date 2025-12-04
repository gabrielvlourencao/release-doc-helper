import { NgModule, Optional, SkipSelf, APP_INITIALIZER } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReleaseService, NotificationService, ExportService, FirebaseService } from './services';

// Função de inicialização do Firebase
export function initializeFirebase(firebaseService: FirebaseService) {
  return () => {
    // O construtor do FirebaseService já inicializa o Firebase
    // Esta função garante que seja inicializado antes da aplicação
    return firebaseService.getApp();
  };
}

/**
 * CoreModule - Módulo para serviços singleton
 * Deve ser importado APENAS no AppModule
 */
@NgModule({
  declarations: [],
  imports: [CommonModule],
  providers: [
    FirebaseService,
    {
      provide: APP_INITIALIZER,
      useFactory: initializeFirebase,
      deps: [FirebaseService],
      multi: true
    },
    ReleaseService,
    NotificationService,
    ExportService
  ]
})
export class CoreModule {
  constructor(@Optional() @SkipSelf() parentModule: CoreModule) {
    if (parentModule) {
      throw new Error('CoreModule já foi carregado. Importe apenas no AppModule.');
    }
  }
}
