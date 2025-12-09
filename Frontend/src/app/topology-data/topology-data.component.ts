import { Component, OnInit } from '@angular/core';
import * as XLSX from 'xlsx';
import {
  ExcelTableService,
  ExcelTableRecord,
  BulkImportResponse,
  HeaderedImportResponse,
} from '../services/topology-data.service';
import { ToastService } from '../services/toast.service';

type ExcelRowData = ExcelTableRecord;

@Component({
  selector: 'app-topology-data',
  templateUrl: './topology-data.component.html',
  styleUrls: ['./topology-data.component.css'],
})
export class TopologyDataComponent implements OnInit {
  fileName: string = '';
  excelData: ExcelRowData[] = [];
  isLoading: boolean = false;
  errorMessage: string = '';
  permission: boolean = false;
  showImportResultModal: boolean = false;
  importResult: HeaderedImportResponse | null = null;
  showUpdateErrorModal: boolean = false;
  updateError: { status?: number; message?: string; details?: any } | null =
    null;
  searchTerm: string = '';

  constructor(
    private excelTableService: ExcelTableService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.loadRecords();
    this.showExcelImportSection();
    this.checkPermission();
    this.loadBlocks(); // Load blocks for dropdown options
  }

  checkPermission(): void {
    this.excelTableService.permissionCheck().subscribe({
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

  showAddForm: boolean = false;
  showEditForm: boolean = false;
  showDeviceTypeForm: boolean = false;
  showExcelImport: boolean = false;
  editingRow: ExcelRowData | null = null;
  editingIndex: number = -1;
  currentEditingRow: ExcelRowData | null = null;

  showDeleteConfirm: boolean = false;
  deletingRow: ExcelRowData | null = null;
  deletingIndex: number = -1;

  showBulkDeleteModal: boolean = false;
  bulkDeleteSelection: {
    device_side: 'A' | 'B' | '';
    hostname: string;
    ip: string;
    updated_by: string;
  } = {
    device_side: '',
    hostname: '',
    ip: '',
    updated_by: 'system',
  };
  bulkDeletePreviewRow: ExcelRowData | null = null;

  selectedRowIds: Set<number> = new Set();
  showMultiRowDeleteModal: boolean = false;

  showBlocksModal: boolean = false;
  showDeleteBlockConfirm: boolean = false;
  showAddBlockFormFlag: boolean = false;
  blocksList: any[] = [];
  editingBlockId: number | null = null;
  editingBlockName: string = '';
  deletingBlock: any = null;
  newBlockName: string = '';

  // Excel import block analysis
  extractedUniqueBlocks: string[] = [];
  blockCreationResults: { created: number; skipped: number; total: number } = {
    created: 0,
    skipped: 0,
    total: 0,
  };

  formData: ExcelRowData = {
    device_a_ip: '',
    device_a_hostname: '',
    device_a_interface: '',
    device_a_type: '',
    device_a_vendor: '',
    device_a_block: null,
    device_b_ip: '',
    device_b_hostname: '',
    device_b_interface: '',
    device_b_type: '',
    device_b_vendor: '',
    device_b_block: null,
    comments: '',
  };

  deviceTypeFormData = {
    device_ip: '',
    device_hostname: '',
    new_device_type: '',
    new_vendor: '',
    device_side: '',
    updated_by: 'system',
    current_type: '',
    current_block: '',
    current_vendor: '',
  };

  columns = [
    { key: 'device_a_ip', label: 'Device A IP', width: '140px' },
    { key: 'device_a_hostname', label: 'Device A Hostname', width: '180px' },
    { key: 'device_a_interface', label: 'Device A Interface', width: '150px' },
    { key: 'device_a_type', label: 'Device A Type', width: '140px' },
    { key: 'device_a_vendor', label: 'Device A Vendor', width: '140px' },
    { key: 'device_a_block', label: 'Device A Block', width: '150px' },
    { key: 'device_b_ip', label: 'Device B IP', width: '140px' },
    { key: 'device_b_hostname', label: 'Device B Hostname', width: '180px' },
    { key: 'device_b_interface', label: 'Device B Interface', width: '150px' },
    { key: 'device_b_type', label: 'Device B Type', width: '140px' },
    { key: 'device_b_vendor', label: 'Device B Vendor', width: '140px' },
    { key: 'device_b_block', label: 'Device B Block', width: '150px' },
    { key: 'comments', label: 'Comments', width: '250px' },
  ];

  availableDeviceTypes = [
    'switch',
    'router',
    'firewall',
    'server',
    'internet',
    'ext_switch',
    'core_switch',
    'ips',
    'proxy',
    'dwdm',
    'isp',
  ];

  availableBlocks = [
    'core-block',
    'internet-block',
    'oob-block',
    'wan-block',
    'extranet-block',
    'replication-block',
    'datacenter-block',
    'visibility-block',
    'ips-block',
    'dmz-block',
    'external-block',
  ];

  availableVendors = ['Cisco', 'Huawei', 'Paloalto', 'Fortigate', 'Forcepoint'];

  checkBackendHealth(): void {
    this.excelTableService.healthCheck().subscribe({
      next: (response) => {
        let healthMessage = '✅ Backend is healthy!\n\n';
        if (response && typeof response === 'object') {
          healthMessage += 'Response details:\n\n';
          for (const [key, value] of Object.entries(response)) {
            healthMessage += `${key}: ${value}\n`;
          }
        }

        // alert(healthMessage);
        this.toastService.success(healthMessage);
      },
      error: (error) => {
        console.error('❌ Backend health check failed:', error);

        let errorMessage = '❌ Backend health check failed!\n\n';
        if (error.status) {
          errorMessage += `Status: ${error.status}\n`;
        }
        if (error.message) {
          errorMessage += `Message: ${error.message}\n`;
        }
        if (error.error) {
          errorMessage += `Error: ${JSON.stringify(error.error)}\n`;
        }

        // alert(errorMessage + '\nCheck console for more details.');
        this.toastService.error(
          errorMessage + '\nCheck console for more details.'
        );
      },
    });
  }

  private assignBlocksToDevices(data: ExcelRowData[]): ExcelRowData[] {
    return data.map((record) => {
      const deviceABlock = this.determineBlock(
        record.device_a_hostname,
        record.device_a_ip,
        record.device_a_type
      );
      const deviceBBlock = this.determineBlock(
        record.device_b_hostname,
        record.device_b_ip,
        record.device_b_type
      );

      return {
        ...record,
        device_a_block: deviceABlock,
        device_b_block: deviceBBlock,
      };
    });
  }

  private determineBlock(
    hostname: string,
    ip: string,
    deviceType: string
  ): string | null {
    if (
      !hostname ||
      !hostname.trim() ||
      !ip ||
      !ip.trim() ||
      !deviceType ||
      !deviceType.trim()
    ) {
      return null;
    }

    if (ip === '10.99.18.253' || ip === '10.99.18.254') {
      return 'core-block';
    }

    if (deviceType.toLowerCase() === 'core_switch') {
      return 'core-block';
    }

    // Do not assign any block to ISP devices
    if (deviceType.toLowerCase() === 'isp') {
      return null;
    }

    const name = hostname.toUpperCase();

    if (name.includes('COR') || name.includes('CORE')) {
      return 'core-block';
    }

    if (name.includes('INT') || name.includes('INTERNET')) {
      return 'internet-block';
    }

    if (name.includes('OOB') || name.includes('OUT_OF_BAND')) {
      return 'oob-block';
    }

    if (name.includes('WAN') || name.includes('WIDE_AREA')) {
      return 'wan-block';
    }

    if (
      name.includes('EXTNET') ||
      name.includes('EXTRANET') ||
      name.includes('PARTNER')
    ) {
      return 'extranet-block';
    }

    if (
      name.includes('OTV') ||
      name.includes('REPL') ||
      name.includes('REPLICATION')
    ) {
      return 'replication-block';
    }

    if (
      name.includes('DC') ||
      name.includes('DATACENTER') ||
      name.includes('ACI')
    ) {
      return 'datacenter-block';
    }

    if (
      name.includes('VIS') ||
      name.includes('VISIBILITY') ||
      name.includes('MONITOR')
    ) {
      return 'visibility-block';
    }

    if (
      name.includes('DMZ') ||
      name.includes('PERIMETER') ||
      name.includes('BORDER')
    ) {
      return 'dmz-block';
    }

    if (
      name.includes('EXT') ||
      name.includes('EXTERNAL') ||
      name.includes('EDGE')
    ) {
      return 'external-block';
    }

    if (deviceType.toLowerCase() === 'firewall') {
      return 'dmz-block';
    }
    if (deviceType.toLowerCase() === 'ips') {
      return 'visibility-block';
    }
    if (deviceType.toLowerCase() === 'proxy') {
      return 'dmz-block';
    }

    return null;
  }

  loadRecords(): void {
    this.isLoading = true;
    this.excelTableService.getRecords().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.excelData = response.data;

          if (this.excelData.length > 0) {
            this.hideExcelImportSection();
          }
        } else {
          this.errorMessage = response.error || 'Failed to load records';
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading records:', error);
        this.errorMessage = 'Failed to load records from server';
        this.isLoading = false;
      },
    });
  }

  onFileSelect(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.fileName = file.name;
      this.readExcelFile(file);
    }
  }

  public readExcelFile(file: File): void {
    this.isLoading = true;
    this.errorMessage = '';

    const reader = new FileReader();

    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (jsonData.length < 2) {
          this.errorMessage =
            'Excel file must have at least a header row and one data row';
          this.isLoading = false;
          return;
        }

        const headers = (jsonData[0] as any[]).map((h) =>
          String(h || '').trim()
        );
        const rows = jsonData.slice(1) as any[][];

        // Build normalized rows and assign blocks on the client before sending
        const normalizeKey = (key: string): string => {
          try {
            const cleaned = String(key)
              .replace(/[^A-Za-z0-9]+/g, ' ')
              .trim()
              .split(/\s+/)
              .join('_')
              .toLowerCase();
            return cleaned;
          } catch {
            return String(key || '')
              .trim()
              .toLowerCase();
          }
        };

        const headerToField: Record<string, string> = {
          // Device A
          device_a_ip: 'device_a_ip',
          devicea_ip: 'device_a_ip',
          device_a_address: 'device_a_ip',
          devicea_address: 'device_a_ip',
          ip_a: 'device_a_ip',
          ip_device_a: 'device_a_ip',
          device_a_hostname: 'device_a_hostname',
          devicea_hostname: 'device_a_hostname',
          device_a_host_name: 'device_a_hostname',
          devicea_host_name: 'device_a_hostname',
          host_a: 'device_a_hostname',
          hostname_a: 'device_a_hostname',
          device_a_name: 'device_a_hostname',
          name_a: 'device_a_hostname',
          device_a_host: 'device_a_hostname',
          host_name_a: 'device_a_hostname',
          device_a_interface: 'device_a_interface',
          devicea_interface: 'device_a_interface',
          intf_a: 'device_a_interface',
          interface_a: 'device_a_interface',
          device_a_type: 'device_a_type',
          devicea_type: 'device_a_type',
          type_a: 'device_a_type',
          device_a_vendor: 'device_a_vendor',
          devicea_vendor: 'device_a_vendor',
          vendor_a: 'device_a_vendor',
          device_a_block: 'device_a_block',
          devicea_block: 'device_a_block',
          block_a: 'device_a_block',
          // Device B
          device_b_ip: 'device_b_ip',
          deviceb_ip: 'device_b_ip',
          device_b_address: 'device_b_ip',
          deviceb_address: 'device_b_ip',
          ip_b: 'device_b_ip',
          ip_device_b: 'device_b_ip',
          device_b_hostname: 'device_b_hostname',
          deviceb_hostname: 'device_b_hostname',
          device_b_host_name: 'device_b_hostname',
          deviceb_host_name: 'device_b_hostname',
          host_b: 'device_b_hostname',
          hostname_b: 'device_b_hostname',
          device_b_name: 'device_b_hostname',
          name_b: 'device_b_hostname',
          device_b_host: 'device_b_hostname',
          host_name_b: 'device_b_hostname',
          device_b_interface: 'device_b_interface',
          deviceb_interface: 'device_b_interface',
          intf_b: 'device_b_interface',
          interface_b: 'device_b_interface',
          device_b_type: 'device_b_type',
          deviceb_type: 'device_b_type',
          type_b: 'device_b_type',
          device_b_vendor: 'device_b_vendor',
          deviceb_vendor: 'device_b_vendor',
          vendor_b: 'device_b_vendor',
          device_b_block: 'device_b_block',
          deviceb_block: 'device_b_block',
          block_b: 'device_b_block',
          // Comments
          comments: 'comments',
          remark: 'comments',
          remarks: 'comments',
          description: 'comments',
        };

        const normalizedRows = rows
          .filter((row) => row && row.length > 0)
          .filter((row) =>
            row.some(
              (cell) => cell !== null && cell !== undefined && cell !== ''
            )
          )
          .map((row) => {
            const obj: any = {};
            headers.forEach((h, i) => {
              const nk = normalizeKey(h);
              const target = headerToField[nk];
              if (target) obj[target] = row[i];
            });
            if (obj.device_a_type)
              obj.device_a_type = String(obj.device_a_type).toLowerCase();
            if (obj.device_b_type)
              obj.device_b_type = String(obj.device_b_type).toLowerCase();
            if (
              !obj.device_a_block ||
              String(obj.device_a_block).trim() === ''
            ) {
              obj.device_a_block = this.determineBlock(
                String(obj.device_a_hostname || ''),
                String(obj.device_a_ip || ''),
                String(obj.device_a_type || '')
              );
            }
            if (
              !obj.device_b_block ||
              String(obj.device_b_block).trim() === ''
            ) {
              obj.device_b_block = this.determineBlock(
                String(obj.device_b_hostname || ''),
                String(obj.device_b_ip || ''),
                String(obj.device_b_type || '')
              );
            }
            return obj;
          });

        if (normalizedRows.length === 0) {
          this.errorMessage =
            'No records found. Please ensure the Excel file has data rows.';
          this.isLoading = false;
          return;
        }

        // Extract unique block names from the Excel data
        const uniqueBlocks = this.extractUniqueBlocks(normalizedRows);

        // Store the extracted data for reference
        this.extractedUniqueBlocks = uniqueBlocks;

        console.log('=== Excel Import Block Analysis ===');
        console.log('Unique blocks found in Excel:', uniqueBlocks);
        console.log('Total unique blocks:', uniqueBlocks.length);
        console.log('=====================================');

        // Create blocks in database if any unique blocks found
        if (uniqueBlocks.length > 0) {
          this.createBlocksFromExcel(uniqueBlocks);
        }

        // Send normalized rows to backend
        this.excelTableService.importHeaderedRows(normalizedRows).subscribe({
          next: (resp) => {
            if (resp.success) {
              this.loadRecords();
              this.hideExcelImportSection();
              const inserted = resp.inserted_count ?? 0;
              const skipped = resp.skipped_count ?? 0;
              const total = resp.total_records ?? normalizedRows.length;
              console.log('Import summary:', resp);
              this.importResult = resp;
              this.showImportResultModal = true;
              this.fileName = '';
            } else {
              this.errorMessage = resp.message || 'Import failed';
            }
            this.isLoading = false;
          },
          error: (error) => {
            console.error('Error uploading headered rows:', error);
            this.errorMessage = 'Failed to upload data to backend';
            this.isLoading = false;
          },
        });
      } catch (error) {
        console.error('Error reading Excel file:', error);
        this.errorMessage = 'Error reading Excel file';
        this.isLoading = false;
      }
    };

    reader.readAsArrayBuffer(file);
  }

  private uploadToBackend(data: ExcelRowData[]): void {
    this.excelTableService.addRecordsBulk(data).subscribe({
      next: (response: BulkImportResponse) => {
        if (response.success) {
          this.loadRecords();
          this.hideExcelImportSection();
        } else {
          this.errorMessage = 'Failed to upload data to backend';
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error uploading to backend:', error);
        this.errorMessage = 'Failed to upload data to backend';
        this.isLoading = false;
      },
    });
  }

  addRecord(): void {
    if (this.validateFormData()) {
      this.isLoading = true;

      const recordData = {
        ...this.formData,
        device_a_type: this.formData.device_a_type?.toLowerCase() || '',
        device_b_type: this.formData.device_b_type?.toLowerCase() || '',
      };

      this.excelTableService.addRecord(recordData).subscribe({
        next: (response) => {
          if (response.success) {
            this.showAddForm = false;
            this.resetForm();
            this.loadRecords();
            this.errorMessage = '';
          } else {
            this.errorMessage = response.error || 'Failed to add record';
          }
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error adding record:', error);
          this.errorMessage = 'Failed to add record';
          this.isLoading = false;
        },
      });
    }
  }

  updateRecord(): void {
    const isValid = this.validateFormData();
    console.log('[updateRecord] validateFormData =>', isValid, {
      formData: this.formData,
    });

    if (!this.editingRow?.id) {
      console.warn('[updateRecord] Missing editingRow.id. Cannot proceed.', {
        editingRow: this.editingRow,
      });
    }

    if (isValid && this.editingRow?.id) {
      this.isLoading = true;

      const updateData = {
        ...this.formData,
        record_id: this.editingRow.id,
        device_a_type: this.formData.device_a_type?.toLowerCase() || '',
        device_b_type: this.formData.device_b_type?.toLowerCase() || '',
      };

      console.log('[updateRecord] Submitting update payload:', updateData);

      this.excelTableService.updateRecord(updateData).subscribe({
        next: (response) => {
          console.log('[updateRecord] Update response:', response);
          if (response.success) {
            this.showEditForm = false;
            this.resetForm();
            this.loadRecords();
            this.errorMessage = '';
          } else {
            this.updateError = {
              status: undefined,
              message: response.error || 'Failed to update record',
              details: response,
            };
            this.showUpdateErrorModal = true;
          }
          this.isLoading = false;
        },
        error: (error) => {
          console.error('[updateRecord] Error updating record:', error);
          this.updateError = {
            status: error.status,
            message:
              (error.error && (error.error.error || error.error.message)) ||
              error.message ||
              'Failed to update record',
            details: error.error || error,
          };
          this.showUpdateErrorModal = true;
          this.isLoading = false;
        },
      });
    }
  }

  deleteRecord(): void {
    if (this.deletingRow?.id) {
      this.isLoading = true;
      this.excelTableService.deleteRecord(this.deletingRow.id).subscribe({
        next: (response) => {
          if (response.success) {
            this.showDeleteConfirm = false;
            this.loadRecords();
            this.errorMessage = '';
          } else {
            this.errorMessage = response.error || 'Failed to delete record';
          }
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error deleting record:', error);
          this.errorMessage = 'Failed to delete record';
          this.isLoading = false;
        },
      });
    }
  }

  private validateFormData(): boolean {
    if (
      !this.formData.device_a_ip ||
      !this.formData.device_a_hostname ||
      !this.formData.device_a_interface
      // ||
      // !this.formData.device_b_ip ||
      // !this.formData.device_b_hostname
      //  ||
      // !this.formData.device_b_interface
    ) {
      this.errorMessage =
        'Device A IP, Hostname, Interface and Device B IP, Hostname, Interface are required fields.';
      return false;
    }
    return true;
  }

  addNewRecord(): void {
    this.showAddForm = true;
    this.resetForm();
    this.errorMessage = '';
  }

  editRecord(index: number): void {
    this.editingRow = this.excelData[index];
    this.editingIndex = index;
    this.formData = { ...this.excelData[index] };
    this.showEditForm = true;
    this.errorMessage = '';
  }

  showDeleteConfirmModal(index: number): void {
    this.deletingRow = this.excelData[index];
    this.deletingIndex = index;
    this.showDeleteConfirm = true;
  }

  showBulkDeleteFromToolbar(): void {
    this.bulkDeletePreviewRow = null;
    this.showBulkDeleteModal = true;
    this.bulkDeleteSelection = {
      device_side: '',
      hostname: '',
      ip: '',
      updated_by: 'system',
    };
  }

  openBulkDeleteModal(index: number): void {
    this.bulkDeletePreviewRow = this.excelData[index];
    this.showBulkDeleteModal = true;
    this.bulkDeleteSelection = {
      device_side: '',
      hostname: '',
      ip: '',
      updated_by: 'system',
    };
  }

  onBulkDeleteSideChange(): void {
    if (!this.bulkDeleteSelection.device_side) return;
    const row = this.bulkDeletePreviewRow;
    if (!row) return;
    if (this.bulkDeleteSelection.device_side === 'A') {
      this.bulkDeleteSelection.hostname = row.device_a_hostname || '';
      this.bulkDeleteSelection.ip = row.device_a_ip || '';
    } else if (this.bulkDeleteSelection.device_side === 'B') {
      this.bulkDeleteSelection.hostname = row.device_b_hostname || '';
      this.bulkDeleteSelection.ip = row.device_b_ip || '';
    }
  }

  confirmBulkDeleteByHostIp(): void {
    const { hostname, ip, updated_by } = this.bulkDeleteSelection;
    if (!hostname || !ip) {
      this.errorMessage = 'Please select device side or enter hostname and IP.';
      return;
    }
    this.isLoading = true;
    this.excelTableService
      .deleteByHostnameIp(hostname.trim(), ip.trim(), updated_by || 'system')
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.showBulkDeleteModal = false;
            this.bulkDeletePreviewRow = null;
            this.loadRecords();
            this.errorMessage = '';
            // alert('✅ Bulk delete completed.');
            this.toastService.success('Bulk delete completed.');
          } else {
            this.errorMessage =
              response.message || response.error || 'Bulk delete failed';
          }
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error bulk deleting by host/ip:', error);
          this.errorMessage = 'Failed to delete by hostname/ip';
          this.isLoading = false;
        },
      });
  }

  cancelBulkDelete(): void {
    this.showBulkDeleteModal = false;
    this.bulkDeletePreviewRow = null;
  }

  isRowSelected(rowId: number | undefined): boolean {
    return rowId ? this.selectedRowIds.has(rowId) : false;
  }

  toggleRowSelection(rowId: number | undefined): void {
    if (!rowId) return;
    if (this.selectedRowIds.has(rowId)) {
      this.selectedRowIds.delete(rowId);
    } else {
      this.selectedRowIds.add(rowId);
    }
  }

  areAllSelected(): boolean {
    const visibleRows = this.getFilteredData().filter((row) => row.id);
    return (
      visibleRows.length > 0 &&
      visibleRows.every((row) => this.selectedRowIds.has(row.id!))
    );
  }

  isSomeSelected(): boolean {
    const visibleRows = this.getFilteredData().filter((row) => row.id);
    const selectedCount = visibleRows.filter((row) =>
      this.selectedRowIds.has(row.id!)
    ).length;
    return selectedCount > 0 && selectedCount < visibleRows.length;
  }

  toggleAllSelection(): void {
    const visibleRows = this.getFilteredData().filter((row) => row.id);
    const allSelected = this.areAllSelected();

    if (allSelected) {
      visibleRows.forEach((row) => this.selectedRowIds.delete(row.id!));
    } else {
      visibleRows.forEach((row) => this.selectedRowIds.add(row.id!));
    }
  }

  getSelectedRows(): ExcelRowData[] {
    return this.excelData.filter(
      (row) => row.id && this.selectedRowIds.has(row.id)
    );
  }

  getSelectedRowsForPreview(): ExcelRowData[] {
    return this.getSelectedRows().slice(0, 10);
  }

  showMultiRowDeleteConfirm(): void {
    if (this.getSelectedRows().length === 0) {
      this.errorMessage = 'No rows selected for deletion.';
      return;
    }
    this.showMultiRowDeleteModal = true;
  }

  confirmMultiRowDelete(): void {
    const selectedRows = this.getSelectedRows();
    const recordIds = selectedRows.map((row) => row.id!).filter((id) => id);

    if (recordIds.length === 0) {
      this.errorMessage = 'No valid record IDs found for deletion.';
      return;
    }

    this.isLoading = true;
    this.excelTableService
      .deleteNetworkTopologyBulk(recordIds, 'system')
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.showMultiRowDeleteModal = false;
            this.selectedRowIds.clear();
            this.loadRecords();
            this.errorMessage = '';
            this.toastService.success(
              `Successfully deleted ${recordIds.length} record(s).`
            );
          } else {
            this.errorMessage =
              response.message || response.error || 'Multi-row delete failed';
          }
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error deleting multiple rows:', error);
          this.errorMessage = 'Failed to delete selected rows';
          this.isLoading = false;
        },
      });
  }

  cancelMultiRowDelete(): void {
    this.showMultiRowDeleteModal = false;
  }

  saveRecord(): void {
    if (this.showAddForm) {
      this.addRecord();
    } else if (this.showEditForm) {
      this.updateRecord();
    }
  }

  confirmDelete(): void {
    this.deleteRecord();
  }

  cancelEdit(): void {
    this.showAddForm = false;
    this.showEditForm = false;
    this.resetForm();
    this.errorMessage = '';
  }

  resetForm(): void {
    this.formData = {
      device_a_ip: '',
      device_a_hostname: '',
      device_a_interface: '',
      device_a_type: '',
      device_a_vendor: '',
      device_a_block: null,
      device_b_ip: '',
      device_b_hostname: '',
      device_b_interface: '',
      device_b_type: '',
      device_b_vendor: '',
      device_b_block: null,
      comments: '',
    };
  }

  cancelForm(): void {
    this.showAddForm = false;
    this.showEditForm = false;
    this.resetForm();
    this.errorMessage = '';
  }

  cancelDelete(): void {
    this.showDeleteConfirm = false;
    this.deletingRow = null;
    this.deletingIndex = -1;
  }

  goToTopology(): void {
    console.log('Navigating to topology page');
  }

  autoAssignBlockA(): void {
    if (
      this.formData.device_a_hostname &&
      this.formData.device_a_ip &&
      this.formData.device_a_type
    ) {
      this.formData.device_a_block = this.determineBlock(
        this.formData.device_a_hostname,
        this.formData.device_a_ip,
        this.formData.device_a_type
      );
    } else {
      // alert(
      //   'Please fill in Device A hostname, IP, and type before auto-assigning block.'
      // );
      this.toastService.error(
        'Please fill in Device A hostname, IP, and type before auto-assigning block.'
      );
    }
  }

  autoAssignBlockB(): void {
    if (
      this.formData.device_b_hostname &&
      this.formData.device_b_ip &&
      this.formData.device_b_type
    ) {
      this.formData.device_b_block = this.determineBlock(
        this.formData.device_b_hostname,
        this.formData.device_b_ip,
        this.formData.device_b_type
      );
    } else {
      // alert(
      //   'Please fill in Device B hostname, IP, and type before auto-assigning block.'
      // );
      this.toastService.error(
        'Please fill in Device B hostname, IP, and type before auto-assigning block.'
      );
    }
  }

  hasData(): boolean {
    return this.excelData && this.excelData.length > 0;
  }

  hasBlocksAssigned(record: ExcelRowData): boolean {
    return !!(
      record.device_a_block &&
      record.device_b_block &&
      record.device_a_block.trim() !== '' &&
      record.device_b_block.trim() !== ''
    );
  }

  getBlockStatus(record: ExcelRowData): string {
    if (this.hasBlocksAssigned(record)) {
      return '✅ Blocks Assigned';
    } else {
      return '❌ No Blocks';
    }
  }

  getBlockStatusClass(record: ExcelRowData): string {
    if (this.hasBlocksAssigned(record)) {
      return 'block-assigned';
    } else {
      return 'block-missing';
    }
  }

  getRecordsWithBlocks(): number {
    return this.excelData.filter((record) => this.hasBlocksAssigned(record))
      .length;
  }

  getRecordsWithoutBlocks(): number {
    return this.excelData.filter((record) => !this.hasBlocksAssigned(record))
      .length;
  }

  bulkAssignBlocks(): void {
    const recordsWithoutBlocks = this.excelData.filter(
      (record) => !this.hasBlocksAssigned(record)
    );

    if (recordsWithoutBlocks.length === 0) {
      // alert('All records already have blocks assigned!');
      this.toastService.info('All records already have blocks assigned!');
      return;
    }

    if (
      confirm(
        `Auto-assign blocks to ${recordsWithoutBlocks.length} records without blocks?`
      )
    ) {
      let updatedCount = 0;

      recordsWithoutBlocks.forEach((record) => {
        if (
          record.device_a_hostname &&
          record.device_a_ip &&
          record.device_a_type
        ) {
          record.device_a_block = this.determineBlock(
            record.device_a_hostname,
            record.device_a_ip,
            record.device_a_type
          );
        }

        if (
          record.device_b_hostname &&
          record.device_b_ip &&
          record.device_b_type
        ) {
          record.device_b_block = this.determineBlock(
            record.device_b_hostname,
            record.device_b_ip,
            record.device_b_type
          );
        }

        if (record.device_a_type) {
          record.device_a_type = record.device_a_type.toLowerCase();
        }
        if (record.device_b_type) {
          record.device_b_type = record.device_b_type.toLowerCase();
        }

        if (record.id) {
          this.excelTableService.updateRecord(record).subscribe({
            next: (response) => {
              if (response.success) {
                updatedCount++;
              } else {
                console.error(
                  `❌ Failed to update record ${record.id}:`,
                  response.error
                );
              }
            },
            error: (error) => {
              console.error(`❌ Error updating record ${record.id}:`, error);
            },
          });
        }
      });

      // setTimeout(() => {
      //   this.loadRecords();
      //   alert(
      //     `Bulk block assignment completed! ${updatedCount} records updated.`
      //     );
      // }, 2000);
    }
  }

  checkAndAssignBlocksFromExcel(): void {
    const recordsWithoutBlocks = this.excelData.filter(
      (record) => !this.hasBlocksAssigned(record)
    );

    if (recordsWithoutBlocks.length === 0) {
      return;
    }

    recordsWithoutBlocks.forEach((record) => {
      if (record.device_a_type) {
        record.device_a_type = record.device_a_type.toLowerCase();
      }
      if (record.device_b_type) {
        record.device_b_type = record.device_b_type.toLowerCase();
      }

      if (!record.device_a_block) {
        const blockA = this.determineBlock(
          record.device_a_hostname,
          record.device_a_ip,
          record.device_a_type
        );
        if (blockA) {
          record.device_a_block = blockA;
        }
      }

      if (!record.device_b_block) {
        const blockB = this.determineBlock(
          record.device_b_hostname,
          record.device_b_ip,
          record.device_b_type
        );
        if (blockB) {
          record.device_b_block = blockB;
        }
      }
    });

    recordsWithoutBlocks.forEach((record) => {
      if (record.id) {
        this.excelTableService.updateRecord(record).subscribe({
          next: (response) => {
            if (response.success) {
              console.log(`✅ Updated record, with new block assignments`);
            } else {
              console.error(
                ` Failed to update record ${record.id}:`,
                response.error
              );
            }
          },
          error: (error) => {
            console.error(`❌ Error updating record ${record.id}:`, error);
          },
        });
      }
    });
  }

  showDeviceTypeUpdateForm(): void {
    this.showDeviceTypeForm = true;
    this.resetDeviceTypeForm();
    this.errorMessage = '';
  }

  showExcelImportSection(): void {
    this.showExcelImport = true;
    this.errorMessage = '';
  }

  hideExcelImportSection(): void {
    this.showExcelImport = false;
  }

  processExcelFile(): void {
    if (this.fileName) {
      this.uploadToBackend(this.excelData);
    }
  }

  onDeviceSideChange(): void {
    if (this.deviceTypeFormData.device_side && this.currentEditingRow) {
      if (this.deviceTypeFormData.device_side === 'A') {
        this.deviceTypeFormData.device_ip =
          this.currentEditingRow.device_a_ip || '';
        this.deviceTypeFormData.device_hostname =
          this.currentEditingRow.device_a_hostname || '';
        this.deviceTypeFormData.new_device_type =
          this.currentEditingRow.device_a_type || '';
        this.deviceTypeFormData.current_type =
          this.currentEditingRow.device_a_type || '';
        this.deviceTypeFormData.current_block =
          this.currentEditingRow.device_a_block || '';
        this.deviceTypeFormData.current_vendor =
          this.currentEditingRow.device_a_vendor || '';
        this.deviceTypeFormData.new_vendor =
          this.currentEditingRow.device_a_vendor || '';
      } else {
        this.deviceTypeFormData.device_ip =
          this.currentEditingRow.device_b_ip || '';
        this.deviceTypeFormData.device_hostname =
          this.currentEditingRow.device_b_hostname || '';
        this.deviceTypeFormData.new_device_type =
          this.currentEditingRow.device_b_type || '';
        this.deviceTypeFormData.new_vendor =
          this.currentEditingRow.device_b_vendor || '';
        this.deviceTypeFormData.current_type =
          this.currentEditingRow.device_b_type || '';
        this.deviceTypeFormData.current_block =
          this.currentEditingRow.device_b_block || '';
        this.deviceTypeFormData.current_vendor =
          this.currentEditingRow.device_b_vendor || '';
      }
    }
  }

  getCurrentDeviceType(): string {
    if (this.deviceTypeFormData.device_side && this.currentEditingRow) {
      if (this.deviceTypeFormData.device_side === 'A') {
        return this.currentEditingRow.device_a_type || 'Unknown';
      } else {
        return this.currentEditingRow.device_b_type || 'Unknown';
      }
    }
    return '';
  }

  resetDeviceTypeForm(): void {
    this.deviceTypeFormData = {
      device_ip: '',
      device_hostname: '',
      new_device_type: '',
      new_vendor: '',
      device_side: '',
      updated_by: 'system',
      current_type: '',
      current_block: '',
      current_vendor: '',
    };
    this.currentEditingRow = null;
  }

  updateDeviceType(): void {
    if (
      !this.deviceTypeFormData.device_ip ||
      !this.deviceTypeFormData.device_hostname ||
      !this.deviceTypeFormData.new_device_type
    ) {
      this.errorMessage =
        'Please fill in all required fields (IP, Hostname, and New Device Type). Vendor is optional.';
      return;
    }

    this.isLoading = true;

    const recordsToUpdate = this.excelData.filter(
      (record) =>
        (record.device_a_ip === this.deviceTypeFormData.device_ip &&
          record.device_a_hostname ===
            this.deviceTypeFormData.device_hostname) ||
        (record.device_b_ip === this.deviceTypeFormData.device_ip &&
          record.device_b_hostname === this.deviceTypeFormData.device_hostname)
    );

    if (recordsToUpdate.length === 0) {
      this.errorMessage =
        'No records found with the specified IP and hostname.';
      this.isLoading = false;
      return;
    }

    const updatePromises = recordsToUpdate.map((record) => {
      const updatedRecord = { ...record };

      if (
        record.device_a_ip === this.deviceTypeFormData.device_ip &&
        record.device_a_hostname === this.deviceTypeFormData.device_hostname
      ) {
        updatedRecord.device_a_type = this.deviceTypeFormData.new_device_type;
        if (this.deviceTypeFormData.new_vendor) {
          updatedRecord.device_a_vendor = this.deviceTypeFormData.new_vendor;
        }
      }

      if (
        record.device_b_ip === this.deviceTypeFormData.device_ip &&
        record.device_b_hostname === this.deviceTypeFormData.device_hostname
      ) {
        updatedRecord.device_b_type = this.deviceTypeFormData.new_device_type;
        if (this.deviceTypeFormData.new_vendor) {
          updatedRecord.device_b_vendor = this.deviceTypeFormData.new_vendor;
        }
      }

      updatedRecord.updated_by = this.deviceTypeFormData.updated_by;
      updatedRecord.updated_date = new Date().toISOString();

      return this.excelTableService.updateRecord(updatedRecord);
    });

    Promise.all(updatePromises.map((promise) => promise.toPromise()))
      .then((responses) => {
        const successCount = responses.filter(
          (response) => response?.success
        ).length;
        const totalCount = recordsToUpdate.length;

        if (successCount > 0) {
          this.showDeviceTypeForm = false;
          this.resetDeviceTypeForm();
          this.loadRecords();
          this.errorMessage = '';
          // alert(
          //   `✅ Device type and vendor updated successfully! ${successCount}/${totalCount} records updated.`
          // );
          this.toastService.success(
            `Device type and vendor updated successfully! ${successCount}/${totalCount} records updated.`
          );
        } else {
          this.errorMessage = 'Failed to update any records.';
        }
        this.isLoading = false;
      })
      .catch((error) => {
        console.error('Error updating device type and vendor:', error);
        this.errorMessage = 'Failed to update device type and vendor';
        this.isLoading = false;
      });
  }

  cancelDeviceTypeForm(): void {
    this.showDeviceTypeForm = false;
    this.resetDeviceTypeForm();
    this.errorMessage = '';
  }

  editDeviceTypeFromTable(row: ExcelRowData): void {
    this.deviceTypeFormData = {
      device_ip: row.device_a_ip,
      device_hostname: row.device_a_hostname,
      new_device_type: row.device_a_type,
      new_vendor: row.device_a_vendor || '',
      device_side: 'A',
      updated_by: 'system',
      current_type: row.device_a_type || '',
      current_block: row.device_a_block || '',
      current_vendor: row.device_a_vendor || '',
    };

    this.currentEditingRow = row;

    this.showDeviceTypeForm = true;
    this.errorMessage = '';
  }

  getRowCount(): number {
    return this.excelData ? this.excelData.length : 0;
  }

  getUniqueIps(): string[] {
    const ips = new Set<string>();
    this.excelData.forEach((row) => {
      if (row.device_a_ip) ips.add(row.device_a_ip);
      if (row.device_b_ip) ips.add(row.device_b_ip);
    });
    return Array.from(ips);
  }

  exportToCSV(): void {
    if (!this.hasData()) return;

    const headers = this.columns.map((col) => col.label).join(',');
    const csvContent = [
      headers,
      ...this.excelData.map((row) =>
        this.columns.map((col) => `"${row[col.key] || ''}"`).join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `network-topology-${
      new Date().toISOString().split('T')[0]
    }.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  clearData(): void {
    this.excelData = [];
    this.fileName = '';
    this.errorMessage = '';

    this.showExcelImportSection();
  }

  getTransformedData(): any[] {
    const deviceMap = new Map<string, any>();

    this.excelData.forEach((row) => {
      if (row.device_a_ip && row.device_a_hostname) {
        if (!deviceMap.has(row.device_a_ip)) {
          deviceMap.set(row.device_a_ip, {
            ip: row.device_a_ip,
            hostname: row.device_a_hostname,
            vendor: row.device_a_vendor || 'Unknown',
            type: row.device_a_type || 'Unknown',
            interfaces: [],
          });
        }
        const device = deviceMap.get(row.device_a_ip);
        if (
          row.device_a_interface &&
          !device.interfaces.includes(row.device_a_interface)
        ) {
          device.interfaces.push(row.device_a_interface);
        }
      }

      if (row.device_b_ip && row.device_b_hostname) {
        if (!deviceMap.has(row.device_b_ip)) {
          deviceMap.set(row.device_b_ip, {
            ip: row.device_b_ip,
            hostname: row.device_b_hostname,
            vendor: row.device_b_vendor || 'Unknown',
            type: row.device_b_type || 'Unknown',
            interfaces: [],
          });
        }
        const device = deviceMap.get(row.device_b_ip);
        if (
          row.device_b_interface &&
          !device.interfaces.includes(row.device_b_interface)
        ) {
          device.interfaces.push(row.device_b_interface);
        }
      }
    });

    return Array.from(deviceMap.values());
  }

  getFilteredData(): ExcelRowData[] {
    if (!this.searchTerm || this.searchTerm.trim() === '') {
      return this.excelData;
    }

    const term = this.searchTerm.toLowerCase().trim();

    return this.excelData.filter((row) => {
      return (
        (row.device_a_ip && row.device_a_ip.toLowerCase().includes(term)) ||
        (row.device_a_hostname &&
          row.device_a_hostname.toLowerCase().includes(term)) ||
        (row.device_a_interface &&
          row.device_a_interface.toLowerCase().includes(term)) ||
        (row.device_a_type && row.device_a_type.toLowerCase().includes(term)) ||
        (row.device_a_vendor &&
          row.device_a_vendor.toLowerCase().includes(term)) ||
        (row.device_a_block &&
          row.device_a_block.toLowerCase().includes(term)) ||
        (row.device_b_ip && row.device_b_ip.toLowerCase().includes(term)) ||
        (row.device_b_hostname &&
          row.device_b_hostname.toLowerCase().includes(term)) ||
        (row.device_b_interface &&
          row.device_b_interface.toLowerCase().includes(term)) ||
        (row.device_b_type && row.device_b_type.toLowerCase().includes(term)) ||
        (row.device_b_vendor &&
          row.device_b_vendor.toLowerCase().includes(term)) ||
        (row.device_b_block &&
          row.device_b_block.toLowerCase().includes(term)) ||
        (row.comments && row.comments.toLowerCase().includes(term))
      );
    });
  }

  clearSearch(): void {
    this.searchTerm = '';
  }

  // Blocks management methods
  showBlocksDetail(): void {
    this.showBlocksModal = true;
    this.loadBlocks();
  }

  loadBlocks(): void {
    this.isLoading = true;
    this.excelTableService.getNetworkTopologyBlocks().subscribe({
      next: (response) => {
        console.log('Blocks response:', response);
        if (response.success && response.data) {
          this.blocksList = response.data;
        } else {
          this.toastService.error(response.error || 'Failed to load blocks');
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading blocks:', error);
        this.toastService.error('Failed to load blocks from server');
        this.isLoading = false;
      },
    });
  }

  startEditingBlock(block: any): void {
    this.editingBlockId = block.ID;
    this.editingBlockName = block.BLOCK_NAME;
  }

  cancelEditingBlock(): void {
    this.editingBlockId = null;
    this.editingBlockName = '';
  }

  saveBlockEdit(): void {
    if (!this.editingBlockId || !this.editingBlockName.trim()) {
      this.toastService.error('Please enter a valid block name');
      return;
    }

    this.isLoading = true;
    this.excelTableService
      .updateNetworkTopologyBlock(
        this.editingBlockId,
        this.editingBlockName.trim(),
        'system' // You can make this configurable
      )
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.toastService.success(`Block updated successfully`);
            this.loadBlocks(); // Reload the blocks list
            this.cancelEditingBlock();
          } else {
            this.toastService.error(response.error || 'Failed to update block');
          }
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error updating block:', error);
          this.toastService.error('Failed to update block');
          this.isLoading = false;
        },
      });
  }

  confirmDeleteBlock(block: any): void {
    this.deletingBlock = block;
    this.showDeleteBlockConfirm = true;
  }

  deleteBlock(): void {
    if (!this.deletingBlock) return;

    this.isLoading = true;
    this.excelTableService
      .deleteNetworkTopologyBlock(
        this.deletingBlock.ID,
        'system' // You can make this configurable
      )
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.toastService.success(
              `Block "${this.deletingBlock.BLOCK_NAME}" deleted successfully`
            );
            this.loadBlocks(); // Reload the blocks list
            this.cancelDeleteBlock();
          } else {
            this.toastService.error(response.error || 'Failed to delete block');
          }
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error deleting block:', error);
          this.toastService.error('Failed to delete block');
          this.isLoading = false;
        },
      });
  }

  cancelDeleteBlock(): void {
    this.showDeleteBlockConfirm = false;
    this.deletingBlock = null;
  }

  closeBlocksModal(): void {
    this.showBlocksModal = false;
    this.cancelEditingBlock();
    this.cancelDeleteBlock();
    this.cancelAddBlock();
    this.errorMessage = '';
  }

  // Add new block methods
  showAddBlockForm(): void {
    this.showAddBlockFormFlag = true;
    this.newBlockName = '';
  }

  cancelAddBlock(): void {
    this.showAddBlockFormFlag = false;
    this.newBlockName = '';
  }

  addNewBlock(): void {
    if (!this.newBlockName || this.newBlockName.trim() === '') {
      this.toastService.error('Please enter a block name');
      return;
    }

    this.isLoading = true;
    this.excelTableService
      .addNetworkTopologyBlock(this.newBlockName.trim(), 'system')
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.toastService.success(
              `Block "${this.newBlockName}" added successfully`
            );
            this.loadBlocks();
            this.cancelAddBlock();
          } else {
            this.toastService.error(response.error || 'Failed to add block');
          }
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error adding block:', error);
          this.toastService.error('Failed to add block');
          this.isLoading = false;
        },
      });
  }

  // Extract unique block names from Excel data
  extractUniqueBlocks(normalizedRows: ExcelRowData[]): string[] {
    const blockSet = new Set<string>();

    normalizedRows.forEach((row) => {
      // Add Device A block if it exists
      if (row.device_a_block && row.device_a_block.trim() !== '') {
        blockSet.add(row.device_a_block.trim());
      }

      // Add Device B block if it exists
      if (row.device_b_block && row.device_b_block.trim() !== '') {
        blockSet.add(row.device_b_block.trim());
      }
    });

    // Convert Set to Array and sort alphabetically
    return Array.from(blockSet).sort();
  }

  // Create blocks from Excel data
  createBlocksFromExcel(uniqueBlocks: string[]): void {
    console.log('Creating blocks in database:', uniqueBlocks);

    this.excelTableService
      .addNetworkTopologyBlocksBulk(
        uniqueBlocks,
        'excel-import' // You can make this configurable
      )
      .subscribe({
        next: (response) => {
          console.log('Blocks creation response:', response);
          if (response?.success) {
            this.blockCreationResults = {
              created: response.created_count || 0,
              skipped: response.skipped_count || 0,
              total: uniqueBlocks.length,
            };
            console.log('Blocks creation result:', this.blockCreationResults);
          } else {
            console.error('Failed to create blocks:', response.error);
            this.blockCreationResults = {
              created: 0,
              skipped: 0,
              total: uniqueBlocks.length,
            };
          }
        },
        error: (error) => {
          console.error('Error creating blocks:', error);
          this.blockCreationResults = {
            created: 0,
            skipped: 0,
            total: uniqueBlocks.length,
          };
        },
      });
  }

  // Get extracted unique blocks from last Excel import
  getExtractedUniqueBlocks(): string[] {
    return this.extractedUniqueBlocks;
  }

  // Get block creation results from last Excel import
  getBlockCreationResults(): {
    created: number;
    skipped: number;
    total: number;
  } {
    return this.blockCreationResults;
  }

  // Check if blocks were extracted from Excel
  hasExtractedBlocks(): boolean {
    return this.extractedUniqueBlocks.length > 0;
  }
}
