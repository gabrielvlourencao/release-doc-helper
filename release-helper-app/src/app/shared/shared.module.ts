import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import {
  HeaderComponent,
  EmptyStateComponent,
  ConfirmDialogComponent
} from './components';

const sharedComponents = [
  HeaderComponent,
  EmptyStateComponent,
  ConfirmDialogComponent
];

/**
 * SharedModule - Módulo para componentes, pipes e diretivas compartilhadas
 */
@NgModule({
  declarations: [
    ...sharedComponents
  ],
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule
  ],
  exports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    ...sharedComponents
  ]
})
export class SharedModule {}
