# Frontend Guide: Dynamic Block Support for Topology Visualization

This guide explains the backend changes for auto-layout positioning and how the frontend can support dynamic blocks in the topology visualization.

## Table of Contents

1. [Overview](#overview)
2. [Backend Changes Summary](#backend-changes-summary)
3. [API Endpoints for Block Management](#api-endpoints-for-block-management)
4. [Data Structures](#data-structures)
5. [Frontend Implementation Guide](#frontend-implementation-guide)
6. [Block Position Configuration](#block-position-configuration)

---

## Overview

### Problem Solved
Previously, when uploading an Excel file, all devices would overlap at position (0, 0) within their assigned blocks. Users had to manually rearrange every device.

### Solution Implemented
The backend now automatically calculates initial positions for devices using a **grid layout algorithm** during Excel import:
- Devices are arranged in a grid pattern within each block (4 devices per row, 200px horizontal spacing, 150px vertical spacing)
- Blocks are arranged in a grid pattern (3 blocks per row, 1500px spacing)
- Devices without blocks are arranged in concentric circles around the main layout

---

## Backend Changes Summary

### 1. Auto-Layout at Import Time
When Excel data is imported via `/topology-api/import-excel-headered`, the backend now:

1. **Validates all records first** (Phase 1)
2. **Calculates positions** using `calculate_auto_layout_positions()` (Phase 2)
3. **Inserts records with positions** (Phase 3)

### 2. Position Storage
Device and block positions are stored in the database:
```
device_a_position_x, device_a_position_y
device_b_position_x, device_b_position_y
device_a_block_position_x, device_a_block_position_y
device_b_block_position_x, device_b_block_position_y
```

### 3. Position Retrieval
When fetching topology data via `/topology-api/get-network-topology-dashboard`, the response includes pre-calculated positions in the `positions` object.

---

## API Endpoints for Block Management

### Get All Blocks
```
GET /topology-api/network-topology-block-get
```

**Response:**
```json
{
  "success": true,
  "data": [
    { "ID": "64abc123...", "BLOCK_NAME": "core-block" },
    { "ID": "64abc124...", "BLOCK_NAME": "internet-block" }
  ]
}
```

### Add Single Block
```
POST /topology-api/network-topology-block-add
Content-Type: application/json

{
  "block_name": "new-custom-block",
  "created_by": "admin@company.com"
}
```

### Add Multiple Blocks (Bulk)
```
POST /topology-api/network-topology-block-add-bulk
Content-Type: application/json

{
  "block_names": ["block-1", "block-2", "block-3"],
  "created_by": "admin@company.com"
}
```

### Update Block Name
```
PUT /topology-api/network-topology-block-update
Content-Type: application/json

{
  "block_id": "64abc123...",
  "block_name": "renamed-block",
  "updated_by": "admin@company.com"
}
```

**Note:** This also updates all device references to use the new block name.

### Delete Block
```
DELETE /topology-api/network-topology-block-delete
Content-Type: application/json

{
  "block_id": "64abc123...",
  "updated_by": "admin@company.com"
}
```

**Note:** Deletion is prevented if any devices are assigned to this block.

### Save Positions (Device and Block)
```
POST /topology-api/save-device-positions
Content-Type: application/json

{
  "positions": {
    "192.168.1.1": { "x": 100, "y": 200 },
    "core-block": { "x": 0, "y": 0 },
    "new-custom-block": { "x": 3000, "y": 0 }
  },
  "changed_by": "admin@company.com"
}
```

---

## Data Structures

### Topology Dashboard Response
```typescript
interface TopologyResponse {
  success: boolean;
  data: {
    networkData: {
      blocks: Block[];
      nodes: Node[];
      edges: Edge[];
    };
    positions: { [nodeId: string]: Position };
    connectionMap: { [connectionId: string]: ConnectionData };
    deviceStatus: { [deviceId: string]: 'on' | 'off' };
    deviceTypes: { [deviceId: string]: string };
    timestamp: number;
  };
  count: {
    blocks: number;
    nodes: number;
    edges: number;
  };
}

interface Block {
  id: string;       // e.g., "core-block", "new-custom-block"
  label: string;    // e.g., "Core Block", "New Custom Block"
  type: 'compound';
}

interface Node {
  id: string;           // Device IP or hostname
  label: string;        // Display name
  type: string;         // 'firewall', 'switch', 'router', etc.
  parent: string | null; // Block ID or null if no block
  status: 'on' | 'off';
}

interface Position {
  x: number;
  y: number;
}
```

### Block Position in Database
Blocks don't have a dedicated position table. Instead, block positions are stored redundantly in device records:
- `device_a_block_position_x`, `device_a_block_position_y`
- `device_b_block_position_x`, `device_b_block_position_y`

When a block is dragged, use the `/save-device-positions` endpoint with the block name as the key.

---

## Frontend Implementation Guide

### 1. Supporting New/Dynamic Blocks

Currently, the frontend has a `fixedBlockPositions` object with predefined positions. To support dynamic blocks:

#### Option A: Remove Fixed Positions (Recommended)
Use positions from the API response instead of hardcoded positions:

```typescript
// OLD: Fixed positions
const fixedBlockPositions = {
  'core-block': { x: 0, y: 0 },
  'internet-block': { x: 0, y: -6000 },
  // ... etc
};

// NEW: Use positions from API
private initializeBlockPositions(apiPositions: { [key: string]: Position }) {
  // API now provides block positions calculated by backend
  this.blockPositions = { ...apiPositions };
}
```

#### Option B: Hybrid Approach
Keep fixed positions for known blocks, fall back to API positions for new blocks:

```typescript
const knownBlockPositions = {
  'core-block': { x: 0, y: 0 },
  'internet-block': { x: 0, y: -6000 },
  // ... predefined blocks
};

private initializeBlockPositions(apiPositions: { [key: string]: Position }) {
  const allPositions = { ...apiPositions };

  // Override with known positions if preferred
  for (const [blockId, pos] of Object.entries(knownBlockPositions)) {
    if (blockId in allPositions) {
      allPositions[blockId] = pos;
    }
  }

  this.blockPositions = allPositions;
}
```

### 2. Handling New Block Creation in UI

When a user creates a new block via the UI:

1. Call the block creation API
2. The new block won't have a position until devices are assigned
3. When devices are assigned to the new block, positions will be calculated on next import
4. Or manually set a position using the save-positions endpoint

```typescript
async createBlock(blockName: string): Promise<void> {
  // 1. Create the block
  await this.api.post('/network-topology-block-add', {
    block_name: blockName,
    created_by: this.currentUser
  });

  // 2. Optionally set an initial position
  const newBlockPosition = this.calculateNewBlockPosition();
  await this.api.post('/save-device-positions', {
    positions: {
      [blockName]: newBlockPosition
    },
    changed_by: this.currentUser
  });

  // 3. Refresh topology
  await this.loadTopology();
}

private calculateNewBlockPosition(): Position {
  // Find the rightmost/bottommost block and place new one after it
  const existingPositions = Object.values(this.blockPositions);
  const maxX = Math.max(...existingPositions.map(p => p.x), 0);
  const maxY = Math.max(...existingPositions.map(p => p.y), 0);

  return { x: maxX + 1500, y: 0 }; // Place to the right
}
```

### 3. Block Management UI Component

Consider adding a Block Management panel with:
- List of all blocks
- Add new block button
- Rename block functionality
- Delete block (with warning if devices are assigned)
- Visual indicator of device count per block

```typescript
interface BlockInfo {
  id: string;
  name: string;
  deviceCount: number;
  position: Position | null;
}

async getBlocksWithDeviceCounts(): Promise<BlockInfo[]> {
  const [blocksRes, topologyRes] = await Promise.all([
    this.api.get('/network-topology-block-get'),
    this.api.get('/get-network-topology-dashboard')
  ]);

  const blocks = blocksRes.data.data;
  const nodes = topologyRes.data.data.networkData.nodes;
  const positions = topologyRes.data.data.positions;

  return blocks.map(block => ({
    id: block.ID,
    name: block.BLOCK_NAME,
    deviceCount: nodes.filter(n => n.parent === block.BLOCK_NAME).length,
    position: positions[block.BLOCK_NAME] || null
  }));
}
```

---

## Block Position Configuration

### Backend Auto-Layout Configuration
The backend uses these default values (in `topology_utilities.py`):

```python
DEVICES_PER_ROW = 4          # Devices per row in a block
DEVICE_SPACING_X = 200       # Horizontal spacing (px)
DEVICE_SPACING_Y = 150       # Vertical spacing (px)
BLOCK_SPACING = 1500         # Space between blocks (px)
BLOCKS_PER_ROW = 3           # Blocks per row in grid
```

### Customizing Block Positions

The backend calculates initial positions, but users can:
1. Drag blocks in the UI to reposition them
2. Save positions via `/save-device-positions`
3. Positions are persisted and restored on next load

### Block Naming Convention

For automatic block assignment (via `determine_block()` function), use these naming patterns in device hostnames:

| Pattern in Hostname | Assigned Block |
|---------------------|----------------|
| COR, CORE | core-block |
| INT, INTERNET | internet-block |
| OOB, OUT OF BAND | oob-block |
| WAN, WIDE AREA | wan-block |
| EXTNET, EXTRANET, PARTNER | extranet-block |
| OTV, REPL, REPLICATION | replication-block |
| DC, DATACENTER, ACI | datacenter-block |
| VIS, VISIBILITY, MONITOR | visibility-block |
| DMZ, PERIMETER, BORDER | dmz-block |
| EXT, EXTERNAL, EDGE | external-block |

Or specify blocks explicitly in the Excel file using the `device_a_block` and `device_b_block` columns.

---

## Migration Notes

### For Existing Data
If you have existing data without positions:
1. The backend will fall back to (0, 0) for devices with blocks
2. Re-import the data to get auto-calculated positions
3. Or manually set positions via the UI

### For New Imports
All new Excel imports will automatically get calculated positions - no action needed.

---

## Questions?

Contact the backend team for:
- Custom layout algorithm requirements
- Additional block-related endpoints
- Position calculation adjustments
