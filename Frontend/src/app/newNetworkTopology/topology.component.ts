import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import cytoscape from 'cytoscape';
import * as XLSX from 'xlsx';
import {
  NetworkApiService,
  DashboardTopologyResponse,
} from '../services/network-api.service';
import { ToastService } from '../services/toast.service';

interface NetworkNode {
  id: string;
  label: string;
  type:
    | 'firewall'
    | 'switch'
    | 'router'
    | 'server'
    | 'internet'
    | 'ext_switch'
    | 'core_switch'
    | 'isp';
  parent?: string;
  status?: string;
}

interface NetworkEdge {
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

interface NetworkBlock {
  id: string;
  label: string;
  type: 'compound';
}

interface NetworkData {
  blocks: NetworkBlock[];
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

interface SavedPosition {
  x: number;
  y: number;
}

interface SavedNetworkState {
  networkData: NetworkData;
  positions: { [nodeId: string]: SavedPosition };
  connectionMap: { [connectionId: string]: any };
  deviceStatus: { [deviceId: string]: string };
  deviceTypes: { [deviceId: string]: string };

  timestamp: number;
}

interface DeviceUpdate {
  id: string;
  type?: string;
  status?: 'on' | 'off';
  name?: string;
}

interface StatusChangeAnimation {
  nodeId: string;
  fromStatus: string;
  toStatus: string;
  timestamp: number;
}

interface BlinkingData {
  element: HTMLElement;
  nodeHandler: () => void;
  panZoomHandler: () => void;
  interval: any;
}

@Component({
  selector: 'app-topology',
  templateUrl: './topology.component.html',
  styleUrls: ['./topology.component.css'],
})
export class TopologyComponent implements AfterViewInit, OnDestroy {
  @ViewChild('cy', { static: false }) cyContainer!: ElementRef;

  fileName: string = '';
  fileData: any[] = [];
  forceFullUpdate: boolean = false;
  isUpdatingIncrementally: boolean = false;
  public isLoadingData: boolean = false; // Add loading guard
  isFullscreen: boolean = false; // Add fullscreen state
  showTooltip: boolean = false;
  tooltipX: number = 0;
  tooltipY: number = 0;
  showLegend: boolean = false; // Legend panel visibility state
  permission: boolean = false; // Add permission property
  public loadFailed: boolean = false; // Track if last load resulted in error
  private isSilentRefreshing: boolean = false; // Prevent overlapping silent refreshes

  private connectionMap: Map<string, any> = new Map();
  private savedPositions: Map<string, SavedPosition> = new Map();
  private deviceStatusMap: Map<string, 'on' | 'off'> = new Map();
  private deviceTypeMap: Map<string, string> = new Map();
  private pendingStatusAnimations: StatusChangeAnimation[] = [];
  private readonly STATUS_ANIMATION_DURATION = 1500; // 1.5 seconds

  private readonly STORAGE_KEY = 'network-topology-state';
  private readonly POSITIONS_KEY = 'network-topology-positions';
  private readonly DATA_KEY = 'network-topology-data';
  private positionSaveTimeout: any = null; // For debounced position saving

  private BLINKING_SPEED = 800; // Default blinking speed
  private blinkingIntervals: Map<string, BlinkingData> = new Map();
  private edgeTooltip: HTMLElement | null = null;
  private deviceTooltip: HTMLElement | null = null;

  private draggedBlockId: string | null = null; // Track which block is being dragged
  private draggedBlockTimeout: any = null; // Timeout to clear dragged block tracking
  private isUserDragging: boolean = false; // ✅ FIX: Track if user is currently dragging to prevent data loss

  private enableCoreSwitchAutoArrangement: boolean = false;
  public lastUpdatedTime: string = '';
  public autoRefreshCountdown: number = 120; // Countdown in seconds
  public Math = Math; // Make Math available in template
  private timestampInterval: any;
  private autoRefreshInterval: any;

  public selectedEdgeInfo: {
    sourceDevice: string;
    targetDevice: string;
    inSpeed: string;
    outSpeed: string;
    capacity: string;
    interfaceA: string;
    interfaceB: string;
    speedStatus: string;
    speedPercentage: number;
  } | null = null;

  public speedStatusCounts: {
    down: number;
    critical: number;
    warning: number;
    normal: number;
    good: number;
    total: number;
  } = {
    down: 0,
    critical: 0,
    warning: 0,
    normal: 0,
    good: 0,
    total: 0,
  };

  constructor(
    private router: Router,
    private networkApiService: NetworkApiService,
    private toastService: ToastService
  ) {
    this.loadStateFromLocalStorage();

    // Listen for dark mode changes
    this.setupDarkModeListener();

    // Add fullscreen change event listener
    this.setupFullscreenListener();

    // Initialize timestamp
    this.updateTimestamp();
    // Start timestamp update interval (every 2 minutes)
    this.startTimestampUpdates();

    // Check permission on component initialization
    this.checkPermission();

    // Commented out auto-refresh functionality
    // setTimeout(() => {
    //   this.startAutoRefresh();
    // }, 5000); // Start auto-refresh after 5 seconds
  }

  hasNetworkData(): boolean {
    return (
      this.networkData &&
      (this.networkData.nodes.length > 0 || this.networkData.edges.length > 0)
    );
  }

  hasLocalStorageData(): boolean {
    // ✅ FIX: localStorage functionality disabled - always return false
    // try {
    //   const storedData = localStorage.getItem(this.STORAGE_KEY);
    //   return (
    //     storedData !== null && storedData !== undefined && storedData !== ''
    //   );
    // } catch (error) {
    //   console.warn('Error checking localStorage:', error);
    //   return false;
    // }

    return false; // localStorage disabled
  }

  get shouldShowUI(): boolean {
    return this.hasNetworkData();
  }

  onFileSelect(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.fileName = file.name;
      this.readExcelFile(file);
    }
  }

  importData(): void {
    this.router.navigate(['/topology-data']);
  }
  goToEditTopology(): void {
    this.router.navigate(['/edit-network-topology']);
  }
  goToViewTopology(): void {
    this.router.navigate(['/topology']);
  }

  readExcelFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });

      this.fileData = [];
      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const sheetData = XLSX.utils.sheet_to_json(worksheet);
        this.fileData = [...this.fileData, ...sheetData];
      });

      this.insertVulnerabilityScan();
    };
    reader.readAsArrayBuffer(file);
  }

  insertVulnerabilityScan() {
    if (!this.fileData || this.fileData.length === 0) {
      console.warn('No data to process');
      return;
    }

    const wasEmpty = !this.hasNetworkData();

    this.updateTimestamp();

    const newNodes: NetworkNode[] = [];
    const newEdges: NetworkEdge[] = [];
    const deviceUpdates: DeviceUpdate[] = [];
    const existingNodeIds = new Set(
      this.networkData.nodes.map((node) => node.id)
    );
    const existingConnectionIds = new Set(this.connectionMap.keys());

    // Extract and log unique device information
    this.extractAndLogUniqueDevices();

    this.fileData.forEach((row, index) => {
      try {
        // Auto-detect if columns are swapped or normal for this row
        const deviceANameField = row['Device A Name'];
        const deviceAIPField = row['Device A IP'];

        // Detect format: if "Device A Name" looks like an IP, columns are swapped
        const isSwappedFormat = this.isIPAddress(deviceANameField);

        let deviceAIP: string, deviceAName: string;
        if (isSwappedFormat) {
          // Swapped format: "Device A Name" contains IP, "Device A IP" contains name
          deviceAIP = deviceANameField;
          deviceAName = deviceAIPField;
        } else {
          // Normal format: "Device A IP" contains IP, "Device A Name" contains name
          deviceAIP = deviceAIPField;
          deviceAName = deviceANameField;
        }

        const deviceBIP = row['Device B IP']; // This should always be correct
        const deviceBName = row['Device b Name '];

        // New fields for type and status
        const deviceAType = row['Device A Type'] || row['Type A'];
        const deviceAStatus = row['Device A Status'] || row['Status A'];
        const deviceBType = row['Device B Type'] || row['Type B'];
        const deviceBStatus = row['Device B Status'] || row['Status B'];

        const inSpeed = this.parseSpeed(row['IN Speed']);
        const outSpeed = this.parseSpeed(row['Out Speed']);
        const capacity = this.parseSpeed(row['capacity']);
        const interface_a = row['interface'];
        const interface_b = row['interface_1'];
        const description = row['Desc'] || 'Auto by snmp';

        if (!deviceAIP || !deviceBIP || !deviceAName || !deviceBName) {
          console.warn(`Skipping row ${index}: Missing device information`);
          return;
        }

        // Process Device A - determine status based on traffic data
        const deviceAFinalStatus = this.determineDeviceStatus(
          deviceAIP,
          deviceAStatus,
          inSpeed,
          outSpeed,
          'A'
        );

        // Determine final device type for Device A (with IP override and Excel data)
        const deviceAFinalType = this.getDeviceType(
          deviceAName,
          deviceAIP,
          deviceAType
        );

        this.processDeviceUpdate(
          deviceAIP,
          deviceAName,
          deviceAFinalType, // Use determined type instead of raw Excel type
          deviceAFinalStatus,
          existingNodeIds,
          newNodes,
          deviceUpdates
        );

        // Process Device B - determine status based on traffic data
        const deviceBFinalStatus = this.determineDeviceStatus(
          deviceBIP,
          deviceBStatus,
          inSpeed,
          outSpeed,
          'B'
        );

        // Determine final device type for Device B (with IP override and Excel data)
        const deviceBFinalType = this.getDeviceType(
          deviceBName,
          deviceBIP,
          deviceBType
        );

        this.processDeviceUpdate(
          deviceBIP,
          deviceBName,
          deviceBFinalType, // Use determined type instead of raw Excel type
          deviceBFinalStatus,
          existingNodeIds,
          newNodes,
          deviceUpdates
        );

        const connectionId = this.createConnectionId(
          deviceAIP,
          interface_a,
          deviceBIP,
          interface_b
        );

        if (this.connectionMap.has(connectionId)) {
          this.handleDuplicateConnection(
            connectionId,
            inSpeed,
            outSpeed,
            capacity,
            deviceAIP,
            deviceBIP
          );
          return;
        }

        this.createNewEdge(
          deviceAIP,
          deviceBIP,
          inSpeed,
          outSpeed,
          capacity,
          interface_a,
          interface_b,
          description,
          newEdges
        );
      } catch (error) {
        console.error(`Error processing row ${index}:`, error);
      }
    });

    const isFirstTime = this.shouldDoFullReinitialization(newNodes, newEdges);

    if (isFirstTime) {
      this.forceFullUpdate = false;
      this.reinitializeNetwork();
    } else {
      // Process device updates first (status/type changes)
      if (deviceUpdates.length > 0) {
        this.processDeviceUpdatesIncrementally(deviceUpdates);
      }

      // Then add new elements
      if (newNodes.length > 0 || newEdges.length > 0) {
        this.addIncrementalElements(newNodes, newEdges);
      }
    }

    this.saveStateToLocalStorage();
    this.fileData = [];

    // If we went from no data to having data, we need to initialize the Cytoscape instance
    if (wasEmpty && this.hasNetworkData()) {
      // Trigger Angular change detection and reinitialize the view
      setTimeout(() => {
        this.ngAfterViewInit();
      }, 100);
    }

    // Reinitialize animations after data processing
    setTimeout(() => {
      this.ensureStatusIndicatorStyles();
      this.initializeBlinkingForAllDevices();
    }, 500);

    // Update speed status counts after data processing
    setTimeout(() => {
      this.updateSpeedStatusCounts();
    }, 600);
  }

  private ensureStatusIndicatorStyles(): void {
    // Remove existing styles first to ensure fresh application
    const existingStyle = document.getElementById('status-indicator-styles');
    if (existingStyle) {
      existingStyle.remove();
    }

    const style = document.createElement('style');
    style.id = 'status-indicator-styles';
    style.textContent = `
    @keyframes status-blink {
      0%, 45% { 
        opacity: 1; 
        transform: scale(1);
        box-shadow: 0 0 8px rgba(0, 0, 0, 0.5);
      }
      50%, 95% { 
        opacity: 0.2; 
        transform: scale(0.85);
        box-shadow: 0 0 4px rgba(0, 0, 0, 0.3);
      }
      100% {
        opacity: 1; 
        transform: scale(1);
        box-shadow: 0 0 8px rgba(0, 0, 0, 0.5);
      }
    }
    
    .status-indicator {
      display: block !important;
      visibility: visible !important;
      position: absolute !important;
      z-index: 10000 !important;
      pointer-events: none !important;
      overflow: visible !important;
      transform-origin: center !important;
    }
    
    .status-indicator.status-on {
      background-color: #4caf50 !important;
      border: 1px solid white !important;
      box-shadow: 0 0 4px rgba(76, 175, 80, 0.8) !important;
    }
    
    .status-indicator.status-off {
      background-color: #f44336 !important;
      border: 1px solid white !important;
      box-shadow: 0 0 4px rgba(244, 67, 54, 0.8) !important;
      animation: status-blink 1.2s ease-in-out infinite !important;
    }
    
    .status-indicator:hover {
      transform: scale(1.2) !important;
      transition: transform 0.2s ease !important;
    }
  `;
    document.head.appendChild(style);
  }
  private processDeviceUpdate(
    deviceIP: string,
    deviceName: string,
    deviceType: string,
    deviceStatus: string,
    existingNodeIds: Set<string>,
    newNodes: NetworkNode[],
    deviceUpdates: any[]
  ): void {
    const normalizedStatus = this.normalizeStatus(deviceStatus);
    const normalizedType = this.normalizeDeviceType(deviceType);

    if (existingNodeIds.has(deviceIP)) {
      // Device exists, check for updates
      const currentStatus = this.deviceStatusMap.get(deviceIP);
      const currentType = this.deviceTypeMap.get(deviceIP);

      const update: any = { id: deviceIP };
      let hasChanges = false;

      if (normalizedStatus && currentStatus !== normalizedStatus) {
        update.status = normalizedStatus;
        hasChanges = true;
      }

      if (normalizedType && currentType !== normalizedType) {
        update.type = normalizedType;
        hasChanges = true;
      }

      if (hasChanges) {
        deviceUpdates.push(update);
      }
    } else {
      // New device - default to 'off' status if no status provided
      // Note: deviceType should already be the final determined type from getDeviceType()
      const deviceTypeForNode = normalizedType || 'firewall'; // Use normalized type or fallback
      const deviceStatusForNode = normalizedStatus || 'off';

      const newNode = this.createOrUpdateNodeIncremental(
        deviceIP,
        deviceName,
        existingNodeIds,
        newNodes,
        deviceTypeForNode
      );

      if (newNode) {
        this.deviceStatusMap.set(deviceIP, deviceStatusForNode);

        // Store the device type in the type map
        this.deviceTypeMap.set(deviceIP, deviceTypeForNode);

        // Start blinking for the new device immediately
        const cyElement = this.cyContainer?.nativeElement;
        if (cyElement && cyElement._cy) {
          const cy = cyElement._cy;
          const node = cy.getElementById(deviceIP);
          if (node.length) {
            this.startBlinking(deviceIP, deviceStatusForNode);
          }
        }
      }
    }
  }

  private normalizeStatus(status: string): 'on' | 'off' | null {
    if (!status) return null;
    const normalized = status.toLowerCase().trim();
    if (
      normalized === 'on' ||
      normalized === 'online' ||
      normalized === 'up' ||
      normalized === 'active'
    ) {
      return 'on';
    }
    if (
      normalized === 'off' ||
      normalized === 'offline' ||
      normalized === 'down' ||
      normalized === 'inactive'
    ) {
      return 'off';
    }
    return null;
  }

  private normalizeDeviceType(type: string): string | null {
    if (!type) return null;
    return type.toLowerCase().trim();
  }

  private determineDeviceStatus(
    deviceIP: string,
    providedStatus: string,
    inSpeed: number,
    outSpeed: number,
    deviceRole: 'A' | 'B'
  ): 'on' | 'off' {
    // If status is explicitly provided, use it (but still log auto-detection)
    if (providedStatus) {
      const normalizedProvided = this.normalizeStatus(providedStatus);
      if (normalizedProvided) {
        return normalizedProvided;
      }
    }
    const isDeviceUp = inSpeed > 0;
    const autoStatus: 'on' | 'off' = isDeviceUp ? 'on' : 'off';

    return autoStatus;
  }

  private processDeviceUpdatesIncrementally(
    deviceUpdates: DeviceUpdate[]
  ): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) {
      return;
    }

    const cy = cyElement._cy;

    deviceUpdates.forEach((update) => {
      const node = cy.getElementById(update.id);
      if (!node.length) {
        return;
      }

      // Handle status changes
      if (update.status) {
        const oldStatus = this.deviceStatusMap.get(update.id);
        this.deviceStatusMap.set(update.id, update.status);

        // Add status animation
        if (oldStatus && oldStatus !== update.status) {
          this.animateStatusChange(cy, node, oldStatus, update.status);
        } else {
          this.applyStatusStyling(node, update.status);
        }
      }

      // Handle type changes
      if (update.type) {
        const oldType = this.deviceTypeMap.get(update.id);
        this.deviceTypeMap.set(update.id, update.type);

        if (oldType && oldType !== update.type) {
          this.animateTypeChange(cy, node, oldType, update.type);
        } else {
          // Update node data
          node.data('type', this.mapToNodeType(update.type));
        }
      }
    });
  }

  private animateStatusChange(
    cy: any,
    node: any,
    oldStatus: string,
    newStatus: 'on' | 'off'
  ): void {
    const nodeId = node.id();
    this.pendingStatusAnimations.push({
      nodeId,
      fromStatus: oldStatus,
      toStatus: newStatus,
      timestamp: Date.now(),
    });
    if (newStatus === 'on') {
      this.applyStatusStyling(node, newStatus);
      this.startBlinking(nodeId, newStatus);
    } else if (newStatus === 'off') {
      this.applyStatusStyling(node, newStatus);
      this.startBlinking(nodeId, newStatus);
    }
    setTimeout(() => {
      this.applyStatusStyling(node, newStatus);
    }, this.STATUS_ANIMATION_DURATION);
  }

  private animateTypeChange(
    cy: any,
    node: any,
    oldType: string,
    newType: string
  ): void {
    const nodeId = node.id();
    const currentWidth = node.style('width');
    const currentHeight = node.style('height');

    node.animate({
      style: {
        width: currentWidth * 0.7,
        height: currentHeight * 0.7,
        'background-opacity': 0.3,
      },
      duration: 400,
    });

    setTimeout(() => {
      node.data('type', this.mapToNodeType(newType));

      node.animate({
        style: {
          width: currentWidth,
          height: currentHeight,
          'background-opacity': 0,
        },
        duration: 400,
      });
    }, 400);
  }

  private applyStatusStyling(node: any, status: 'on' | 'off'): void {
    if (status === 'on') {
      node.style({
        'border-color': '#4caf50',
        'border-width': 0,
        'border-opacity': 0,
      });
    } else if (status === 'off') {
      node.style({
        'border-color': '#f44336',
        'border-width': 0,
        'border-opacity': 0,
      });
    }
  }

  private mapToNodeType(type: string): string {
    const typeMap: { [key: string]: string } = {
      router: 'router',
      switch: 'switch',
      core_switch: 'core_switch',
      'core switch': 'core_switch',
      firewall: 'firewall',
      server: 'server',
      internet: 'internet',
      external_switch: 'ext_switch',
      ext_switch: 'ext_switch',
      isp: 'isp',
    };

    return typeMap[type.toLowerCase()] || 'firewall';
  }

  private handleDuplicateConnection(
    connectionId: string,
    inSpeed: number,
    outSpeed: number,
    capacity: number,
    deviceAIP: string,
    deviceBIP: string
  ): void {
    const existingConnection = this.connectionMap.get(connectionId);
    const mergedInSpeed = Math.max(inSpeed, existingConnection.inSpeed);
    const mergedOutSpeed = Math.max(outSpeed, existingConnection.outSpeed);
    const mergedCapacity = Math.max(capacity, existingConnection.capacity);

    existingConnection.inSpeed = mergedInSpeed;
    existingConnection.outSpeed = mergedOutSpeed;
    existingConnection.capacity = mergedCapacity;

    const speedPercentage =
      mergedCapacity > 0 ? (mergedInSpeed / mergedCapacity) * 100 : 0;
    const speedInfo = this.getSpeedColorInfo(
      speedPercentage,
      mergedInSpeed,
      mergedCapacity
    );

    existingConnection.speedPercentage = speedPercentage;
    existingConnection.speedColor = speedInfo.color;
    existingConnection.speedStatus = speedInfo.status;
    existingConnection.speed = `${mergedInSpeed}G / ${mergedCapacity}G`;

    this.updateExistingEdgeInCytoscape(
      deviceAIP,
      deviceBIP,
      existingConnection
    );
  }

  private createNewEdge(
    deviceAIP: string,
    deviceBIP: string,
    inSpeed: number,
    outSpeed: number,
    capacity: number,
    interface_a: string,
    interface_b: string,
    description: string,
    newEdges: NetworkEdge[]
  ): void {
    const connectionId = this.createConnectionId(
      deviceAIP,
      interface_a,
      deviceBIP,
      interface_b
    );
    const speedPercentage = capacity > 0 ? (inSpeed / capacity) * 100 : 0;
    const speedInfo = this.getSpeedColorInfo(
      speedPercentage,
      inSpeed,
      capacity
    );

    const connectionData = {
      deviceAIP,
      deviceBIP,
      inSpeed,
      outSpeed,
      capacity,
      interface_a,
      interface_b,
      description,
      speedPercentage,
      speedColor: speedInfo.color,
      speedStatus: speedInfo.status,
      speed: `${inSpeed}G / ${capacity}G`,
    };

    this.connectionMap.set(connectionId, connectionData);

    const edge: NetworkEdge = {
      source: deviceAIP,
      target: deviceBIP,
      speed: connectionData.speed,
      status: description,
      type: 'primary',
      metadata: {
        interface_a,
        interface_b,
        description,
        inSpeed: `${inSpeed}G`,
        outSpeed: `${outSpeed}G`,
        capacity: `${capacity}G`,
        speedPercentage,
        speedColor: speedInfo.color,
        speedStatus: speedInfo.status,
      },
    };

    newEdges.push(edge);
    this.networkData.edges.push(edge);
  }

  private shouldDoFullReinitialization(
    newNodes: NetworkNode[],
    newEdges: NetworkEdge[]
  ): boolean {
    if (this.forceFullUpdate) {
      return true;
    }

    if (!this.hasCytoscapeInstance()) {
      return true;
    }

    if (this.networkData.nodes.length === 0) {
      return true;
    }

    if (
      this.networkData.nodes.length === newNodes.length &&
      newNodes.length > 0
    ) {
      return true;
    }

    return false;
  }

  clearData() {
    this.stopAllBlinking();
    this.cleanupTooltip();
    this.networkData = {
      blocks: this.networkData.blocks,
      nodes: [],
      edges: [],
    };

    this.fileData = [];
    this.fileName = '';
    this.connectionMap.clear();
    this.deviceStatusMap.clear();
    this.deviceTypeMap.clear();
    this.isUpdatingIncrementally = false;

    this.clearLocalStorage();

    this.reinitializeNetwork();

    this.updateTimestamp();

    this.toastService.success('Network data cleared successfully!', 3000);
  }

  private cleanupTooltip(): void {
    if (this.edgeTooltip && this.edgeTooltip.parentNode) {
      this.edgeTooltip.parentNode.removeChild(this.edgeTooltip);
      this.edgeTooltip = null;
    }
    if (this.deviceTooltip && this.deviceTooltip.parentElement) {
      this.deviceTooltip.parentElement.removeChild(this.deviceTooltip);
      this.deviceTooltip = null;
    }
  }

  forceFullReinitialization(): void {
    this.reinitializeNetwork();
  }

  private saveStateToLocalStorage(): void {
    // ✅ FIX: localStorage functionality disabled - keeping data in memory only
    // try {
    //   const connectionMapObj: { [key: string]: any } = {};
    //   this.connectionMap.forEach((value, key) => {
    //     connectionMapObj[key] = value;
    //   });

    //   const positionsObj: { [key: string]: SavedPosition } = {};
    //   this.savedPositions.forEach((value, key) => {
    //     positionsObj[key] = value;
    //   });

    //   const deviceStatusObj: { [key: string]: string } = {};
    //   this.deviceStatusMap.forEach((value, key) => {
    //     deviceStatusObj[key] = value;
    //   });

    //   const deviceTypeObj: { [key: string]: string } = {};
    //   this.deviceTypeMap.forEach((value, key) => {
    //     deviceTypeObj[key] = value;
    //   });

    //   const state: SavedNetworkState = {
    //     networkData: this.networkData,
    //     positions: positionsObj,
    //     connectionMap: connectionMapObj,
    //     deviceStatus: deviceStatusObj,
    //     deviceTypes: deviceTypeObj,
    //     timestamp: Date.now(),
    //   };

    //   localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
    //   // this.toastService.success('State saved to local storage', 2000);
    // } catch (error) {
    //   console.error('Failed to save state to localStorage:', error);
    // }

    console.log(
      '💾 Data tracked in memory:',
      this.savedPositions.size,
      'positions,',
      this.connectionMap.size,
      'connections (localStorage disabled)'
    );
  }

  private loadStateFromLocalStorage(): void {
    // ✅ FIX: localStorage functionality disabled - load fresh data from backend
    // try {
    //   const savedStateString = localStorage.getItem(this.STORAGE_KEY);
    //   if (!savedStateString) {
    //     if (!this.isLoadingData) {
    //       this.loadNetworkData();
    //     }
    //     return;
    //   }

    //   const savedState: SavedNetworkState = JSON.parse(savedStateString);

    //   if (savedState.networkData) {
    //     this.networkData = savedState.networkData;
    //     this.toastService.info('Loaded network data from local storage', 2000);
    //   }

    //   this.connectionMap.clear();
    //   if (savedState.connectionMap) {
    //     Object.entries(savedState.connectionMap).forEach(([key, value]) => {
    //       this.connectionMap.set(key, value);
    //     });
    //   }

    //   // ✅ FIX: Preserve user-modified positions during localStorage loading
    //   const userModifiedPositions = new Map<string, SavedPosition>();
    //   this.savedPositions.forEach((position, nodeId) => {
    //     const localStoragePosition = savedState.positions?.[nodeId];
    //     if (
    //       !localStoragePosition ||
    //       Math.abs(position.x - localStoragePosition.x) > 5 ||
    //       Math.abs(position.y - localStoragePosition.y) > 5
    //     ) {
    //       userModifiedPositions.set(nodeId, position);
    //     }
    //   });

    //   this.savedPositions.clear();
    //   if (savedState.positions) {
    //     Object.entries(savedState.positions).forEach(([key, value]) => {
    //       this.savedPositions.set(key, value);
    //     });
    //   }

    //   // ✅ Restore user-modified positions (they take precedence)
    //   userModifiedPositions.forEach((position, nodeId) => {
    //     this.savedPositions.set(nodeId, position);
    //   });

    //   this.deviceStatusMap.clear();
    //   if (savedState.deviceStatus) {
    //     Object.entries(savedState.deviceStatus).forEach(([key, value]) => {
    //       this.deviceStatusMap.set(key, value as 'on' | 'off');
    //     });
    //   }

    //   this.deviceTypeMap.clear();
    //   if (savedState.deviceTypes) {
    //     Object.entries(savedState.deviceTypes).forEach(([key, value]) => {
    //       this.deviceTypeMap.set(key, value as string);
    //     });
    //   }
    // } catch (error) {
    //   console.error('Failed to load state from localStorage:', error);
    //   this.clearLocalStorage();
    // }

    console.log('💾 localStorage disabled - loading fresh data from backend');
    if (!this.isLoadingData) {
      this.loadNetworkData();
    }
  }

  private clearLocalStorage(): void {
    // ✅ FIX: localStorage functionality disabled - no clearing needed
    // try {
    //   localStorage.removeItem(this.STORAGE_KEY);
    //   localStorage.removeItem(this.POSITIONS_KEY);
    //   localStorage.removeItem(this.DATA_KEY);
    // } catch (error) {
    //   console.error('Failed to clear localStorage:', error);
    // }

    console.log('💾 localStorage disabled - no clearing needed');
  }

  private saveNodePosition(nodeId: string, position: SavedPosition): void {
    const oldPosition = this.savedPositions.get(nodeId);
    this.savedPositions.set(nodeId, position);

    // ✅ FIX: Enhanced position change detection
    let hasSignificantChange = false;
    if (oldPosition) {
      const distance = Math.sqrt(
        Math.pow(position.x - oldPosition.x, 2) +
          Math.pow(position.y - oldPosition.y, 2)
      );
      hasSignificantChange = distance > 5; // Only save if moved more than 5 pixels
    } else {
      hasSignificantChange = true; // New position always counts as significant
    }

    console.log(
      `📍 Position saved locally for ${nodeId}: (${position.x.toFixed(
        1
      )}, ${position.y.toFixed(
        1
      )}) - Use "Save Positions" button to save to backend`
    );

    this.saveStateToLocalStorage();

    // ✅ FIX: DISABLED automatic backend saving - only save on button click
    // Positions are only saved when user clicks "Save Positions" button
    // if (hasSignificantChange) {
    //   this.debouncedSavePositionsToBackend();
    // }
  }

  private getSavedPosition(nodeId: string): SavedPosition | null {
    const pos = this.savedPositions.get(nodeId) || null;
    if (pos && pos.x === 0 && pos.y === 0) {
      return null;
    }
    return pos;
  }

  private isValidPosition(position: SavedPosition): boolean {
    if (!position) return false;

    // ✅ FIX: Only skip positions that are exactly (0,0)
    // Allow negative positions and any other valid coordinates
    if (position.x === 0 && position.y === 0) return false;

    // ✅ FIX: Only check for NaN and infinite values
    // Remove the absolute value limit to allow negative coordinates
    if (
      isNaN(position.x) ||
      isNaN(position.y) ||
      !isFinite(position.x) ||
      !isFinite(position.y)
    )
      return false;

    return true;
  }

  private isUserModifiedPosition(
    nodeId: string,
    defaultPosition?: SavedPosition
  ): boolean {
    const savedPos = this.getSavedPosition(nodeId);

    if (!savedPos || (savedPos.x === 0 && savedPos.y === 0)) {
      return false;
    }

    if (defaultPosition) {
      const threshold = 10;
      return (
        Math.abs(savedPos.x - defaultPosition.x) > threshold ||
        Math.abs(savedPos.y - defaultPosition.y) > threshold
      );
    }

    return true;
  }

  private isFirstTimeVisit(): boolean {
    // ✅ FIX: localStorage functionality disabled - only check memory and network data
    // const hasLocalStoragePositions = this.hasLocalStorageData();
    const hasMemoryPositions = this.savedPositions.size > 0;
    const hasNetworkData = this.hasNetworkData();
    const isFirstVisit = !hasMemoryPositions && !hasNetworkData;
    return isFirstVisit;
  }

  private generateSafePosition(
    cy: any,
    nodeId: string,
    preferredParent?: string
  ): SavedPosition {
    const savedPos = this.getSavedPosition(nodeId);
    if (savedPos && this.isValidPosition(savedPos)) {
      return savedPos;
    }

    if (preferredParent) {
      const parentBlock = cy.getElementById(preferredParent);
      if (parentBlock.length) {
        const parentPos = parentBlock.position();

        const siblings = parentBlock
          .children()
          .filter(
            (sibling: any) => sibling.id() !== nodeId && !sibling.isParent()
          );

        const maxDevicesPerRow = 4;
        const deviceSpacing = 80;
        const row = Math.floor(siblings.length / maxDevicesPerRow);
        const col = siblings.length % maxDevicesPerRow;
        const totalRows = Math.ceil((siblings.length + 1) / maxDevicesPerRow);

        const deviceX =
          parentPos.x + (col - (maxDevicesPerRow - 1) / 2) * deviceSpacing;
        const deviceY =
          parentPos.y + (row - (totalRows - 1) / 2) * deviceSpacing;

        return {
          x: deviceX,
          y: deviceY,
        };
      }
    }

    const viewport = cy.extent();
    const padding = 150;
    const minDistance = 200;

    const viewportWidth = Math.max(viewport.x2 - viewport.x1, 800);
    const viewportHeight = Math.max(viewport.y2 - viewport.y1, 600);

    const existingNodes = cy
      .nodes()
      .filter((node: any) => node.id() !== nodeId);
    const existingPositions = existingNodes.map((node: any) => node.position());

    let attempts = 0;
    let newPosition: SavedPosition;
    const maxAttempts = 20;

    do {
      newPosition = {
        x:
          viewport.x1 + padding + Math.random() * (viewportWidth - 2 * padding),
        y:
          viewport.y1 +
          padding +
          Math.random() * (viewportHeight - 2 * padding),
      };

      const distanceFromOrigin = Math.sqrt(
        newPosition.x * newPosition.x + newPosition.y * newPosition.y
      );
      if (distanceFromOrigin < 50) {
        attempts++;
        continue;
      }

      let tooClose = false;
      for (const existingPos of existingPositions) {
        const distance = Math.sqrt(
          Math.pow(newPosition.x - existingPos.x, 2) +
            Math.pow(newPosition.y - existingPos.y, 2)
        );
        if (distance < minDistance) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) break;
      attempts++;
    } while (attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      const gridSize = 300;
      const gridCols = Math.ceil(viewportWidth / gridSize);
      const gridRows = Math.ceil(viewportHeight / gridSize);

      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          const gridX = viewport.x1 + padding + col * gridSize + gridSize / 2;
          const gridY = viewport.y1 + padding + row * gridSize + gridSize / 2;

          let validPosition = true;
          for (const existingPos of existingPositions) {
            const distance = Math.sqrt(
              Math.pow(gridX - existingPos.x, 2) +
                Math.pow(gridY - existingPos.y, 2)
            );
            if (distance < minDistance) {
              validPosition = false;
              break;
            }
          }

          if (validPosition) {
            newPosition = { x: gridX, y: gridY };
            break;
          }
        }
        if (newPosition) break;
      }
      if (!newPosition) {
        newPosition = {
          x: 200 + Math.random() * 400,
          y: 200 + Math.random() * 400,
        };
      }
    }

    return newPosition;
  }

  private arrangeCoreNetworkSwitches(cy: any): void {
    const coreBlock = cy.getElementById('core-block');
    if (!coreBlock.length) return;

    const coreSwitches = coreBlock.children().filter((node: any) => {
      const nodeType = node.data('type');
      const nodeId = node.data('id');
      return (
        nodeType === 'switch' ||
        nodeType === 'core_switch' ||
        nodeId.includes('COR-C-SW')
      );
    });

    if (coreSwitches.length === 0) return;
    const coreBlockBB = coreBlock.boundingBox();
    const centerX = (coreBlockBB.x1 + coreBlockBB.x2) / 2;
    const centerY = (coreBlockBB.y1 + coreBlockBB.y2) / 2;

    let switchSpacing = 250;
    const switchesWithSavedPositions = coreSwitches.filter((sw: any) =>
      this.getSavedPosition(sw.id())
    );

    if (switchesWithSavedPositions.length > 1) {
      const positions = switchesWithSavedPositions
        .map((sw: any) => this.getSavedPosition(sw.id())!.x)
        .sort((a: number, b: number) => a - b);
      const spacings: number[] = [];
      for (let i = 1; i < positions.length; i++) {
        spacings.push(Math.abs(positions[i] - positions[i - 1]));
      }
      if (spacings.length > 0) {
        const filteredSpacings = spacings.filter(
          (spacing) => spacing > 50 && spacing < 500
        );
        if (filteredSpacings.length > 0) {
          switchSpacing =
            filteredSpacings.reduce((sum, spacing) => sum + spacing, 0) /
            filteredSpacings.length;
        }
      }
    }

    const totalWidth = (coreSwitches.length - 1) * switchSpacing;
    const startX = centerX - totalWidth / 2;

    coreSwitches.forEach((switchNode: any, index: number) => {
      const nodeId = switchNode.id();
      const savedPos = this.getSavedPosition(nodeId);

      if (savedPos) {
        switchNode.position(savedPos);
      } else {
        const newPosition = {
          x: startX + index * switchSpacing,
          y: centerY,
        };
        switchNode.position(newPosition);
        this.saveNodePosition(nodeId, newPosition);
      }
    });
  }

  private hasCytoscapeInstance(): boolean {
    const cyElement = this.cyContainer?.nativeElement;
    return !!(cyElement && cyElement._cy);
  }

  private getCytoscapeInstance(): any {
    const cyElement = this.cyContainer?.nativeElement;
    return cyElement && cyElement._cy ? cyElement._cy : null;
  }

  private setupDragHandlers(cy: any): void {
    cy.off('dragstart', 'node');
    cy.off('drag', 'node');
    cy.off('dragfree', 'node');

    cy.on('dragstart', 'node', (event: any) => {
      const node = event.target;
      const nodeType = this.getNodeTypeInfo(node);

      // ✅ FIX: Set dragging flag to prevent position clearing during drag operations
      this.isUserDragging = true;

      if (nodeType.isBlock) {
        this.draggedBlockId = node.id();

        if (this.draggedBlockTimeout) {
          clearTimeout(this.draggedBlockTimeout);
        }

        this.draggedBlockTimeout = setTimeout(() => {
          this.draggedBlockId = null;
          this.draggedBlockTimeout = null;
        }, 5000);
      } else {
        if (!this.draggedBlockId) {
        }
      }
    });

    cy.on('drag', 'node', (event: any) => {
      const node = event.target;
      const position = node.position();
      const nodeType = this.getNodeTypeInfo(node);

      // ✅ FIX: Enhanced drag handling with better position tracking
      this.saveNodePosition(node.id(), position);

      // ✅ FIX: If dragging a block, also update positions of child devices
      if (nodeType.isBlock) {
        console.log(
          `📦 Block ${node.id()} being dragged - updating child positions`
        );
        const children = node.children();
        children.forEach((child: any) => {
          const childPosition = child.position();
          this.saveNodePosition(child.id(), childPosition);
        });
      }

      this.updateStatusIndicatorPosition(node.id());
    });

    cy.on('dragfree', 'node', (event: any) => {
      const node = event.target;
      const position = node.position();
      const nodeType = this.getNodeTypeInfo(node);

      // ✅ FIX: Enhanced dragfree handling for better position saving
      this.saveNodePosition(node.id(), position);

      // ✅ FIX: If block was dragged, ensure all child positions are saved
      if (nodeType.isBlock) {
        console.log(
          `📦 Block ${node.id()} drag completed - finalizing child positions`
        );
        const children = node.children();
        children.forEach((child: any) => {
          const childPosition = child.position();
          this.saveNodePosition(child.id(), childPosition);
        });

        // ✅ FIX: DISABLED automatic save - only save on button click
        // console.log(
        //   `💾 Block movement completed - forcing immediate position save`
        // );
        // setTimeout(() => {
        //   this.saveDevicePositionsToBackend();
        // }, 500);
      }

      if (nodeType.isBlock || !this.draggedBlockId) {
        this.logDetailedNodePosition(node, position);
      }

      if (nodeType.isBlock && this.draggedBlockId === node.id()) {
        this.draggedBlockId = null;
        if (this.draggedBlockTimeout) {
          clearTimeout(this.draggedBlockTimeout);
          this.draggedBlockTimeout = null;
        }
      }

      // ✅ FIX: Clear dragging flag after drag operation completes
      this.isUserDragging = false;

      this.updateStatusIndicatorPosition(node.id());

      if (
        this.enableCoreSwitchAutoArrangement &&
        node.parent().length > 0 &&
        node.parent().id() === 'core-block' &&
        (node.data('type') === 'switch' ||
          node.data('type') === 'core_switch' ||
          node.id().includes('COR-C-SW'))
      ) {
        this.updateCoreSwitchParallelPositions(cy, node);
      }
    });

    cy.on('dragcancel', 'node', (event: any) => {
      this.draggedBlockId = null;
      // ✅ FIX: Clear dragging flag if drag is cancelled
      this.isUserDragging = false;
      if (this.draggedBlockTimeout) {
        clearTimeout(this.draggedBlockTimeout);
        this.draggedBlockTimeout = null;
      }
    });
  }

  private getNodeTypeInfo(node: any): {
    isBlock: boolean;
    description: string;
    details: any;
  } {
    const isBlock = node.isParent();
    const nodeData = node.data();

    if (isBlock) {
      return {
        isBlock: true,
        description: 'BLOCK',
        details: {
          id: node.id(),
          label: nodeData.label || node.id(),
          type: 'compound',
        },
      };
    } else {
      return {
        isBlock: false,
        description: 'DEVICE',
        details: {
          id: node.id(),
          label: nodeData.label || node.id(),
          type: nodeData.type || 'unknown',
          parent: node.parent().length > 0 ? node.parent().id() : 'none',
          status: nodeData.status || 'unknown',
        },
      };
    }
  }

  private logDetailedNodePosition(node: any, position: SavedPosition): void {
    const nodeInfo = this.getNodeTypeInfo(node);
    const timestamp = new Date().toISOString();

    if (nodeInfo.isBlock) {
      const childDevices = this.getChildDevicesInBlock(node);

      const blockLocationData = {
        type: 'block',
        dragType: 'block_drag',
        id: nodeInfo.details.id,
        label: nodeInfo.details.label,
        blockType: nodeInfo.details.type,

        position: {
          x: Math.round(position.x * 100) / 100,
          y: Math.round(position.y * 100) / 100,
        },

        timestamp: timestamp,

        childDevicesCount: childDevices.length,
        childDevices: childDevices.map((child) => ({
          id: child.id(),
          label: child.data('label') || child.id(),
          type: child.data('type') || 'unknown',
          status: child.data('status') || 'unknown',
          position: {
            x: Math.round(child.position().x * 100) / 100,
            y: Math.round(child.position().y * 100) / 100,
          },
        })),

        dragEvent: 'dragfree',
        source: 'network-topology-component',
      };
    } else {
      const deviceNetworkInfo = this.getDeviceNetworkInfo(nodeInfo.details.id);

      const deviceLocationData = {
        type: 'device',
        dragType: 'device_drag',
        id: nodeInfo.details.id,
        label: nodeInfo.details.label,
        deviceType: nodeInfo.details.type,
        status: nodeInfo.details.status,

        parentBlock: nodeInfo.details.parent,

        position: {
          x: Math.round(position.x * 100) / 100,
          y: Math.round(position.y * 100) / 100,
        },

        timestamp: timestamp,

        networkInfo: {
          totalConnections: deviceNetworkInfo?.totalConnections || 0,
          hasConnections: (deviceNetworkInfo?.totalConnections || 0) > 0,
          connections: deviceNetworkInfo?.connections || [],
          hasMoreConnections: deviceNetworkInfo?.hasMoreConnections || false,
        },

        dragEvent: 'dragfree',
        source: 'network-topology-component',
      };
    }
  }

  private getChildDevicesInBlock(blockNode: any): any[] {
    const cy = this.getCytoscapeInstance();
    if (!cy) return [];

    return cy.nodes().filter((node: any) => {
      return (
        !node.isParent() &&
        node.parent().length > 0 &&
        node.parent().id() === blockNode.id()
      );
    });
  }

  private getDeviceNetworkInfo(deviceId: string): any {
    const connections: any[] = [];
    this.connectionMap.forEach((value, key) => {
      if (key.includes(deviceId)) {
        connections.push({
          connectionId: key,
          details: value,
        });
      }
    });

    return {
      totalConnections: connections.length,
      connections: connections.slice(0, 3),
      hasMoreConnections: connections.length > 3,
    };
  }

  public getDragTypeInfo(node: any): {
    dragType: 'block_drag' | 'device_drag';
    description: string;
    isBlockDrag: boolean;
  } {
    const nodeInfo = this.getNodeTypeInfo(node);

    if (nodeInfo.isBlock) {
      return {
        dragType: 'block_drag',
        description: 'Block is being dragged',
        isBlockDrag: true,
      };
    } else {
      return {
        dragType: 'device_drag',
        description: 'Device is being dragged individually',
        isBlockDrag: false,
      };
    }
  }

  public getDragEventObject(node: any, position: SavedPosition): any {
    const nodeInfo = this.getNodeTypeInfo(node);
    const timestamp = new Date().toISOString();

    if (nodeInfo.isBlock) {
      const childDevices = this.getChildDevicesInBlock(node);

      return {
        type: 'block',
        dragType: 'block_drag',
        id: nodeInfo.details.id,
        label: nodeInfo.details.label,
        blockType: nodeInfo.details.type,

        position: {
          x: Math.round(position.x * 100) / 100,
          y: Math.round(position.y * 100) / 100,
        },

        timestamp: timestamp,

        childDevicesCount: childDevices.length,
        childDevices: childDevices.map((child) => ({
          id: child.id(),
          label: child.data('label') || child.id(),
          type: child.data('type') || 'unknown',
          status: child.data('status') || 'unknown',
          position: {
            x: Math.round(child.position().x * 100) / 100,
            y: Math.round(child.position().y * 100) / 100,
          },
        })),

        dragEvent: 'dragfree',
        source: 'network-topology-component',
      };
    } else {
      const deviceNetworkInfo = this.getDeviceNetworkInfo(nodeInfo.details.id);

      return {
        type: 'device',
        dragType: 'device_drag',
        id: nodeInfo.details.id,
        label: nodeInfo.details.label,
        deviceType: nodeInfo.details.type,
        status: nodeInfo.details.status,

        parentBlock: nodeInfo.details.parent,

        position: {
          x: Math.round(position.x * 100) / 100,
          y: Math.round(position.y * 100) / 100,
        },
        timestamp: timestamp,
        networkInfo: {
          totalConnections: deviceNetworkInfo?.totalConnections || 0,
          hasConnections: (deviceNetworkInfo?.totalConnections || 0) > 0,
          connections: deviceNetworkInfo?.connections || [],
          hasMoreConnections: deviceNetworkInfo?.hasMoreConnections || false,
        },

        dragEvent: 'dragfree',
        source: 'network-topology-component',
      };
    }
  }

  private parseSpeed(speedStr: string): number {
    if (!speedStr) return 0;

    const numericValue = parseFloat(
      speedStr.toString().replace(/[^0-9.]/g, '')
    );
    return isNaN(numericValue) ? 0 : numericValue;
  }

  private createConnectionId(
    deviceAIP: string,
    interfaceA: string,
    deviceBIP: string,
    interfaceB: string
  ): string {
    const normalizedInterfaceA = (interfaceA || '').trim().toUpperCase();
    const normalizedInterfaceB = (interfaceB || '').trim().toUpperCase();
    const normalizedDeviceA = (deviceAIP || '').trim();
    const normalizedDeviceB = (deviceBIP || '').trim();

    if (!normalizedInterfaceA || !normalizedInterfaceB) {
      const devicePair = [normalizedDeviceA, normalizedDeviceB].sort();
      const connectionId = `${devicePair[0]}|${devicePair[1]}`;
      return connectionId;
    }

    const pairA = `${normalizedDeviceA}:${normalizedInterfaceA}`;
    const pairB = `${normalizedDeviceB}:${normalizedInterfaceB}`;

    const sortedPairs = [pairA, pairB].sort();

    const connectionId = `${sortedPairs[0]}|${sortedPairs[1]}`;

    return connectionId;
  }

  private getDeviceType(
    deviceName: string,
    deviceIP?: string,
    excelDeviceType?: string
  ):
    | 'firewall'
    | 'switch'
    | 'router'
    | 'server'
    | 'internet'
    | 'ext_switch'
    | 'core_switch'
    | 'isp' {
    if (deviceIP === '10.99.18.253' || deviceIP === '10.99.18.254') {
      return 'core_switch';
    }

    if (excelDeviceType && excelDeviceType.trim()) {
      const excelType = this.mapExcelDeviceType(excelDeviceType.trim());
      return excelType;
    }

    const name = deviceName.toUpperCase();

    if (name.includes('COR-C-SW')) return 'core_switch';
    if (name.includes('FW')) return 'firewall';
    if (name.includes('RO') || name.includes('R0')) return 'router';
    if (name.includes('SRV') || name.includes('SERVER')) return 'server';
    if (name.includes('EXT')) return 'ext_switch';

    return 'firewall';
  }

  private mapExcelDeviceType(
    excelType: string
  ):
    | 'firewall'
    | 'switch'
    | 'router'
    | 'server'
    | 'internet'
    | 'ext_switch'
    | 'core_switch'
    | 'isp' {
    const type = excelType.toLowerCase().trim();

    switch (type) {
      case 'switch':
        return 'switch';
      case 'firewall':
        return 'firewall';
      case 'router':
        return 'router';
      case 'proxy':
        return 'server';
      case 'ips':
        return 'firewall';
      case 'isp':
        return 'isp';
      default:
        break;
    }

    if (type.includes('core') && type.includes('switch')) return 'core_switch';
    if (type.includes('core')) return 'core_switch';
    if (type.includes('switch')) return 'switch';
    if (type.includes('router')) return 'router';
    if (type.includes('firewall') || type.includes('fw')) return 'firewall';
    if (type.includes('server') || type.includes('srv')) return 'server';
    if (type.includes('proxy')) return 'server';
    if (type.includes('ips') || type.includes('intrusion')) return 'firewall';
    if (type.includes('internet') || type.includes('wan')) return 'internet';
    if (type.includes('isp')) return 'isp';
    if (type.includes('external') || type.includes('ext')) return 'ext_switch';

    if (type === 'l3_switch' || type === 'layer3_switch') return 'core_switch';
    if (type === 'l2_switch' || type === 'layer2_switch') return 'switch';
    if (type === 'access_switch') return 'switch';
    if (type === 'distribution_switch') return 'switch';

    return 'firewall';
  }

  private getSpeedColorInfo(
    speedPercentage: number,
    inSpeed: number,
    capacity: number
  ): { color: string; status: string } {
    if (inSpeed === 0 || capacity === 0) {
      return { color: '#ff0000', status: 'down' };
    }

    if (speedPercentage >= 90) {
      return { color: '#f44336', status: 'critical' };
    } else if (speedPercentage >= 70) {
      return { color: '#ff9800', status: 'warning' };
    } else if (speedPercentage >= 50) {
      return { color: '#2196f3', status: 'normal' };
    } else {
      return { color: '#4caf50', status: 'good' };
    }
  }

  private createOrUpdateNodeIncremental(
    deviceIP: string,
    deviceName: string,
    existingNodeIds: Set<string>,
    newNodes: NetworkNode[],
    deviceType?: string
  ): NetworkNode | null {
    if (existingNodeIds.has(deviceIP)) {
      return null;
    }

    const existingNewNode = newNodes.find((node) => node.id === deviceIP);
    if (existingNewNode) {
      return existingNewNode;
    }

    const finalDeviceType =
      deviceType || this.getDeviceType(deviceName, deviceIP);
    const parentBlock = this.determineParentBlock(
      deviceName,
      deviceIP,
      finalDeviceType
    );

    const newNode: NetworkNode = {
      id: deviceIP,
      label: `${deviceName}\n${deviceIP}`,
      type: finalDeviceType as any,
      parent: parentBlock,
    };

    newNodes.push(newNode);
    this.networkData.nodes.push(newNode);
    existingNodeIds.add(deviceIP);
    return newNode;
  }

  private addIncrementalElements(
    newNodes: NetworkNode[],
    newEdges: NetworkEdge[]
  ): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) {
      this.reinitializeNetwork();
      return;
    }
    const cy = cyElement._cy;
    this.isUpdatingIncrementally = true;
    const existingNodes = cy.nodes();
    const lockedPositions = new Map();
    existingNodes.forEach((node: any) => {
      const currentPos = node.position();
      lockedPositions.set(node.id(), { x: currentPos.x, y: currentPos.y });
      node.lock();
    });
    newNodes.forEach((node) => {
      const nodeId = (node.id ?? '').toString().trim();
      if (!nodeId) {
        return;
      }

      // Ensure parent block exists in cy if specified
      const parentId = (node.parent ?? '').toString().trim();
      if (parentId) {
        const parentExists = cy.getElementById(parentId).length > 0;
        if (!parentExists) {
          // Find the block definition for label
          const blockDef = this.networkData.blocks.find(
            (b) => b.id === parentId
          );
          cy.add({
            group: 'nodes',
            data: { id: parentId, label: blockDef ? blockDef.label : parentId },
          });
        }
      }

      const nodeData = {
        id: nodeId,
        label: node.label,
        type: node.type,
        parent: node.parent,
      };

      const status = this.deviceStatusMap.get(nodeId);
      if (status) {
        (nodeData as any)['status'] = status;
      }

      cy.add({
        group: 'nodes',
        data: nodeData,
      });

      if (!this.deviceStatusMap.has(nodeId)) {
        this.deviceStatusMap.set(nodeId, 'off');
      }
      const nodeStatus = this.deviceStatusMap.get(nodeId);
      if (nodeStatus) {
        this.startBlinking(nodeId, nodeStatus);
      }
    });

    newEdges.forEach((edge) => {
      const sourceId = (edge.source ?? '').toString().trim();
      const targetId = (edge.target ?? '').toString().trim();
      if (!sourceId || !targetId) {
        return;
      }
      // ensure nodes exist in cy before adding edge
      if (
        !cy.getElementById(sourceId).length ||
        !cy.getElementById(targetId).length
      ) {
        return;
      }
      const edgeData: any = {
        source: sourceId,
        target: targetId,
        speed: edge.speed,
        status: edge.status,
        type: edge.type,
      };

      if (edge.metadata) {
        edgeData.interface_a = edge.metadata.interface_a;
        edgeData.interface_b = edge.metadata.interface_b;
        edgeData.description = edge.metadata.description;
        edgeData.inSpeed = edge.metadata.inSpeed;
        edgeData.outSpeed = edge.metadata.outSpeed;
        edgeData.capacity = edge.metadata.capacity;
        edgeData.speedPercentage = edge.metadata.speedPercentage;
        edgeData.speedColor = edge.metadata.speedColor;
        edgeData.speedStatus = edge.metadata.speedStatus;
      }

      cy.add({
        group: 'edges',
        data: edgeData,
      });
    });

    this.positionNewNodesManually(cy, newNodes);

    lockedPositions.forEach((position, nodeId) => {
      const node = cy.getElementById(nodeId);
      if (node.length) {
        node.position(position);
      }
    });

    existingNodes.forEach((node: any) => {
      node.unlock();
    });

    const newCyNodes = cy
      .nodes()
      .filter((node: any) =>
        newNodes.some((newNode) => newNode.id === node.id())
      );
    newCyNodes.grabify();

    this.setupDragHandlersForNewNodes(cy, newNodes);

    this.setupNodeHoverEffects(cy);

    this.isUpdatingIncrementally = false;

    setTimeout(() => {
      this.updateSpeedStatusCounts();
    }, 100);
  }

  private positionNewNodesManually(cy: any, newNodes: NetworkNode[]): void {
    newNodes.forEach((newNode) => {
      const cyNode = cy.getElementById(newNode.id);
      if (!cyNode.length) return;

      const safePosition = this.generateSafePosition(
        cy,
        newNode.id,
        newNode.parent
      );

      cyNode.position(safePosition);
      this.saveNodePosition(newNode.id, safePosition);
    });
  }

  private setupDragHandlersForNewNodes(cy: any, newNodes: NetworkNode[]): void {
    newNodes.forEach((newNode) => {
      const cyNode = cy.getElementById(newNode.id);
      if (!cyNode.length) return;

      cyNode.on('dragstart', (event: any) => {
        const node = event.target;
      });

      cyNode.on('drag', (event: any) => {
        const node = event.target;
        const position = node.position();
        this.saveNodePosition(node.id(), position);

        this.updateStatusIndicatorPosition(node.id());
      });

      cyNode.on('dragfree', (event: any) => {
        const node = event.target;
        const position = node.position();
        this.saveNodePosition(node.id(), position);

        this.updateStatusIndicatorPosition(node.id());

        if (
          this.enableCoreSwitchAutoArrangement &&
          node.parent().id() === 'core-block' &&
          (node.data('type') === 'switch' ||
            node.data('type') === 'core_switch' ||
            node.id().includes('COR-C-SW'))
        ) {
          this.updateCoreSwitchParallelPositions(cy, node);
        }
      });
    });
  }

  private updateExistingEdgeInCytoscape(
    deviceAIP: string,
    deviceBIP: string,
    connectionData: any
  ): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) return;

    const cy = cyElement._cy;

    const existingEdge = cy.edges().filter((edge: any) => {
      const source = edge.source().id();
      const target = edge.target().id();
      return (
        (source === deviceAIP && target === deviceBIP) ||
        (source === deviceBIP && target === deviceAIP)
      );
    });

    if (existingEdge.length > 0) {
      const edgeData = existingEdge.data();
      edgeData.speed = connectionData.speed;
      edgeData.speedPercentage = connectionData.speedPercentage;
      edgeData.speedColor = connectionData.speedColor;
      edgeData.speedStatus = connectionData.speedStatus;
      edgeData.inSpeed = `${connectionData.inSpeed}G`;
      edgeData.outSpeed = `${connectionData.outSpeed}G`;
      edgeData.capacity = `${connectionData.capacity}G`;

      existingEdge.style({
        'line-color': connectionData.speedColor,
      });
    }
  }

  private determineParentBlock(
    deviceName: string,
    deviceIP?: string,
    deviceType?: string
  ): string | undefined {
    if (deviceIP === '10.99.18.253' || deviceIP === '10.99.18.254') {
      return 'core-block';
    }

    if (deviceType === 'core_switch') {
      return 'core-block';
    }

    // ISP devices should not be assigned to any block
    if (deviceType === 'isp') {
      return undefined;
    }

    const name = deviceName.toUpperCase();

    if (name.includes('INT')) {
      return 'internet-block';
    }
    if (name.includes('OOB')) {
      return 'oob-block';
    }
    if (name.includes('WAN')) {
      return 'wan-block';
    }
    if (name.includes('OTV')) {
      return 'replication-block';
    }
    if (name.includes('DC')) {
      return 'datacenter-block';
    }
    if (name.includes('EXTRANET') || name.includes('EXTN')) {
      return 'extranet-block';
    }
    if (name.includes('VISIBILITY') || name.includes('VIS')) {
      return 'visibility-block';
    }
    if (name.includes('DMZ')) {
      return 'dmz-block';
    }
    if (name.includes('IPS')) {
      return 'ips-block';
    }
    if (name.includes('EXT')) {
      return 'external-block';
    }

    if (name.includes('COR')) {
      return 'core-block';
    }

    return undefined;
  }

  private isIPAddress(value: string): boolean {
    if (!value || typeof value !== 'string') return false;

    const ipPattern =
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipPattern.test(value.trim());
  }

  private reinitializeNetwork(): void {
    if (this.cyContainer?.nativeElement) {
      this.cyContainer.nativeElement.innerHTML = '';
    }

    setTimeout(() => {
      this.ngAfterViewInit();
      this.toastService.success('Network reinitialization completed!', 3000);
    }, 100);
  }

  private networkData: NetworkData = {
    blocks: [],
    nodes: [],
    edges: [],
  };

  // Dynamic block styles mapping for predefined blocks
  private blockStylesMap: { [key: string]: any } = {
    'internet-block': {
      margin: '0px',
      'background-color': '#c6e3ff',
      'background-opacity': 0.25,
      'border-color': '#1E90FF',
      'border-width': 2,
      'border-opacity': 0.8,
      padding: '120px',
    },
    'wan-block': {
      margin: '0px',
      'background-color': '#f9c1cc',
      'background-opacity': 0.25,
      'border-color': '#DC143C',
      'border-width': 2,
      'border-opacity': 0.8,
      padding: '120px',
    },
    'datacenter-block': {
      margin: '0px',
      'background-color': '#e5ffe5',
      'background-opacity': 0.25,
      'border-color': '#006400',
      'border-width': 2,
      'border-opacity': 0.8,
      padding: '120px',
    },
    'replication-block': {
      margin: '0px',
      'background-color': '#ffe7ff',
      'background-opacity': 0.25,
      'border-color': '#800080',
      'border-width': 2,
      'border-opacity': 0.8,
      padding: '120px',
    },
    'oob-block': {
      margin: '0px',
      'background-color': '#c3e3e5',
      'background-opacity': 0.25,
      'border-color': '#008080',
      'border-width': 2,
      'border-opacity': 0.8,
      padding: '120px',
    },
    'core-block': {
      'background-color': '#d3d3d3',
      'background-opacity': 0.15,
      'border-width': 1,
      'border-opacity': 0.3,
      margin: '0px',
      padding: '120px',
    },
    'external-block': {
      'background-color': '#ffe2bf',
      'background-opacity': 0.15,
      'border-color': '#FF8C00',
      'border-width': 2,
      'border-opacity': 0.8,
      'corner-radius': 16,
      margin: '0px',
      padding: '120px',
    },
    'extranet-block': {
      'background-color': '#fff0f0',
      'background-opacity': 0.15,
      'border-color': '#e67e22',
      'border-width': 2,
      'border-opacity': 0.8,
      'corner-radius': 16,
      margin: '0px',
      padding: '120px',
    },
    'visibility-block': {
      'background-color': '#eaf7ff',
      'background-opacity': 0.15,
      'border-color': '#2980b9',
      'border-width': 2,
      'border-opacity': 0.8,
      'corner-radius': 16,
      margin: '0px',
      padding: '120px',
    },
    'dmz-block': {
      'background-color': '#fff5e6',
      'background-opacity': 0.15,
      'border-color': '#c0392b',
      'border-width': 2,
      'border-opacity': 0.8,
      'corner-radius': 16,
      margin: '0px',
      padding: '120px',
    },
    'ips-block': {
      margin: '0px',
      'background-color': '#f0f8ff',
      'background-opacity': 0.2,
      'border-color': '#4682B4',
      'border-width': 2,
      'border-opacity': 0.8,
      'corner-radius': 16,
      padding: '120px',
    },
  };

  /**
   * Generate dynamic block styles based on blocks from backend
   */
  private generateDynamicBlockStyles(): any[] {
    const blockStyles: any[] = [];
    const blockIds = this.networkData.blocks.map((block) => block.id);

    blockIds.forEach((blockId) => {
      if (this.blockStylesMap[blockId]) {
        // Use predefined style if available
        blockStyles.push({
          selector: `node[id = "${blockId}"]`,
          style: this.blockStylesMap[blockId],
        });
      } else {
        // Generate default style for new blocks
        const defaultBlockStyle = this.generateDefaultBlockStyle(blockId);
        blockStyles.push({
          selector: `node[id = "${blockId}"]`,
          style: defaultBlockStyle,
        });
      }
    });

    return blockStyles;
  }

  /**
   * Generate default styling for new dynamic blocks
   */
  private generateDefaultBlockStyle(blockId: string): any {
    // Generate consistent colors based on block ID hash
    const hash = this.hashString(blockId);
    const hue = hash % 360;

    // Create more professional color combinations
    const backgroundColor = `hsl(${hue}, 45%, 85%)`;
    const borderColor = `hsl(${hue}, 65%, 55%)`;

    // Ensure minimum contrast and readability
    const adjustedBackground = this.adjustColorForContrast(backgroundColor);
    const adjustedBorder = this.adjustColorForContrast(borderColor);

    return {
      margin: '0px',
      'background-color': adjustedBackground,
      'background-opacity': 0.25,
      'border-color': adjustedBorder,
      'border-width': 2,
      'border-opacity': 0.8,
      'corner-radius': 16,
      padding: '120px',
      // Add subtle shadow for depth
      'box-shadow': '0 4px 12px rgba(0, 0, 0, 0.1)',
    };
  }

  /**
   * Adjust color to ensure good contrast and readability
   */
  private adjustColorForContrast(color: string): string {
    // For now, return the color as-is, but this can be enhanced
    // to ensure better contrast ratios if needed
    return color;
  }

  /**
   * Generate a numeric hash from a string for consistent color generation
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  private generateInitialBlockPositions(
    blocks: NetworkBlock[]
  ): Map<string, SavedPosition> {
    const blockPositions = new Map<string, SavedPosition>();
    const radius = 7000;
    const blockSize = 1000;

    const blockPositionMap: { [key: string]: { x: number; y: number } } = {
      'core-block': { x: 0, y: 0 },
      'internet-block': { x: 0, y: -6000 },
      'external-block': { x: -5200, y: -3000 },
      'wan-block': { x: 5200, y: -3000 },
      'datacenter-block': { x: -5200, y: 3000 },
      'replication-block': { x: 5200, y: 3000 },
      'oob-block': { x: 0, y: 6000 },
      'extranet-block': { x: -5200, y: 0 },
      'visibility-block': { x: 5200, y: 0 },
      'dmz-block': { x: 0, y: 3000 },
      'ips-block': { x: 2600, y: 0 },
    };

    blocks.forEach((block) => {
      let position: SavedPosition;

      if (blockPositionMap[block.id]) {
        position = blockPositionMap[block.id];
      } else {
        const index = blocks.indexOf(block);
        const totalBlocks = blocks.length;
        const angleStep = (2 * Math.PI) / totalBlocks;
        const angle = index * angleStep;

        const adjustedRadius = Math.max(
          radius,
          (blockSize * totalBlocks) / (2 * Math.PI) + blockSize
        );

        position = {
          x: Math.cos(angle) * adjustedRadius,
          y: Math.sin(angle) * adjustedRadius,
        };
      }

      blockPositions.set(block.id, position);
    });

    return blockPositions;
  }

  private convertToCytoscapeElements(): any[] {
    const elements: any[] = [];
    const isFirstVisit = this.isFirstTimeVisit();
    const fixedBlockPositions: { [key: string]: { x: number; y: number } } = {
      'core-block': { x: 0, y: 0 },
      'internet-block': { x: 0, y: -6000 },
      'external-block': { x: -5200, y: -3000 },
      'wan-block': { x: 5200, y: -3000 },
      'datacenter-block': { x: -5200, y: 3000 },
      'replication-block': { x: 5200, y: 3000 },
      'oob-block': { x: 0, y: 6000 },
      'extranet-block': { x: -5200, y: 0 },
      'visibility-block': { x: 5200, y: 0 },
      'dmz-block': { x: 0, y: 3000 },
      'ips-block': { x: 2600, y: 0 },
    };

    this.networkData.blocks.forEach((block) => {
      const hasChildren = this.networkData.nodes.some(
        (n) => (n.parent || '').trim() === block.id
      );
      if (!hasChildren) {
        return;
      }

      const blockElement: any = { data: { id: block.id, label: block.label } };

      const savedPos = this.getSavedPosition(block.id);
      const fixedPos = fixedBlockPositions[block.id];

      if (savedPos && (savedPos.x !== 0 || savedPos.y !== 0)) {
        blockElement.position = savedPos;
      } else if (isFirstVisit && fixedPos) {
        blockElement.position = fixedPos;
        this.saveNodePosition(block.id, fixedPos);
      } else {
        const unknownBlocks = this.networkData.blocks.filter(
          (b) => !fixedBlockPositions[b.id]
        );
        const index = unknownBlocks.indexOf(block);
        const angle = (index * 2 * Math.PI) / unknownBlocks.length;
        const radius = 8000;

        const position = {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
        };

        blockElement.position = position;
        this.saveNodePosition(block.id, position);
      }

      elements.push(blockElement);
    });

    // Build nodes with validation and collect valid IDs
    const validNodeIds = new Set<string>();
    this.networkData.nodes.forEach((node) => {
      const nodeId = (node.id ?? '').toString().trim();
      if (!nodeId) {
        return;
      }

      const nodeData: any = {
        id: nodeId,
        label: node.label,
        type: node.type,
      };

      // Only set parent if it is a non-empty string
      if (typeof node.parent === 'string' && node.parent.trim().length > 0) {
        nodeData.parent = node.parent;
      }

      const status = this.deviceStatusMap.get(nodeId) || 'off';
      nodeData.status = status;

      if (!this.deviceStatusMap.has(nodeId)) {
        this.deviceStatusMap.set(nodeId, 'off');
      }

      const nodeElement: any = { data: nodeData };
      const savedPos = this.getSavedPosition(nodeId);
      if (savedPos) {
        nodeElement.position = savedPos;
      }

      elements.push(nodeElement);
      validNodeIds.add(nodeId);
    });

    // Build edges only if endpoints are valid
    this.networkData.edges.forEach((edge) => {
      const sourceId = (edge.source ?? '').toString().trim();
      const targetId = (edge.target ?? '').toString().trim();
      if (!sourceId || !targetId) {
        return;
      }
      if (!validNodeIds.has(sourceId) || !validNodeIds.has(targetId)) {
        return;
      }

      const edgeData: any = {
        source: sourceId,
        target: targetId,
        speed: edge.speed,
        status: edge.status,
        type: edge.type,
      };

      if (edge.metadata) {
        edgeData.interface_a = edge.metadata.interface_a;
        edgeData.interface_b = edge.metadata.interface_b;
        edgeData.description = edge.metadata.description;
        edgeData.inSpeed = edge.metadata.inSpeed;
        edgeData.outSpeed = edge.metadata.outSpeed;
        edgeData.capacity = edge.metadata.capacity;
        edgeData.speedPercentage = edge.metadata.speedPercentage;
        edgeData.speedColor = edge.metadata.speedColor;
        edgeData.speedStatus = edge.metadata.speedStatus;
      }

      elements.push({ data: edgeData });
    });

    return elements;
  }

  private areBlocksConnected(cy: any, block1: any, block2: any): boolean {
    const children1 = block1.children();
    const children2 = block2.children();

    for (let child1 of children1) {
      for (let child2 of children2) {
        const edges = cy.edges(
          `[source = "${child1.id()}"][target = "${child2.id()}"], [source = "${child2.id()}"][target = "${child1.id()}"]`
        );
        if (edges.length > 0) {
          return true;
        }
      }
    }
    return false;
  }

  private ensureBlocksArePositioned(cy: any): void {
    const isFirstVisit = this.isFirstTimeVisit();
    // Remove empty blocks (no child devices) before positioning
    cy.nodes(':parent').forEach((block: any) => {
      if (block.children().filter((n: any) => !n.isParent()).length === 0) {
        cy.remove(block);
      }
    });

    const compounds = cy.nodes(':parent');
    const fixedBlockPositions: { [key: string]: { x: number; y: number } } = {
      'core-block': { x: 0, y: 0 },
      'internet-block': { x: 0, y: -6000 },
      'external-block': { x: -5200, y: -3000 },
      'wan-block': { x: 5200, y: -3000 },
      'datacenter-block': { x: -5200, y: 3000 },
      'replication-block': { x: 5200, y: 3000 },
      'oob-block': { x: 0, y: 6000 },
      'extranet-block': { x: -5200, y: 0 },
      'visibility-block': { x: 5200, y: 0 },
      'dmz-block': { x: 0, y: 3000 },
      'ips-block': { x: 2600, y: 0 },
    };

    compounds.forEach((block: any) => {
      const blockId = block.id();
      const currentPos = block.position();
      const savedPos = this.getSavedPosition(blockId);
      const fixedPosition = fixedBlockPositions[blockId];

      if (savedPos && (savedPos.x !== 0 || savedPos.y !== 0)) {
        block.position(savedPos);
      } else if (isFirstVisit && fixedPosition) {
        block.position(fixedPosition);
        this.saveNodePosition(blockId, fixedPosition);
      } else if (!isFirstVisit) {
        if (currentPos.x !== 0 || currentPos.y !== 0) {
          this.saveNodePosition(blockId, currentPos);
        }
      } else {
        const unknownBlocks = compounds.filter(
          (b: any) => !fixedBlockPositions[b.id()]
        );
        const index = unknownBlocks.indexOf(block);
        const angle = (index * 2 * Math.PI) / unknownBlocks.length;
        const radius = 8000;

        const position = {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
        };
        block.position(position);
      }
    });

    cy.forceRender();
  }

  private handlePostLayoutPositioning(cy: any): void {
    this.ensureBlocksArePositioned(cy);
    const unpositionedNodes = cy.nodes().filter((node: any) => {
      if (node.isParent()) return false;

      const nodeId = node.id();
      const savedPos = this.getSavedPosition(nodeId);
      const currentPos = node.position();

      const hasValidPosition =
        savedPos || (currentPos.x !== 0 && currentPos.y !== 0);

      return !hasValidPosition;
    });

    if (unpositionedNodes.length > 0) {
      unpositionedNodes.forEach((node: any) => {
        const nodeId = node.id();
        const parent = node.parent();

        if (parent.length && parent.id() !== '') {
          const parentBB = parent.boundingBox();
          const parentCenter = {
            x: (parentBB.x1 + parentBB.x2) / 2,
            y: (parentBB.y1 + parentBB.y2) / 2,
          };

          const siblings = parent
            .children()
            .filter(
              (sibling: any) => sibling.id() !== nodeId && !sibling.isParent()
            );

          const angle = siblings.length * 45 * (Math.PI / 180);
          const distance = 40 + siblings.length * 20;

          const calculatedPosition = {
            x: parentCenter.x + Math.cos(angle) * distance,
            y: parentCenter.y + Math.sin(angle) * distance,
          };

          const savedPos = this.getSavedPosition(nodeId);
          const hasUserPosition =
            savedPos && (savedPos.x !== 0 || savedPos.y !== 0);

          if (hasUserPosition) {
            node.position(savedPos);
          } else {
            node.position(calculatedPosition);
            this.saveNodePosition(nodeId, calculatedPosition);
          }
        } else {
          const viewport = cy.extent();
          const freePosition = {
            x: viewport.x1 + 100 + Math.random() * 200,
            y: viewport.y1 + 100 + Math.random() * 200,
          };

          node.position(freePosition);
          this.saveNodePosition(nodeId, freePosition);
        }
      });
    }

    cy.nodes().forEach((node: any) => {
      if (!node.isParent()) {
        const nodeId = node.id();
        const currentPos = node.position();
        const savedPos = this.getSavedPosition(nodeId);

        if (!savedPos) {
          this.saveNodePosition(nodeId, currentPos);
        }
      }
    });
  }

  private handleInitialBlockPositioning(
    cy: any,
    blocksWithoutPositions: any[]
  ): void {
    const blockPositions = new Map<string, { x: number; y: number }>();
    const blockPositionMap: { [key: string]: { x: number; y: number } } = {
      'core-block': { x: 0, y: 0 },
      'internet-block': { x: 0, y: -400 },
      'external-block': { x: -400, y: -200 },
      'wan-block': { x: 400, y: -200 },
      'datacenter-block': { x: -400, y: 200 },
      'replication-block': { x: 400, y: 200 },
      'oob-block': { x: 0, y: 400 },
      'extranet-block': { x: -600, y: 0 },
      'visibility-block': { x: 600, y: 0 },
      'dmz-block': { x: 0, y: 200 },
    };

    blocksWithoutPositions.forEach((block) => {
      const blockId = block.id();
      let position: { x: number; y: number };

      if (blockPositionMap[blockId]) {
        position = blockPositionMap[blockId];
      } else {
        const index = blocksWithoutPositions.indexOf(block);
        const radius = 400;
        const angleStep = (2 * Math.PI) / blocksWithoutPositions.length;
        const angle = index * angleStep;

        position = {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
        };
      }

      block.position(position);

      this.saveNodePosition(blockId, position);
    });

    this.positionDevicesWithinBlocks(cy);
  }

  private positionDevicesWithinBlocks(cy: any): void {
    const blocks = cy.nodes(':parent');

    blocks.forEach((block: any) => {
      const children = block.children().filter((node: any) => !node.isParent());

      if (children.length === 0) return;

      const blockPos = block.position();
      const deviceSpacing = 80;
      const maxDevicesPerRow = 4;

      children.forEach((device: any, index: number) => {
        const row = Math.floor(index / maxDevicesPerRow);
        const col = index % maxDevicesPerRow;
        const totalRows = Math.ceil(children.length / maxDevicesPerRow);

        const deviceX =
          blockPos.x + (col - (maxDevicesPerRow - 1) / 2) * deviceSpacing;
        const deviceY =
          blockPos.y + (row - (totalRows - 1) / 2) * deviceSpacing;

        const deviceId = device.id();
        const savedPos = this.getSavedPosition(deviceId);

        const hasUserPosition =
          savedPos &&
          (savedPos.x !== 0 || savedPos.y !== 0) &&
          (Math.abs(savedPos.x - deviceX) > 5 ||
            Math.abs(savedPos.y - deviceY) > 5);

        if (hasUserPosition) {
          device.position(savedPos);
        } else {
          device.position({ x: deviceX, y: deviceY });
          this.saveNodePosition(deviceId, { x: deviceX, y: deviceY });
        }
      });
    });

    cy.forceRender();
  }

  private improveBlockPositioning(cy: any): void {
    if (this.isUpdatingIncrementally) {
      return;
    }
    this.ensureBlocksArePositioned(cy);
    setTimeout(() => {
      this.positionDevicesWithinBlocks(cy);
    }, 100);
    if (!this.isUpdatingIncrementally && this.enableCoreSwitchAutoArrangement) {
      this.arrangeCoreNetworkSwitches(cy);
    }

    if (!this.isUpdatingIncrementally) {
      let restoredCount = 0;
      cy.nodes().forEach((node: any) => {
        const nodeId = node.id();
        const savedPos = this.getSavedPosition(nodeId);
        if (savedPos && !node.isParent()) {
          const currentPos = node.position();
          const distance = Math.sqrt(
            Math.pow(currentPos.x - savedPos.x, 2) +
              Math.pow(currentPos.y - savedPos.y, 2)
          );
          if (distance > 5) {
            node.position(savedPos);
            restoredCount++;
          }
        }
      });

      if (restoredCount > 0) {
      }
    }

    cy.fit(undefined, 100);
  }

  private getNodeStyles(): any[] {
    const textColor = '#ffffff';

    // Base node styles (device types and common styles)
    const baseStyles = [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          color: textColor,
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '60px',
          'font-size': '8px',
          'font-weight': 'bold',
          width: 'label',
          height: 'label',
          padding: '8px',
          shape: 'rectangle',
          'border-width': 0,
          'border-color': 'transparent',
          'border-opacity': 0,
        },
      },
      {
        selector: 'node:selected',
        style: {
          'overlay-opacity': 0,
        },
      },
      {
        selector: 'node[status = "on"]',
        style: {},
      },
      {
        selector: 'node[status = "off"]',
        style: {},
      },
      {
        selector: 'node[type = "firewall"]',
        style: {
          'background-image': 'url(assets/firewall_new.svg)',
          'background-fit': 'cover',
          'background-opacity': 0,
          width: 180,
          height: 195,
          shape: 'rectangle',
          'text-valign': 'bottom',
          'font-size': 75,
          color: textColor,
        },
      },
      {
        selector: 'node[type = "switch"]',
        style: {
          'background-image': 'url(assets/realSwitch.svg)',
          'background-fit': 'cover',
          'background-opacity': 0,
          width: 210,
          height: 135,
          shape: 'rectangle',
          'text-valign': 'bottom',
          'font-size': 75,
          color: textColor,
        },
      },
      {
        selector: 'node[type = "core_switch"]',
        style: {
          'background-image': 'url(assets/coreSwitch_real.svg)',
          'background-fit': 'cover',
          'background-opacity': 0,
          width: 270,
          height: 375,
          shape: 'rectangle',
          'text-valign': 'bottom',
          'font-size': 75,
          color: textColor,
          'border-width': 0,
          'border-color': 'transparent',
          'border-opacity': 0,
        },
      },
      {
        selector: 'node[type = "internet"]',
        style: {
          'background-image': 'url(assets/real_internet_2.svg)',
          'background-fit': 'cover',
          'background-opacity': 0,
          width: 180,
          height: 180,
          shape: 'rectangle',
          'text-valign': 'bottom',
          'font-size': 75,
          color: textColor,
          margin: '0px',
        },
      },
      {
        selector: 'node[type = "router"]',
        style: {
          'background-image': 'url(assets/router_real.svg)',
          'background-fit': 'cover',
          'background-opacity': 0,
          width: 225,
          height: 210,
          'text-valign': 'bottom',
          'font-size': 75,
          color: textColor,
        },
      },
      {
        selector: 'node[type = "server"]',
        style: {
          'background-image': 'url(assets/proxy.svg)',
          'background-fit': 'cover',
          'background-opacity': 0,
          width: 255,
          height: 315,
          shape: 'rectangle',
          'text-valign': 'bottom',
          'font-size': 75,
          color: textColor,
        },
      },
      {
        selector: 'node[type = "ext_switch"]',
        style: {
          'background-image': 'url(assets/realSwitch.svg)',
          'background-fit': 'cover',
          'background-opacity': 0,
          width: 300,
          height: 225,
          shape: 'rectangle',
          'text-valign': 'bottom',
          'font-size': 75,
          color: textColor,
        },
      },
      {
        selector: 'node[type = "ips"]',
        style: {
          'background-image': 'url(assets/ips.svg)',
          'background-fit': 'cover',
          'background-opacity': 0,
          width: 180,
          height: 180,
          shape: 'rectangle',
          'text-valign': 'bottom',
          'font-size': 75,
          color: textColor,
        },
      },
      {
        selector: 'node[type = "proxy"]',
        style: {
          'background-image': 'url(assets/proxy.svg)',
          'background-fit': 'cover',
          'background-opacity': 0,
          width: 180,
          height: 180,
          shape: 'rectangle',
          'text-valign': 'bottom',
          'font-size': 75,
          color: textColor,
        },
      },
      {
        selector: 'node[type = "isp"]',
        style: {
          'background-image': 'url(assets/isp.svg)',
          'background-fit': 'cover',
          'background-opacity': 0,
          width: 180,
          height: 180,
          shape: 'rectangle',
          'text-valign': 'bottom',
          'font-size': 75,
          color: textColor,
          margin: '0px',
        },
      },
      {
        selector: ':parent',
        style: {
          'background-color': '#000000',
          'background-opacity': 0.25,

          'border-color': '#ffffff',
          'border-opacity': 0.15,
          'border-width': 1,

          shape: 'round-rectangle',
          'corner-radius': 16,
          padding: '16px',

          label: 'data(label)',
          'text-valign': 'top',
          'text-halign': 'center',
          'text-margin-y': '-12px',
          'font-size': '55px',
          'font-weight': 'bold',
          color: '#ffffff',

          'text-background-color': 'transparent',
          'text-background-opacity': 1,
          'text-border-color': 'transparent',
          'text-border-width': 0,

          'text-wrap': 'none',
          'text-max-width': 'none',
        },
      },
    ];

    // Generate dynamic block styles from backend data
    const blockStyles = this.generateDynamicBlockStyles();

    return [...baseStyles, ...blockStyles];
  }

  refreshStyles(): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (cyElement && cyElement._cy) {
      const cy = cyElement._cy;
      this.updateEdgeColors(cy);
      cy.style(this.getNodeStyles().concat(this.getEdgeStyles()));
      cy.style().update();
      cy.nodes().forEach((node: any) => {
        if (!node.isParent()) {
          node.style({
            'border-width': 0,
            'border-opacity': 0,
            'border-color': 'transparent',
            'background-color': 'transparent',
          });
        }
      });
      const compounds = cy.nodes(':parent');
      compounds.forEach((compound: any) => {
        compound.style().update();
      });
    }
  }

  private updateEdgeColors(cy: any): void {
    cy.edges().forEach((edge: any) => {
      const speedPercentage = edge.data('speedPercentage');
      const inSpeed = this.parseSpeed(edge.data('inSpeed') || '0');
      const capacity = this.parseSpeed(edge.data('capacity') || '0');

      if (
        speedPercentage !== undefined &&
        inSpeed !== undefined &&
        capacity !== undefined
      ) {
        const speedInfo = this.getSpeedColorInfo(
          speedPercentage,
          inSpeed,
          capacity
        );
        edge.data('speedColor', speedInfo.color);
        edge.data('speedStatus', speedInfo.status);
      }
    });
  }

  public refreshEdgeColors(): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (cyElement && cyElement._cy) {
      const cy = cyElement._cy;
      this.updateEdgeColors(cy);
      cy.style().update();
    }
  }

  public forceRefreshAllEdgeColors(): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (cyElement && cyElement._cy) {
      const cy = cyElement._cy;

      cy.edges().forEach((edge: any) => {
        const inSpeed = this.parseSpeed(edge.data('inSpeed') || '0');
        const capacity = this.parseSpeed(edge.data('capacity') || '0');

        if (inSpeed > 0 && capacity > 0) {
          const speedPercentage = (inSpeed / capacity) * 100;
          const speedInfo = this.getSpeedColorInfo(
            speedPercentage,
            inSpeed,
            capacity
          );

          edge.data('speedColor', speedInfo.color);
          edge.data('speedStatus', speedInfo.status);
          edge.data('speedPercentage', speedPercentage);
        }
      });

      cy.style().update();
    }
  }

  private getEdgeStyles(): any[] {
    return [
      {
        selector: 'edge',
        style: {
          'curve-style': 'bezier',
          label: '',
          width: 2,
          'line-color': (ele: any) => {
            const speedColor = ele.data('speedColor');
            return speedColor || '#000';
          },
        },
      },
      {
        selector: 'edge.highlighted-edge',
        style: {
          width: '6px !important',
          'z-index': '998 !important',
          opacity: '1 !important',
          'line-style': 'solid !important',
        },
      },
      {
        selector: 'edge.dimmed-edge',
        style: {
          opacity: '0.2 !important',
          'z-index': '1 !important',
        },
      },
      {
        selector: 'edge[speedColor]',
        style: {
          'line-color': 'data(speedColor)',
          width: 2,
        },
      },
      {
        selector: 'edge[speedStatus = "down"]',
        style: {
          'line-color': '#ff0000',
          'line-style': 'solid',
          width: 3,
        },
      },
      {
        selector: 'edge[speedStatus = "critical"]',
        style: {
          'line-color': '#ff9500',
          'line-style': 'solid',
          width: 3,
        },
      },
      {
        selector: 'edge[speedStatus = "warning"]',
        style: {
          'line-color': '#ffeb3b',
          'line-style': 'solid',
          width: 2,
        },
      },
      {
        selector: 'edge[speedStatus = "medium"]',
        style: {
          'line-color': '#2196f3',
          'line-style': 'solid',
          width: 2,
        },
      },
      {
        selector: 'edge[speedStatus = "good"]',
        style: {
          'line-color': '#4caf50',
          'line-style': 'solid',
          width: 2,
        },
      },
      {
        selector: 'edge[type = "primary"]',
        style: {
          'line-color': (ele: any) => {
            const speedColor = ele.data('speedColor');
            return speedColor || '#4caf50';
          },
          width: 2,
        },
      },
      {
        selector: 'edge[type = "secondary"]',
        style: {
          'line-color': (ele: any) => {
            const speedColor = ele.data('speedColor');
            return speedColor || '#ff9800';
          },
          width: 2,
          'line-style': 'solid',
        },
      },
      {
        selector: 'edge[type = "trunk"]',
        style: {
          'line-color': (ele: any) => {
            const speedColor = ele.data('speedColor');
            return speedColor || '#9c27b0';
          },
          width: 2,
        },
      },

      {
        selector: 'node.show-device-info',
        style: {
          label: (ele: any) => {
            const tooltip = ele.data('tooltip');
            return tooltip || 'Device information loading...';
          },
          'font-size': 9,
          color: '#2e7d32',
          'text-background-opacity': 1,
          'text-background-color': '#e8f5e8',
          'text-border-color': '#4caf50',
          'text-border-width': 1,
          'text-wrap': 'wrap',
          'text-max-width': '180px',
          'text-background-padding': '6px',
          'z-index': 50000,
          'text-valign': 'top',
          'text-halign': 'left',
          'text-justification': 'left',
          'text-margin-x': 0,
          'text-margin-y': 0,
          'overlay-opacity': 0,
        },
      },
    ];
  }

  async loadNetworkData(silent: boolean = false) {
    if (silent) {
      if (this.isSilentRefreshing || this.isLoadingData) {
        return;
      }
      this.isSilentRefreshing = true;
    } else {
      if (this.isLoadingData) {
        this.toastService.warning('Data loading already in progress...', 2000);
        return;
      }
      this.isLoadingData = true;
      this.loadFailed = false;
    }

    try {
      this.networkApiService.getDashboardTopology().subscribe({
        next: (response: any) => {
          if (response.success && response.data) {
            this.compareAndUpdateNetworkData(response.data);
            this.updateTimestamp();
            if (!silent) {
              this.toastService.success(
                'Network data loaded successfully!',
                3000
              );
              this.loadFailed = false;
            }
          } else {
            if (this.hasLocalStorageData()) {
              this.loadStateFromLocalStorage();
            }
            if (!silent) {
              this.loadFailed = true;
            }
          }
        },
        error: (error) => {
          if (this.hasLocalStorageData()) {
            this.loadStateFromLocalStorage();
          } else if (!silent) {
            this.toastService.error('Error loading network data', 5000);
          }
          if (!silent) {
            this.loadFailed = true;
          }
        },
        complete: () => {
          if (silent) {
            this.isSilentRefreshing = false;
          } else {
            this.isLoadingData = false;
          }
        },
      });
    } catch (error) {
      if (!silent) {
        this.loadFailed = true;
      }
      if (this.hasLocalStorageData()) {
        this.loadStateFromLocalStorage();
      }
      if (silent) {
        this.isSilentRefreshing = false;
      } else {
        this.isLoadingData = false;
      }
    }
  }

  refreshFromBackend(): void {
    if (this.isLoadingData || this.isSilentRefreshing) {
      this.toastService.warning('Refresh already in progress...', 2000);
      return;
    }

    // ✅ FIX: Use silent mode to prevent showing the loader overlay
    // This provides a smoother user experience when manually refreshing
    if (this.forceFullUpdate) {
      this.loadNetworkData(true); // Silent mode - no loader
    } else {
      this.refreshNetworkDataIncrementally(true); // Silent mode - no loader
    }

    // Show a subtle toast to indicate refresh is happening
    this.toastService.info('Refreshing topology data...', 2000);

    // Commented out automatic backend saving after refresh
    // setTimeout(() => {
    //   this.saveAllNetworkDataToBackend();
    // }, 3000);

    if (this.isAutoRefreshActive()) {
      this.autoRefreshCountdown = 120;
    }
  }

  private refreshNetworkDataIncrementally(silent: boolean = false): void {
    if (silent) {
      if (this.isSilentRefreshing || this.isLoadingData) {
        return;
      }
      this.isSilentRefreshing = true;
    } else {
      this.isLoadingData = true;
    }

    try {
      this.networkApiService.getDashboardTopology().subscribe({
        next: (response: DashboardTopologyResponse) => {
          if (response.success && response.data) {
            this.compareAndUpdateNetworkData(response.data);
            if (!silent) {
              this.toastService.success(
                'Network data refreshed successfully!',
                3000
              );
            }
          } else {
            if (!silent) {
              this.isLoadingData = false;
            }
          }
        },
        error: (error) => {
          if (this.hasLocalStorageData()) {
            this.loadStateFromLocalStorage();
          }
          if (!silent) {
            this.isLoadingData = false;
            this.loadFailed = true;
          }
        },
        complete: () => {
          if (silent) {
            this.isSilentRefreshing = false;
          } else {
            this.isLoadingData = false;
          }
        },
      });
    } catch (error) {
      if (!silent) {
        this.isLoadingData = false;
        this.loadFailed = true;
      } else {
        this.isSilentRefreshing = false;
      }
    }
  }

  private compareAndUpdateNetworkData(backendData: any): void {
    const cy = this.getCytoscapeInstance();
    if (!cy) {
      this.loadNetworkData();
      return;
    }

    const changes = {
      newNodes: [] as NetworkNode[],
      updatedNodes: [] as DeviceUpdate[],
      newEdges: [] as NetworkEdge[],
      updatedEdges: [] as any[],
      positionUpdates: [] as { nodeId: string; position: SavedPosition }[],
      statusUpdates: [] as { deviceId: string; status: 'on' | 'off' }[],
      typeUpdates: [] as { deviceId: string; type: string }[],
    };
    this.compareNodes(backendData.networkData.nodes, changes);
    this.compareEdges(backendData.networkData.edges, changes);
    this.comparePositions(backendData.positions, changes);
    this.compareDeviceStatuses(backendData.deviceStatus, changes);
    this.compareDeviceTypes(backendData.deviceTypes, changes);
    this.applyIncrementalChanges(changes, backendData);
    this.lastUpdatedTime = new Date(backendData.timestamp).toLocaleString();
  }

  private compareNodes(backendNodes: NetworkNode[], changes: any): void {
    const currentNodeIds = new Set(this.networkData.nodes.map((n) => n.id));
    const backendNodeIds = new Set(backendNodes.map((n) => n.id));

    backendNodes.forEach((backendNode) => {
      if (!currentNodeIds.has(backendNode.id)) {
        changes.newNodes.push(backendNode);
      }
    });

    backendNodes.forEach((backendNode) => {
      const currentNode = this.networkData.nodes.find(
        (n) => n.id === backendNode.id
      );
      if (currentNode) {
        const currentStatus = this.deviceStatusMap.get(backendNode.id);
        const currentType = this.deviceTypeMap.get(backendNode.id);

        if (backendNode.status && currentStatus !== backendNode.status) {
          changes.statusUpdates.push({
            deviceId: backendNode.id,
            status: backendNode.status as 'on' | 'off',
          });
        }

        if (backendNode.type && currentType !== backendNode.type) {
          changes.typeUpdates.push({
            deviceId: backendNode.id,
            type: backendNode.type,
          });
        }
      }
    });
  }

  private compareEdges(backendEdges: NetworkEdge[], changes: any): void {
    const currentEdgeIds = new Set(
      this.networkData.edges.map((e) => `${e.source}-${e.target}`)
    );
    backendEdges.forEach((backendEdge) => {
      const edgeId = `${backendEdge.source}-${backendEdge.target}`;
      if (!currentEdgeIds.has(edgeId)) {
        changes.newEdges.push(backendEdge);
      }
    });
  }

  private comparePositions(backendPositions: any, changes: any): void {
    Object.entries(backendPositions).forEach(([nodeId, position]) => {
      const currentPosition = this.savedPositions.get(nodeId);
      const backendPosition = position as SavedPosition;
      if (
        !currentPosition ||
        currentPosition.x !== backendPosition.x ||
        currentPosition.y !== backendPosition.y
      ) {
        changes.positionUpdates.push({
          nodeId,
          position: backendPosition,
        });
      }
    });
  }

  private compareDeviceStatuses(backendStatuses: any, changes: any): void {
    Object.entries(backendStatuses).forEach(([deviceId, status]) => {
      const currentStatus = this.deviceStatusMap.get(deviceId);
      if (currentStatus !== status) {
        changes.statusUpdates.push({
          deviceId,
          status: status as 'on' | 'off',
        });
      }
    });
  }

  private compareDeviceTypes(backendTypes: any, changes: any): void {
    Object.entries(backendTypes).forEach(([deviceId, type]) => {
      const currentType = this.deviceTypeMap.get(deviceId);
      if (currentType !== type) {
        changes.typeUpdates.push({
          deviceId,
          type: type as string,
        });
      }
    });
  }

  private applyIncrementalChanges(changes: any, backendData: any): void {
    const cy = this.getCytoscapeInstance();
    if (!cy) return;

    // ✅ FIX: Skip position updates during active drag operations to prevent data loss
    if (this.isUserDragging) {
      console.log(
        '⚠️ Skipping position updates during drag operation to prevent data loss'
      );
      // Still update other data, just not positions
      this.networkData = backendData.networkData;

      this.deviceStatusMap.clear();
      this.deviceTypeMap.clear();
      Object.entries(backendData.deviceStatus).forEach(([deviceId, status]) => {
        this.deviceStatusMap.set(deviceId, status as 'on' | 'off');
      });
      Object.entries(backendData.deviceTypes).forEach(([deviceId, type]) => {
        this.deviceTypeMap.set(deviceId, type as string);
      });

      this.connectionMap.clear();
      Object.entries(backendData.connectionMap).forEach(([key, value]) => {
        this.connectionMap.set(key, value);
      });

      // Refresh styles to apply dynamic block styles even during drag
      cy.style([...this.getNodeStyles(), ...this.getEdgeStyles()]);

      return;
    }

    this.networkData = backendData.networkData;

    // ✅ FIX: Preserve user-modified positions instead of clearing all
    // Store current user positions before applying backend data
    const userModifiedPositions = new Map<string, SavedPosition>();
    this.savedPositions.forEach((position, nodeId) => {
      // Check if this position was user-modified (not from backend)
      const backendPosition = backendData.positions[nodeId];
      if (
        !backendPosition ||
        Math.abs(position.x - backendPosition.x) > 5 ||
        Math.abs(position.y - backendPosition.y) > 5
      ) {
        userModifiedPositions.set(nodeId, position);
      }
    });

    // Clear and reload backend positions
    this.savedPositions.clear();
    Object.entries(backendData.positions).forEach(([nodeId, position]) => {
      this.savedPositions.set(nodeId, position as SavedPosition);
    });

    // ✅ Restore user-modified positions (they take precedence)
    userModifiedPositions.forEach((position, nodeId) => {
      this.savedPositions.set(nodeId, position);
    });

    this.deviceStatusMap.clear();
    this.deviceTypeMap.clear();
    Object.entries(backendData.deviceStatus).forEach(([deviceId, status]) => {
      this.deviceStatusMap.set(deviceId, status as 'on' | 'off');
    });
    Object.entries(backendData.deviceTypes).forEach(([deviceId, type]) => {
      this.deviceTypeMap.set(deviceId, type as string);
    });

    this.connectionMap.clear();
    Object.entries(backendData.connectionMap).forEach(
      ([connectionId, connectionData]) => {
        this.connectionMap.set(connectionId, connectionData as any);
      }
    );

    changes.positionUpdates.forEach((update: any) => {
      const node = cy.getElementById(update.nodeId);
      if (node.length) {
        if (this.isValidPosition(update.position)) {
          node.position(update.position);
        } else {
          const safePosition = this.generateSafePosition(cy, update.nodeId);
          node.position(safePosition);
          this.saveNodePosition(update.nodeId, safePosition);
        }
      }
    });

    changes.statusUpdates.forEach((update: any) => {
      const node = cy.getElementById(update.deviceId);
      if (node.length) {
        const oldStatus = this.deviceStatusMap.get(update.deviceId);
        this.deviceStatusMap.set(update.deviceId, update.status);

        if (oldStatus && oldStatus !== update.status) {
          this.animateStatusChange(cy, node, oldStatus, update.status);
        } else {
          this.applyStatusStyling(node, update.status);
        }
      }
    });
    changes.typeUpdates.forEach((update: any) => {
      const node = cy.getElementById(update.deviceId);
      if (node.length) {
        const oldType = this.deviceTypeMap.get(update.deviceId);
        this.deviceTypeMap.set(update.deviceId, update.type);

        if (oldType && oldType !== update.type) {
          this.animateTypeChange(cy, node, oldType, update.type);
        } else {
          node.data('type', this.mapToNodeType(update.type));
        }
      }
    });
    if (changes.newNodes.length > 0 || changes.newEdges.length > 0) {
      this.addIncrementalElements(changes.newNodes, changes.newEdges);
    }
    this.fixInvalidPositionsAfterUpdate(cy);
    this.saveStateToLocalStorage();

    // Refresh styles to apply dynamic block styles
    cy.style([...this.getNodeStyles(), ...this.getEdgeStyles()]);

    setTimeout(() => {
      this.updateSpeedStatusCounts();
    }, 100);
  }

  private getOptimalLayout(): any {
    return {
      name: 'preset',
      animate: false,
      fit: true,
      padding: 120,
    };
  }

  ngAfterViewInit(): void {
    setTimeout(async () => {
      try {
        if (!this.cyContainer?.nativeElement) {
          return;
        }

        if (!this.isLoadingData) {
          await this.loadNetworkData();
        } else {
        }

        const cy = cytoscape({
          container: this.cyContainer.nativeElement,
          elements: this.convertToCytoscapeElements(),
          layout: this.getOptimalLayout(),
          style: [...this.getNodeStyles(), ...this.getEdgeStyles()],
          wheelSensitivity: 1,
          zoomingEnabled: true,
          userZoomingEnabled: true,
          panningEnabled: true,
          userPanningEnabled: true,
          minZoom: 0.1,
          maxZoom: 3.0,
        });

        this.cyContainer.nativeElement._cy = cy;

        setTimeout(() => {
          this.ensureBlocksArePositioned(cy);
          setTimeout(() => {
            this.positionDevicesWithinBlocks(cy);
          }, 50);
        }, 10);

        cy.on('layoutstop', () => {
          if (!this.isUpdatingIncrementally) {
            this.ensureBlocksArePositioned(cy);
            setTimeout(() => {
              this.positionDevicesWithinBlocks(cy);
            }, 100);
            this.handlePostLayoutPositioning(cy);
            this.improveBlockPositioning(cy);
            this.updateSpeedStatusCounts();
            setTimeout(() => {
              this.ensureStatusIndicatorStyles();
              this.initializeBlinkingForAllDevices();
              setTimeout(() => {
                this.updateAllNodesStyling();
              }, 500);
            }, 2000);
          } else {
          }
        });

        // Zoom configuration is now set in Cytoscape initialization

        cy.nodes().grabify();
        this.setupDragHandlers(cy);
        cy.on('mouseover', 'edge', (event: any) => {
          this.showEdgeTooltip(event);
          this.highlightHoveredEdge(event.target);
        });

        cy.on('mouseout', 'edge', (event: any) => {
          this.hideEdgeTooltip();
          this.resetEdgeHighlighting();
        });

        cy.on('mousemove', 'edge', (event: any) => {
          this.updateTooltipPosition(event);
        });

        cy.on('mouseover', 'node', (event: any) => {
          const node = event.target;
          if (!node.isParent()) {
            const deviceInfo = this.generateDeviceTooltip(node);
            node.data('tooltip', deviceInfo);
            node.addClass('show-device-info');
          }
        });

        cy.on('mouseout', 'node', (event: any) => {
          const node = event.target;
          if (!node.isParent()) {
            node.removeClass('show-device-info');
            node.removeData('tooltip');
          }
        });
        this.setupNodeHoverEffects(cy);
        this.preventBlockExpansion();

        cy.on('tap', 'node', (event: any) => {
          const node = event.target;
          if (node.isParent()) {
          }
        });
        cy.nodes().forEach((node: any) => {
          const nodeId = node.id();
          const status = this.deviceStatusMap.get(nodeId);
          if (status) {
            node.data('status', status);
            this.applyStatusStyling(node, status);
          }
        });
        this.forceRefreshAllEdgeColors();

        cy.resize();

        // ✅ FIX: Delay centering to ensure all elements are positioned first
        setTimeout(() => {
          cy.fit(undefined, 80);
          cy.zoom(0.1);
          cy.center();
          console.log('✅ Initial centering applied');
        }, 100);

        this.updateSpeedStatusCounts();
        setTimeout(() => {
          this.ensureStatusIndicatorStyles();
          this.initializeBlinkingForAllDevices();

          // ✅ FIX: Final centering after all initialization is complete
          setTimeout(() => {
            cy.fit(undefined, 80);
            cy.zoom(0.1);
            cy.center();
            console.log('✅ Final centering applied after initialization');
          }, 500);
        }, 1500);
      } catch (error) {
        console.error('Error initializing Cytoscape:', error);
      }
    }, 200);
  }

  ngOnDestroy(): void {
    this.stopAllBlinking();
    this.cleanupTooltip();

    // Cleanup edge tooltip
    if (this.edgeTooltip) {
      this.edgeTooltip.remove();
      this.edgeTooltip = null;
    }

    // Remove dark mode listener
    if (this.darkModeObserver) {
      this.darkModeObserver.disconnect();
    }

    // Clean up timestamp interval
    if (this.timestampInterval) {
      clearInterval(this.timestampInterval);
    }

    // Clean up auto-refresh interval
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
    }

    // Clean up drag tracking timeout
    if (this.draggedBlockTimeout) {
      clearTimeout(this.draggedBlockTimeout);
      this.draggedBlockTimeout = null;
    }
  }

  // Update the timestamp display
  private updateTimestamp(): void {
    const now = new Date();
    this.lastUpdatedTime = now.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  // Start the timestamp update interval (every 2 minutes)
  private startTimestampUpdates(): void {
    // Update immediately
    this.updateTimestamp();

    // Set interval to update every 2 minutes (120000 milliseconds)
    this.timestampInterval = setInterval(() => {
      this.updateTimestamp();
    }, 120000);
  }

  private startAutoRefresh(): void {
    this.autoRefreshCountdown = 120;
    const countdownInterval = setInterval(() => {
      this.autoRefreshCountdown--;
      if (this.autoRefreshCountdown <= 0) {
        this.autoRefreshCountdown = 120;
      }
    }, 1000);

    // Commented out auto-refresh interval
    // this.autoRefreshInterval = setInterval(() => {
    //   try {
    //     this.refreshFromBackend();
    //     this.autoRefreshCountdown = 120;
    //     // Commented out automatic backend saving every 2 minutes
    //     // setTimeout(() => {
    //     //   this.saveAllNetworkDataToBackend();
    //     // }, 2000);
    //   } catch (error) {
    //     console.error('❌ Auto-refresh failed:', error);
    //     this.autoRefreshCountdown = 120;
    //   }
    // }, 120000);
  }

  public toggleAutoRefresh(): void {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = null;
      this.autoRefreshCountdown = 0;
    } else {
      this.startAutoRefresh();
    }
  }

  public isAutoRefreshActive(): boolean {
    return this.autoRefreshInterval !== null;
  }

  public stopAutoRefresh(): void {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = null;
      this.autoRefreshCountdown = 0;
    }
  }

  public getFormattedCountdown(): string {
    const minutes = Math.floor(this.autoRefreshCountdown / 60);
    const seconds = this.autoRefreshCountdown % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  public getAutoRefreshStatus(): {
    isActive: boolean;
    countdown: string;
    nextRefreshIn: number;
    isEnabled: boolean;
  } {
    return {
      isActive: this.isAutoRefreshActive(),
      countdown: this.getFormattedCountdown(),
      nextRefreshIn: this.autoRefreshCountdown,
      isEnabled: this.autoRefreshInterval !== null,
    };
  }

  private darkModeObserver: MutationObserver | null = null;

  private setupDarkModeListener(): void {
    this.darkModeObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'class'
        ) {
          const target = mutation.target as HTMLElement;
          if (target.tagName === 'BODY') {
            setTimeout(() => {
              this.refreshStyles();
            }, 100);
          }
        }
      });
    });

    this.darkModeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  private setupNodeHoverEffects(cy: any): void {
    cy.off('mouseover', 'node');
    cy.off('mouseout', 'node');

    cy.on('mouseover', 'node', (event: any) => {
      const node = event.target;

      if (!node.isParent()) {
        this.showDeviceTooltip(event, node);
        const connectedEdges = node.connectedEdges();
        const connectedNodes = node.neighborhood().nodes();
        const allEdges = cy.edges();
        const allNodes = cy.nodes().filter((n: any) => !n.isParent());

        allEdges.forEach((edge: any) => {
          edge.addClass('dimmed-edge');
          edge.style({
            opacity: 0.3,
            width: 1,
            'z-index': 1,
          });
        });

        allNodes.forEach((n: any) => {
          if (n.id() !== node.id() && !connectedNodes.has(n)) {
            n.addClass('dimmed-node');
            n.style({
              opacity: 0.3,
              'z-index': 1,
            });
          }
        });

        connectedEdges.forEach((edge: any) => {
          edge.removeClass('dimmed-edge');
          edge.addClass('highlighted-edge');

          edge.style({
            width: 6,
            'z-index': 998,
            opacity: 1,
          });
        });

        connectedNodes.forEach((connectedNode: any) => {
          connectedNode.removeClass('dimmed-node');
          connectedNode.style({
            opacity: 1,
            'z-index': 999,
          });
        });

        node.removeClass('dimmed-node');
        node.style({
          opacity: 1,
          'z-index': 1000,
        });
      }
    });

    cy.on('mouseout', 'node', (event: any) => {
      const node = event.target;

      if (!node.isParent()) {
        this.hideDeviceTooltip();

        const allEdges = cy.edges();
        const allNodes = cy.nodes().filter((n: any) => !n.isParent());

        allEdges.forEach((edge: any) => {
          edge.removeClass('highlighted-edge');
          edge.removeClass('dimmed-edge');

          const originalColor = edge.data('speedColor') || '#000';
          edge.style({
            width: 2,
            'line-color': originalColor,
            'z-index': 1,
            opacity: 1,
          });
        });

        allNodes.forEach((n: any) => {
          n.removeClass('dimmed-node');
          n.style({
            opacity: 1,
            'z-index': 1,
          });
        });
      }
    });
  }

  private updateCoreSwitchParallelPositions(cy: any, draggedSwitch: any): void {
    const coreBlock = cy.getElementById('core-block');
    if (!coreBlock.length) return;

    const coreSwitches = coreBlock.children().filter((node: any) => {
      const nodeType = node.data('type');
      const nodeId = node.data('id');
      return (
        (nodeType === 'switch' ||
          nodeType === 'core_switch' ||
          nodeId.includes('COR-C-SW')) &&
        node.id() !== draggedSwitch.id()
      );
    });

    if (coreSwitches.length === 0) return;

    const draggedPosition = draggedSwitch.position();

    let draggedIndex = 0;
    const allCoreSwitches = coreBlock.children().filter((node: any) => {
      const nodeType = node.data('type');
      const nodeId = node.data('id');
      return (
        nodeType === 'switch' ||
        nodeType === 'core_switch' ||
        nodeId.includes('COR-C-SW')
      );
    });

    const sortedSwitches = allCoreSwitches.sort(
      (a: any, b: any) => a.position().x - b.position().x
    );
    draggedIndex = sortedSwitches.findIndex(
      (sw: any) => sw.id() === draggedSwitch.id()
    );

    let calculatedSpacing = 250;
    if (sortedSwitches.length > 1) {
      const positions = sortedSwitches.map((sw: any) => sw.position().x);
      const spacings: number[] = [];

      for (let i = 1; i < positions.length; i++) {
        spacings.push(Math.abs(positions[i] - positions[i - 1]));
      }

      if (spacings.length > 0) {
        const filteredSpacings = spacings.filter(
          (spacing) => spacing > 50 && spacing < 500
        );
        if (filteredSpacings.length > 0) {
          calculatedSpacing =
            filteredSpacings.reduce((sum, spacing) => sum + spacing, 0) /
            filteredSpacings.length;
        }
      }
    }

    sortedSwitches.forEach((switchNode: any, index: number) => {
      if (switchNode.id() !== draggedSwitch.id()) {
        const offset = index - draggedIndex;
        const newPosition = {
          x: draggedPosition.x + offset * calculatedSpacing,
          y: draggedPosition.y,
        };

        switchNode.position(newPosition);
        this.saveNodePosition(switchNode.id(), newPosition);
      }
    });
  }
  private startBlinking(nodeId: string, status: 'on' | 'off'): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) {
      return;
    }

    const cy = cyElement._cy;
    const node = cy.getElementById(nodeId);
    if (!node.length) {
      return;
    }

    this.stopBlinking(nodeId);

    this.ensureStatusIndicatorStyles();

    const blinkColor = status === 'on' ? '#4caf50' : '#f44336';

    const statusIndicator = document.createElement('div');
    statusIndicator.className = `status-indicator status-${status}`;
    statusIndicator.style.cssText = `
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: ${blinkColor} !important;
      border: 1px solid white !important;
      position: absolute !important;
      z-index: 10000 !important;
      box-shadow: 0 0 4px rgba(0, 0, 0, 0.5) !important;
      pointer-events: none !important;
      overflow: visible !important;
      contain: layout !important;
      transform-origin: center !important;
      will-change: transform, opacity !important;
    `;

    const updatePosition = () => {
      const bb = node.renderedBoundingBox();
      if (bb && bb.w > 0 && bb.h > 0) {
        statusIndicator.style.left = `${bb.x2 - 30}px`;
        statusIndicator.style.top = `${bb.y1 - 8}px`;
      }
    };

    cyElement.style.position = 'relative';
    cyElement.appendChild(statusIndicator);

    updatePosition();

    const positionHandler = () => {
      requestAnimationFrame(updatePosition);
    };
    const panZoomHandler = () => {
      requestAnimationFrame(updatePosition);
    };

    node.on('position', positionHandler);
    cy.on('zoom pan viewport', panZoomHandler);

    node.on('drag', positionHandler);

    this.blinkingIntervals.set(nodeId, {
      element: statusIndicator,
      nodeHandler: positionHandler,
      panZoomHandler: panZoomHandler,
      interval: null,
    });
  }
  private stopBlinking(nodeId: string): void {
    const blinkData = this.blinkingIntervals.get(nodeId);
    if (blinkData) {
      if (blinkData.interval) {
        clearInterval(blinkData.interval);
      }

      if (blinkData.element && blinkData.element.parentNode) {
        blinkData.element.parentNode.removeChild(blinkData.element);
      }

      const cyElement = this.cyContainer?.nativeElement;
      if (cyElement && cyElement._cy) {
        const cy = cyElement._cy;
        const node = cy.getElementById(nodeId);
        if (node.length) {
          if (blinkData.nodeHandler) {
            node.off('position', blinkData.nodeHandler);
            node.off('drag', blinkData.nodeHandler);
          }
          if (blinkData.panZoomHandler) {
            cy.off('zoom pan viewport', blinkData.panZoomHandler);
          }
        }
      }

      this.blinkingIntervals.delete(nodeId);
    }
  }

  private updateStatusIndicatorPosition(nodeId: string): void {
    const blinkData = this.blinkingIntervals.get(nodeId);
    if (!blinkData || !blinkData.element) {
      return;
    }

    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) {
      return;
    }

    const cy = cyElement._cy;
    const node = cy.getElementById(nodeId);
    if (!node.length) {
      return;
    }

    requestAnimationFrame(() => {
      const bb = node.renderedBoundingBox();
      if (bb && bb.w > 0 && bb.h > 0) {
        blinkData.element.style.left = `${bb.x2 - 30}px`;
        blinkData.element.style.top = `${bb.y1 - 8}px`;
      }
    });
  }

  private stopAllBlinking(): void {
    this.blinkingIntervals.forEach((blinkData, nodeId) => {
      this.stopBlinking(nodeId);
    });
  }
  private initializeBlinkingForAllDevices(): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement) {
      return;
    }

    const cy = cyElement._cy;
    if (!cy) {
      return;
    }

    let successCount = 0;
    this.deviceStatusMap.forEach((status, deviceId) => {
      const node = cy.getElementById(deviceId);
      if (!node.length) {
        return;
      }

      this.startBlinking(deviceId, status);
      successCount++;
    });
  }

  clearSavedPositions(): void {
    this.savedPositions.clear();
    this.saveStateToLocalStorage();
    this.toastService.info('All saved positions cleared', 2000);
  }

  clearBlockPositions(): void {
    const blockIds = this.networkData.blocks.map((block) => block.id);
    let clearedCount = 0;

    blockIds.forEach((blockId) => {
      if (this.savedPositions.has(blockId)) {
        this.savedPositions.delete(blockId);
        clearedCount++;
      }
    });

    this.saveStateToLocalStorage();
  }

  forceCompleteRepositioning(): void {
    const cy = this.getCytoscapeInstance();
    if (!cy) {
      return;
    }

    this.clearSavedPositions();

    this.ensureBlocksArePositioned(cy);

    setTimeout(() => {
      this.positionDevicesWithinBlocks(cy);

      cy.fit(undefined, 200);
    }, 100);
  }

  goToExcelTable(): void {
    this.router.navigate(['/topology-data']);
  }

  resetAllPositionsAndTest(): void {
    this.clearSavedPositions();

    setTimeout(() => {
      this.forceFullReinitialization();
    }, 100);
  }

  debugPositions(): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) {
      return;
    }

    const cy = cyElement._cy;
    console.log(`📊 Total saved positions: ${this.savedPositions.size}`);
    console.log(`📊 Total nodes in network: ${this.networkData.nodes.length}`);

    cy.nodes().forEach((node: any) => {
      if (!node.isParent()) {
        const nodeId = node.id();
        const currentPos = node.position();
        const savedPos = this.getSavedPosition(nodeId);

        if (savedPos) {
          const distance = Math.sqrt(
            Math.pow(currentPos.x - savedPos.x, 2) +
              Math.pow(currentPos.y - savedPos.y, 2)
          );
          console.log(`✅ ${nodeId}:`);
          console.log(
            `    Current: (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(
              1
            )})`
          );
          console.log(
            `    Saved:   (${savedPos.x.toFixed(1)}, ${savedPos.y.toFixed(1)})`
          );
          console.log(`    Distance: ${distance.toFixed(1)}px`);
        } else {
          console.log(
            `❌ ${nodeId}: Current (${currentPos.x.toFixed(
              1
            )}, ${currentPos.y.toFixed(1)}) - NO SAVED POSITION`
          );
        }
      }
    });

    // ✅ FIX: localStorage functionality disabled
    // try {
    //   const savedStateString = localStorage.getItem(this.STORAGE_KEY);
    //   if (savedStateString) {
    //     const savedState = JSON.parse(savedStateString);
    //     const positionsInStorage = Object.keys(
    //       savedState.positions || {}
    //     ).length;
    //     console.log(`💾 Positions in localStorage: ${positionsInStorage}`);
    //     console.log(
    //       `🕒 Last saved: ${new Date(savedState.timestamp).toLocaleString()}`
    //     );
    //   } else {
    //     console.log('❌ No data found in localStorage');
    //   }
    // } catch (error) {
    //   console.error('❌ Error reading localStorage:', error);
    // }

    console.log('💾 localStorage disabled - positions only in memory');

    // ✅ FIX: Manual save status (auto-save disabled)
    console.log('\n💾 MANUAL SAVE STATUS:');
    console.log(`  Auto-save: DISABLED ❌`);
    console.log(`  User dragging: ${this.isUserDragging ? 'YES 🖱️' : 'NO'}`);
    console.log(`  Dragged block: ${this.draggedBlockId || 'NONE'}`);

    // Count valid positions ready for manual save
    let validCount = 0;
    this.savedPositions.forEach((pos) => {
      if (this.isValidPosition(pos)) validCount++;
    });
    console.log(`  Valid positions ready for manual save: ${validCount}`);
    console.log(`  💡 Use "Save Positions" button to save to backend`);
  }

  saveAllCurrentPositions(): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) {
      return;
    }

    const cy = cyElement._cy;
    let savedCount = 0;

    cy.nodes().forEach((node: any) => {
      if (!node.isParent()) {
        const nodeId = node.id();
        const currentPos = node.position();
        this.saveNodePosition(nodeId, currentPos);
        savedCount++;
      }
    });

    // this.toastService.success(`Saved ${savedCount} device positions!`, 3000);
    this.debugPositions();
  }

  getAllSavedPositions(): { [key: string]: SavedPosition } {
    const positions: { [key: string]: SavedPosition } = {};
    this.savedPositions.forEach((position, nodeId) => {
      positions[nodeId] = position;
    });
    return positions;
  }

  setSavedPositions(positions: { [key: string]: SavedPosition }): void {
    this.savedPositions.clear();
    Object.entries(positions).forEach(([nodeId, position]) => {
      this.savedPositions.set(nodeId, position);
    });
    this.saveStateToLocalStorage();
  }

  enableCoreSwitchAutoPositioning(): void {
    this.enableCoreSwitchAutoArrangement = true;
  }

  disableCoreSwitchAutoPositioning(): void {
    this.enableCoreSwitchAutoArrangement = false;
  }

  isCoreSwitchAutoPositioningEnabled(): boolean {
    return this.enableCoreSwitchAutoArrangement;
  }

  getCoreSwitchPositioningMode(): { enabled: boolean; description: string } {
    return {
      enabled: this.enableCoreSwitchAutoArrangement,
      description: this.enableCoreSwitchAutoArrangement
        ? 'Automatic parallel arrangement is ENABLED - core switches maintain formation during drag'
        : 'Manual positioning is ENABLED - users can freely position core switches anywhere',
    };
  }

  manuallyArrangeCoreSwitches(): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (cyElement && cyElement._cy) {
      this.arrangeCoreNetworkSwitches(cyElement._cy);
    } else {
    }
  }

  setZoomLevel(zoomLevel: number): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (cyElement && cyElement._cy) {
      const cy = cyElement._cy;
      cy.zoom(zoomLevel);
      cy.center();
    }
  }

  fitWithPadding(padding: number = 80): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (cyElement && cyElement._cy) {
      const cy = cyElement._cy;
      cy.fit(undefined, padding);
    }
  }

  getCurrentZoom(): number {
    const cyElement = this.cyContainer?.nativeElement;
    if (cyElement && cyElement._cy) {
      return cyElement._cy.zoom();
    }
    return 1;
  }

  showFullTopology(): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (cyElement && cyElement._cy) {
      const cy = cyElement._cy;
      cy.fit(undefined, 120);
    }
  }

  enableFullUpdates(): void {
    this.forceFullUpdate = true;
  }

  isIncrementalMode(): boolean {
    return !this.forceFullUpdate;
  }

  public enableIncrementalRefresh(): void {
    this.forceFullUpdate = false;
  }

  public disableIncrementalRefresh(): void {
    this.forceFullUpdate = true;
  }

  public getRefreshModeStatus(): {
    isIncremental: boolean;
    description: string;
    nextRefreshType: string;
  } {
    return {
      isIncremental: !this.forceFullUpdate,
      description: this.forceFullUpdate
        ? 'Full refresh mode - will reinitialize entire topology'
        : 'Incremental refresh mode - will only update changed values',
      nextRefreshType: this.forceFullUpdate
        ? 'Full reinitialization'
        : 'Incremental update',
    };
  }

  public checkPositionValidity(): {
    totalNodes: number;
    validPositions: number;
    invalidPositions: number;
    zeroPositions: number;
    invalidNodes: string[];
    summary: string;
  } {
    const cy = this.getCytoscapeInstance();
    if (!cy) {
      return {
        totalNodes: 0,
        validPositions: 0,
        invalidPositions: 0,
        zeroPositions: 0,
        invalidNodes: [],
        summary: 'Cytoscape instance not available',
      };
    }

    const allNodes = cy.nodes().filter((node: any) => !node.isParent());
    const totalNodes = allNodes.length;
    let validPositions = 0;
    let invalidPositions = 0;
    let zeroPositions = 0;
    const invalidNodes: string[] = [];

    allNodes.forEach((node: any) => {
      const currentPos = node.position();

      if (currentPos.x === 0 && currentPos.y === 0) {
        zeroPositions++;
        invalidNodes.push(`${node.id()} (0,0)`);
      } else if (!this.isValidPosition(currentPos)) {
        invalidPositions++;
        invalidNodes.push(`${node.id()} (${currentPos.x},${currentPos.y})`);
      } else {
        validPositions++;
      }
    });

    const summary =
      invalidPositions > 0 || zeroPositions > 0
        ? `⚠️ Found ${
            invalidPositions + zeroPositions
          } nodes with positioning issues`
        : `✅ All ${totalNodes} nodes have valid positions`;

    return {
      totalNodes,
      validPositions,
      invalidPositions,
      zeroPositions,
      invalidNodes,
      summary,
    };
  }

  private fixInvalidPositionsAfterUpdate(cy: any): void {
    const nodesToFix = cy.nodes().filter((node: any) => {
      if (node.isParent()) return false;

      const currentPos = node.position();
      return !this.isValidPosition(currentPos);
    });
    if (nodesToFix.length === 0) return;
    nodesToFix.forEach((node: any) => {
      const nodeId = node.id();
      const parent = node.parent();
      const parentId = parent.length ? parent.id() : undefined;
      const safePosition = this.generateSafePosition(cy, nodeId, parentId);
      node.position(safePosition);
      this.saveNodePosition(nodeId, safePosition);
    });
  }

  getUpdateStatus(): {
    incrementalMode: boolean;
    currentlyUpdating: boolean;
    nodeCount: number;
    edgeCount: number;
    localStorageSize: number;
    hasLocalStorageData: boolean;
  } {
    let localStorageSize = 0;
    let hasLocalStorageData = false;

    // ✅ FIX: localStorage functionality disabled
    // try {
    //   const savedData = localStorage.getItem(this.STORAGE_KEY);
    //   if (savedData) {
    //     localStorageSize = savedData.length;
    //     hasLocalStorageData = true;
    //   }
    // } catch (error) {}

    // localStorage disabled - always false

    return {
      incrementalMode: this.isIncrementalMode(),
      currentlyUpdating: this.isUpdatingIncrementally,
      nodeCount: this.networkData.nodes.length,
      edgeCount: this.networkData.edges.length,
      localStorageSize,
      hasLocalStorageData,
    };
  }

  getLocalStorageInfo(): {
    hasData: boolean;
    dataSize: number;
    nodeCount: number;
    edgeCount: number;
    positionCount: number;
    lastSaved: string;
  } {
    // ✅ FIX: localStorage functionality disabled - return memory-based info
    // try {
    //   const savedStateString = localStorage.getItem(this.STORAGE_KEY);
    //   if (!savedStateString) {
    //     return {
    //       hasData: false,
    //       dataSize: 0,
    //       nodeCount: 0,
    //       edgeCount: 0,
    //       positionCount: 0,
    //       lastSaved: 'Never',
    //     };
    //   }

    //   const savedState: SavedNetworkState = JSON.parse(savedStateString);

    //   return {
    //     hasData: true,
    //     dataSize: savedStateString.length,
    //     nodeCount: savedState.networkData?.nodes?.length || 0,
    //     edgeCount: savedState.networkData?.edges?.length || 0,
    //     positionCount: Object.keys(savedState.positions || {}).length,
    //     lastSaved: new Date(savedState.timestamp).toLocaleString(),
    //   };
    // } catch (error) {
    //   return {
    //     hasData: false,
    //     dataSize: 0,
    //     nodeCount: 0,
    //     edgeCount: 0,
    //     positionCount: 0,
    //     lastSaved: 'Error',
    //   };
    // }

    return {
      hasData: false,
      dataSize: 0,
      nodeCount: this.networkData?.nodes?.length || 0,
      edgeCount: this.networkData?.edges?.length || 0,
      positionCount: this.savedPositions.size,
      lastSaved: 'localStorage disabled',
    };
  }

  updateDeviceType(deviceId: string, newType: string): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) return;

    const cy = cyElement._cy;
    const node = cy.getElementById(deviceId);

    if (node.length) {
      const oldType = this.deviceTypeMap.get(deviceId);
      this.deviceTypeMap.set(deviceId, newType);

      if (oldType && oldType !== newType) {
        this.animateTypeChange(cy, node, oldType, newType);
      } else {
        node.data('type', this.mapToNodeType(newType));
      }

      this.saveStateToLocalStorage();

      this.saveDeviceTypesToBackend();
    } else {
    }
  }

  getDeviceStatuses(): { [key: string]: string } {
    const statuses: { [key: string]: string } = {};
    this.deviceStatusMap.forEach((status, deviceId) => {
      statuses[deviceId] = status;
    });
    return statuses;
  }

  getDeviceStatusCount(status: 'on' | 'off'): number {
    let count = 0;
    this.deviceStatusMap.forEach((deviceStatus) => {
      if (deviceStatus === status) {
        count++;
      }
    });
    return count;
  }

  getTotalDeviceCount(): number {
    return this.deviceStatusMap.size;
  }

  getDeviceStatusPercentage(status: 'on' | 'off'): number {
    const total = this.getTotalDeviceCount();
    if (total === 0) return 0;
    const count = this.getDeviceStatusCount(status);
    return Math.round((count / total) * 100);
  }

  getNetworkHealthStatus(): string {
    const upPercentage = this.getDeviceStatusPercentage('on');

    if (upPercentage >= 90) {
      return 'Excellent - All systems operational';
    } else if (upPercentage >= 75) {
      return 'Good - Minor issues detected';
    } else if (upPercentage >= 50) {
      return 'Fair - Some devices down';
    } else if (upPercentage >= 25) {
      return 'Poor - Multiple devices down';
    } else {
      return 'Critical - Most devices down';
    }
  }

  getDeviceTypes(): { [key: string]: string } {
    const types: { [key: string]: string } = {};
    this.deviceTypeMap.forEach((type, deviceId) => {
      types[deviceId] = type;
    });
    return types;
  }

  getPendingAnimations(): StatusChangeAnimation[] {
    const now = Date.now();
    this.pendingStatusAnimations = this.pendingStatusAnimations.filter(
      (animation) => now - animation.timestamp < 5000
    );
    return [...this.pendingStatusAnimations];
  }

  clearPendingAnimations(): void {
    this.pendingStatusAnimations = [];
  }

  bulkUpdateDeviceStatuses(updates: {
    [deviceId: string]: 'on' | 'off';
  }): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) return;

    const cy = cyElement._cy;
    let animationCount = 0;

    Object.entries(updates).forEach(([deviceId, newStatus]) => {
      const node = cy.getElementById(deviceId);
      if (node.length) {
        const oldStatus = this.deviceStatusMap.get(deviceId);
        this.deviceStatusMap.set(deviceId, newStatus);

        if (oldStatus && oldStatus !== newStatus) {
          setTimeout(() => {
            this.animateStatusChange(cy, node, oldStatus, newStatus);
          }, animationCount * 100);
          animationCount++;
        } else {
          this.applyStatusStyling(node, newStatus);
        }
      }
    });

    this.saveStateToLocalStorage();
  }

  getTopologyStats(): {
    totalNodes: number;
    totalEdges: number;
    onlineDevices: number;
    offlineDevices: number;
    unknownStatusDevices: number;
    deviceTypeBreakdown: { [type: string]: number };
    statusBreakdown: { on: number; off: number; unknown: number };
  } {
    const stats = {
      totalNodes: this.networkData.nodes.length,
      totalEdges: this.networkData.edges.length,
      onlineDevices: 0,
      offlineDevices: 0,
      unknownStatusDevices: 0,
      deviceTypeBreakdown: {} as { [type: string]: number },
      statusBreakdown: { on: 0, off: 0, unknown: 0 },
    };

    // Count device statuses
    this.networkData.nodes.forEach((node) => {
      const status = this.deviceStatusMap.get(node.id);
      if (status === 'on') {
        stats.onlineDevices++;
        stats.statusBreakdown.on++;
      } else if (status === 'off') {
        stats.offlineDevices++;
        stats.statusBreakdown.off++;
      } else {
        stats.unknownStatusDevices++;
        stats.statusBreakdown.unknown++;
      }

      // Count device types
      const type = node.type;
      stats.deviceTypeBreakdown[type] =
        (stats.deviceTypeBreakdown[type] || 0) + 1;
    });

    return stats;
  }

  private generateDeviceTooltip(node: any): string {
    const nodeId = node.id();
    const nodeLabel = node.data('label');
    const nodeType = node.data('type');
    const status = node.data('status');

    // Keep tooltip concise to prevent layout interference
    let deviceInfo = `${nodeLabel || nodeId}`;

    if (nodeType) {
      deviceInfo += `\nType: ${
        nodeType.charAt(0).toUpperCase() + nodeType.slice(1)
      }`;
    }

    if (status) {
      deviceInfo += `\nStatus: ${status.toUpperCase()}`;
    }

    // Get connected devices count only (not detailed info to prevent expansion)
    const connectedEdges = node.connectedEdges();
    if (connectedEdges.length > 0) {
      deviceInfo += `\nConnections: ${connectedEdges.length}`;
    }

    return deviceInfo;
  }

  // Enhanced clear method that preserves structure but clears device data
  clearDeviceData(): void {
    this.deviceStatusMap.clear();
    this.deviceTypeMap.clear();
    this.pendingStatusAnimations = [];

    this.saveStateToLocalStorage();

    // Reset visual states in cytoscape
    const cyElement = this.cyContainer?.nativeElement;
    if (cyElement && cyElement._cy) {
      const cy = cyElement._cy;
      cy.nodes().forEach((node: any) => {
        if (!node.isParent()) {
          node.removeData('status');
          node.style({
            'border-width': 0,
            'border-opacity': 0,
            'border-color': 'transparent',
            'border-style': 'none',
            'background-opacity': 1,
            opacity: 1,
          });
        }
      });
    }
  }

  private getTooltipContainer(): HTMLElement {
    if (this.isFullscreen) {
      const fullscreenContainer = document.querySelector(
        '.topology-container'
      ) as HTMLElement;
      if (
        fullscreenContainer &&
        document.fullscreenElement === fullscreenContainer
      ) {
        return fullscreenContainer;
      }
    }
    return document.body;
  }

  private ensureTooltipInCorrectContainer(): void {
    if (!this.edgeTooltip) return;

    const currentParent = this.edgeTooltip.parentElement;
    const correctContainer = this.getTooltipContainer();

    if (currentParent !== correctContainer) {
      correctContainer.appendChild(this.edgeTooltip);
    }
  }

  private highlightHoveredEdge(hoveredEdge: any): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) return;

    const cy = cyElement._cy;
    const allEdges = cy.edges();
    const allNodes = cy.nodes().filter((n: any) => !n.isParent());

    allEdges.forEach((edge: any) => {
      edge.addClass('dimmed-edge');
      edge.style({
        opacity: 0.2,
        width: 1,
        'z-index': 1,
        'line-color': (ele: any) => {
          const originalColor = ele.data('speedColor') || '#000';
          return originalColor;
        },
      });
    });

    allNodes.forEach((node: any) => {
      node.addClass('dimmed-node');
      node.style({
        opacity: 0.3,
        'z-index': 1,
      });
    });

    hoveredEdge.removeClass('dimmed-edge');
    hoveredEdge.addClass('highlighted-edge');

    const originalColor = hoveredEdge.data('speedColor') || '#000';

    hoveredEdge.style({
      width: 6,
      'z-index': 999,
      opacity: 1,
      'line-color': originalColor,
      'line-style': 'solid',
    });

    const sourceNode = hoveredEdge.source();
    const targetNode = hoveredEdge.target();

    if (sourceNode && !sourceNode.isParent()) {
      sourceNode.removeClass('dimmed-node');
      sourceNode.style({
        opacity: 1,
        'z-index': 998,
      });
    }

    if (targetNode && !targetNode.isParent()) {
      targetNode.removeClass('dimmed-node');
      targetNode.style({
        opacity: 1,
        'z-index': 998,
      });
    }

    const inSpeed = hoveredEdge.data('inSpeed');
    const outSpeed = hoveredEdge.data('outSpeed');
    const capacity = hoveredEdge.data('capacity');
    const interface_a = hoveredEdge.data('interface_a');
    const interface_b = hoveredEdge.data('interface_b');
    const speedStatus = hoveredEdge.data('speedStatus');
    const speedPercentage = hoveredEdge.data('speedPercentage');

    this.selectedEdgeInfo = {
      sourceDevice: sourceNode.data('label') || sourceNode.id(),
      targetDevice: targetNode.data('label') || targetNode.id(),
      inSpeed: inSpeed || 'N/A',
      outSpeed: outSpeed || 'N/A',
      capacity: capacity || 'N/A',
      interfaceA: interface_a || 'N/A',
      interfaceB: interface_b || 'N/A',
      speedStatus: speedStatus || 'Normal',
      speedPercentage: speedPercentage || 0,
    };
  }

  private resetEdgeHighlighting(): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) return;

    const cy = cyElement._cy;
    const allEdges = cy.edges();
    const allNodes = cy.nodes().filter((n: any) => !n.isParent());

    allEdges.forEach((edge: any) => {
      edge.removeClass('highlighted-edge');
      edge.removeClass('dimmed-edge');

      const originalColor = edge.data('speedColor') || '#000';
      edge.style({
        width: 2,
        'line-color': originalColor,
        'z-index': 1,
        opacity: 1,
        'line-style': 'solid',
      });
    });

    // Restore all device nodes to original state
    allNodes.forEach((node: any) => {
      node.removeClass('dimmed-node');
      node.style({
        opacity: 1,
        'z-index': 1,
      });
    });
  }

  private generateCRCData(edge: any): any {
    // Generate realistic CRC data for the edge
    const edgeId = edge.id();
    const sourceId = edge.source().id();
    const targetId = edge.target().id();

    // Use edge ID and device IDs to generate consistent CRC data
    const seed = edgeId.length + sourceId.length + targetId.length;
    const random = this.seededRandom(seed);

    // Generate realistic CRC statistics
    const totalPackets = Math.floor(random() * 1000000) + 100000; // 100k to 1.1M packets
    const errors = Math.floor(random() * 100); // 0 to 99 errors
    const errorRate = (errors / totalPackets) * 100;

    // Determine status based on error rate
    let status: 'good' | 'warning' | 'critical';
    if (errorRate < 0.01) {
      status = 'good';
    } else if (errorRate < 0.1) {
      status = 'warning';
    } else {
      status = 'critical';
    }

    // Generate last check time (within last 24 hours)
    const now = new Date();
    const hoursAgo = Math.floor(random() * 24);
    const lastCheck = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);

    return {
      errors,
      totalPackets,
      errorRate,
      lastCheck: lastCheck.toLocaleTimeString(),
      status,
    };
  }

  private seededRandom(seed: number): () => number {
    // Simple seeded random number generator
    let state = seed;
    return () => {
      state = (state * 9301 + 49297) % 233280;
      return state / 233280;
    };
  }

  private updateSpeedStatusCounts(): void {
    const cy = this.getCytoscapeInstance();
    if (!cy) {
      this.speedStatusCounts = {
        down: 0,
        critical: 0,
        warning: 0,
        normal: 0,
        good: 0,
        total: 0,
      };
      return;
    }

    const edges = cy.edges();
    let down = 0;
    let critical = 0;
    let warning = 0;
    let normal = 0;
    let good = 0;

    edges.forEach((edge: any) => {
      const speedStatus = edge.data('speedStatus');
      switch (speedStatus) {
        case 'down':
          down++;
          break;
        case 'critical':
          critical++;
          break;
        case 'warning':
          warning++;
          break;
        case 'normal':
          normal++;
          break;
        case 'good':
          good++;
          break;
      }
    });

    this.speedStatusCounts = {
      down,
      critical,
      warning,
      normal,
      good,
      total: edges.length,
    };
  }

  public getSpeedStatusCounts(): {
    down: number;
    critical: number;
    warning: number;
    normal: number;
    good: number;
    total: number;
  } {
    this.updateSpeedStatusCounts();
    return this.speedStatusCounts;
  }

  private generateEnhancedEdgeTooltip(edge: any): string {
    // Get edge data
    const inSpeed = edge.data('inSpeed');
    const outSpeed = edge.data('outSpeed');
    const speedPercentage = edge.data('speedPercentage');
    const speedStatus = edge.data('speedStatus');
    const interface_a = edge.data('interface_a');
    const interface_b = edge.data('interface_b');
    const capacity = edge.data('capacity');

    // Get device nodes
    const sourceNode = edge.source();
    const targetNode = edge.target();

    // Get device information
    const deviceAId = sourceNode.id();
    const deviceBId = targetNode.id();

    // Extract name and IP from label (format: "name\nip")
    const deviceALabel = sourceNode.data('label') || deviceAId;
    const deviceBLabel = targetNode.data('label') || deviceBId;

    // Split label to get name and IP separately
    const deviceALabelParts = deviceALabel.split('\n');
    const deviceBLabelParts = deviceBLabel.split('\n');

    const deviceAName = deviceALabelParts[0] || deviceAId;
    const deviceBName = deviceBLabelParts[0] || deviceBId;
    const deviceAIP = deviceALabelParts[1] || deviceAId;
    const deviceBIP = deviceBLabelParts[1] || deviceBId;
    const deviceAType = sourceNode.data('type');
    const deviceBType = targetNode.data('type');
    const deviceAStatus = sourceNode.data('status');
    const deviceBStatus = targetNode.data('status');
    const deviceAParent = sourceNode.data('parent');
    const deviceBParent = targetNode.data('parent');

    // Tooltip header
    let tooltipContent = `
    <div style="margin-bottom: 12px;">
      <div style="font-weight: bold; font-size: 14px; color: #3498db; margin-bottom: 6px; text-align: center; border-bottom: 1px solid #34495e; padding-bottom: 6px;">
        🔗 Connection Details
      </div>
    </div>
  `;

    // Parallel layout container
    tooltipContent += `<div style="display: flex; gap: 12px; margin-bottom: 12px;">`;

    // Device A Block
    tooltipContent += `
    <div style="flex: 1; padding: 8px; background: rgba(52, 152, 219, 0.1); border-radius: 6px; border-left: 3px solid #3498db;">
      <div style="font-size: 11px; color: #3498db; font-weight: bold; margin-bottom: 6px;">
        🔵 DEVICE A
      </div>
      <div style="margin-bottom: 4px;">
        <div style="font-size: 1em; color: #ecf0f1; font-weight: 500; margin-bottom: 2px;">${deviceAName}</div>
        <div style="font-size: 1em; color: #95a5a6; font-family: 'Courier New', monospace;">${deviceAIP}</div>
      </div>
  `;

    if (deviceAType) {
      const typeIcon = this.getDeviceTypeIcon(deviceAType);
      tooltipContent += `
      <div style="margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
        <span style="color: #f39c12; font-size: 1em;">${typeIcon}</span>
        <span style="font-size: 1em; color: #bdc3c7;">${deviceAType}</span>
      </div>
    `;
    }

    if (deviceAStatus) {
      const statusColor = deviceAStatus === 'on' ? '#27ae60' : '#e74c3c';
      const statusIcon = deviceAStatus === 'on' ? '🟢' : '🔴';
      tooltipContent += `
      <div style="margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
        <span style="font-size: 12px;">${statusIcon}</span>
        <span style="font-size: 12px; color: ${statusColor}; font-weight: 500;">${deviceAStatus.toUpperCase()}</span>
      </div>
    `;
    }

    if (deviceAParent) {
      tooltipContent += `
      <div style="margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
        <span style="color: #9b59b6; font-size: 1em;">📦</span>
        <span style="font-size: 1em; color: #bdc3c7;">${deviceAParent}</span>
      </div>
    `;
    }

    if (interface_a) {
      tooltipContent += `
      <div style="margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
        <span style="color: #2ecc71; font-size: 1em;">🔌</span>
        <span style="font-size: 1em; color: #bdc3c7;">${interface_a}</span>
      </div>
    `;
    }

    // Connection Info in Device A
    if (inSpeed || outSpeed || capacity) {
      tooltipContent += `
      <div style="margin-top: 8px; padding: 8px; background: rgba(52, 73, 94, 0.3); border-radius: 6px;">
        <div style="font-size: 11px; color: #f39c12; font-weight: bold; margin-bottom: 6px;">
          📊 CONNECTION STATS
        </div>
    `;

      if (inSpeed && outSpeed) {
        tooltipContent += `
        <div style="margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; color: #ecf0f1;">In Speed:</span>
          <span style="font-size: 11px; color: #3498db; font-weight: 500;">${inSpeed}</span>
        </div>
        <div style="margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; color: #ecf0f1;">Out Speed:</span>
          <span style="font-size: 11px; color: #e74c3c; font-weight: 500;">${outSpeed}</span>
        </div>
      `;
      }

      if (capacity) {
        tooltipContent += `
        <div style="margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; color: #ecf0f1;">Capacity:</span>
          <span style="font-size: 11px; color: #f39c12; font-weight: 500;">${capacity}</span>
        </div>
      `;
      }

      // if (speedPercentage !== undefined && speedStatus) {
      //   const utilizationColor =
      //     speedPercentage > 80
      //       ? '#e74c3c'
      //       : speedPercentage > 60
      //       ? '#f39c12'
      //       : '#27ae60';
      //   tooltipContent += `
      //   <div style="margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
      //     <span style="font-size: 11px; color: #ecf0f1;">Utilization:</span>
      //     <span style="font-size: 11px; color: ${utilizationColor}; font-weight: 500;">
      //       ${speedPercentage.toFixed(1)}% (${speedStatus})
      //     </span>
      //   </div>
      // `;
      // }

      tooltipContent += `</div>`;
    }

    tooltipContent += `</div>`; // Close Device A block

    // Device B Block
    tooltipContent += `
    <div style="flex: 1; padding: 8px; background: rgba(155, 89, 182, 0.15); border-radius: 6px; border-left: 3px solid #9b59b6;">
      <div style="font-size: 11px; color: #9b59b6; font-weight: bold; margin-bottom: 6px;">
        🟣 DEVICE B
      </div>
      <div style="margin-bottom: 4px;">
        <div style="font-size: 1em; color: #ecf0f1; font-weight: 500; margin-bottom: 2px;">${deviceBName}</div>
        <div style="font-size: 1em; color: #95a5a6; font-family: 'Courier New', monospace;">${deviceBIP}</div>
      </div>
  `;

    if (deviceBType) {
      const typeIcon = this.getDeviceTypeIcon(deviceBType);
      tooltipContent += `
      <div style="margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
        <span style="color: #f39c12; font-size: 1em;">${typeIcon}</span>
        <span style="font-size: 1em; color: #bdc3c7;">${deviceBType}</span>
      </div>
    `;
    }

    if (deviceBStatus) {
      const statusColor = deviceBStatus === 'on' ? '#27ae60' : '#e74c3c';
      const statusIcon = deviceBStatus === 'on' ? '🟢' : '🔴';
      tooltipContent += `
      <div style="margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
        <span style="font-size: 12px;">${statusIcon}</span>
        <span style="font-size: 12px; color: ${statusColor}; font-weight: 500;">${deviceBStatus.toUpperCase()}</span>
      </div>
    `;
    }

    if (deviceBParent) {
      tooltipContent += `
      <div style="margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
        <span style="color: #9b59b6; font-size: 1em;">📦</span>
        <span style="font-size: 1em; color: #bdc3c7;">${deviceBParent}</span>
      </div>
    `;
    }

    if (interface_b) {
      tooltipContent += `
      <div style="margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
        <span style="color: #2ecc71; font-size: 1em;">🔌</span>
        <span style="font-size: 1em; color: #bdc3c7;">${interface_b}</span>
      </div>
    `;
    }

    // Connection Info in Device B
    if (inSpeed || outSpeed || capacity) {
      tooltipContent += `
      <div style="margin-top: 8px; padding: 8px; background: rgba(52, 73, 94, 0.3); border-radius: 6px;">
        <div style="font-size: 11px; color: #f39c12; font-weight: bold; margin-bottom: 6px;">
          📊 CONNECTION STATS
        </div>
    `;

      if (inSpeed && outSpeed) {
        tooltipContent += `
        <div style="margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; color: #ecf0f1;">In Speed:</span>
          <span style="font-size: 11px; color: #3498db; font-weight: 500;">${inSpeed}</span>
        </div>
        <div style="margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; color: #ecf0f1;">Out Speed:</span>
          <span style="font-size: 11px; color: #e74c3c; font-weight: 500;">${outSpeed}</span>
        </div>
      `;
      }

      if (capacity) {
        tooltipContent += `
        <div style="margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; color: #ecf0f1;">Capacity:</span>
          <span style="font-size: 11px; color: #f39c12; font-weight: 500;">${capacity}</span>
        </div>
      `;
      }

      // if (speedPercentage !== undefined && speedStatus) {
      //   const utilizationColor =
      //     speedPercentage > 80
      //       ? '#e74c3c'
      //       : speedPercentage > 60
      //       ? '#f39c12'
      //       : '#27ae60';
      //   tooltipContent += `
      //   <div style="margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
      //     <span style="font-size: 11px; color: #ecf0f1;">Utilization:</span>
      //     <span style="font-size: 11px; color: ${utilizationColor}; font-weight: 500;">
      //       ${speedPercentage.toFixed(1)}% (${speedStatus})
      //     </span>
      //   </div>
      // `;
      // }

      tooltipContent += `</div>`;
    }

    tooltipContent += `</div>`; // Close Device B block

    tooltipContent += `</div>`; // Close flex container

    // Add timestamp
    const now = new Date();
    tooltipContent += `
    <div style="font-size: 10px; color: #7f8c8d; text-align: center; border-top: 1px solid #34495e; padding-top: 8px;">
      Last updated: ${now.toLocaleTimeString()}
    </div>
  `;

    return tooltipContent;
  }

  private showEdgeTooltip(event: any): void {
    const edge = event.target;
    const content = this.generateEnhancedEdgeTooltip(edge);
    if (!this.edgeTooltip) {
      this.edgeTooltip = document.createElement('div');
      this.edgeTooltip.className = 'edge-tooltip';
      this.edgeTooltip.style.cssText = `
        position: fixed;
        background-color: #2c3e50;
        color: #ecf0f1;
        border: 2px solid #3498db;
        border-radius: 8px;
        padding: 12px;
        font-size: 12px;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        font-weight: 400;
        z-index: 100000;
        pointer-events: none;
        box-shadow: 0 6px 20px rgba(0,0,0,0.4);
        max-width: 400px;
        min-width: 300px;
        line-height: 1.4;
        overflow: visible;
        contain: layout;
        transform-origin: top left;
        will-change: transform;
      `;

      // Append to the appropriate container based on fullscreen state
      const appendTarget = this.getTooltipContainer();
      appendTarget.appendChild(this.edgeTooltip);
    }

    this.ensureTooltipInCorrectContainer();

    this.edgeTooltip.innerHTML = content;
    this.updateTooltipPosition(event);
    this.edgeTooltip.style.display = 'block';
    this.edgeTooltip.style.visibility = 'visible';
  }

  private hideEdgeTooltip(): void {
    if (this.edgeTooltip) {
      this.edgeTooltip.style.display = 'none';
      this.edgeTooltip.style.visibility = 'hidden';
    }
  }

  private updateTooltipPosition(event: any): void {
    if (!this.edgeTooltip) return;

    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement) return;

    const containerRect = cyElement.getBoundingClientRect();

    let mouseX = 0;
    let mouseY = 0;

    if (event.originalEvent) {
      mouseX = event.originalEvent.clientX;
      mouseY = event.originalEvent.clientY;
    } else if (event.renderedPosition) {
      mouseX = event.renderedPosition.x + containerRect.left;
      mouseY = event.renderedPosition.y + containerRect.top;
    }

    if (this.isFullscreen) {
      const fullscreenContainer = document.querySelector(
        '.topology-container'
      ) as HTMLElement;
      if (
        fullscreenContainer &&
        document.fullscreenElement === fullscreenContainer
      ) {
        const fullscreenRect = fullscreenContainer.getBoundingClientRect();
        mouseX = mouseX - fullscreenRect.left;
        mouseY = mouseY - fullscreenRect.top;
      }
    }

    const offsetX = 15;
    const offsetY = -35;

    const tooltipWidth = this.edgeTooltip.offsetWidth || 200;
    const tooltipHeight = this.edgeTooltip.offsetHeight || 60;
    const viewportWidth = this.isFullscreen
      ? (document.fullscreenElement as HTMLElement)?.offsetWidth ||
        window.innerWidth
      : window.innerWidth;
    const viewportHeight = this.isFullscreen
      ? (document.fullscreenElement as HTMLElement)?.offsetHeight ||
        window.innerHeight
      : window.innerHeight;

    let finalX = mouseX + offsetX;
    let finalY = mouseY + offsetY;

    if (finalX + tooltipWidth > viewportWidth) {
      finalX = mouseX - tooltipWidth - 15;
    }
    if (finalY < 0) {
      finalY = mouseY + 15;
    }
    this.edgeTooltip.style.left = `${finalX}px`;
    this.edgeTooltip.style.top = `${finalY}px`;
  }

  // Device tooltip methods
  private showDeviceTooltip(event: any, node: any): void {
    if (!node || node.isParent()) return;

    // Hide edge tooltip if it's showing
    this.hideEdgeTooltip();

    // Create device tooltip if it doesn't exist
    if (!this.deviceTooltip) {
      this.deviceTooltip = document.createElement('div');
      this.deviceTooltip.className = 'device-tooltip';
      this.deviceTooltip.style.cssText = `
        position: fixed;
        background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
        color: #ecf0f1;
        border: 2px solid #3498db;
        border-radius: 8px;
        padding: 12px 16px;
        font-size: 13px;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        z-index: 50001;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        max-width: 280px;
        min-width: 200px;
        backdrop-filter: blur(10px);
        pointer-events: none;
        opacity: 0;
        transform: translateY(10px);
        transition: opacity 0.2s ease, transform 0.2s ease;
      `;

      const container = this.getTooltipContainer();
      container.appendChild(this.deviceTooltip);
    }
    const deviceInfo = this.generateEnhancedDeviceTooltip(node);
    this.deviceTooltip.innerHTML = deviceInfo;
    this.updateDeviceTooltipPosition(event);
    this.deviceTooltip.style.opacity = '1';
    this.deviceTooltip.style.transform = 'translateY(0)';
  }

  private hideDeviceTooltip(): void {
    if (this.deviceTooltip) {
      this.deviceTooltip.style.opacity = '0';
      this.deviceTooltip.style.transform = 'translateY(10px)';
      setTimeout(() => {
        if (this.deviceTooltip && this.deviceTooltip.parentElement) {
          this.deviceTooltip.parentElement.removeChild(this.deviceTooltip);
          this.deviceTooltip = null;
        }
      }, 200);
    }
  }

  private updateDeviceTooltipPosition(event: any): void {
    if (!this.deviceTooltip) return;

    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement) return;

    const containerRect = cyElement.getBoundingClientRect();

    let mouseX = 0;
    let mouseY = 0;

    if (event.originalEvent) {
      mouseX = event.originalEvent.clientX;
      mouseY = event.originalEvent.clientY;
    } else if (event.renderedPosition) {
      mouseX = event.renderedPosition.x + containerRect.left;
      mouseY = event.renderedPosition.y + containerRect.top;
    }

    if (this.isFullscreen) {
      const fullscreenContainer = document.querySelector(
        '.topology-container'
      ) as HTMLElement;
      if (
        fullscreenContainer &&
        document.fullscreenElement === fullscreenContainer
      ) {
        const fullscreenRect = fullscreenContainer.getBoundingClientRect();
        mouseX = mouseX - fullscreenRect.left;
        mouseY = mouseY - fullscreenRect.top;
      }
    }

    const offsetX = 20;
    const offsetY = -20;

    const tooltipWidth = this.deviceTooltip.offsetWidth || 250;
    const tooltipHeight = this.deviceTooltip.offsetHeight || 100;
    const viewportWidth = this.isFullscreen
      ? (document.fullscreenElement as HTMLElement)?.offsetWidth ||
        window.innerWidth
      : window.innerWidth;
    const viewportHeight = this.isFullscreen
      ? (document.fullscreenElement as HTMLElement)?.offsetHeight ||
        window.innerHeight
      : window.innerHeight;

    let finalX = mouseX + offsetX;
    let finalY = mouseY + offsetY;

    if (finalX + tooltipWidth > viewportWidth) {
      finalX = mouseX - tooltipWidth - 20;
    }
    if (finalY < 0) {
      finalY = mouseY + 20;
    }

    this.deviceTooltip.style.left = `${finalX}px`;
    this.deviceTooltip.style.top = `${finalY}px`;
  }

  private generateEnhancedDeviceTooltip(node: any): string {
    const nodeId = node.id();
    const nodeLabel = node.data('label');
    const nodeType = node.data('type');
    const status = node.data('status');
    const parent = node.data('parent');

    const deviceStatus = this.deviceStatusMap.get(nodeId);
    const deviceType = nodeType;

    const connectedEdges = node.connectedEdges();
    const connectedNodes = node.neighborhood().nodes();

    let tooltipContent = `
      <div style="margin-bottom: 8px;">
        <div style="font-weight: bold; font-size: 14px; color: #3498db; margin-bottom: 4px;">
          ${nodeLabel} ${nodeId}
        </div>
      </div>
    `;

    if (nodeType || deviceType) {
      const displayType = deviceType || nodeType;
      const typeIcon = this.getDeviceTypeIcon(displayType);
      tooltipContent += `
        <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
          <span style="color: #f39c12;">${typeIcon}</span>
          <span style="font-size: 12px; color: #ecf0f1;">
            Type: ${displayType.charAt(0).toUpperCase() + displayType.slice(1)}
          </span>
        </div>
      `;
    }

    if (status || deviceStatus) {
      const displayStatus = deviceStatus || status;
      const statusColor = displayStatus === 'on' ? '#27ae60' : '#e74c3c';
      const statusIcon = displayStatus === 'on' ? '🟢' : '🔴';
      tooltipContent += `
        <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 12px;">${statusIcon}</span>
          <span style="font-size: 12px; color: ${statusColor}; font-weight: 500;">
            Status: ${displayStatus.toUpperCase()}
          </span>
        </div>
      `;
    }

    if (parent) {
      tooltipContent += `
        <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
          <span style="color: #9b59b6;">📦</span>
          <span style="font-size: 12px; color: #ecf0f1;">
            Block: ${parent}
          </span>
        </div>
      `;
    }

    if (connectedEdges.length > 0) {
      tooltipContent += `
        <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
          <span style="color: #3498db;">🔗</span>
          <span style="font-size: 12px; color: #ecf0f1;">
            Connections: ${connectedEdges.length}
          </span>
        </div>
      `;
    }

    if (connectedNodes.length > 0) {
      tooltipContent += `
        <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
          <span style="color: #2ecc71;">👥</span>
          <span style="font-size: 12px; color: #ecf0f1;">
            Connected Devices: ${connectedNodes.length}
          </span>
        </div>
      `;
    }

    const now = new Date();
    tooltipContent += `
      <div style="font-size: 10px; color: #7f8c8d; text-align: center;">
        Last updated: ${now.toLocaleTimeString()}
      </div>
    `;

    return tooltipContent;
  }

  private getDeviceTypeIcon(type: string): string {
    const iconMap: { [key: string]: string } = {
      firewall: '🛡️',
      switch: '🔌',
      router: '🌐',
      server: '🖥️',
      internet: '🌍',
      ext_switch: '🔌',
      core_switch: '🔌',
      ips: '🛡️',
      proxy: '🔒',
      dwdm: '📡',
      unknown: '❓',
      isp: '🌍',
    };
    return iconMap[type] || '📱';
  }

  private getDeviceTypeSVG(type: string): string {
    const svgMap: { [key: string]: string } = {
      firewall: 'assets/firewall_new.svg',
      switch: 'assets/realSwitch.svg',
      router: 'assets/router_real.svg',
      server: 'assets/networkServer.svg',
      internet: 'assets/real_internet_2.svg',
      ext_switch: 'assets/externalSwitch.svg',
      core_switch: 'assets/coreSwitch_real.svg',
      ips: 'assets/ips.svg',
      proxy: 'assets/proxy.svg',
      dwdm: 'assets/realSwitch.svg',
      unknown: 'assets/realSwitch.svg',
      isp: 'assets/isp.svg',
    };
    return svgMap[type] || 'assets/realSwitch.svg';
  }

  // Update node styling based on device type
  private updateNodeStyling(nodeId: string, deviceType: string): void {
    const cy = this.getCytoscapeInstance();
    if (!cy) return;

    const node = cy.getElementById(nodeId);
    if (node.length === 0) return;

    const svgPath = this.getDeviceTypeSVG(deviceType);

    node.style({
      'background-image': `url(${svgPath})`,
      'background-fit': 'cover',
      'background-opacity': 0,
    });
  }

  // Update all nodes styling based on current device types
  private updateAllNodesStyling(): void {
    if (!this.deviceTypeMap || this.deviceTypeMap.size === 0) return;

    this.deviceTypeMap.forEach((deviceType, deviceId) => {
      this.updateNodeStyling(deviceId, deviceType);
    });
  }

  private getDeviceUtilization(deviceId: string): any {
    let deviceCapacity = 0;
    let deviceInSpeed = 0;
    let deviceOutSpeed = 0;
    let connectionCount = 0;

    // Track unique connections to avoid double counting
    const processedConnections = new Set<string>();
    const capacityCounts = new Map<number, number>();
    const inSpeedCounts = new Map<number, number>();
    const outSpeedCounts = new Map<number, number>();

    // Iterate through connection map to find connections involving this device
    this.connectionMap.forEach((connectionData, connectionId) => {
      if (
        connectionData.deviceAIP === deviceId ||
        connectionData.deviceBIP === deviceId
      ) {
        // Only process each connection once
        if (!processedConnections.has(connectionId)) {
          processedConnections.add(connectionId);
          connectionCount++;

          // Count speed and capacity occurrences to find the most common values
          const inSpeed = connectionData.inSpeed || 0;
          const outSpeed = connectionData.outSpeed || 0;
          const capacity = connectionData.capacity || 0;

          if (inSpeed > 0) {
            inSpeedCounts.set(inSpeed, (inSpeedCounts.get(inSpeed) || 0) + 1);
          }
          if (outSpeed > 0) {
            outSpeedCounts.set(
              outSpeed,
              (outSpeedCounts.get(outSpeed) || 0) + 1
            );
          }
          if (capacity > 0) {
            capacityCounts.set(
              capacity,
              (capacityCounts.get(capacity) || 0) + 1
            );
          }
        }
      }
    });

    // Also check fileData for additional information, but avoid double counting
    if (this.fileData && this.fileData.length > 0) {
      this.fileData.forEach((row, index) => {
        const deviceAIP = row['Device A IP'];
        const deviceBIP = row['Device B IP'];

        if (deviceAIP === deviceId || deviceBIP === deviceId) {
          // Create a unique identifier for this file row to avoid double counting
          const fileRowId = `file_${index}_${deviceAIP}_${deviceBIP}`;

          if (!processedConnections.has(fileRowId)) {
            processedConnections.add(fileRowId);
            connectionCount++;

            const inSpeed = this.parseSpeed(row['IN Speed']) || 0;
            const outSpeed = this.parseSpeed(row['Out Speed']) || 0;
            const capacity = this.parseSpeed(row['capacity']) || 0;

            // Count speed and capacity occurrences
            if (inSpeed > 0) {
              inSpeedCounts.set(inSpeed, (inSpeedCounts.get(inSpeed) || 0) + 1);
            }
            if (outSpeed > 0) {
              outSpeedCounts.set(
                outSpeed,
                (outSpeedCounts.get(outSpeed) || 0) + 1
              );
            }
            if (capacity > 0) {
              capacityCounts.set(
                capacity,
                (capacityCounts.get(capacity) || 0) + 1
              );
            }
          }
        }
      });
    }

    // Determine the device's actual capacity (most common value)
    if (capacityCounts.size > 0) {
      let maxCount = 0;
      let mostCommonCapacity = 0;

      capacityCounts.forEach((count, capacity) => {
        if (count > maxCount) {
          maxCount = count;
          mostCommonCapacity = capacity;
        }
      });

      deviceCapacity = mostCommonCapacity;
    }

    // Determine the device's actual in speed (most common value)
    if (inSpeedCounts.size > 0) {
      let maxCount = 0;
      let mostCommonInSpeed = 0;

      inSpeedCounts.forEach((count, speed) => {
        if (count > maxCount) {
          maxCount = count;
          mostCommonInSpeed = speed;
        }
      });

      deviceInSpeed = mostCommonInSpeed;
    }

    // Determine the device's actual out speed (most common value)
    if (outSpeedCounts.size > 0) {
      let maxCount = 0;
      let mostCommonOutSpeed = 0;

      outSpeedCounts.forEach((count, speed) => {
        if (count > maxCount) {
          maxCount = count;
          mostCommonOutSpeed = speed;
        }
      });

      deviceOutSpeed = mostCommonOutSpeed;
    }

    // If we still don't have values, use the maximum found
    if (deviceCapacity === 0 && capacityCounts.size > 0) {
      deviceCapacity = Math.max(...capacityCounts.keys());
    }
    if (deviceInSpeed === 0 && inSpeedCounts.size > 0) {
      deviceInSpeed = Math.max(...inSpeedCounts.keys());
    }
    if (deviceOutSpeed === 0 && outSpeedCounts.size > 0) {
      deviceOutSpeed = Math.max(...outSpeedCounts.keys());
    }

    return {
      totalInSpeed: deviceInSpeed,
      totalOutSpeed: deviceOutSpeed,
      totalCapacity: deviceCapacity,
      connectionCount,
      capacityBreakdown: Object.fromEntries(capacityCounts),
      inSpeedBreakdown: Object.fromEntries(inSpeedCounts),
      outSpeedBreakdown: Object.fromEntries(outSpeedCounts),
    };
  }

  private getDeviceDetails(deviceId: string): any {
    const interfaces: string[] = [];
    const descriptions: string[] = [];

    // Get interface and description information from connection map
    this.connectionMap.forEach((connectionData, connectionId) => {
      if (connectionData.deviceAIP === deviceId) {
        if (
          connectionData.interface_a &&
          !interfaces.includes(connectionData.interface_a)
        ) {
          interfaces.push(connectionData.interface_a);
        }
        if (
          connectionData.description &&
          !descriptions.includes(connectionData.description)
        ) {
          descriptions.push(connectionData.description);
        }
      }
      if (connectionData.deviceBIP === deviceId) {
        if (
          connectionData.interface_b &&
          !interfaces.includes(connectionData.interface_b)
        ) {
          interfaces.push(connectionData.interface_b);
        }
        if (
          connectionData.description &&
          !descriptions.includes(connectionData.description)
        ) {
          descriptions.push(connectionData.description);
        }
      }
    });

    // Also check fileData for additional information
    if (this.fileData && this.fileData.length > 0) {
      this.fileData.forEach((row) => {
        const deviceAIP = row['Device A IP'];
        const deviceBIP = row['Device B IP'];
        const interface_a = row['interface'];
        const interface_b = row['interface_1'];
        const description = row['Desc'];

        if (deviceAIP === deviceId) {
          if (interface_a && !interfaces.includes(interface_a)) {
            interfaces.push(interface_a);
          }
          if (description && !descriptions.includes(description)) {
            descriptions.push(description);
          }
        }
        if (deviceBIP === deviceId) {
          if (interface_b && !interfaces.includes(interface_b)) {
            interfaces.push(interface_b);
          }
          if (description && !descriptions.includes(description)) {
            descriptions.push(description);
          }
        }
      });
    }

    return {
      interfaces,
      descriptions,
    };
  }

  preventBlockExpansion(): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) {
      console.warn('Cytoscape not ready');
      return;
    }

    const cy = cyElement._cy;

    cy.on('mouseover', 'node', (event: any) => {
      const node = event.target;
      if (node.isParent()) {
        node.removeClass('show-device-info');
        node.removeData('tooltip');
      }
    });
  }

  toggleFullscreen(): void {
    const topologyContainer = document.querySelector(
      '.topology-container'
    ) as HTMLElement;

    if (!topologyContainer) {
      return;
    }

    if (!this.isFullscreen) {
      if (topologyContainer.requestFullscreen) {
        topologyContainer.requestFullscreen();
      } else if ((topologyContainer as any).webkitRequestFullscreen) {
        (topologyContainer as any).webkitRequestFullscreen();
      } else if ((topologyContainer as any).msRequestFullscreen) {
        (topologyContainer as any).msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
      }
    }

    this.showTooltip = false;
  }

  recenterView(): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) {
      console.error('❌ Cytoscape not ready for recentering');
      return;
    }

    const cy = cyElement._cy;

    try {
      cy.fit(undefined, 80);
      cy.zoom(0.1);
      cy.center();
    } catch (error) {
      console.error('❌ Error recentering view:', error);
    }
  }

  private setupFullscreenListener(): void {
    document.addEventListener('fullscreenchange', () => {
      this.isFullscreen = !!document.fullscreenElement;
      this.handleFullscreenChange();
    });

    document.addEventListener('webkitfullscreenchange', () => {
      this.isFullscreen = !!(document as any).webkitFullscreenElement;
      this.handleFullscreenChange();
    });

    document.addEventListener('msfullscreenchange', () => {
      this.isFullscreen = !!(document as any).msFullscreenElement;
      this.handleFullscreenChange();
    });
  }

  private handleFullscreenChange(): void {
    const cy = this.getCytoscapeInstance();
    if (cy) {
      setTimeout(() => {
        cy.resize();
        cy.fit();
      }, 100);
    }

    // Hide tooltip when fullscreen state changes
    this.showTooltip = false;

    // Hide and reposition edge tooltip for fullscreen changes
    if (this.edgeTooltip) {
      this.hideEdgeTooltip();
      // Move tooltip to correct container for new fullscreen state
      setTimeout(() => {
        this.ensureTooltipInCorrectContainer();
      }, 100);
    }

    // Force layout recalculation to prevent overflow
    setTimeout(() => {
      const topologyContainer = document.querySelector(
        '.topology-container'
      ) as HTMLElement;
      if (topologyContainer) {
        topologyContainer.style.display = 'none';
        topologyContainer.offsetHeight; // Force reflow
        topologyContainer.style.display = 'flex';
      }
    }, 50);
  }

  showLegendTooltip(event: MouseEvent): void {
    this.showTooltip = true;
    let x = event.clientX + 10;
    let y = event.clientY - 10;
    const tooltipWidth = 350;
    const tooltipHeight = 400;

    if (x + tooltipWidth > window.innerWidth) {
      x = event.clientX - tooltipWidth - 10;
    }

    if (y + tooltipHeight > window.innerHeight) {
      y = event.clientY - tooltipHeight - 10;
    }

    x = Math.max(10, x);
    y = Math.max(10, y);

    this.tooltipX = x;
    this.tooltipY = y;
  }

  hideLegendTooltip(): void {
    this.showTooltip = false;
  }

  toggleLegend(): void {
    this.showLegend = !this.showLegend;
  }

  private extractAndLogUniqueDevices(): void {
    const uniqueDevices = new Map<
      string,
      {
        name: string;
        ip: string;
        type: string;
        vendor?: string;
        occurrences: number;
        interfaces: Set<string>;
      }
    >();

    this.fileData.forEach((row, index) => {
      try {
        // Extract Device A information
        const deviceANameField = row['Device A Name'];
        const deviceAIPField = row['Device A IP'];
        const deviceAType = row['Device A Type'] || row['Type A'];
        const deviceAVendor = row['Device A Vendor'] || row['Vendor A'];

        // Detect format: if "Device A Name" looks like an IP, columns are swapped
        const isSwappedFormat = this.isIPAddress(deviceANameField);

        let deviceAIP: string, deviceAName: string;
        if (isSwappedFormat) {
          deviceAIP = deviceANameField;
          deviceAName = deviceAIPField;
        } else {
          deviceAIP = deviceAIPField;
          deviceAName = deviceANameField;
        }

        // Extract Device B information
        const deviceBIP = row['Device B IP'];
        const deviceBName = row['Device b Name '];
        const deviceBType = row['Device B Type'] || row['Type B'];
        const deviceBVendor = row['Device B Vendor'] || row['Vendor B'];

        // Extract interface information
        const interfaceA = row['interface'];
        const interfaceB = row['interface_1'];

        // Process Device A
        if (deviceAIP && deviceAName) {
          const deviceAKey = deviceAIP;
          if (uniqueDevices.has(deviceAKey)) {
            const device = uniqueDevices.get(deviceAKey)!;
            device.occurrences++;
            // Add interface if it exists and is not empty
            if (interfaceA && interfaceA.trim() !== '') {
              device.interfaces.add(interfaceA.trim());
            }
          } else {
            const interfaceSet = new Set<string>();
            if (interfaceA && interfaceA.trim() !== '') {
              interfaceSet.add(interfaceA.trim());
            }
            uniqueDevices.set(deviceAKey, {
              name: deviceAName,
              ip: deviceAIP,
              type: deviceAType || 'unknown',
              vendor: deviceAVendor,
              occurrences: 1,
              interfaces: interfaceSet,
            });
          }
        }

        // Process Device B
        if (deviceBIP && deviceBName) {
          const deviceBKey = deviceBIP;
          if (uniqueDevices.has(deviceBKey)) {
            const device = uniqueDevices.get(deviceBKey)!;
            device.occurrences++;
            // Add interface if it exists and is not empty
            if (interfaceB && interfaceB.trim() !== '') {
              device.interfaces.add(interfaceB.trim());
            }
          } else {
            const interfaceSet = new Set<string>();
            if (interfaceB && interfaceB.trim() !== '') {
              interfaceSet.add(interfaceB.trim());
            }
            uniqueDevices.set(deviceBKey, {
              name: deviceBName,
              ip: deviceBIP,
              type: deviceBType || 'unknown',
              vendor: deviceBVendor,
              occurrences: 1,
              interfaces: interfaceSet,
            });
          }
        }
      } catch (error) {
        console.warn(
          `Error processing row ${index} for device extraction:`,
          error
        );
      }
    });

    // Log the unique devices
    console.log('📊 UNIQUE DEVICES FOUND:');
    console.log('='.repeat(80));

    const sortedDevices = Array.from(uniqueDevices.values()).sort((a, b) => {
      // Sort by type first, then by name
      if (a.type !== b.type) {
        return a.type.localeCompare(b.type);
      }
      return a.name.localeCompare(b.name);
    });

    // Format devices in the requested array structure
    const formattedDevices = sortedDevices.map((device) => ({
      IP: device.ip || '',
      hostname: device.name || '',
      vendor: device.vendor || '',
      type: device.type || '',
      interfaces: Array.from(device.interfaces).sort(), // Real interfaces from data
    }));

    console.log('Devices Array:');
    console.log(JSON.stringify(formattedDevices, null, 2));

    // Also log individual devices for detailed view
    sortedDevices.forEach((device, index) => {
      console.log(`${index + 1}. Device: ${device.name}`);
      console.log(`   IP: ${device.ip}`);
      console.log(`   Type: ${device.type}`);
      if (device.vendor) {
        console.log(`   Vendor: ${device.vendor}`);
      }
      console.log(
        `   Interfaces: [${Array.from(device.interfaces).sort().join(', ')}]`
      );
      console.log(`   Occurrences: ${device.occurrences}`);
      console.log('-'.repeat(40));
    });

    // Summary statistics
    const deviceTypes = new Map<string, number>();
    const vendors = new Map<string, number>();

    sortedDevices.forEach((device) => {
      // Count device types
      const type = device.type || 'unknown';
      deviceTypes.set(type, (deviceTypes.get(type) || 0) + 1);

      // Count vendors
      if (device.vendor) {
        vendors.set(device.vendor, (vendors.get(device.vendor) || 0) + 1);
      }
    });

    console.log('📈 SUMMARY STATISTICS:');
    console.log('='.repeat(80));
    console.log(`Total unique devices: ${sortedDevices.length}`);
    console.log(
      `First device: ${
        sortedDevices.length > 0 ? sortedDevices[0].name : 'None'
      }`
    );
    console.log(
      `Total device occurrences: ${sortedDevices.reduce(
        (sum, d) => sum + d.occurrences,
        0
      )}`
    );

    console.log('\nDevice Types:');
    Array.from(deviceTypes.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count} devices`);
      });

    if (vendors.size > 0) {
      console.log('\nVendors:');
      Array.from(vendors.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([vendor, count]) => {
          console.log(`  ${vendor}: ${count} devices`);
        });
    }

    console.log('='.repeat(80));
  }

  public logUniqueDevices(): void {
    if (!this.fileData || this.fileData.length === 0) {
      console.log('⚠️ No file data available. Please import a file first.');
      return;
    }
    this.extractAndLogUniqueDevices();
  }

  private saveNetworkStateToBackend(): void {
    if (!this.hasNetworkData()) {
      return;
    }

    const positionsObj: { [nodeId: string]: any } = {};
    this.savedPositions.forEach((value, key) => {
      positionsObj[key] = value;
    });

    const deviceStatusObj: { [deviceId: string]: string } = {};
    this.deviceStatusMap.forEach((value, key) => {
      deviceStatusObj[key] = value;
    });

    const deviceTypesObj: { [deviceId: string]: string } = {};
    this.deviceTypeMap.forEach((value, key) => {
      deviceTypesObj[key] = value;
    });

    const connectionMapObj: { [connectionId: string]: any } = {};
    this.connectionMap.forEach((value, key) => {
      connectionMapObj[key] = value;
    });
  }

  // private saveDevicePositionsToBackend(): void {
  //   if (this.savedPositions.size === 0) {
  //     console.log('⚠️ No positions to save to backend');
  //     return;
  //   }

  //   // ✅ FIX: Filter out invalid positions before sending to backend
  //   const positionsObj: { [nodeId: string]: any } = {};
  //   let validPositionsCount = 0;

  //   this.savedPositions.forEach((value, key) => {
  //     // Only save valid positions (not default 0,0 and not NaN/Infinity)
  //     if (this.isValidPosition(value)) {
  //       positionsObj[key] = value;
  //       validPositionsCount++;
  //     } else {
  //       console.log(`⚠️ Skipping invalid position for ${key}:`, value);
  //     }
  //   });

  //   if (validPositionsCount === 0) {
  //     console.log('⚠️ No valid positions to save to backend');
  //     return;
  //   }

  //   console.log(
  //     `💾 Saving ${validPositionsCount} valid positions to backend...`
  //   );

  //   this.networkApiService.saveDevicePositions(positionsObj).subscribe({
  //     next: (response) => {
  //       if (response.success) {
  //         this.toastService.success(
  //           'Device positions saved successfully!',
  //           3000
  //         );
  //       } else {
  //         console.error(
  //           '❌ Failed to save device positions to backend:',
  //           response.message
  //         );
  //         this.toastService.error(
  //           `Failed to save positions: ${response.message}`,
  //           5000
  //         );
  //       }
  //     },
  //     error: (error) => {
  //       console.error('❌ Error saving device positions to backend:', error);
  //       this.toastService.error('Error saving device positions.', 5000);
  //     },
  //   });
  // }

  private saveDeviceStatusesToBackend(): void {
    if (this.deviceStatusMap.size === 0) {
      return;
    }

    const deviceStatusObj: { [deviceId: string]: string } = {};
    this.deviceStatusMap.forEach((value, key) => {
      deviceStatusObj[key] = value;
    });
  }

  private saveDeviceTypesToBackend(): void {
    if (this.deviceTypeMap.size === 0) {
      return;
    }

    const deviceTypesObj: { [deviceId: string]: string } = {};
    this.deviceTypeMap.forEach((value, key) => {
      deviceTypesObj[key] = value;
    });
  }

  // public saveAllNetworkDataToBackend(): void {
  //   // this.saveNetworkStateToBackend();
  //   this.saveDevicePositionsToBackend();
  //   // this.saveDeviceStatusesToBackend();
  //   // this.saveDeviceTypesToBackend();
  // }

  public saveAllPositions(): void {
    if (this.savedPositions.size === 0) {
      console.log('⚠️ No positions to save');
      this.toastService.warning(
        'No positions to save. Move some devices first.',
        3000
      );
      return;
    }

    // ✅ FIX: Enhanced position validation and logging
    const positionsObj: { [nodeId: string]: any } = {};
    let validPositionsCount = 0;
    let devicePositions = 0;
    let blockPositions = 0;

    this.savedPositions.forEach((value, key) => {
      if (this.isValidPosition(value)) {
        positionsObj[key] = value;
        validPositionsCount++;

        // ✅ FIX: Track device vs block positions
        if (this.isIPAddress(key)) {
          devicePositions++;
        } else {
          blockPositions++;
        }
      } else {
        console.log(`⚠️ Skipping invalid position for ${key}:`, value);
      }
    });

    if (validPositionsCount === 0) {
      console.log('⚠️ No valid positions to save');
      this.toastService.warning(
        'No valid positions to save. All positions are invalid.',
        4000
      );
      return;
    }

    console.log(
      `💾 Manual save triggered: ${validPositionsCount} valid positions (${devicePositions} devices, ${blockPositions} blocks)`
    );

    this.networkApiService.saveDevicePositions(positionsObj).subscribe({
      next: (response) => {
        if (response.success) {
          console.log(
            `✅ Manual save successful: ${validPositionsCount} positions saved`
          );
          this.toastService.success(
            `Successfully saved device positions!`,
            2000
          );

          // ✅ FIX: Clear saved positions after successful save
          // This will disable the save button until new positions are changed
          // Note: We keep localStorage for recovery but clear the pending changes
          console.log('🧹 Clearing saved positions after successful save');
          // Don't clear savedPositions completely as they're needed for positioning
          // Instead, we'll track this differently in future if needed
        } else {
          console.error('❌ Manual save failed:', response.message);
          this.toastService.error(
            `Failed to save positions: ${response.message}`,
            5000
          );
        }
      },
      error: (error) => {
        console.error('❌ Error during manual save:', error);
        this.toastService.error(
          'Error saving device positions. Please try again.',
          5000
        );
      },
    });
  }

  checkPermission(): void {
    this.networkApiService.permissionCheck().subscribe({
      next: (response) => {
        console.log('Permission check response:', response);
        this.permission = response.permission;
      },
      error: (error) => {
        console.error('Error checking permission:', error);
        this.permission = false;
      },
    });
  }

  // ✅ FIX: Manual save only - automatic saving disabled
  // Positions are only saved when user clicks "Save Positions" button

  // Helper method to check if there are unsaved positions
  public hasUnsavedPositions(): boolean {
    return this.savedPositions.size > 0;
  }

  // Helper method to get count of unsaved positions
  public getUnsavedPositionsCount(): number {
    let validCount = 0;
    this.savedPositions.forEach((pos) => {
      if (this.isValidPosition(pos)) validCount++;
    });
    return validCount;
  }
}
