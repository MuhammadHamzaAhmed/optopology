import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { TopologyComponent } from './newNetworkTopology/topology.component';
import { TopologyDataComponent } from './topology-data/topology-data.component';
import { ViewNetworkTopologyComponent } from './view-network-topology/view-network-topology.component';

const routes: Routes = [
  { path: '', redirectTo: '/topology', pathMatch: 'full' },
  { path: 'topology', component: ViewNetworkTopologyComponent },
  { path: 'topology-data', component: TopologyDataComponent },
  { path: 'edit-network-topology', component: TopologyComponent },
  { path: '**', redirectTo: '/topology' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
