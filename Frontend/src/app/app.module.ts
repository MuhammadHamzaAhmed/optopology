import { BrowserModule } from '@angular/platform-browser';
import { NgModule, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { TopologyComponent } from './newNetworkTopology/topology.component';
import { TopologyDataComponent } from './topology-data/topology-data.component';
import { ViewNetworkTopologyComponent } from './view-network-topology/view-network-topology.component';
import { ToastComponent } from './components/toast/toast.component';
import { NetworkApiService } from './services/network-api.service';
import { ExcelTableService } from './services/topology-data.service';

@NgModule({
  declarations: [
    AppComponent,
    TopologyComponent,
    TopologyDataComponent,
    ViewNetworkTopologyComponent,
    ToastComponent,
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    AppRoutingModule,
    FormsModule,
    CommonModule,
  ],
  providers: [NetworkApiService, ExcelTableService],
  bootstrap: [AppComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class AppModule {}
