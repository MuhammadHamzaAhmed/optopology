import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import cytoscape from 'cytoscape';
import {
  NetworkApiService,
  DashboardTopologyResponse,
} from '../services/network-api.service';

interface NetworkNode {
  id: string;
  label: string;
  type: string;
  parent?: string;
  position?: { x: number; y: number };
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
  position?: { x: number; y: number };
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

@Component({
  selector: 'view-network-topology',
  templateUrl: './view-network-topology.component.html',
  styleUrls: ['./view-network-topology.component.css'],
})
export class ViewNetworkTopologyComponent implements AfterViewInit, OnDestroy {
  @ViewChild('cy', { static: false }) cyContainer!: ElementRef;

  // Default zoom level for better overview (more zoomed out)
  private readonly DEFAULT_ZOOM_LEVEL: number = 0.1;

  isFullscreen: boolean = false;
  private autoRefreshInterval: any;
  public autoRefreshCountdown: number = 120; // Countdown in seconds
  public Math = Math; // Make Math available in template
  public isLoadingData: boolean = false;
  showLegend: boolean = false; // Legend panel visibility state
  showTooltip: boolean = false;
  tooltipX: number = 0;
  tooltipY: number = 0;
  public lastUpdatedTime: string = '';
  permission: boolean = false; // Add permission property
  public loadFailed: boolean = false; // Track last load failure state
  private isSilentRefreshing: boolean = false; // Prevent overlapping silent refreshes

  get shouldShowUI(): boolean {
    return this.hasNetworkData();
  }

  get networkDataCounts(): { nodes: number; edges: number } {
    return {
      nodes: this.networkData?.nodes?.length || 0,
      edges: this.networkData?.edges?.length || 0,
    };
  }

  hasNetworkData(): boolean {
    return (
      this.networkData &&
      (this.networkData.nodes.length > 0 || this.networkData.edges.length > 0)
    );
  }

  hasLocalStorageData(): boolean {
    try {
      const storedData = localStorage.getItem('network-topology-state');
      return (
        storedData !== null && storedData !== undefined && storedData !== ''
      );
    } catch (error) {
      console.warn('Error checking localStorage:', error);
      return false;
    }
  }

  private networkData: NetworkData = {
    blocks: [],
    nodes: [],
    edges: [],
  };

  public fileData: any[] = [];
  public fileName: string = '';

  private deviceStatusMap: Map<string, 'on' | 'off'> = new Map();
  private savedPositions: Map<string, { x: number; y: number }> = new Map();
  private connectionMap: Map<string, any> = new Map();
  private edgeTooltip: HTMLElement | null = null;
  private deviceTooltip: HTMLElement | null = null;
  private blinkingIndicators: Map<
    string,
    {
      element: HTMLElement;
      nodeHandler?: () => void;
      panZoomHandler?: () => void;
    }
  > = new Map();

  constructor(
    private router: Router,
    private networkApiService: NetworkApiService
  ) {
    console.log('🔍 Constructor: Initial isFullscreen:', this.isFullscreen);

    // Start auto-refresh interval (every 2 minutes) - delayed to prevent immediate calls
    setTimeout(() => {
      this.startAutoRefresh();
    }, 5000); // Start auto-refresh after 5 seconds

    // Setup fullscreen change listener
    this.setupFullscreenListener();

    // Check permission on component initialization
    this.checkPermission();

    console.log(
      '🔍 Constructor: After setupFullscreenListener, isFullscreen:',
      this.isFullscreen
    );
  }

  ngAfterViewInit(): void {
    setTimeout(async () => {
      try {
        if (!this.cyContainer?.nativeElement) {
          return;
        }

        if (!this.isLoadingData) {
          await this.loadNetworkData();
        }

        const cy = cytoscape({
          container: this.cyContainer.nativeElement,
          elements: this.convertToCytoscapeElements(),
          layout: {
            name: 'preset',
            animate: false,
            fit: true,
            padding: 120,
          },
          style: [...this.getNodeStyles(), ...this.getEdgeStyles()],
        });

        this.cyContainer.nativeElement._cy = cy;

        // Status indicator styles and initial render
        this.ensureStatusIndicatorStyles();

        // Wait for Cytoscape to be fully ready before creating indicators
        cy.ready(() => {
          console.log(
            '🎯 Cytoscape is ready, initializing status indicators...'
          );

          // Initialize status indicators after Cytoscape is ready
          this.initializeBlinkingForAllDevices();

          // Pan/zoom reposition for indicators
          cy.on('zoom pan viewport', () => {
            this.blinkingIndicators.forEach((_, nodeId) => {
              this.updateStatusIndicatorPosition(nodeId);
            });
          });

          // Apply positioning logic after layout
          setTimeout(() => {
            this.ensureBlocksArePositioned(cy);
            setTimeout(() => {
              this.positionDevicesWithinBlocks(cy);
              // Ensure status indicators are properly positioned after layout
              this.refreshStatusIndicators();
              // Attach hover event handlers after elements are loaded
              this.attachHoverEventHandlers(cy);
              // Ensure proper overview after layout
              cy.fit(undefined, 200);
              cy.zoom(this.DEFAULT_ZOOM_LEVEL);

              // Final check to ensure all indicators are visible
              setTimeout(() => {
                this.ensureAllIndicatorsVisible();
              }, 500);
            }, 100);
          }, 50);
        });

        cy.zoomingEnabled(true);
        cy.userZoomingEnabled(true);
        cy.panningEnabled(true);
        cy.userPanningEnabled(true);

        cy.minZoom(0.1);
        cy.maxZoom(2.0);

        // Completely disable drag and drop functionality
        this.disableDragAndDrop(cy);

        cy.resize();
        // Set initial zoom for better overview with more padding
        cy.fit(undefined, 200); // Increased padding for better overview
        cy.zoom(this.DEFAULT_ZOOM_LEVEL);
      } catch (error) {
        console.error('Error initializing Cytoscape:', error);
      }
    }, 200);
  }

  ngOnDestroy(): void {
    // Clean up auto-refresh interval
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
    }

    // Clean up tooltips
    if (this.edgeTooltip && this.edgeTooltip.parentNode) {
      this.edgeTooltip.parentNode.removeChild(this.edgeTooltip);
      this.edgeTooltip = null;
    }
    if (this.deviceTooltip && this.deviceTooltip.parentElement) {
      this.deviceTooltip.parentElement.removeChild(this.deviceTooltip);
      this.deviceTooltip = null;
    }

    // Clean up blinking indicators
    Array.from(this.blinkingIndicators.keys()).forEach((nodeId) => {
      this.stopBlinkingIndicator(nodeId);
    });
    this.blinkingIndicators.clear();

    // Clean up maps
    this.connectionMap.clear();
    this.deviceStatusMap.clear();
    this.savedPositions.clear();
  }

  async loadNetworkData(silent: boolean = false) {
    console.log('Silent____:', silent);
    // Prevent overlapping loads
    if (silent) {
      if (this.isSilentRefreshing || this.isLoadingData) {
        console.log('Silent mode: Overlapping loads prevented');
        return;
      }
      this.isSilentRefreshing = true;
    } else {
      if (this.isLoadingData) {
        return;
      }
      this.isLoadingData = true;
      this.loadFailed = false;
    }

    try {
      this.networkApiService.getDashboardTopology().subscribe({
        next: (response: any) => {
          if (response.success && response.data) {
            if (!silent) {
              this.loadFailed = false;
            }
            // Update network data from API response
            this.networkData = response.data.networkData || this.networkData;

            // Update positions from API response
            if (response.data.positions) {
              // Clear existing positions and update with API positions
              this.savedPositions.clear();
              Object.entries(response.data.positions).forEach(
                ([nodeId, position]) => {
                  this.savedPositions.set(
                    nodeId,
                    position as { x: number; y: number }
                  );
                }
              );
            }

            // Update device status map if available
            if (response.data.deviceStatus) {
              this.deviceStatusMap.clear();
              Object.entries(response.data.deviceStatus).forEach(
                ([deviceId, status]) => {
                  const normalized = String(status).toLowerCase();
                  if (normalized === 'on' || normalized === 'off') {
                    this.deviceStatusMap.set(
                      deviceId,
                      normalized as 'on' | 'off'
                    );
                  }
                }
              );
            }

            // Update connection map if available
            if (response.data.connectionMap) {
              this.connectionMap.clear();
              Object.entries(response.data.connectionMap).forEach(
                ([edgeId, connectionData]) => {
                  this.connectionMap.set(edgeId, connectionData);
                }
              );
            }

            // Update last updated time
            this.lastUpdatedTime = new Date().toLocaleString('en-US', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            });

            // If we have a Cytoscape instance, update it with new data
            const cy = this.getCytoscapeInstance();
            if (cy) {
              this.updateCytoscapeWithNewData(cy);
              // Ensure status indicators render after data/status load
              this.refreshStatusIndicators();
              // Ensure drag and drop remains disabled
              this.disableDragAndDrop(cy);
              // Re-attach hover event handlers after data update
              this.attachHoverEventHandlers(cy);

              // Handle page reload scenario - ensure indicators are visible
              if (this.isPageReload()) {
                setTimeout(() => {
                  this.handlePageReloadIndicators();
                }, 1000);
              }
            }
          }
        },
        error: (error) => {
          console.error('Error loading network data:', error);
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
      console.error('Error loading network data:', error);
      if (silent) {
        this.isSilentRefreshing = false;
      } else {
        this.isLoadingData = false;
      }
    }
  }

  private isPageReload(): boolean {
    // Check if this is a page reload by looking for performance navigation type
    if (performance.navigation) {
      return performance.navigation.type === performance.navigation.TYPE_RELOAD;
    }

    // Fallback: check if we have stored data but no current indicators
    return this.hasLocalStorageData() && this.blinkingIndicators.size === 0;
  }

  private handlePageReloadIndicators(): void {
    console.log(
      '🔄 Handling page reload - ensuring status indicators are visible...'
    );

    // Force refresh all indicators
    this.forceRefreshStatusIndicators();

    // Double-check visibility after a delay
    setTimeout(() => {
      const indicators = this.getStatusIndicatorsInfo();
      console.log(
        `📊 Page reload check: ${indicators.visibleIndicators}/${indicators.totalIndicators} indicators visible`
      );

      if (indicators.visibleIndicators < indicators.totalIndicators) {
        console.log('🔄 Some indicators still hidden, attempting final fix...');
        this.ensureAllIndicatorsVisible();
      }
    }, 500);
  }

  private convertToCytoscapeElements(): any[] {
    const elements: any[] = [];

    // Add blocks with positioning logic
    this.networkData.blocks.forEach((block) => {
      const hasChildren = this.networkData.nodes.some(
        (n) => (n.parent || '').trim() === block.id
      );
      if (!hasChildren) {
        return;
      }

      const blockElement: any = { data: { id: block.id, label: block.label } };

      // Use position from savedPositions map (API positions)
      const savedPosition = this.savedPositions.get(block.id);
      if (savedPosition && this.isValidPosition(savedPosition)) {
        blockElement.position = savedPosition;
      }

      elements.push(blockElement);
    });

    // Add nodes with positioning logic
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

      if (typeof node.parent === 'string' && node.parent.trim().length > 0) {
        nodeData.parent = node.parent;
      }

      const nodeElement: any = { data: nodeData };

      // Use position from savedPositions map (API positions)
      const savedPosition = this.savedPositions.get(nodeId);
      if (savedPosition && this.isValidPosition(savedPosition)) {
        nodeElement.position = savedPosition;
      }

      elements.push(nodeElement);
    });

    // Add edges
    this.networkData.edges.forEach((edge) => {
      const sourceId = (edge.source ?? '').toString().trim();
      const targetId = (edge.target ?? '').toString().trim();
      if (!sourceId || !targetId) {
        return;
      }

      const edgeData: any = {
        source: sourceId,
        target: targetId,
        speed: edge.speed,
        status: edge.status,
        type: edge.type,
      };

      // Add metadata from edge if available
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

      // Add connection data from connectionMap if available
      const connectionId = this.createConnectionId(sourceId, targetId);
      if (this.connectionMap.has(connectionId)) {
        const connectionData = this.connectionMap.get(connectionId);
        edgeData.speedColor = connectionData.speedColor;
        edgeData.speedStatus = connectionData.speedStatus;
        edgeData.speedPercentage = connectionData.speedPercentage;
        edgeData.inSpeed = connectionData.inSpeed;
        edgeData.outSpeed = connectionData.outSpeed;
        edgeData.capacity = connectionData.capacity;
      }

      elements.push({ data: edgeData });
    });

    return elements;
  }

  // Predefined block styles mapping
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
      'background-color': '#ffe0e0',
      'background-opacity': 0.15,
      'border-color': '#e74c3c',
      'border-width': 2,
      'border-opacity': 0.8,
      'corner-radius': 16,
      margin: '0px',
      padding: '120px',
    },
  };

  private getNodeStyles(): any[] {
    const textColor = '#ffffff';

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

    // Dynamically add styles for blocks from backend
    const blockStyles = this.generateDynamicBlockStyles();

    return [...baseStyles, ...blockStyles];
  }

  // Generate dynamic block styles based on networkData.blocks
  private generateDynamicBlockStyles(): any[] {
    const blockStyles: any[] = [];

    // Get unique block IDs from networkData
    const blockIds = this.networkData.blocks.map((block) => block.id);

    blockIds.forEach((blockId) => {
      // Check if we have predefined styles for this block
      if (this.blockStylesMap[blockId]) {
        blockStyles.push({
          selector: `node[id = "${blockId}"]`,
          style: this.blockStylesMap[blockId],
        });
      } else {
        // Generate default style for unknown blocks
        const defaultBlockStyle = this.generateDefaultBlockStyle(blockId);
        blockStyles.push({
          selector: `node[id = "${blockId}"]`,
          style: defaultBlockStyle,
        });
      }
    });

    return blockStyles;
  }

  // Generate default style for blocks not in the predefined map
  private generateDefaultBlockStyle(blockId: string): any {
    // Generate a color based on block ID hash for consistency
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

  // Simple hash function to generate consistent colors for block IDs
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  private getEdgeStyles(): any[] {
    return [
      {
        selector: 'edge',
        style: {
          'curve-style': 'bezier',
          label: '',
          width: 2,
          'line-color': '#4caf50',
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
    ];
  }

  private startAutoRefresh(): void {
    this.autoRefreshCountdown = 120;
    const countdownInterval = setInterval(() => {
      this.autoRefreshCountdown--;
      if (this.autoRefreshCountdown <= 0) {
        this.autoRefreshCountdown = 120;
      }
    }, 1000);

    this.autoRefreshInterval = setInterval(() => {
      try {
        console.log(
          '🔄 Auto-refresh triggered - loading network data silently'
        );
        this.loadNetworkData(true);
        this.autoRefreshCountdown = 120;
      } catch (error) {
        console.error('❌ Auto-refresh failed:', error);
        this.autoRefreshCountdown = 120;
      }
    }, 120000);
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

  public isInFullscreenMode(): boolean {
    return this.isFullscreen;
  }

  public getFullscreenState(): {
    isFullscreen: boolean;
    documentFullscreen: boolean;
    webkitFullscreen: boolean;
    msFullscreen: boolean;
  } {
    return {
      isFullscreen: this.isFullscreen,
      documentFullscreen: !!document.fullscreenElement,
      webkitFullscreen: !!(document as any).webkitFullscreenElement,
      msFullscreen: !!(document as any).msFullscreenElement,
    };
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
      cy.zoom(this.DEFAULT_ZOOM_LEVEL);
      cy.center();
    } catch (error) {
      console.error('❌ Error recentering view:', error);
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
      cy.zoom(this.DEFAULT_ZOOM_LEVEL);
    }
  }

  private setupFullscreenListener(): void {
    console.log('🔍 setupFullscreenListener called');

    // Initialize to false and only update on actual fullscreen changes
    this.isFullscreen = false;
    console.log('🔍 Initialized isFullscreen to false');

    document.addEventListener('fullscreenchange', () => {
      console.log('🔍 Fullscreen change event fired');
      this.isFullscreen = !!document.fullscreenElement;
      console.log('🔍 Updated isFullscreen to:', this.isFullscreen);
      this.handleFullscreenChange();
    });

    document.addEventListener('webkitfullscreenchange', () => {
      console.log('🔍 Webkit fullscreen change event fired');
      this.isFullscreen = !!(document as any).webkitFullscreenElement;
      console.log('🔍 Updated isFullscreen to:', this.isFullscreen);
      this.handleFullscreenChange();
    });

    document.addEventListener('msfullscreenchange', () => {
      console.log('🔍 MS fullscreen change event fired');
      this.isFullscreen = !!(document as any).msFullscreenElement;
      console.log('🔍 Updated isFullscreen to:', this.isFullscreen);
      this.handleFullscreenChange();
    });

    console.log(
      '🔍 setupFullscreenListener completed, isFullscreen:',
      this.isFullscreen
    );
  }

  private handleFullscreenChange(): void {
    const cy = this.getCytoscapeInstance();
    if (cy) {
      setTimeout(() => {
        cy.resize();
        cy.fit();
        cy.zoom(this.DEFAULT_ZOOM_LEVEL);
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

  private getCytoscapeInstance(): any {
    const cyElement = this.cyContainer?.nativeElement;
    return cyElement && cyElement._cy ? cyElement._cy : null;
  }

  public toggleLegend(): void {
    console.log('🔍 toggleLegend called, current showLegend:', this.showLegend);
    this.showLegend = !this.showLegend;
    console.log('🔍 toggleLegend updated showLegend to:', this.showLegend);
  }

  public getLegendData(): Array<{
    type: string;
    label: string;
    icon: string;
    description: string;
  }> {
    return [
      {
        type: 'firewall',
        label: 'Firewall',
        icon: '🛡️',
        description: 'Network security device',
      },
      {
        type: 'switch',
        label: 'Switch',
        icon: '🔌',
        description: 'Network switching device',
      },
      {
        type: 'core_switch',
        label: 'Core Switch',
        icon: '🔌',
        description: 'Core network switch',
      },
      {
        type: 'router',
        label: 'Router',
        icon: '🌐',
        description: 'Network routing device',
      },
      {
        type: 'server',
        label: 'Server',
        icon: '🖥️',
        description: 'Network server',
      },
      {
        type: 'internet',
        label: 'Internet',
        icon: '🌍',
        description: 'Internet connection',
      },
      {
        type: 'ext_switch',
        label: 'External Switch',
        icon: '🔌',
        description: 'External network switch',
      },
      {
        type: 'ips',
        label: 'IPS',
        icon: '🛡️',
        description: 'Intrusion Prevention System',
      },
      {
        type: 'proxy',
        label: 'Proxy',
        icon: '🔒',
        description: 'Proxy server',
      },
      {
        type: 'isp',
        label: 'ISP',
        icon: '🌍',
        description: 'Internet Service Provider',
      },
    ];
  }

  private updateCytoscapeWithNewData(cy: any): void {
    console.log('🔄 updateCytoscapeWithNewData called');

    // Clear existing elements
    cy.elements().remove();

    // Add new elements from updated network data
    const elements = this.convertToCytoscapeElements();
    cy.add(elements);

    // Update styles to include dynamic blocks from backend
    cy.style([...this.getNodeStyles(), ...this.getEdgeStyles()]);

    // Re-disable drag and drop after adding new elements
    this.disableDragAndDrop(cy);

    // ✅ FIX: Only apply positioning logic if nodes don't have saved positions
    // This prevents position changes during auto-refresh when positions are already saved
    const nodesWithSavedPositions = this.networkData.nodes.filter((node) => {
      const savedPosition = this.savedPositions.get(node.id);
      return savedPosition && this.isValidPosition(savedPosition);
    });

    const blocksWithSavedPositions = this.networkData.blocks.filter((block) => {
      const savedPosition = this.savedPositions.get(block.id);
      return savedPosition && this.isValidPosition(savedPosition);
    });

    const totalNodes = this.networkData.nodes.length;
    const totalBlocks = this.networkData.blocks.length;
    const nodesWithPositions = nodesWithSavedPositions.length;
    const blocksWithPositions = blocksWithSavedPositions.length;

    console.log(
      `📍 Position status: ${nodesWithPositions}/${totalNodes} nodes, ${blocksWithPositions}/${totalBlocks} blocks have saved positions`
    );

    // Apply positioning logic only if we have significant missing positions
    // Allow for some tolerance (e.g., 80% of elements should have positions)
    const nodePositionRatio =
      totalNodes > 0 ? nodesWithPositions / totalNodes : 1;
    const blockPositionRatio =
      totalBlocks > 0 ? blocksWithPositions / totalBlocks : 1;

    const shouldSkipPositioning =
      nodePositionRatio >= 0.8 && blockPositionRatio >= 0.8;

    if (!shouldSkipPositioning) {
      console.log(
        '🎯 Applying positioning logic (insufficient saved positions)'
      );
      setTimeout(() => {
        this.ensureBlocksArePositioned(cy);
        setTimeout(() => {
          this.positionDevicesWithinBlocks(cy);
          cy.fit(undefined, 100);
          cy.zoom(this.DEFAULT_ZOOM_LEVEL);
        }, 50);
      }, 10);
    } else {
      console.log('✅ Skipping positioning logic (sufficient saved positions)');
      // If we have saved positions, just apply fit and zoom without repositioning
      setTimeout(() => {
        cy.fit(undefined, 100);
        cy.zoom(this.DEFAULT_ZOOM_LEVEL);
      }, 10);
    }
  }

  public getConnectionStatusLegend(): Array<{
    status: string;
    label: string;
    color: string;
    description: string;
  }> {
    return [
      {
        status: 'good',
        label: 'Good',
        color: '#4caf50',
        description: 'Connection utilization < 50%',
      },
      {
        status: 'normal',
        label: 'Normal',
        color: '#2196f3',
        description: 'Connection utilization 50-70%',
      },
      {
        status: 'warning',
        label: 'Warning',
        color: '#ff9800',
        description: 'Connection utilization 70-90%',
      },
      {
        status: 'critical',
        label: 'Critical',
        color: '#f44336',
        description: 'Connection utilization > 90%',
      },
      {
        status: 'down',
        label: 'Down',
        color: '#ff0000',
        description: 'Connection is down',
      },
    ];
  }

  public getDeviceStatusCount(status: 'on' | 'off'): number {
    let count = 0;
    this.deviceStatusMap.forEach((deviceStatus) => {
      if (deviceStatus === status) {
        count++;
      }
    });
    return count;
  }

  public getTotalDeviceCount(): number {
    return this.deviceStatusMap.size;
  }

  public getDeviceStatusPercentage(status: 'on' | 'off'): number {
    const total = this.getTotalDeviceCount();
    if (total === 0) return 0;
    const count = this.getDeviceStatusCount(status);
    return Math.round((count / total) * 100);
  }

  public getSpeedStatusCounts(): {
    down: number;
    critical: number;
    warning: number;
    normal: number;
    good: number;
    total: number;
  } {
    const cy = this.getCytoscapeInstance();
    if (!cy) {
      return {
        down: 0,
        critical: 0,
        warning: 0,
        normal: 0,
        good: 0,
        total: 0,
      };
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

    return {
      down,
      critical,
      warning,
      normal,
      good,
      total: edges.length,
    };
  }

  public showLegendTooltip(event: MouseEvent): void {
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

  public hideLegendTooltip(): void {
    this.showTooltip = false;
  }

  public refreshFromBackend(): void {
    if (this.isLoadingData || this.isSilentRefreshing) {
      return;
    }

    console.log('🔄 Manual refresh triggered - loading network data silently');

    // ✅ FIX: Use silent mode to prevent showing the loader overlay
    // This provides a smoother user experience when manually refreshing
    this.loadNetworkData(true); // Silent mode - no loader

    // Show a subtle indication that refresh is happening
    console.log('🔄 Refreshing topology data silently...');

    if (this.isAutoRefreshActive()) {
      this.autoRefreshCountdown = 120;
    }
  }

  public goToTopologyData(): void {
    this.router.navigate(['/topology-data']);
  }
  public goToTopology(): void {
    this.router.navigate(['/edit-network-topology']);
  }

  public goToExcelTable(): void {
    this.router.navigate(['/topology-data']);
  }

  public clearData(): void {
    // Clear network data
    this.networkData = {
      blocks: [],
      nodes: [],
      edges: [],
    };

    // Clear maps
    this.deviceStatusMap.clear();
    this.savedPositions.clear();
    this.connectionMap.clear();

    // Clear blinking indicators
    Array.from(this.blinkingIndicators.keys()).forEach((nodeId) => {
      this.stopBlinkingIndicator(nodeId);
    });
    this.blinkingIndicators.clear();

    // Clear localStorage
    try {
      localStorage.removeItem('network-topology-state');
    } catch (error) {
      console.warn('Error clearing localStorage:', error);
    }

    // Reinitialize the view
    const cy = this.getCytoscapeInstance();
    if (cy) {
      this.updateCytoscapeWithNewData(cy);
    }
  }

  public onFileSelect(event: any): void {
    // This method is for file selection but in view mode we don't process files
    console.log('File selection not supported in view mode');
  }

  private isFirstTimeVisit(): boolean {
    // Check if this is the first time loading data
    return (
      this.networkData.nodes.length === 0 &&
      this.networkData.blocks.length === 0
    );
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

  private generateSafePosition(
    cy: any,
    nodeId: string,
    preferredParent?: string
  ): { x: number; y: number } {
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

    // Generate random position within viewport
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
    let newPosition: { x: number; y: number };
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
      // Fallback to grid-based positioning
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

  private positionDevicesWithinBlocks(cy: any): void {
    const blocks = cy.nodes(':parent');

    blocks.forEach((block: any) => {
      const children = block.children().filter((node: any) => !node.isParent());

      if (children.length === 0) return;

      children.forEach((device: any) => {
        const deviceId = device.id();
        const currentPos = device.position();

        // ✅ FIX: Always prioritize saved positions from API
        const savedPosition = this.savedPositions.get(deviceId);

        if (savedPosition && this.isValidPosition(savedPosition)) {
          // Always use position from API if it exists and is valid
          device.position(savedPosition);
        } else if (!currentPos || (currentPos.x === 0 && currentPos.y === 0)) {
          // Only apply auto-positioning if no valid position exists at all
          const blockPos = block.position();
          const deviceSpacing = 80;
          const maxDevicesPerRow = 4;

          const siblings = children.filter(
            (sibling: any) => sibling.id() !== deviceId
          );
          const index = siblings.length;
          const row = Math.floor(index / maxDevicesPerRow);
          const col = index % maxDevicesPerRow;
          const totalRows = Math.ceil((children.length + 1) / maxDevicesPerRow);

          const deviceX =
            blockPos.x + (col - (maxDevicesPerRow - 1) / 2) * deviceSpacing;
          const deviceY =
            blockPos.y + (row - (totalRows - 1) / 2) * deviceSpacing;

          device.position({ x: deviceX, y: deviceY });
        }
        // ✅ FIX: If device has a valid current position and no saved position,
        // don't change it (prevents unnecessary repositioning)
      });
    });

    cy.forceRender();
  }

  private ensureBlocksArePositioned(cy: any): void {
    // Remove empty blocks (no child devices) before positioning
    cy.nodes(':parent').forEach((block: any) => {
      if (block.children().filter((n: any) => !n.isParent()).length === 0) {
        cy.remove(block);
      }
    });

    // Only position blocks that don't have valid positions from API
    const compounds = cy.nodes(':parent');

    compounds.forEach((block: any) => {
      const currentPos = block.position();
      const blockId = block.id();

      // ✅ FIX: Be more strict about when to apply positioning
      // Check for position in savedPositions map (API positions) first
      const savedPosition = this.savedPositions.get(blockId);

      if (savedPosition && this.isValidPosition(savedPosition)) {
        // Always use the position from API if it exists and is valid
        block.position(savedPosition);
      } else if (!currentPos || (currentPos.x === 0 && currentPos.y === 0)) {
        // Only apply auto-positioning if no valid position exists at all
        console.log(
          `No saved position found for block ${blockId}, keeping current position or using default`
        );
      }
    });

    cy.forceRender();
  }

  // Tooltip methods
  private getTooltipContainer(): HTMLElement {
    return document.body;
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

      const appendTarget = this.getTooltipContainer();
      appendTarget.appendChild(this.edgeTooltip);
    }

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

    const offsetX = 15;
    const offsetY = -35;

    const tooltipWidth = this.edgeTooltip.offsetWidth || 200;
    const tooltipHeight = this.edgeTooltip.offsetHeight || 60;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

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

  private highlightHoveredEdge(hoveredEdge: any): void {
    console.log('🎯 Starting edge highlighting for:', hoveredEdge.id());

    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) {
      console.log('❌ Cytoscape not ready for edge highlighting');
      return;
    }

    const cy = cyElement._cy;
    const allEdges = cy.edges();
    const allNodes = cy.nodes().filter((n: any) => !n.isParent());

    console.log(
      `📊 Found ${allEdges.length} edges and ${allNodes.length} nodes to process`
    );

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
      width: 8,
      'z-index': 999,
      opacity: 1,
      'line-color': originalColor,
      'line-style': 'solid',
      'line-cap': 'round',
      'line-join': 'round',
      'shadow-blur': 10,
      'shadow-color': originalColor,
      'shadow-opacity': 0.8,
      'shadow-offset-x': 0,
      'shadow-offset-y': 0,
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
      sourceNode.style({
        opacity: 1,
        'z-index': 998,
      });
    }
  }

  private highlightHoveredNode(hoveredNode: any): void {
    console.log('🎯 Starting node highlighting for:', hoveredNode.id());

    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) {
      console.log('❌ Cytoscape not ready for node highlighting');
      return;
    }

    const cy = cyElement._cy;
    const connectedEdges = hoveredNode.connectedEdges();
    const connectedNodes = hoveredNode.neighborhood().nodes();
    const allEdges = cy.edges();
    const allNodes = cy.nodes().filter((n: any) => !n.isParent());

    console.log(
      `📊 Node ${hoveredNode.id()} has ${
        connectedEdges.length
      } connected edges and ${connectedNodes.length} connected nodes`
    );
    console.log(
      `📊 Total elements: ${allEdges.length} edges, ${allNodes.length} nodes`
    );

    // Dim all edges
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
    console.log(`✅ Dimmed ${allEdges.length} edges`);

    // Dim unconnected nodes
    allNodes.forEach((n: any) => {
      if (n.id() !== hoveredNode.id() && !connectedNodes.has(n)) {
        n.addClass('dimmed-node');
        n.style({
          opacity: 0.3,
          'z-index': 1,
        });
      }
    });
    console.log(`✅ Dimmed unconnected nodes`);

    // Highlight connected edges
    connectedEdges.forEach((edge: any) => {
      edge.removeClass('dimmed-edge');
      edge.addClass('highlighted-edge');
      const originalColor = edge.data('speedColor') || '#000';
      edge.style({
        width: 6,
        'z-index': 998,
        opacity: 1,
        'line-color': originalColor,
        'line-style': 'solid',
        'line-cap': 'round',
        'line-join': 'round',
        'shadow-blur': 8,
        'shadow-color': originalColor,
        'shadow-opacity': 0.6,
        'shadow-offset-x': 0,
        'shadow-offset-y': 0,
      });
    });
    console.log(`✅ Highlighted ${connectedEdges.length} connected edges`);

    // Highlight connected nodes
    connectedNodes.forEach((connectedNode: any) => {
      connectedNode.removeClass('dimmed-node');
      connectedNode.style({
        opacity: 1,
        'z-index': 999,
      });
    });

    // Highlight the hovered node itself
    hoveredNode.removeClass('dimmed-node');
    hoveredNode.addClass('highlighted-node');
    hoveredNode.style({
      opacity: 1,
      'z-index': 1000,
      'border-width': '4px',
      'border-color': '#3498db',
      'border-opacity': 1,
      'border-style': 'solid',
      'shadow-blur': 15,
      'shadow-color': '#3498db',
      'shadow-opacity': 0.6,
      'shadow-offset-x': 0,
      'shadow-offset-y': 0,
    });

    console.log(
      `✅ Highlighted node: ${hoveredNode.id()} with ${
        connectedEdges.length
      } connections`
    );
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

    allNodes.forEach((node: any) => {
      node.removeClass('dimmed-node');
      node.style({
        opacity: 1,
        'z-index': 1,
      });
    });
  }

  private resetNodeHighlighting(): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) return;

    const cy = cyElement._cy;
    const allEdges = cy.edges();
    const allNodes = cy.nodes().filter((n: any) => !n.isParent());

    // Reset all edges to normal
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
        'line-cap': 'butt',
        'line-join': 'miter',
      });
    });

    // Reset all nodes to normal
    allNodes.forEach((node: any) => {
      node.removeClass('highlighted-node');
      node.removeClass('dimmed-node');
      node.style({
        opacity: 1,
        'z-index': 1,
        'border-width': 0,
        'border-color': 'transparent',
        'border-opacity': 0,
        'border-style': 'none',
      });
    });

    console.log('✅ Reset all node and edge highlighting');
  }

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

    const offsetX = 20;
    const offsetY = -20;

    const tooltipWidth = this.deviceTooltip.offsetWidth || 250;
    const tooltipHeight = this.deviceTooltip.offsetHeight || 100;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

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

  private generateEnhancedEdgeTooltip(edge: any): string {
    // Get edge data
    const inSpeed = edge.data('inSpeed');
    console.log('inSpeed', inSpeed);
    const outSpeed = edge.data('outSpeed');
    console.log('outSpeed', outSpeed);
    const speedPercentage = edge.data('speedPercentage');
    console.log('speedPercentage', speedPercentage);
    const speedStatus = edge.data('speedStatus');
    console.log('speedStatus', speedStatus);
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
    if (
      (inSpeed !== undefined && inSpeed !== null) ||
      (outSpeed !== undefined && outSpeed !== null) ||
      (capacity !== undefined && capacity !== null)
    ) {
      tooltipContent += `
      <div style="margin-top: 8px; padding: 8px; background: rgba(52, 73, 94, 0.3); border-radius: 6px;">
        <div style="font-size: 11px; color: #f39c12; font-weight: bold; margin-bottom: 6px;">
          📊 CONNECTION STATS
        </div>
    `;

      if (inSpeed !== undefined && inSpeed !== null) {
        tooltipContent += `
        <div style="margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; color: #ecf0f1;">In Speed:</span>
          <span style="font-size: 11px; color: #3498db; font-weight: 500;">${inSpeed}</span>
        </div>
      `;
      }
      if (outSpeed !== undefined && outSpeed !== null) {
        tooltipContent += `
        <div style="margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; color: #ecf0f1;">Out Speed:</span>
          <span style="font-size: 11px; color: #e74c3c; font-weight: 500;">${outSpeed}</span>
        </div>
      `;
      }

      if (capacity !== undefined && capacity !== null) {
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
    if (
      (inSpeed !== undefined && inSpeed !== null) ||
      (outSpeed !== undefined && outSpeed !== null) ||
      (capacity !== undefined && capacity !== null)
    ) {
      tooltipContent += `
      <div style="margin-top: 8px; padding: 8px; background: rgba(52, 73, 94, 0.3); border-radius: 6px;">
        <div style="font-size: 11px; color: #f39c12; font-weight: bold; margin-bottom: 6px;">
          📊 CONNECTION STATS
        </div>
    `;

      if (inSpeed !== undefined && inSpeed !== null) {
        tooltipContent += `
        <div style="margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; color: #ecf0f1;">In Speed:</span>
          <span style="font-size: 11px; color: #3498db; font-weight: 500;">${inSpeed}</span>
        </div>
      `;
      }
      if (outSpeed !== undefined && outSpeed !== null) {
        tooltipContent += `
        <div style="margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; color: #ecf0f1;">Out Speed:</span>
          <span style="font-size: 11px; color: #e74c3c; font-weight: 500;">${outSpeed}</span>
        </div>
      `;
      }

      if (capacity !== undefined && capacity !== null) {
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

  private createConnectionId(sourceId: string, targetId: string): string {
    // Create a consistent connection ID regardless of source/target order
    const sortedIds = [sourceId, targetId].sort();
    return `${sortedIds[0]}-${sortedIds[1]}`;
  }

  private attachHoverEventHandlers(cy: any): void {
    console.log('🔗 Attaching hover event handlers to Cytoscape...');

    try {
      // Remove any existing event handlers first
      cy.off('mouseover mouseout mousemove');

      // Add edge hover event handlers
      cy.on('mouseover', 'edge', (event: any) => {
        console.log('🔗 Edge hover detected:', event.target.id());
        this.showEdgeTooltip(event);
        this.highlightHoveredEdge(event.target);
      });

      cy.on('mouseout', 'edge', (event: any) => {
        console.log('🔗 Edge hover ended:', event.target.id());
        this.hideEdgeTooltip();
        this.resetEdgeHighlighting();
      });

      cy.on('mousemove', 'edge', (event: any) => {
        this.updateTooltipPosition(event);
      });

      // Add node hover event handlers
      cy.on('mouseover', 'node', (event: any) => {
        const node = event.target;
        if (!node.isParent()) {
          console.log('🖱️ Node hover detected:', node.id());
          this.showDeviceTooltip(event, node);
          this.highlightHoveredNode(node);
        }
      });

      cy.on('mouseout', 'node', (event: any) => {
        const node = event.target;
        if (!node.isParent()) {
          console.log('🖱️ Node hover ended:', node.id());
          this.hideDeviceTooltip();
          this.resetNodeHighlighting();
        }
      });

      console.log('✅ Hover event handlers attached successfully');

      // Test if events are working
      setTimeout(() => {
        this.testHoverEventBinding(cy);
      }, 1000);
    } catch (error) {
      console.error('❌ Error attaching hover event handlers:', error);
    }
  }

  private testHoverEventBinding(cy: any): void {
    console.log('🧪 Testing hover event binding...');

    // Check if we have elements
    const nodes = cy.nodes().filter((n: any) => !n.isParent());
    const edges = cy.edges();

    console.log(
      `📊 Found ${nodes.length} nodes and ${edges.length} edges for event testing`
    );

    if (nodes.length > 0) {
      console.log('🎯 Testing node event binding...');
      const firstNode = nodes.first();
      console.log(`🎯 First node: ${firstNode.id()} is ready for events`);
    }

    if (edges.length > 0) {
      console.log('🔗 Testing edge event binding...');
      const firstEdge = edges.first();
      console.log(`🔗 First edge: ${firstEdge.id()} is ready for events`);
    }
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
      width: 12px !important;
      height: 12px !important;
      border-radius: 50% !important;
      border: 2px solid white !important;
      box-shadow: 0 0 8px rgba(0, 0, 0, 0.8) !important;
      opacity: 1 !important;
      background-color: transparent !important;
    }
    .status-indicator.status-on { 
      background-color: #4caf50 !important; 
      border-color: #ffffff !important;
      box-shadow: 0 0 12px rgba(76, 175, 80, 0.8) !important;
    }
    .status-indicator.status-off { 
      background-color: #f44336 !important; 
      border-color: #ffffff !important;
      box-shadow: 0 0 12px rgba(244, 67, 54, 0.8) !important;
      animation: status-blink 1.2s ease-in-out infinite !important;
    }

    /* Enhanced hover highlighting styles */
    .highlighted-edge {
      transition: all 0.2s ease-in-out !important;
    }

    .highlighted-node {
      transition: all 0.2s ease-in-out !important;
    }

    .dimmed-edge {
      transition: all 0.3s ease-in-out !important;
    }

    .dimmed-node {
      transition: all 0.3s ease-in-out !important;
    }
    `;
    document.head.appendChild(style);
    console.log('✅ Status indicator styles added to document head');
  }

  private initializeBlinkingForAllDevices(): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) return;

    const cy = cyElement._cy;

    cy.nodes().forEach((node: any) => {
      const nodeId = node.id();
      const status = this.deviceStatusMap.get(nodeId);
      if (status === 'on' || status === 'off') {
        this.startBlinkingIndicator(nodeId, status);
      }
    });
  }

  private startBlinkingIndicator(nodeId: string, status: 'on' | 'off'): void {
    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) return;

    const cy = cyElement._cy;
    const node = cy.getElementById(nodeId);
    if (!node || node.length === 0) return;

    // Remove existing first
    this.stopBlinkingIndicator(nodeId);

    const indicator = document.createElement('div');
    indicator.className = `status-indicator status-${status}`;

    // Set initial styles to ensure visibility
    indicator.style.cssText = `
      position: absolute !important;
      z-index: 10000 !important;
      pointer-events: none !important;
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      width: 12px !important;
      height: 12px !important;
      border-radius: 50% !important;
      border: 2px solid white !important;
      box-shadow: 0 0 8px rgba(0, 0, 0, 0.8) !important;
      background-color: ${status === 'on' ? '#4caf50' : '#f44336'} !important;
    `;

    cyElement.style.position = 'relative';
    cyElement.appendChild(indicator);

    let positionUpdateAttempts = 0;
    const maxPositionAttempts = 5;

    const updatePosition = () => {
      try {
        const bb = node.renderedBoundingBox();
        if (bb && bb.w > 0 && bb.h > 0) {
          // Position indicator at top-right corner of the node
          const left = bb.x2 - 20;
          const top = bb.y1 - 10;

          indicator.style.left = `${left}px`;
          indicator.style.top = `${top}px`;

          // Ensure indicator is visible
          indicator.style.display = 'block';
          indicator.style.visibility = 'visible';
          indicator.style.opacity = '1';

          // Reset attempt counter on success
          positionUpdateAttempts = 0;

          console.log(
            `✅ Position updated for indicator ${nodeId}: (${left}, ${top})`
          );
        } else {
          // If bounding box is not available, try alternative positioning
          positionUpdateAttempts++;
          if (positionUpdateAttempts < maxPositionAttempts) {
            console.log(
              `🔄 Attempt ${positionUpdateAttempts}/${maxPositionAttempts}: Bounding box not ready for ${nodeId}, retrying...`
            );
            setTimeout(updatePosition, 200);
          } else {
            console.warn(
              `⚠️ Failed to position indicator for ${nodeId} after ${maxPositionAttempts} attempts`
            );
            // Fallback to center positioning
            const nodePos = node.position();
            if (nodePos) {
              indicator.style.left = `${nodePos.x + 50}px`;
              indicator.style.top = `${nodePos.y - 50}px`;
              console.log(
                `📍 Fallback positioning for ${nodeId}: (${nodePos.x + 50}, ${
                  nodePos.y - 50
                })`
              );
            }
          }
        }
      } catch (error) {
        positionUpdateAttempts++;
        console.warn(
          `⚠️ Error updating position for indicator ${nodeId} (attempt ${positionUpdateAttempts}):`,
          error
        );

        if (positionUpdateAttempts < maxPositionAttempts) {
          setTimeout(updatePosition, 300);
        } else {
          console.error(
            `❌ Failed to position indicator for ${nodeId} after ${maxPositionAttempts} attempts`
          );
        }
      }
    };

    // Initial position update with retry logic
    const initialPositionUpdate = () => {
      if (cy.ready()) {
        updatePosition();
      } else {
        // Wait for Cytoscape to be ready
        cy.ready(() => {
          setTimeout(updatePosition, 100);
        });
      }
    };

    initialPositionUpdate();

    const positionHandler = () => {
      requestAnimationFrame(updatePosition);
    };
    const panZoomHandler = () => {
      requestAnimationFrame(updatePosition);
    };

    node.on('position', positionHandler);
    cy.on('zoom pan viewport', panZoomHandler);

    this.blinkingIndicators.set(nodeId, {
      element: indicator,
      nodeHandler: positionHandler,
      panZoomHandler,
    });

    console.log(
      `✅ Status indicator created for ${nodeId} with status: ${status}`
    );
  }

  private stopBlinkingIndicator(nodeId: string): void {
    const data = this.blinkingIndicators.get(nodeId);
    if (data) {
      if (data.element && data.element.parentNode) {
        data.element.parentNode.removeChild(data.element);
      }
      const cyElement = this.cyContainer?.nativeElement;
      if (cyElement && cyElement._cy) {
        const cy = cyElement._cy;
        const node = cy.getElementById(nodeId);
        if (node && node.length) {
          if (data.nodeHandler) {
            node.off('position', data.nodeHandler);
          }
          if (data.panZoomHandler) {
            cy.off('zoom pan viewport', data.panZoomHandler);
          }
        }
      }
      this.blinkingIndicators.delete(nodeId);
    }
  }

  private updateStatusIndicatorPosition(nodeId: string): void {
    const data = this.blinkingIndicators.get(nodeId);
    if (!data) return;

    const cyElement = this.cyContainer?.nativeElement;
    if (!cyElement || !cyElement._cy) return;

    const cy = cyElement._cy;
    const node = cy.getElementById(nodeId);
    if (!node || node.length === 0) {
      this.stopBlinkingIndicator(nodeId);
      return;
    }

    requestAnimationFrame(() => {
      try {
        const bb = node.renderedBoundingBox();
        if (bb && bb.w > 0 && bb.h > 0) {
          // Position indicator at top-right corner of the node
          const left = bb.x2 - 20;
          const top = bb.y1 - 10;

          data.element.style.left = `${left}px`;
          data.element.style.top = `${top}px`;

          // Ensure indicator remains visible
          data.element.style.display = 'block';
          data.element.style.visibility = 'visible';
          data.element.style.opacity = '1';
        }
      } catch (error) {
        console.warn(
          `Failed to update position for indicator ${nodeId}:`,
          error
        );
      }
    });
  }

  private refreshStatusIndicators(): void {
    // Remove existing
    this.blinkingIndicators.forEach((_, nodeId) =>
      this.stopBlinkingIndicator(nodeId)
    );
    // Recreate from current map
    this.initializeBlinkingForAllDevices();
  }

  private ensureAllIndicatorsVisible(): void {
    console.log('🔍 Ensuring all status indicators are visible...');

    let retryCount = 0;
    const maxRetries = 3;

    const checkAndFixIndicators = () => {
      const indicators = this.getStatusIndicatorsInfo();
      console.log(
        `📊 Status check: ${indicators.visibleIndicators}/${indicators.totalIndicators} indicators visible`
      );

      if (
        indicators.visibleIndicators < indicators.totalIndicators &&
        retryCount < maxRetries
      ) {
        retryCount++;
        console.log(
          `🔄 Retry ${retryCount}/${maxRetries}: Recreating hidden indicators...`
        );

        // Force refresh indicators
        this.forceRefreshStatusIndicators();

        // Check again after a delay
        setTimeout(checkAndFixIndicators, 1000);
      } else if (indicators.visibleIndicators === indicators.totalIndicators) {
        console.log('✅ All status indicators are now visible');
      } else {
        console.warn(
          `⚠️ Some indicators may still be hidden after ${maxRetries} retries`
        );
      }
    };

    // Start checking after a short delay
    setTimeout(checkAndFixIndicators, 200);
  }

  public forceRefreshStatusIndicators(): void {
    console.log('🔄 Force refreshing status indicators...');

    // Clear existing indicators
    this.blinkingIndicators.forEach((_, nodeId) =>
      this.stopBlinkingIndicator(nodeId)
    );

    // Ensure styles are applied
    this.ensureStatusIndicatorStyles();

    // Recreate all indicators
    this.initializeBlinkingForAllDevices();

    // Log the count of active indicators
    const activeCount = this.blinkingIndicators.size;
    console.log(
      `✅ Status indicators refreshed. Active indicators: ${activeCount}`
    );

    // Log device status map for debugging
    console.log('Device status map:', Object.fromEntries(this.deviceStatusMap));
  }

  public getStatusIndicatorsInfo(): {
    totalIndicators: number;
    visibleIndicators: number;
    deviceStatusCount: number;
    indicators: Array<{ nodeId: string; status: string; visible: boolean }>;
  } {
    const totalIndicators = this.blinkingIndicators.size;
    let visibleIndicators = 0;
    const indicators: Array<{
      nodeId: string;
      status: string;
      visible: boolean;
    }> = [];

    this.blinkingIndicators.forEach((data, nodeId) => {
      const isVisible =
        data.element &&
        data.element.style.display !== 'none' &&
        data.element.style.visibility !== 'hidden' &&
        data.element.style.opacity !== '0';

      if (isVisible) visibleIndicators++;

      const status = this.deviceStatusMap.get(nodeId) || 'unknown';
      indicators.push({
        nodeId,
        status,
        visible: isVisible,
      });
    });

    return {
      totalIndicators,
      visibleIndicators,
      deviceStatusCount: this.deviceStatusMap.size,
      indicators,
    };
  }

  private disableDragAndDrop(cy: any): void {
    // Disable dragging for all nodes (including parent nodes)
    cy.nodes().forEach((node: any) => {
      node.lock();
      node.ungrabify();
    });

    // Disable dragging for all edges
    cy.edges().forEach((edge: any) => {
      edge.lock();
      edge.ungrabify();
    });

    // Disable box selection
    cy.boxSelectionEnabled(false);

    // Disable selection interactions globally (supported Cytoscape API)
    cy.autounselectify(true);

    // Prevent grabbing/dragging globally (in addition to per-element ungrabify)
    cy.autoungrabify(true);

    // Ensure nothing is selected
    cy.nodes().unselect();
    cy.edges().unselect();

    // Prevent any selection changes from events
    cy.on('select', 'node', (event: any) => {
      event.target.unselect();
    });

    cy.on('select', 'edge', (event: any) => {
      event.target.unselect();
    });

    console.log(
      '✅ Dragging and selection disabled via supported Cytoscape APIs'
    );
  }

  public isDragAndDropDisabled(): boolean {
    const cy = this.getCytoscapeInstance();
    if (!cy) return false;

    // Check if any nodes are grabable
    const grabableNodes = cy.nodes().filter((node: any) => node.grabbable());
    const grabableEdges = cy.edges().filter((edge: any) => edge.grabbable());

    const isDisabled = grabableNodes.length === 0 && grabableEdges.length === 0;

    console.log(`Drag and drop status: ${isDisabled ? 'DISABLED' : 'ENABLED'}`);
    console.log(
      `Grabable nodes: ${grabableNodes.length}, Grabable edges: ${grabableEdges.length}`
    );

    return isDisabled;
  }

  public resetToDefaultZoom(): void {
    const cy = this.getCytoscapeInstance();
    if (cy) {
      cy.fit(undefined, 150); // Increased padding for better overview
      cy.zoom(this.DEFAULT_ZOOM_LEVEL);
      cy.center();
      console.log(`✅ Reset to default zoom level: ${this.DEFAULT_ZOOM_LEVEL}`);
    }
  }

  public setOverviewZoom(): void {
    const cy = this.getCytoscapeInstance();
    if (cy) {
      cy.fit(undefined, 200); // Large padding for full overview
      cy.zoom(0.03); // Very zoomed out for complete overview
      cy.center();
      console.log('✅ Set to overview zoom level (0.03)');
    }
  }

  public setMediumZoom(): void {
    const cy = this.getCytoscapeInstance();
    if (cy) {
      cy.fit(undefined, 120);
      cy.zoom(0.08); // Medium zoom level
      cy.center();
      console.log('✅ Set to medium zoom level (0.08)');
    }
  }

  public getCurrentZoomInfo(): {
    currentZoom: number;
    defaultZoom: number;
    minZoom: number;
    maxZoom: number;
    zoomPercentage: number;
  } {
    const cy = this.getCytoscapeInstance();
    if (!cy) {
      return {
        currentZoom: 1,
        defaultZoom: this.DEFAULT_ZOOM_LEVEL,
        minZoom: 0.1,
        maxZoom: 2.0,
        zoomPercentage: 100,
      };
    }

    const currentZoom = cy.zoom();
    const zoomPercentage = Math.round(currentZoom * 100);

    return {
      currentZoom,
      defaultZoom: this.DEFAULT_ZOOM_LEVEL,
      minZoom: cy.minZoom(),
      maxZoom: cy.maxZoom(),
      zoomPercentage,
    };
  }

  public zoomToFitAll(): void {
    const cy = this.getCytoscapeInstance();
    if (cy) {
      cy.fit(undefined, 250); // Large padding to see everything
      cy.zoom(0.02); // Very zoomed out
      cy.center();
      console.log('✅ Zoomed to fit all elements with maximum overview');
    }
  }

  public showAllStatusIndicators(): void {
    console.log('🔍 Showing all status indicators...');

    this.blinkingIndicators.forEach((data, nodeId) => {
      if (data.element) {
        data.element.style.display = 'block';
        data.element.style.visibility = 'visible';
        data.element.style.opacity = '1';
        data.element.style.zIndex = '10000';

        console.log(`✅ Made indicator visible for ${nodeId}`);
      }
    });

    console.log(
      `✅ All ${this.blinkingIndicators.size} status indicators should now be visible`
    );
  }

  public hideAllStatusIndicators(): void {
    console.log('🔍 Hiding all status indicators...');

    this.blinkingIndicators.forEach((data, nodeId) => {
      if (data.element) {
        data.element.style.display = 'none';
        data.element.style.visibility = 'hidden';
        data.element.style.opacity = '0';

        console.log(`✅ Hidden indicator for ${nodeId}`);
      }
    });

    console.log(
      `✅ All ${this.blinkingIndicators.size} status indicators should now be hidden`
    );
  }

  public toggleHoverHighlighting(): boolean {
    const cy = this.getCytoscapeInstance();
    if (!cy) return false;

    // Check if highlighting is currently enabled
    const isEnabled =
      cy.elements().hasClass('highlighted-edge') ||
      cy.elements().hasClass('highlighted-node');

    if (isEnabled) {
      // Disable highlighting
      this.resetEdgeHighlighting();
      this.resetNodeHighlighting();
      console.log('🔍 Hover highlighting disabled');
      return false;
    } else {
      // Enable highlighting (this will happen automatically on next hover)
      console.log('🔍 Hover highlighting enabled');
      return true;
    }
  }

  public getHighlightingStatus(): {
    isEnabled: boolean;
    highlightedEdges: number;
    highlightedNodes: number;
    dimmedEdges: number;
    dimmedNodes: number;
  } {
    const cy = this.getCytoscapeInstance();
    if (!cy) {
      return {
        isEnabled: false,
        highlightedEdges: 0,
        highlightedNodes: 0,
        dimmedEdges: 0,
        dimmedNodes: 0,
      };
    }

    const highlightedEdges = cy.edges('.highlighted-edge').length;
    const highlightedNodes = cy.nodes('.highlighted-node').length;
    const dimmedEdges = cy.edges('.dimmed-edge').length;
    const dimmedNodes = cy.nodes('.dimmed-node').length;

    return {
      isEnabled: highlightedEdges > 0 || highlightedNodes > 0,
      highlightedEdges,
      highlightedNodes,
      dimmedEdges,
      dimmedNodes,
    };
  }

  public demonstrateHighlighting(): void {
    console.log('🎭 Demonstrating hover highlighting...');

    const cy = this.getCytoscapeInstance();
    if (!cy) {
      console.log('❌ Cytoscape not ready');
      return;
    }

    // Get first non-parent node
    const firstNode = cy
      .nodes()
      .filter((n: any) => !n.isParent())
      .first();
    if (firstNode.length > 0) {
      console.log(`🎯 Highlighting node: ${firstNode.id()}`);
      this.highlightHoveredNode(firstNode);

      // Auto-reset after 3 seconds
      setTimeout(() => {
        this.resetNodeHighlighting();
        console.log('✅ Demo highlighting reset');
      }, 3000);
    } else {
      console.log('❌ No nodes found for demo');
    }
  }

  public testEdgeHighlighting(): void {
    console.log('🔗 Testing edge highlighting...');

    const cy = this.getCytoscapeInstance();
    if (!cy) {
      console.log('❌ Cytoscape not ready');
      return;
    }

    // Get first edge
    const firstEdge = cy.edges().first();
    if (firstEdge.length > 0) {
      console.log(`🎯 Highlighting edge: ${firstEdge.id()}`);
      this.highlightHoveredEdge(firstEdge);

      // Auto-reset after 3 seconds
      setTimeout(() => {
        this.resetEdgeHighlighting();
        console.log('✅ Demo edge highlighting reset');
      }, 3000);
    } else {
      console.log('❌ No edges found for demo');
    }
  }

  public forceHighlightRefresh(): void {
    console.log('🔄 Force refreshing highlighting...');

    const cy = this.getCytoscapeInstance();
    if (!cy) {
      console.log('❌ Cytoscape not ready');
      return;
    }

    // Reset any existing highlighting
    this.resetEdgeHighlighting();
    this.resetNodeHighlighting();

    // Force a render
    cy.forceRender();

    console.log('✅ Highlighting refreshed, try hovering now');
  }

  public checkStylesInDOM(): void {
    console.log('🔍 Checking if styles are in DOM...');

    const styleElement = document.getElementById('status-indicator-styles');
    if (styleElement) {
      console.log('✅ Status indicator styles found in DOM');
      console.log(
        '📝 Style content length:',
        styleElement.textContent?.length || 0
      );
    } else {
      console.log('❌ Status indicator styles NOT found in DOM');
    }

    // Check for any Cytoscape styles
    const cytoscapeStyles = document.querySelectorAll('style');
    console.log(`📊 Total style elements in DOM: ${cytoscapeStyles.length}`);

    // Check if highlighting classes are defined
    const testElement = document.createElement('div');
    testElement.className = 'highlighted-edge';
    const computedStyle = window.getComputedStyle(testElement);
    console.log('🔍 Highlighted edge computed styles:', {
      display: computedStyle.display,
      visibility: computedStyle.visibility,
      opacity: computedStyle.opacity,
    });
  }

  public manuallyTriggerHover(): void {
    console.log('🎯 Manually triggering hover events for testing...');

    const cy = this.getCytoscapeInstance();
    if (!cy) {
      console.log('❌ Cytoscape not ready');
      return;
    }

    // Get first non-parent node
    const firstNode = cy
      .nodes()
      .filter((n: any) => !n.isParent())
      .first();
    if (firstNode.length > 0) {
      console.log(`🎯 Manually triggering hover on node: ${firstNode.id()}`);

      // Manually call the hover method
      this.highlightHoveredNode(firstNode);

      // Auto-reset after 2 seconds
      setTimeout(() => {
        this.resetNodeHighlighting();
        console.log('✅ Manual hover test completed');
      }, 2000);
    } else {
      console.log('❌ No nodes found for manual hover test');
    }
  }

  public debugHoverSystem(): void {
    console.log('🔍 Debugging hover system...');

    const cy = this.getCytoscapeInstance();
    if (!cy) {
      console.log('❌ Cytoscape not ready');
      return;
    }

    console.log('📊 Cytoscape instance:', cy);
    console.log('📊 Total elements:', cy.elements().length);
    console.log('📊 Nodes:', cy.nodes().length);
    console.log('📊 Edges:', cy.edges().length);

    // Check event listeners
    const nodes = cy.nodes().filter((n: any) => !n.isParent());
    const edges = cy.edges();

    if (nodes.length > 0) {
      const firstNode = nodes.first();
      console.log(`🎯 First node ${firstNode.id()} is ready for hover events`);
    }

    if (edges.length > 0) {
      const firstEdge = edges.first();
      console.log(`🔗 First edge ${firstEdge.id()} is ready for hover events`);
    }

    // Check if highlighting methods exist
    console.log('🔍 Highlighting methods:', {
      highlightHoveredNode: typeof this.highlightHoveredNode,
      highlightHoveredEdge: typeof this.highlightHoveredEdge,
      resetNodeHighlighting: typeof this.resetNodeHighlighting,
      resetEdgeHighlighting: typeof this.resetEdgeHighlighting,
    });
  }

  public forceReattachHoverEvents(): void {
    console.log('🔗 Force reattaching hover event handlers...');

    const cy = this.getCytoscapeInstance();
    if (!cy) {
      console.log('❌ Cytoscape not ready');
      return;
    }

    // Remove all existing event handlers
    cy.off('mouseover mouseout mousemove');

    // Re-attach event handlers
    this.attachHoverEventHandlers(cy);

    console.log('✅ Hover event handlers reattached');
  }

  public checkPermission(): void {
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
}
