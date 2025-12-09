import traceback
from flask import logging
import pyodbc
from datetime import datetime
from props import db_server, db_name, db_user, db_pwd
from db.svault import get_pwd
import logging
import sys

class TopologyDBUtils:
    def __init__(self):
        """Initialize DB connection using pyodbc."""

        print(f"Connecting to {db_server} with user {db_user}",file=sys.stderr)
        try:
            self.conn = pyodbc.connect(
                driver='{ODBC Driver 17 for SQL Server}',
                server=db_server,
                database=db_name,
                uid=db_user,
                pwd=get_pwd(db_pwd)
            )
        except Exception as e:
            print(f"Error connecting to {db_server}: {str(e)}",file=sys.stderr)
            raise e

    def handleKeyError(self, body, key):
        """Gracefully handle missing keys."""
        try:
            return body[key]
        except KeyError:
            return ''

    def check_duplicate_connection(self, record):
        """
        Check for duplicate connections based on hostname+interface pairs.
        Only considers duplicates when BOTH ends match exactly (including all fields).
        """
        try:
            cursor = self.conn.cursor()
            
            da_host = str(record['device_a_hostname']).strip()
            da_intf = str(record['device_a_interface']).strip()
            db_host = str(record['device_b_hostname']).strip()
            db_intf = str(record['device_b_interface']).strip()
            da_ip = str(record.get('device_a_ip', '')).strip()
            db_ip = str(record.get('device_b_ip', '')).strip()
            at = str(record.get('device_a_type', '')).lower().strip()
            bt = str(record.get('device_b_type', '')).lower().strip()
            av = str(record.get('device_a_vendor', '')).lower().strip()
            bv = str(record.get('device_b_vendor', '')).lower().strip()
            cm = str(record.get('comments', '')).strip()

            # Check direct order (A->B)
            cursor.execute("""
                SELECT COUNT(*) FROM NETWORK_TOPOLOGY_Dashboard
                WHERE TRIM(DEVICE_A_HOSTNAME) = ? AND TRIM(DEVICE_A_INTERFACE) = ? 
                AND TRIM(DEVICE_B_HOSTNAME) = ? AND TRIM(DEVICE_B_INTERFACE) = ?
                AND COALESCE(TRIM(DEVICE_A_IP), '') = ? AND COALESCE(TRIM(DEVICE_B_IP), '') = ?
                AND COALESCE(LOWER(DEVICE_A_TYPE), '') = ? AND COALESCE(LOWER(DEVICE_B_TYPE), '') = ?
                AND COALESCE(LOWER(DEVICE_A_VENDOR), '') = ? AND COALESCE(LOWER(DEVICE_B_VENDOR), '') = ?
                AND COALESCE(TRIM(COMMENTS), '') = ?
            """, da_host, da_intf, db_host, db_intf, da_ip, db_ip, at, bt, av, bv, cm)
            
            direct_count = cursor.fetchone()[0]

            # Check swapped order (B->A)
            cursor.execute("""
                SELECT COUNT(*) FROM NETWORK_TOPOLOGY_Dashboard
                WHERE TRIM(DEVICE_A_HOSTNAME) = ? AND TRIM(DEVICE_A_INTERFACE) = ? 
                AND TRIM(DEVICE_B_HOSTNAME) = ? AND TRIM(DEVICE_B_INTERFACE) = ?
                AND COALESCE(TRIM(DEVICE_A_IP), '') = ? AND COALESCE(TRIM(DEVICE_B_IP), '') = ?
                AND COALESCE(LOWER(DEVICE_A_TYPE), '') = ? AND COALESCE(LOWER(DEVICE_B_TYPE), '') = ?
                AND COALESCE(LOWER(DEVICE_A_VENDOR), '') = ? AND COALESCE(LOWER(DEVICE_B_VENDOR), '') = ?
                AND COALESCE(TRIM(COMMENTS), '') = ?
            """, db_host, db_intf, da_host, da_intf, db_ip, da_ip, bt, at, bv, av, cm)
            
            swapped_count = cursor.fetchone()[0]

            if direct_count > 0:
                reason = (f"Duplicate by hostname+interface pair with IPs matched (A->B): "
                         f"A[{da_host}/{da_intf}](IP:{da_ip}) <-> B[{db_host}/{db_intf}](IP:{db_ip})")
                return {'is_duplicate': True, 'reason': reason}
            
            if swapped_count > 0:
                reason = (f"Duplicate by hostname+interface pair with IPs matched (B->A): "
                         f"A[{da_host}/{da_intf}](IP:{da_ip}) <-> B[{db_host}/{db_intf}](IP:{db_ip})")
                return {'is_duplicate': True, 'reason': reason}

            return {'is_duplicate': False}

        except Exception as e:
            traceback.print_exc()
            return {'is_duplicate': False, 'error': str(e)}

    def insert_dashboard_connection(self, record):
        """
        Insert a single connection record into NETWORK_TOPOLOGY_Dashboard.
        Skips insertion if an exact duplicate (A->B or B->A) already exists.
        """
        try:
            cursor = self.conn.cursor()

            # Normalize inputs (trim spaces, lowercase where needed)
            da_ip     = str(record.get('device_a_ip', '')).strip()
            da_host   = str(record.get('device_a_hostname', '')).strip()
            da_intf   = str(record.get('device_a_interface', '')).strip()
            da_type   = str(record.get('device_a_type', 'unknown')).strip().lower()
            da_vendor = str(record.get('device_a_vendor', 'unknown')).strip().lower()

            db_ip     = str(record.get('device_b_ip', '')).strip()
            db_host   = str(record.get('device_b_hostname', '')).strip()
            db_intf   = str(record.get('device_b_interface', '')).strip()
            db_type   = str(record.get('device_b_type', 'unknown')).strip().lower()
            db_vendor = str(record.get('device_b_vendor', 'unknown')).strip().lower()

            comments  = str(record.get('comments', '')).strip()

            # --- Debug logging (optional) ---
            print("DEBUG: Checking values for duplicate:")
            print(f"  Device A -> {da_host}/{da_intf}, IP={da_ip}, Type={da_type}, Vendor={da_vendor}")
            print(f"  Device B -> {db_host}/{db_intf}, IP={db_ip}, Type={db_type}, Vendor={db_vendor}")
            print(f"  Comments : {comments}")

            # Direct duplicate check (A -> B)
            cursor.execute("""
                SELECT COUNT(*) FROM NETWORK_TOPOLOGY_Dashboard
                WHERE DEVICE_A_HOSTNAME = ? AND DEVICE_A_INTERFACE = ?
                AND DEVICE_B_HOSTNAME = ? AND DEVICE_B_INTERFACE = ?
                AND DEVICE_A_IP = ? AND DEVICE_B_IP = ?
                AND DEVICE_A_TYPE = ? AND DEVICE_B_TYPE = ?
                AND DEVICE_A_VENDOR = ? AND DEVICE_B_VENDOR = ?
                AND COMMENTS = ?
            """, (da_host, da_intf, db_host, db_intf,
                da_ip, db_ip, da_type, db_type,
                da_vendor, db_vendor, comments))
            direct_count = cursor.fetchone()[0]

            # Reverse duplicate check (B -> A)
            cursor.execute("""
                SELECT COUNT(*) FROM NETWORK_TOPOLOGY_Dashboard
                WHERE DEVICE_A_HOSTNAME = ? AND DEVICE_A_INTERFACE = ?
                AND DEVICE_B_HOSTNAME = ? AND DEVICE_B_INTERFACE = ?
                AND DEVICE_A_IP = ? AND DEVICE_B_IP = ?
                AND DEVICE_A_TYPE = ? AND DEVICE_B_TYPE = ?
                AND DEVICE_A_VENDOR = ? AND DEVICE_B_VENDOR = ?
                AND COMMENTS = ?
            """, (db_host, db_intf, da_host, da_intf,
                db_ip, da_ip, db_type, da_type,
                db_vendor, da_vendor, comments))
            reverse_count = cursor.fetchone()[0]

            if direct_count > 0 or reverse_count > 0:
                print("DEBUG: Exact duplicate found -> Skipping insertion")
                return {
                    'status': 'Skipped',
                    'message': 'Exact record already exists in database',
                    'is_duplicate': True,
                    'inserted_count': 0
                }

            # --- Insert new record ---
            print("DEBUG: No duplicate found -> Inserting new record")
            cursor.execute("""
                INSERT INTO NETWORK_TOPOLOGY_Dashboard (
                    DEVICE_A_IP, DEVICE_A_HOSTNAME, DEVICE_A_INTERFACE, DEVICE_A_TYPE, DEVICE_A_VENDOR, DEVICE_A_BLOCK,
                    DEVICE_B_IP, DEVICE_B_HOSTNAME, DEVICE_B_INTERFACE, DEVICE_B_TYPE, DEVICE_B_VENDOR, DEVICE_B_BLOCK,
                    COMMENTS, UPDATED_BY, CREATED_DATE, UPDATED_DATE, CREATED_BY
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                da_ip, da_host, da_intf, da_type, da_vendor, record.get('device_a_block', ''),
                db_ip, db_host, db_intf, db_type, db_vendor, record.get('device_b_block', ''),
                comments, record['updated_by'], datetime.now(), datetime.now(), record['created_by']
            ))

            self.conn.commit()

            try:
                cursor.execute("SELECT @@IDENTITY")
                record_id = cursor.fetchone()[0]
                return {
                    'status': 'Success',
                    'record_id': int(record_id) if record_id else None,
                    'inserted_count': 1
                }
            except:
                return {
                    'status': 'Success',
                    'inserted_count': 1
                }

        except Exception as e:
            traceback.print_exc()
            return {
                'status': 'Failed',
                'error': str(e),
                'inserted_count': 0
            }

    def update_dashboard_connection(self, record):
        """
        Update an existing connection record in NETWORK_TOPOLOGY_Dashboard.
        """
        try:
            cursor = self.conn.cursor()
            cursor.execute("""
                UPDATE NETWORK_TOPOLOGY_Dashboard
                SET DEVICE_A_IP = ?,
                    DEVICE_A_HOSTNAME = ?,
                    DEVICE_A_INTERFACE = ?,
                    DEVICE_A_TYPE = ?,
                    DEVICE_A_VENDOR = ?,
                    DEVICE_A_BLOCK = ?,
                    DEVICE_B_IP = ?,
                    DEVICE_B_HOSTNAME = ?,
                    DEVICE_B_INTERFACE = ?,
                    DEVICE_B_TYPE = ?,
                    DEVICE_B_VENDOR = ?,
                    DEVICE_B_BLOCK = ?,
                    COMMENTS = ?,
                    UPDATED_BY = ?,
                    UPDATED_DATE = ?
                WHERE ID = ?
            """,
                record['device_a_ip'],
                record['device_a_hostname'],
                record['device_a_interface'],
                record.get('device_a_type', 'unknown') or 'unknown',
                record.get('device_a_vendor', 'unknown') or 'unknown',
                record.get('device_a_block', '') or '',
                record.get('device_b_ip', '') or '',
                record['device_b_hostname'],
                record.get('device_b_interface', '') or '',
                record.get('device_b_type', 'unknown') or 'unknown',
                record.get('device_b_vendor', 'unknown') or 'unknown',
                record.get('device_b_block', '') or '',
                record.get('comments', '') or '',
                record['updated_by'],
                datetime.now(),
                record['record_id']
            )
            cursor.commit()
            
            rows_updated = cursor.rowcount
            
            if rows_updated == 0:
                return {
                    'status': 'Failed',
                    'message': f'No record found with ID: {record["record_id"]}'
                }
            
            return {
                'status': 'Success',
                'rows_updated': rows_updated
            }
                
        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}

    def delete_dashboard_connection(self, record_id, updated_by):
        """
        Delete a connection record from NETWORK_TOPOLOGY_Dashboard.
        Attempts soft delete first (IS_ACTIVE = 0), falls back to hard delete if column doesn't exist.
        """
        try:
            cursor = self.conn.cursor()
            
            # Try soft delete first (IS_ACTIVE = 0)
            try:
                cursor.execute("""
                    UPDATE NETWORK_TOPOLOGY_Dashboard
                    SET IS_ACTIVE = 0,
                        UPDATED_BY = ?,
                        UPDATED_DATE = ?
                    WHERE ID = ?
                """, updated_by, datetime.now(), record_id)
                
                rows_deleted = cursor.rowcount
                
                if rows_deleted > 0:
                    cursor.commit()
                    return {
                        'status': 'Success',
                        'rows_deleted': rows_deleted,
                        'delete_type': 'soft'
                    }
                    
            except Exception as soft_delete_error:
                # If soft delete fails (e.g., IS_ACTIVE column doesn't exist), try hard delete
                cursor.execute("DELETE FROM NETWORK_TOPOLOGY_Dashboard WHERE ID = ?", record_id)
                rows_deleted = cursor.rowcount
                
                if rows_deleted > 0:
                    cursor.commit()
                    return {
                        'status': 'Success',
                        'rows_deleted': rows_deleted,
                        'delete_type': 'hard'
                    }
            
            # If no rows were affected, record doesn't exist
            if rows_deleted == 0:
                return {
                    'status': 'Failed',
                    'message': f'No record found with ID: {record_id}'
                }
                
        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}

    def get_dashboard_connections(self, search=''):
        """
        Retrieve all connection records from NETWORK_TOPOLOGY_Dashboard with optional search.
        """
        try:
            cursor = self.conn.cursor()
            
            # Build query with optional search
            base_query = """
                SELECT ID, DEVICE_A_IP, DEVICE_A_HOSTNAME, DEVICE_A_INTERFACE, DEVICE_A_TYPE, DEVICE_A_VENDOR, DEVICE_A_BLOCK,
                       DEVICE_B_IP, DEVICE_B_HOSTNAME, DEVICE_B_INTERFACE, DEVICE_B_TYPE, DEVICE_B_VENDOR, DEVICE_B_BLOCK,
                       COMMENTS, UPDATED_BY, CREATED_DATE, UPDATED_DATE
                FROM NETWORK_TOPOLOGY_Dashboard
            """
            
            where_clause = ""
            params = []
            
            if search and search.strip():
                where_clause = """
                WHERE DEVICE_A_IP LIKE ? OR DEVICE_A_HOSTNAME LIKE ? OR 
                      DEVICE_B_IP LIKE ? OR DEVICE_B_HOSTNAME LIKE ?
                """
                search_term = f'%{search.strip()}%'
                params = [search_term, search_term, search_term, search_term]
            
            # Build the final query
            if where_clause:
                query = base_query + where_clause + " ORDER BY CREATED_DATE DESC"
            else:
                query = base_query + " ORDER BY CREATED_DATE DESC"
            
            cursor.execute(query, params)
            rows = cursor.fetchall()
            
            # Get total count
            if where_clause:
                count_query = f"""
                SELECT COUNT(*) FROM NETWORK_TOPOLOGY_Dashboard {where_clause}
                """
                count_params = params
            else:
                count_query = "SELECT COUNT(*) FROM NETWORK_TOPOLOGY_Dashboard"
                count_params = []
            
            cursor.execute(count_query, count_params)
            total_count = cursor.fetchone()[0]
            
            # Convert rows to list of dictionaries
            records = []
            for row in rows:
                records.append({
                    'id': row[0],
                    'device_a_ip': row[1],
                    'device_a_hostname': row[2],
                    'device_a_interface': row[3],
                    'device_a_type': row[4],
                    'device_a_vendor': row[5],
                    'device_a_block': row[6],
                    'device_b_ip': row[7],
                    'device_b_hostname': row[8],
                    'device_b_interface': row[9],
                    'device_b_type': row[10],
                    'device_b_vendor': row[11],
                    'device_b_block': row[12],
                    'comments': row[13],
                    'updated_by': row[14],
                    'created_date': row[15].isoformat() if row[15] else None,
                    'updated_date': row[16].isoformat() if row[16] else None
                })
            
            return {
                'status': 'Success',
                'records': records,
                'total_count': total_count
            }
            
        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}

    def update_device_type(self, device_ip, device_hostname, new_device_type, updated_by):
        """
        Update device type by IP and hostname.
        Searches both Device A and Device B columns and updates the type
        regardless of which side the device appears on.
        """
        try:
            cursor = self.conn.cursor()
            current_time = datetime.now()
            
            # Update device type in Device A columns
            cursor.execute("""
                UPDATE NETWORK_TOPOLOGY_Dashboard
                SET DEVICE_A_TYPE = ?,
                    UPDATED_BY = ?,
                    UPDATED_DATE = ?
                WHERE DEVICE_A_IP = ? AND DEVICE_A_HOSTNAME = ?
            """, new_device_type, updated_by, current_time, device_ip, device_hostname)
            
            rows_updated_a = cursor.rowcount
            
            # Update device type in Device B columns
            cursor.execute("""
                UPDATE NETWORK_TOPOLOGY_Dashboard
                SET DEVICE_B_TYPE = ?,
                    UPDATED_BY = ?,
                    UPDATED_DATE = ?
                WHERE DEVICE_B_IP = ? AND DEVICE_B_HOSTNAME = ?
            """, new_device_type, updated_by, current_time, device_ip, device_hostname)
            
            rows_updated_b = cursor.rowcount
            
            cursor.commit()
            
            total_rows_updated = rows_updated_a + rows_updated_b
            
            if total_rows_updated == 0:
                return {
                    'status': 'Failed',
                    'message': f'No device found with IP: {device_ip} and hostname: {device_hostname}'
                }
            
            return {
                'status': 'Success',
                'rows_updated': total_rows_updated,
                'updated_at': current_time.isoformat()
            }
            
        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}

    def save_device_positions_bulk(self, positions, changed_by):
        """
        Save device and block positions in bulk.
        Accepts a map of positions keyed by nodeId. 
        
        This method tries multiple strategies to identify and update devices:
        1. First tries to match by IP address (for devices with IPs)
        2. Then tries to match by hostname (for devices with or without IPs)
        3. Finally tries to match by block ID (for network blocks)
        
        Any device can be saved at any position, regardless of device type or whether it has an IP/block.
        This explicitly supports devices that have NO IP addresses - they will be matched by hostname.
        """
        try:
            cursor = self.conn.cursor()
            current_time = datetime.now()
            
            device_updates = 0
            block_updates = 0
            per_key_rows = {}
            
            from utils.topology_utilities import TopologyUtilities
            topology_utils = TopologyUtilities()
            
            def clean_key(k):
                """Clean key - treat '-', 'null', 'None', etc. as empty"""
                if k is None:
                    return ''
                cleaned = str(k).strip()
                empty_vals = {'-', '', 'none', 'null', 'undefined', 'n/a', 'na'}
                return '' if cleaned.lower() in empty_vals else cleaned
            
            for key, pos in positions.items():
                key = clean_key(key)
                # Skip empty/null keys
                if not key:
                    continue
                
                # Validate position object
                if not isinstance(pos, dict) or 'x' not in pos or 'y' not in pos:
                    logging.warning(f"Skipping invalid position data for key: {key}")
                    continue

                try:
                    x = float(pos.get('x', 0))
                    y = float(pos.get('y', 0))
                except Exception:
                    logging.warning(f"Skipping invalid position coordinates for key: {key}")
                    continue

                total_rows_for_key = 0
                
                # Strategy 1: Try to update by IP address (if key looks like an IP)
                if topology_utils.is_ipv4(key):
                    # Update device positions for both sides where this IP appears
                    cursor.execute("""
                        UPDATE NETWORK_TOPOLOGY_Dashboard
                        SET DEVICE_A_POSITION_X = ?,
                            DEVICE_A_POSITION_Y = ?,
                            UPDATED_DATE = ?,
                            UPDATED_BY = ?
                        WHERE DEVICE_A_IP = ?
                    """, x, y, current_time, changed_by, key)
                    
                    rows_updated_a = cursor.rowcount
                    
                    cursor.execute("""
                        UPDATE NETWORK_TOPOLOGY_Dashboard
                        SET DEVICE_B_POSITION_X = ?,
                            DEVICE_B_POSITION_Y = ?,
                            UPDATED_DATE = ?,
                            UPDATED_BY = ?
                        WHERE DEVICE_B_IP = ?
                    """, x, y, current_time, changed_by, key)
                    
                    rows_updated_b = cursor.rowcount
                    
                    total_rows_for_key = rows_updated_a + rows_updated_b
                    device_updates += total_rows_for_key
                
                # Strategy 2: Try to update by hostname (for devices with or without IPs)
                if total_rows_for_key == 0 and not topology_utils.is_ipv4(key):
                    cursor.execute("""
                        UPDATE NETWORK_TOPOLOGY_Dashboard
                        SET DEVICE_A_POSITION_X = ?,
                            DEVICE_A_POSITION_Y = ?,
                            UPDATED_DATE = ?,
                            UPDATED_BY = ?
                        WHERE DEVICE_A_HOSTNAME = ?
                        AND (DEVICE_A_IP IS NULL OR DEVICE_A_IP = '')
                    """, x, y, current_time, changed_by, key)
                    
                    rows_updated_a = cursor.rowcount
                    
                    cursor.execute("""
                        UPDATE NETWORK_TOPOLOGY_Dashboard
                        SET DEVICE_B_POSITION_X = ?,
                            DEVICE_B_POSITION_Y = ?,
                            UPDATED_DATE = ?,
                            UPDATED_BY = ?
                        WHERE DEVICE_B_HOSTNAME = ?
                        AND (DEVICE_B_IP IS NULL OR DEVICE_B_IP = '')
                    """, x, y, current_time, changed_by, key)
                    
                    rows_updated_b = cursor.rowcount
                    
                    hostname_rows = rows_updated_a + rows_updated_b
                    total_rows_for_key += hostname_rows
                    device_updates += hostname_rows
                
                # Strategy 3: Try to update block positions (if no device matches found)
                if total_rows_for_key == 0:
                    cursor.execute("""
                        UPDATE NETWORK_TOPOLOGY_Dashboard
                        SET DEVICE_A_BLOCK_POSITION_X = ?,
                            DEVICE_A_BLOCK_POSITION_Y = ?,
                            UPDATED_DATE = ?,
                            UPDATED_BY = ?
                        WHERE DEVICE_A_BLOCK = ?
                    """, x, y, current_time, changed_by, key)
                    
                    rows_updated_ba = cursor.rowcount
                    
                    cursor.execute("""
                        UPDATE NETWORK_TOPOLOGY_Dashboard
                        SET DEVICE_B_BLOCK_POSITION_X = ?,
                            DEVICE_B_BLOCK_POSITION_Y = ?,
                            UPDATED_DATE = ?,
                            UPDATED_BY = ?
                        WHERE DEVICE_B_BLOCK = ?
                    """, x, y, current_time, changed_by, key)
                    
                    rows_updated_bb = cursor.rowcount
                    
                    block_rows = rows_updated_ba + rows_updated_bb
                    total_rows_for_key += block_rows
                    block_updates += block_rows
                
                per_key_rows[key] = total_rows_for_key
                
                if total_rows_for_key > 50:
                    logging.warning(f"Large position update: Key '{key}' affected {total_rows_for_key} rows")
            
            cursor.commit()
            
            total_updates = device_updates + block_updates
            if total_updates > 500:
                logging.warning(f"Very large bulk update: {total_updates} total rows affected")
            
            return {
                'status': 'Success',
                'device_rows_updated': device_updates,
                'block_rows_updated': block_updates,
                'per_key_rows': per_key_rows,
                'updated_at': current_time.isoformat()
            }
            
        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}



    def insert_dashboard_connections_bulk(self, records):
        """
        Insert multiple connection records into NETWORK_TOPOLOGY_Dashboard.
        Handles bulk operations with error tracking and record ID collection.
        """
        try:
            cursor = self.conn.cursor()
            inserted_count = 0
            errors = []
            inserted_ids = []
            
            for idx, record in enumerate(records):
                try:
                    # Validate required fields
                    required_fields = [
                        'device_a_ip', 'device_a_hostname', 'device_a_interface',
                        'device_b_hostname'
                    ]
                    
                    missing_fields = [field for field in required_fields if not record.get(field)]
                    if missing_fields:
                        errors.append(f"Row {idx + 1}: Missing required fields: {missing_fields}")
                        continue
                    
                    # Insert record
                    cursor.execute("""
                        INSERT INTO NETWORK_TOPOLOGY_Dashboard (
                            DEVICE_A_IP, DEVICE_A_HOSTNAME, DEVICE_A_INTERFACE, DEVICE_A_TYPE, DEVICE_A_VENDOR, DEVICE_A_BLOCK,
                            DEVICE_B_IP, DEVICE_B_HOSTNAME, DEVICE_B_INTERFACE, DEVICE_B_TYPE, DEVICE_B_VENDOR, DEVICE_B_BLOCK,
                            COMMENTS, UPDATED_BY, CREATED_DATE, UPDATED_DATE, CREATED_BY
                        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                        record['device_a_ip'],
                        record['device_a_hostname'],
                        record['device_a_interface'],
                        record.get('device_a_type', 'unknown') or 'unknown',
                        record.get('device_a_vendor', 'unknown') or 'unknown',
                        record.get('device_a_block', '') or '',
                        record['device_b_ip'],
                        record['device_b_hostname'],
                        record['device_b_interface'],
                        record.get('device_b_type', 'unknown') or 'unknown',
                        record.get('device_b_vendor', 'unknown') or 'unknown',
                        record.get('device_b_block', '') or '',
                        record.get('comments', '') or '',
                        record['updated_by'],
                        datetime.now(),
                        datetime.now(),
                        record['created_by']
                    )
                    
                    # Get the inserted record ID
                    try:
                        cursor.execute("SELECT @@IDENTITY")
                        record_id = cursor.fetchone()[0]
                        if record_id:
                            inserted_ids.append(int(record_id))
                    except:
                        pass
                    
                    inserted_count += 1
                    
                except Exception as e:
                    errors.append(f"Row {idx + 1}: {str(e)}")
            
            cursor.commit()
            
            result = {
                'status': 'Success',
                'inserted_count': inserted_count,
                'total_records': len(records),
                'inserted_ids': inserted_ids
            }
            
            if errors:
                result['errors'] = errors
                result['error_count'] = len(errors)
            
            return result
            
        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}


    # def get_network_topology_dashboard_data(self):
    #     """
    #     Retrieve network topology data from NETWORK_TOPOLOGY_Dashboard table.
    #     Returns connection records for processing.
    #     """
    #     try:
    #         cursor = self.conn.cursor()
            
    #         # Get all connection records from Dashboard table
    #         cursor.execute("""
    #             SELECT 
    #                 DEVICE_A_IP, DEVICE_A_HOSTNAME, DEVICE_A_INTERFACE, DEVICE_A_TYPE, DEVICE_A_VENDOR, DEVICE_A_BLOCK,
    #                 DEVICE_A_POSITION_X, DEVICE_A_POSITION_Y, DEVICE_A_BLOCK_POSITION_X, DEVICE_A_BLOCK_POSITION_Y,
    #                 DEVICE_B_IP, DEVICE_B_HOSTNAME, DEVICE_B_INTERFACE, DEVICE_B_TYPE, DEVICE_B_VENDOR, DEVICE_B_BLOCK,
    #                 DEVICE_B_POSITION_X, DEVICE_B_POSITION_Y, DEVICE_B_BLOCK_POSITION_X, DEVICE_B_BLOCK_POSITION_Y,
    #                 COMMENTS, CREATED_DATE, UPDATED_DATE
    #             FROM NETWORK_TOPOLOGY_Dashboard
    #             ORDER BY UPDATED_DATE DESC, CREATED_DATE DESC
    #         """)
            
    #         connection_rows = cursor.fetchall()
            
    #         return {
    #             'status': 'Success',
    #             'connections': connection_rows
    #         }
            
    #     except Exception as e:
    #         traceback.print_exc()
    #         return {'status': 'Failed', 'error': str(e)}

    def get_network_topology_dashboard_data(self):
        """
        Retrieve network topology data from NETWORK_TOPOLOGY_Dashboard table.
        Returns connection records for processing.
        """
        try:
            cursor = self.conn.cursor()

            # logging.info(f"get_network_topology_dashboard_data at {datetime.now()}")
            # Get all connection records from Dashboard table
            cursor.execute("""
                SELECT 
                    DEVICE_A_IP, DEVICE_A_HOSTNAME, DEVICE_A_INTERFACE, DEVICE_A_TYPE, DEVICE_A_VENDOR, DEVICE_A_BLOCK,
                    DEVICE_A_POSITION_X, DEVICE_A_POSITION_Y, DEVICE_A_BLOCK_POSITION_X, DEVICE_A_BLOCK_POSITION_Y,
                    DEVICE_B_IP, DEVICE_B_HOSTNAME, DEVICE_B_INTERFACE, DEVICE_B_TYPE, DEVICE_B_VENDOR, DEVICE_B_BLOCK,
                    DEVICE_B_POSITION_X, DEVICE_B_POSITION_Y, DEVICE_B_BLOCK_POSITION_X, DEVICE_B_BLOCK_POSITION_Y,
                    COMMENTS, CREATED_DATE, UPDATED_DATE
                FROM NETWORK_TOPOLOGY_Dashboard
                ORDER BY CREATED_DATE DESC
            """)
            
            connection_rows = cursor.fetchall()
            logging.debug(f"Retrieved {len(connection_rows)} connection rows at {datetime.now()}")
            return {
                'status': 'Success',
                'connections': connection_rows
            }
            
        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}

    def get_network_topology_blocks(self):
        """
        Get all network topology blocks from the database.
        Used by the Excel table component for displaying and searching blocks.
        """
        try:
            cursor = self.conn.cursor()
            cursor.execute("""
                SELECT ID, BLOCK_NAME FROM NETWORK_TOPOLOGY_Block
                ORDER BY CREATED_DATE DESC
            """)
            rows = cursor.fetchall()
            
            # Convert rows to list of dictionaries for JSON serialization
            blocks = []
            for row in rows:
                blocks.append({
                    'ID': row[0],
                    'BLOCK_NAME': row[1]
                })
            
            return {
                'status': 'Success',
                'blocks': blocks
            }
        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}

    def insert_network_topology_block(self, data, created_by, updated_by):
        """
        Insert a network topology block into NETWORK_TOPOLOGY_Block table.
        """
        try:
            cursor = self.conn.cursor()
            current_time = datetime.now()
            cursor.execute("""
                INSERT INTO NETWORK_TOPOLOGY_Block (BLOCK_NAME, CREATED_DATE, UPDATED_DATE, UPDATED_BY, CREATED_BY)
                VALUES (?, ?, ?, ?, ?)
            """, (data['block_name'], current_time, current_time, updated_by, created_by))
            
            # Get the ID of the last inserted record
            cursor.execute("SELECT @@IDENTITY")
            last_id = cursor.fetchone()[0]
            
            self.conn.commit()
            return {
                'status': 'Success',
                'block_id': int(last_id) if last_id else None,
                'data': data
            }
        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}
        
    def update_network_topology_block(self, data):
        """
        Update a network topology block in NETWORK_TOPOLOGY_Block table.
        Also updates references to the old block name in NETWORK_TOPOLOGY_Dashboard table.
        """
        try:
            cursor = self.conn.cursor()
            current_time = datetime.now()
            
            # First, get the old block name before updating
            cursor.execute("""
                SELECT BLOCK_NAME FROM NETWORK_TOPOLOGY_Block WHERE ID = ?
            """, (data['block_id'],))
            old_block_result = cursor.fetchone()
            
            if not old_block_result:
                return {'status': 'Failed', 'error': 'Block not found'}
            
            old_block_name = old_block_result[0]
            new_block_name = data['block_name']
            
            # Update the block name in NETWORK_TOPOLOGY_Block table
            cursor.execute("""
                UPDATE NETWORK_TOPOLOGY_Block SET BLOCK_NAME = ?, UPDATED_DATE = ?, UPDATED_BY = ? WHERE ID = ?
            """, (new_block_name, current_time, data['updated_by'], data['block_id']))
            
            # Update references in NETWORK_TOPOLOGY_Dashboard table
            # Update DEVICE_A_BLOCK where it matches the old block name
            cursor.execute("""
                UPDATE NETWORK_TOPOLOGY_Dashboard 
                SET DEVICE_A_BLOCK = ?, UPDATED_DATE = ?, UPDATED_BY = ?
                WHERE DEVICE_A_BLOCK = ?
            """, (new_block_name, current_time, data['updated_by'], old_block_name))
            
            # Update DEVICE_B_BLOCK where it matches the old block name
            cursor.execute("""
                UPDATE NETWORK_TOPOLOGY_Dashboard 
                SET DEVICE_B_BLOCK = ?, UPDATED_DATE = ?, UPDATED_BY = ?
                WHERE DEVICE_B_BLOCK = ?
            """, (new_block_name, current_time, data['updated_by'], old_block_name))
            
            self.conn.commit()
            
            return {
                'status': 'Success',
                'block_id': data['block_id'],
                'old_block_name': old_block_name,
                'new_block_name': new_block_name,
                'data': data
            }
        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}
        
    def delete_network_topology_block(self, data):
        """
        Delete a network topology block from NETWORK_TOPOLOGY_Block table.
        Prevents deletion if the block is assigned to any device in NETWORK_TOPOLOGY_Dashboard.
        """
        try:
            cursor = self.conn.cursor()
            cursor.execute("""
                SELECT BLOCK_NAME FROM NETWORK_TOPOLOGY_Block WHERE ID = ?
            """, (data['block_id'],))
            block_result = cursor.fetchone()

            if not block_result:
                return {'status': 'Failed', 'error': 'Block not found'}

            block_name = block_result[0]
            cursor.execute("""
                SELECT COUNT(*) FROM NETWORK_TOPOLOGY_Dashboard
                WHERE DEVICE_A_BLOCK = ? OR DEVICE_B_BLOCK = ?
            """, (block_name, block_name))
            usage_count = cursor.fetchone()[0]

            if usage_count > 0:
                return {
                    'status': 'Failed',
                    'error': f"This block ('{block_name}') is assigned to {usage_count} device(s). Please unassign before deleting."
                }

            cursor.execute("""
                DELETE FROM NETWORK_TOPOLOGY_Block WHERE ID = ?
            """, (data['block_id'],))
            self.conn.commit()

            return {
                'status': 'Success',
                'block_id': data['block_id'],
                'deleted_block_name': block_name
            }

        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}

        
    def delete_network_topology_bulk_by_ids(self, record_ids, updated_by):
        """
        Delete multiple network topology records by their IDs.
        Used by the Excel table component for deleting multiple selected records.
        """
        try:
            cursor = self.conn.cursor()
            
            if not record_ids or len(record_ids) == 0:
                return {
                    'status': 'Failed',
                    'error': 'No record IDs provided',
                    'deleted_count': 0
                }
            
            # Convert record IDs to a comma-separated string for SQL IN clause
            ids_placeholder = ','.join('?' * len(record_ids))
            
            cursor.execute(f"""
                DELETE FROM NETWORK_TOPOLOGY_Dashboard
                WHERE ID IN ({ids_placeholder})
            """, record_ids)
            
            rows_deleted = cursor.rowcount
            self.conn.commit()
            
            return {
                'status': 'Success',
                'deleted_count': rows_deleted,
                'record_ids': record_ids,
                'updated_by': updated_by
            }
            
        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}

    def delete_network_topology_bulk(self, hostname, ip, updated_by):
        """
        Delete all rows where the given (hostname, ip) pair appears on either device side.
        Matches when (DEVICE_A_HOSTNAME, DEVICE_A_IP) = (hostname, ip) OR
        (DEVICE_B_HOSTNAME, DEVICE_B_IP) = (hostname, ip).
        """
        try:
            cursor = self.conn.cursor()

            # Hard delete matching rows across both sides
            cursor.execute(
                """
                DELETE FROM NETWORK_TOPOLOGY_Dashboard
                WHERE (
                    COALESCE(TRIM(DEVICE_A_HOSTNAME), '') = COALESCE(TRIM(?), '') AND
                    COALESCE(TRIM(DEVICE_A_IP), '') = COALESCE(TRIM(?), '')
                ) OR (
                    COALESCE(TRIM(DEVICE_B_HOSTNAME), '') = COALESCE(TRIM(?), '') AND
                    COALESCE(TRIM(DEVICE_B_IP), '') = COALESCE(TRIM(?), '')
                )
                """,
                hostname, ip, hostname, ip
            )

            rows_deleted = cursor.rowcount
            self.conn.commit()

            return {
                'status': 'Success',
                'rows_deleted': rows_deleted,
                'hostname': hostname,
                'ip': ip,
                'updated_by': updated_by
            }

        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}

    def delete_all_topology_table_records(self, updated_by):
        """
        Delete all records from all topology tables.
        """
        try:
            cursor = self.conn.cursor()
            cursor.execute("""
                DELETE FROM NETWORK_TOPOLOGY_Dashboard
            """)
            self.conn.commit()
            return {
                'status': 'Success',
                'updated_by': updated_by
            }
        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}
        
    def insert_network_topology_blocks_bulk(self, data, created_by):
        """
        Insert multiple network topology blocks into NETWORK_TOPOLOGY_Block table.
        Only inserts blocks that don't already exist in the database.
        """
        try:
            cursor = self.conn.cursor()
            current_time = datetime.now()
            
            created_count = 0
            skipped_count = 0
            created_block_ids = []
            skipped_blocks = []
            
            for record in data:
                block_name = record['block_name']
                
                # Check if block already exists
                cursor.execute("""
                    SELECT ID FROM NETWORK_TOPOLOGY_Block WHERE BLOCK_NAME = ?
                """, block_name)
                
                existing_block = cursor.fetchone()
                
                if existing_block:
                    # Block already exists, skip it
                    skipped_count += 1
                    skipped_blocks.append(block_name)
                else:
                    # Block doesn't exist, insert it
                    cursor.execute("""
                        INSERT INTO NETWORK_TOPOLOGY_Block (BLOCK_NAME, CREATED_DATE, UPDATED_DATE, UPDATED_BY, CREATED_BY)
                        VALUES (?, ?, ?, ?, ?)
                    """, (block_name, current_time, current_time, created_by, created_by))
                    
                    created_count += 1
                    # Get the ID of the last inserted record
                    cursor.execute("SELECT @@IDENTITY")
                    last_id = cursor.fetchone()[0]
                    if last_id:
                        created_block_ids.append(int(last_id))
            
            self.conn.commit()
            
            return {
                'status': 'Success',
                'created_count': created_count,
                'skipped_count': skipped_count,
                'total_processed': len(data),
                'created_block_ids': created_block_ids,
                'skipped_blocks': skipped_blocks,
                'data': data
            }
        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}
        
    