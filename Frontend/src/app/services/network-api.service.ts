import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, delay } from 'rxjs';
import { environment } from '../../environments/environment';

// API Models matching the single main table database structure with explicit interface details
export interface NetworkTopologyRecord {
  id?: number;

  // Device A Information (Source Device with explicit interface details)
  deviceAIp: string;
  deviceAName: string;
  deviceAInterface: string; // Required - specific interface (e.g., E1/28, Gi0/1)
  deviceAInterfaceCapacity?: number; // Capacity of this specific interface
  deviceAInterfaceSpeed?: number; // Current speed of this specific interface
  deviceAInterfaceStatus?: 'up' | 'down' | 'admin_down' | 'unknown'; // Status of this specific interface
  deviceAInterfaceUtilization?: number; // Utilization % of this interface
  deviceADesc?: string;
  deviceAType?:
    | 'firewall'
    | 'switch'
    | 'router'
    | 'server'
    | 'internet'
    | 'ext_switch'
    | 'core_switch';
  deviceAVendor?: string;
  deviceAStatus?: 'on' | 'off' | 'unknown'; // Overall device status
  deviceAPositionX?: number;
  deviceAPositionY?: number;
  deviceAParentBlock?: string;

  // Device B Information (Target Device with explicit interface details)
  deviceBIp: string;
  deviceBName: string;
  deviceBInterface: string; // Required - specific interface (e.g., E2/28, Gi0/2)
  deviceBInterfaceCapacity?: number; // Capacity of this specific interface
  deviceBInterfaceSpeed?: number; // Current speed of this specific interface
  deviceBInterfaceStatus?: 'up' | 'down' | 'admin_down' | 'unknown'; // Status of this specific interface
  deviceBInterfaceUtilization?: number; // Utilization % of this interface
  deviceBDesc?: string;
  deviceBType?:
    | 'firewall'
    | 'switch'
    | 'router'
    | 'server'
    | 'internet'
    | 'ext_switch'
    | 'core_switch';
  deviceBVendor?: string;
  deviceBStatus?: 'on' | 'off' | 'unknown'; // Overall device status
  deviceBPositionX?: number;
  deviceBPositionY?: number;
  deviceBParentBlock?: string;

  // Connection Speed Information (calculated by backend)
  inSpeed?: number;
  outSpeed?: number;
  speedUnit?: string;
  speedPercentage?: number;
  connectionStatus?: 'up' | 'down' | 'warning' | 'critical' | 'normal' | 'good';

  // Additional Information
  comments?: string;
  dataSource?: 'excel' | 'snmp' | 'manual' | 'api';
  processingStatus?: 'initial' | 'calculated' | 'verified' | 'error';

  // Audit fields
  isActive?: boolean;
}

export interface NetworkTopologyData {
  topologyRecords: NetworkTopologyRecord[];
}

// New interface for dashboard topology data
export interface DashboardTopologyResponse {
  success: boolean;
  data: {
    networkData: {
      blocks: NetworkBlock[];
      nodes: NetworkNode[];
      edges: NetworkEdge[];
    };
    positions: { [key: string]: { x: number; y: number } };
    connectionMap: { [key: string]: any };
    deviceStatus: { [key: string]: string };
    deviceTypes: { [key: string]: string };
    timestamp: number;
  };
  count: {
    blocks: number;
    nodes: number;
    edges: number;
  };
}

export interface NetworkBlock {
  id: string;
  label: string;
  type: 'compound';
}

export interface NetworkNode {
  id: string;
  label: string;
  type:
    | 'firewall'
    | 'switch'
    | 'router'
    | 'server'
    | 'internet'
    | 'ext_switch'
    | 'core_switch';
  parent?: string;
  status?: string;
}

export interface NetworkEdge {
  source: string;
  target: string;
  speed: string;
  status?: string;
  type?: string;
  metadata?: any;
  crc?: {
    errors: number;
    totalPackets: number;
    errorRate: number;
    lastCheck: string;
    status: 'good' | 'warning' | 'critical';
  };
}

export interface ExcelDataPayload {
  fileName: string;
  sheetData: any[];
  deviceInfo: {
    IP: string;
    hostname: string;
    vendor: string;
    type: string;
    interfaces: string[];
  }[];
}

export interface DevicePositionUpdate {
  deviceIp: string;
  positionX: number;
  positionY: number;
}

@Injectable({
  providedIn: 'root',
})
export class NetworkApiService {
  private baseUrl = environment.serverurl + '/topology-api';

  private httpOptions = {
    headers: new HttpHeaders({
      'Content-Type': 'application/json',
    }),
  };

  constructor(private http: HttpClient) {}

  // Dummy data showing explicit interface-level details
  private getDummyTopologyRecords(): NetworkTopologyRecord[] {
    return [
      {
        id: 1,
        // Device A: Core Switch 001, Interface E1/28
        deviceAIp: '10.99.18.253',
        deviceAName: 'NRR-COR-C-SW001',
        deviceAInterface: 'E1/28',
        deviceAInterfaceCapacity: 10000, // 10Gbps capacity on E1/28
        deviceAInterfaceSpeed: 10000,
        deviceAInterfaceStatus: 'up',
        deviceAInterfaceUtilization: 10.0, // 10% utilization on this interface
        deviceADesc: 'Core Switch 001 - Main Distribution',
        deviceAType: 'core_switch',
        deviceAVendor: 'Cisco',
        deviceAStatus: 'on',
        deviceAPositionX: 100.0,
        deviceAPositionY: 200.0,
        deviceAParentBlock: 'CORE',
        // Device B: Core Switch 002, Interface E1/28
        deviceBIp: '10.99.18.254',
        deviceBName: 'NRR-COR-C-SW002',
        deviceBInterface: 'E1/28',
        deviceBInterfaceCapacity: 10000, // 10Gbps capacity on E1/28
        deviceBInterfaceSpeed: 10000,
        deviceBInterfaceStatus: 'up',
        deviceBInterfaceUtilization: 10.0, // 10% utilization on this interface
        deviceBDesc: 'Core Switch 002 - Backup Distribution',
        deviceBType: 'core_switch',
        deviceBVendor: 'Cisco',
        deviceBStatus: 'on',
        deviceBPositionX: 300.0,
        deviceBPositionY: 200.0,
        deviceBParentBlock: 'CORE',
        // Connection details
        inSpeed: 1000,
        outSpeed: 1000,
        speedUnit: 'Mbps',
        speedPercentage: 10.0,
        connectionStatus: 'good',
        comments: 'High-speed core interconnect - Interface E1/28 to E1/28',
        dataSource: 'excel',
        processingStatus: 'calculated',
        isActive: true,
      },
      {
        id: 2,
        // Device A: Core Switch 001, Interface E2/28 (different interface, different speeds)
        deviceAIp: '10.99.18.253',
        deviceAName: 'NRR-COR-C-SW001',
        deviceAInterface: 'E2/28',
        deviceAInterfaceCapacity: 1000, // 1Gbps capacity on E2/28
        deviceAInterfaceSpeed: 1000,
        deviceAInterfaceStatus: 'up',
        deviceAInterfaceUtilization: 80.0, // High utilization on this interface
        deviceADesc: 'Core Switch 001 - Main Distribution',
        deviceAType: 'core_switch',
        deviceAVendor: 'Cisco',
        deviceAStatus: 'on',
        deviceAPositionX: 100.0,
        deviceAPositionY: 200.0,
        deviceAParentBlock: 'CORE',
        // Device B: Firewall, Interface port1
        deviceBIp: '192.168.1.1',
        deviceBName: 'FW-MAIN-001',
        deviceBInterface: 'port1',
        deviceBInterfaceCapacity: 1000, // 1Gbps capacity on port1
        deviceBInterfaceSpeed: 1000,
        deviceBInterfaceStatus: 'up',
        deviceBInterfaceUtilization: 80.0, // High utilization on this interface
        deviceBDesc: 'Main Firewall - Security Gateway',
        deviceBType: 'firewall',
        deviceBVendor: 'Fortinet',
        deviceBStatus: 'on',
        deviceBPositionX: 200.0,
        deviceBPositionY: 100.0,
        deviceBParentBlock: 'SECURITY',
        // Connection details
        inSpeed: 1000,
        outSpeed: 800,
        speedUnit: 'Mbps',
        speedPercentage: 80.0,
        connectionStatus: 'warning',
        comments: 'High utilization - Interface E2/28 to port1',
        dataSource: 'excel',
        processingStatus: 'calculated',
        isActive: true,
      },
      {
        id: 3,
        // Device A: Firewall, Interface port2 (different interface on same device)
        deviceAIp: '192.168.1.1',
        deviceAName: 'FW-MAIN-001',
        deviceAInterface: 'port2',
        deviceAInterfaceCapacity: 1000, // 1Gbps capacity on port2
        deviceAInterfaceSpeed: 1000,
        deviceAInterfaceStatus: 'up',
        deviceAInterfaceUtilization: 50.0, // Moderate utilization on this interface
        deviceADesc: 'Main Firewall - Security Gateway',
        deviceAType: 'firewall',
        deviceAVendor: 'Fortinet',
        deviceAStatus: 'on',
        deviceAPositionX: 200.0,
        deviceAPositionY: 100.0,
        deviceAParentBlock: 'SECURITY',
        // Device B: Router, Interface GigabitEthernet0/0
        deviceBIp: '10.0.0.1',
        deviceBName: 'RTR-EDGE-001',
        deviceBInterface: 'GigabitEthernet0/0',
        deviceBInterfaceCapacity: 1000, // 1Gbps capacity on GigabitEthernet0/0
        deviceBInterfaceSpeed: 1000,
        deviceBInterfaceStatus: 'up',
        deviceBInterfaceUtilization: 50.0, // Moderate utilization on this interface
        deviceBDesc: 'Edge Router 001 - WAN Gateway',
        deviceBType: 'router',
        deviceBVendor: 'Cisco',
        deviceBStatus: 'on',
        deviceBPositionX: 200.0,
        deviceBPositionY: 50.0,
        deviceBParentBlock: 'WAN',
        // Connection details
        inSpeed: 500,
        outSpeed: 300,
        speedUnit: 'Mbps',
        speedPercentage: 50.0,
        connectionStatus: 'normal',
        comments: 'Normal traffic flow - Interface port2 to GigabitEthernet0/0',
        dataSource: 'excel',
        processingStatus: 'calculated',
        isActive: true,
      },
      {
        id: 4,
        // Device A: Core Switch 002, Interface E3/28 (different interface, critical utilization)
        deviceAIp: '10.99.18.254',
        deviceAName: 'NRR-COR-C-SW002',
        deviceAInterface: 'E3/28',
        deviceAInterfaceCapacity: 1000, // 1Gbps capacity on E3/28
        deviceAInterfaceSpeed: 1000,
        deviceAInterfaceStatus: 'up',
        deviceAInterfaceUtilization: 90.0, // Critical utilization on this interface
        deviceADesc: 'Core Switch 002 - Backup Distribution',
        deviceAType: 'core_switch',
        deviceAVendor: 'Cisco',
        deviceAStatus: 'on',
        deviceAPositionX: 300.0,
        deviceAPositionY: 200.0,
        deviceAParentBlock: 'CORE',
        // Device B: External Switch, Interface Gi0/2
        deviceBIp: '192.168.1.50',
        deviceBName: 'SW-EXT-001',
        deviceBInterface: 'Gi0/2',
        deviceBInterfaceCapacity: 1000, // 1Gbps capacity on Gi0/2
        deviceBInterfaceSpeed: 1000,
        deviceBInterfaceStatus: 'up',
        deviceBInterfaceUtilization: 90.0, // Critical utilization on this interface
        deviceBDesc: 'External Switch - DMZ Access',
        deviceBType: 'ext_switch',
        deviceBVendor: 'Cisco',
        deviceBStatus: 'on',
        deviceBPositionX: 400.0,
        deviceBPositionY: 150.0,
        deviceBParentBlock: 'EXTERNAL',
        // Connection details
        inSpeed: 800,
        outSpeed: 900,
        speedUnit: 'Mbps',
        speedPercentage: 90.0,
        connectionStatus: 'critical',
        comments:
          'CRITICAL: Very high utilization on E3/28 to Gi0/2 - consider upgrade',
        dataSource: 'excel',
        processingStatus: 'calculated',
        isActive: true,
      },
      {
        id: 5,
        // Device A: Core Switch 002, Interface E2/28 (same device, different interface - DOWN)
        deviceAIp: '10.99.18.254',
        deviceAName: 'NRR-COR-C-SW002',
        deviceAInterface: 'E2/28',
        deviceAInterfaceCapacity: 1000, // 1Gbps capacity on E2/28
        deviceAInterfaceSpeed: 0, // Interface down
        deviceAInterfaceStatus: 'down',
        deviceAInterfaceUtilization: 0.0, // No utilization - interface down
        deviceADesc: 'Core Switch 002 - Backup Distribution',
        deviceAType: 'core_switch',
        deviceAVendor: 'Cisco',
        deviceAStatus: 'on', // Device is on, but this interface is down
        deviceAPositionX: 300.0,
        deviceAPositionY: 200.0,
        deviceAParentBlock: 'CORE',
        // Device B: Access Switch, Interface Gi0/1
        deviceBIp: '192.168.1.11',
        deviceBName: 'SW-ACCESS-002',
        deviceBInterface: 'Gi0/1',
        deviceBInterfaceCapacity: 1000, // 1Gbps capacity on Gi0/1
        deviceBInterfaceSpeed: 0, // Interface down
        deviceBInterfaceStatus: 'down',
        deviceBInterfaceUtilization: 0.0, // No utilization - interface down
        deviceBDesc: 'Access Switch 002 - User Access',
        deviceBType: 'switch',
        deviceBVendor: 'Cisco',
        deviceBStatus: 'off', // Device is off
        deviceBPositionX: 350.0,
        deviceBPositionY: 300.0,
        deviceBParentBlock: 'ACCESS',
        // Connection details
        inSpeed: 0,
        outSpeed: 0,
        speedUnit: 'Mbps',
        speedPercentage: 0.0,
        connectionStatus: 'down',
        comments:
          'CRITICAL: Connection down - E2/28 to Gi0/1 - investigate immediately',
        dataSource: 'excel',
        processingStatus: 'calculated',
        isActive: true,
      },
    ];
  }

  // API Methods

  /**
   * Get all network topology data (unified main table records with explicit interface details)
   */
  getNetworkTopology(): Observable<NetworkTopologyData> {
    console.log(
      '📡 API Call: Getting network topology data with explicit interface details'
    );

    return of({
      topologyRecords: this.getDummyTopologyRecords(),
    }).pipe(delay(500));
  }

  /**
   * Get network topology data from Dashboard table (Excel data)
   */
  getDashboardTopology(): Observable<DashboardTopologyResponse> {
    const fullUrl = `${this.baseUrl}/get-network-topology-dashboard`;
    console.log(
      '📡 API Call: Getting dashboard topology data from Excel table'
    );
    console.log('🔗 Full URL:', fullUrl);
    console.log('🌍 Environment API Base URL:', this.baseUrl);
    console.log('📋 HTTP Options:', this.httpOptions);

    return this.http.get<DashboardTopologyResponse>(fullUrl, this.httpOptions);
  }

  /**
   * Upload Excel data and process it
   */
  uploadExcelData(
    payload: ExcelDataPayload
  ): Observable<{ success: boolean; message: string; processedCount: number }> {
    console.log(
      '📡 API Call: Uploading Excel data with explicit interface details',
      payload
    );

    // Log the device info as requested
    console.log('📊 Device Info being sent to backend:', payload.deviceInfo);
    console.log('📋 Excel Sheet Data:', payload.sheetData);

    return of({
      success: true,
      message:
        'Excel data processed successfully - each interface will be stored separately',
      processedCount: payload.sheetData.length,
    }).pipe(delay(1000));
  }

  /**
   * Update device position when moved
   */
  updateDevicePosition(
    positionUpdate: DevicePositionUpdate
  ): Observable<{ success: boolean; message: string }> {
    console.log('📡 API Call: Updating device position', positionUpdate);

    return of({
      success: true,
      message: 'Device position updated successfully',
    }).pipe(delay(200));
  }

  /**
   * Update device status
   */
  updateDeviceStatus(
    deviceIp: string,
    status: 'on' | 'off'
  ): Observable<{ success: boolean; message: string }> {
    console.log('📡 API Call: Updating device status', { deviceIp, status });

    return of({
      success: true,
      message: 'Device status updated successfully',
    }).pipe(delay(200));
  }

  /**
   * Save device positions to backend
   */
  saveDevicePositions(positions: {
    [nodeId: string]: any;
  }): Observable<{ success: boolean; message: string }> {
    console.log('📡 API Call: Saving device positions to backend', positions);

    return this.http.post<{ success: boolean; message: string }>(
      `${this.baseUrl}/save-device-positions`,
      { positions },
      this.httpOptions
    );
  }

  permissionCheck(): Observable<any> {
    return this.http.get(`${this.baseUrl}/permission-check`, this.httpOptions);
  }
}
