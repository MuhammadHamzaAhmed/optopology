import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Interface matching the backend API structure
export interface ExcelTableRecord {
  id?: number;
  device_a_ip: string;
  device_a_hostname: string;
  device_a_interface: string;
  device_a_type: string;
  device_a_vendor: string;
  device_a_block: string | null;
  device_b_ip: string;
  device_b_hostname: string;
  device_b_interface: string;
  device_b_type: string;
  device_b_vendor: string;
  device_b_block: string | null;
  comments: string;
  updated_by?: string;
  created_date?: string;
  updated_date?: string;
  [key: string]: string | number | null | undefined;
}

export interface NetworkTopologyBlockResponse {
  success: boolean;
  data?: NetworkTopologyBlockResponse[];
  message?: string;
  total_records?: number;
  error?: string;
  created_count?: number;
  skipped_count?: number;
  block_ids?: number[];
}

export interface ExcelTableResponse {
  success: boolean;
  data?: ExcelTableRecord[];
  message?: string;
  total_records?: number;
  error?: string;
}

export interface BulkImportResponse {
  success: boolean;
  message: string;
  inserted_count: number;
  total_records: number;
  inserted_ids: number[];
  errors?: string[];
  error_count?: number;
}

export interface DeviceTypeUpdateResponse {
  success: boolean;
  message?: string;
  error?: string;
  device_ip?: string;
  device_hostname?: string;
  new_device_type?: string;
  rows_updated?: number;
  updated_at?: string;
}

export interface HeaderedImportResponse {
  success: boolean;
  message: string;
  inserted_count: number;
  skipped_count: number;
  total_records: number;
  inserted_ids: number[];
  skipped: { index: number; reason: string }[];
  errors?: string[];
}

@Injectable({
  providedIn: 'root',
})
export class ExcelTableService {
  private baseUrl = environment.serverurl + '/topology-api';

  private httpOptions = {
    headers: new HttpHeaders({
      'Content-Type': 'application/json',
    }),
  };

  constructor(private http: HttpClient) {}

  // Get all records with optional search
  getRecords(search?: string): Observable<ExcelTableResponse> {
    let url = `${this.baseUrl}/network-topology-get`;
    if (search) {
      url += `?search=${encodeURIComponent(search)}`;
    }
    return this.http.get<ExcelTableResponse>(url);
  }

  // Add single record
  addRecord(record: ExcelTableRecord): Observable<ExcelTableResponse> {
    const payload = {
      ...record,
      updated_by: record.updated_by || 'system',
    };
    return this.http.post<ExcelTableResponse>(
      `${this.baseUrl}/network-topology-add`,
      payload,
      this.httpOptions
    );
  }

  // Add multiple records (bulk import)
  addRecordsBulk(records: ExcelTableRecord[]): Observable<BulkImportResponse> {
    const payload = records.map((record) => ({
      ...record,
      updated_by: record.updated_by || 'system',
    }));
    return this.http.post<BulkImportResponse>(
      `${this.baseUrl}/network-topology-add-bulk`,
      payload,
      this.httpOptions
    );
  }

  // Import header-based rows directly (backend parses headers and inserts)
  importHeaderedRows(rows: any[]): Observable<HeaderedImportResponse> {
    const payload = { rows };
    return this.http.post<HeaderedImportResponse>(
      `${this.baseUrl}/import-excel-headered`,
      payload,
      this.httpOptions
    );
  }

  // Update existing record
  updateRecord(record: ExcelTableRecord): Observable<ExcelTableResponse> {
    if (!record['record_id'] && !record.id) {
      throw new Error('Record ID is required for update');
    }
    const payload = {
      ...record,
      record_id: record['record_id'] || record.id,
      updated_by: record.updated_by || 'system',
    };
    return this.http.put<ExcelTableResponse>(
      `${this.baseUrl}/network-topology-update`,
      payload,
      this.httpOptions
    );
  }

  // Delete record
  deleteRecord(
    recordId: number,
    updatedBy?: string
  ): Observable<ExcelTableResponse> {
    const payload = {
      record_id: recordId,
      updated_by: updatedBy || 'system',
    };
    return this.http.delete<ExcelTableResponse>(
      `${this.baseUrl}/network-topology-delete`,
      { ...this.httpOptions, body: payload }
    );
  }

  // Update device type
  updateDeviceType(
    deviceIp: string,
    deviceHostname: string,
    newDeviceType: string,
    updatedBy?: string
  ): Observable<DeviceTypeUpdateResponse> {
    const payload = {
      device_ip: deviceIp,
      device_hostname: deviceHostname,
      new_device_type: newDeviceType,
      updated_by: updatedBy || 'system',
    };
    return this.http.put<DeviceTypeUpdateResponse>(
      `${this.baseUrl}/update-device-type`,
      payload,
      this.httpOptions
    );
  }

  // Permission check
  permissionCheck(): Observable<any> {
    return this.http.get(`${this.baseUrl}/permission-check`, this.httpOptions);
  }

  // Health check
  healthCheck(): Observable<any> {
    return this.http.get(`${this.baseUrl}/health`);
  }

  // Network topology block get
  getNetworkTopologyBlocks(): Observable<NetworkTopologyBlockResponse> {
    return this.http.get<NetworkTopologyBlockResponse>(
      `${this.baseUrl}/network-topology-block-get`,
      this.httpOptions
    );
  }

  // Network topology block add
  addNetworkTopologyBlock(
    blockName: string,
    createdBy: string
  ): Observable<NetworkTopologyBlockResponse> {
    const payload = {
      block_name: blockName,
      created_by: createdBy,
    };
    return this.http.post<NetworkTopologyBlockResponse>(
      `${this.baseUrl}/network-topology-block-add`,
      payload,
      this.httpOptions
    );
  }

  // Network topology block update
  updateNetworkTopologyBlock(
    blockId: number,
    blockName: string,
    updatedBy: string
  ): Observable<NetworkTopologyBlockResponse> {
    const payload = {
      block_id: blockId,
      block_name: blockName,
      updated_by: updatedBy,
    };
    return this.http.put<NetworkTopologyBlockResponse>(
      `${this.baseUrl}/network-topology-block-update`,
      payload,
      this.httpOptions
    );
  }

  // Network topology block delete
  deleteNetworkTopologyBlock(
    blockId: number,
    updatedBy: string
  ): Observable<NetworkTopologyBlockResponse> {
    const payload = {
      block_id: blockId,
      updated_by: updatedBy,
    };
    return this.http.delete<NetworkTopologyBlockResponse>(
      `${this.baseUrl}/network-topology-block-delete`,
      { ...this.httpOptions, body: payload }
    );
  }

  // Network topology block add bulk
  addNetworkTopologyBlocksBulk(
    blockNames: string[],
    createdBy: string
  ): Observable<NetworkTopologyBlockResponse> {
    const payload = {
      block_names: blockNames,
      created_by: createdBy,
    };
    return this.http.post<NetworkTopologyBlockResponse>(
      `${this.baseUrl}/network-topology-block-add-bulk`,
      payload,
      this.httpOptions
    );
  }

  deleteNetworkTopologyBulk(
    recordIds: number[],
    updatedBy: string
  ): Observable<NetworkTopologyBlockResponse> {
    const payload = {
      record_ids: recordIds,
      updated_by: updatedBy,
    };
    return this.http.delete<NetworkTopologyBlockResponse>(
      `${this.baseUrl}/network-topology-bulk-delete-by-ids`,
      { ...this.httpOptions, body: payload }
    );
  }

  deleteByHostnameIp(
    hostname: string,
    ip: string,
    updatedBy: string
  ): Observable<NetworkTopologyBlockResponse> {
    const payload = {
      hostname,
      ip,
      updated_by: updatedBy,
    };
    return this.http.delete<NetworkTopologyBlockResponse>(
      `${this.baseUrl}/network-topology-delete-by-host-ip`,
      { ...this.httpOptions, body: payload }
    );
  }
}
