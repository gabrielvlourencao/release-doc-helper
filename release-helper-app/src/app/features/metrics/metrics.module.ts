import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared';
import { MetricsComponent } from './metrics.component';

const routes: Routes = [
  { path: '', component: MetricsComponent }
];

@NgModule({
  declarations: [MetricsComponent],
  imports: [
    SharedModule,
    RouterModule.forChild(routes)
  ]
})
export class MetricsModule {}







