import { NgModule, Optional, SkipSelf } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReleaseService, NotificationService, ExportService } from './services';

/**
 * CoreModule - Módulo para serviços singleton
 * Deve ser importado APENAS no AppModule
 */
@NgModule({
  declarations: [],
  imports: [CommonModule],
  providers: [
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
