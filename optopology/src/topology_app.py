import logging
import re
from utils.topology_utilities import TopologyUtilities
from db.topology_db_utils import TopologyDBUtils
from flask import request
from datetime import datetime

logger = logging.getLogger(__name__)

class TopologyApp:
    def __init__(self):
        self.db_utils = TopologyDBUtils()
        self.topology_utils = TopologyUtilities()
        self.allowed_users = {
            '10.98.151.35':'Usama Ibnul Islam',
            '10.98.151.220':'Najam ul Hassan',
            '10.252.120.51':'Raza Raheem',
            '10.98.151.74':'Ahmed Harras'
        }

    def _get_request_user(self):
        """Return allowed user name from X-Forwarded-For or None if not allowed."""
        ip_address = str(request.headers.get('X-Forwarded-For', '')).strip()
        if ',' in ip_address:
            ip_address = ip_address.split(',')[0].strip()
        return self.allowed_users.get(ip_address)

    def _enforce_allowed(self, action_label: str):
        """Ensure requester is allowed. Returns (user_name, None) or (None, error_response)."""
        # Temporarily bypassing authorization check
        return "System User", None
        
        # Original authorization logic (commented out for bypass)
        # user_name = self._get_request_user()
        # if not user_name:
        #     logger.warning(f"Unauthorized {action_label} from request")
        #     return None, {
        #         'success': False,
        #         'message': 'you are not allowed'
        #     }
        # return user_name, None
    
    def permission_check(self):
        _, error = self._enforce_allowed('user')
        if error:
            return {"permission":True}
        else:
            return {"permission":True}
    
    def import_connections(self, data):
        return {
            'success': False,
            'message': 'Deprecated: NETWORK_TOPOLOGY_MAIN endpoints removed. Use Dashboard endpoints.'
        }

    def import_excel_headered(self, data):
        """
        Process Excel header-based data and insert into Dashboard table.
        Handles flexible header naming and deduplication logic.
        """
        inserted_count = 0
        skipped = []
        errors = []
        inserted_ids = []

        logger.debug("Starting Excel headered import operation")

        created_by, error = self._enforce_allowed('import_excel_headered')
        if error:
            return error

        for idx, raw_row in enumerate(data, start=1):
            try:
                if not isinstance(raw_row, dict):
                    skipped.append({'index': idx, 'reason': 'Row is not an object'})
                    logger.warning(f"Skipping row {idx}: not an object")
                    continue

                # Extract record using header mapping
                record = self.topology_utils.extract_headered_record(raw_row)
                record['created_by'] = created_by
                record['updated_by'] = created_by
                # Validate required fields
                validation_errors = self.topology_utils.validate_headered_record(record, idx)
                if validation_errors:
                    skipped.append({'index': idx, 'reason': validation_errors[0]})
                    logger.warning(f"Skipping row {idx}: {validation_errors[0]}")
                    continue

                # Check for duplicates
                dup_result = self.db_utils.check_duplicate_connection(record)
                if dup_result['is_duplicate']:
                    reason = dup_result['reason']
                    skipped.append({'index': idx, 'reason': reason})
                    logger.info(f"Skipping row {idx}: {reason}")
                    continue

                # Auto-assign blocks if missing
                if not record.get('device_a_block'):
                    record['device_a_block'] = self.topology_utils.determine_block(
                        record['device_a_hostname'], 
                        record['device_a_ip'], 
                        record['device_a_type'],
                    )
                if not record.get('device_b_block'):
                    record['device_b_block'] = self.topology_utils.determine_block(
                        record['device_b_hostname'], 
                        record['device_b_ip'], 
                        record['device_b_type']
                    )

                # Insert record
                result = self.db_utils.insert_dashboard_connection(record)
                if result['status'] == 'Success':
                    inserted_count += 1
                    if result.get('record_id'):
                        inserted_ids.append(result['record_id'])
                    logger.debug(f"Successfully inserted headered record {idx}")
                else:
                    errors.append(f"Row {idx}: {result['error']}")

            except Exception as row_err:
                msg = f"Row {idx} failed with error: {str(row_err)}"
                errors.append(msg)
                logger.error(msg)

        summary = {
            'success': True,
            'message': f'Processed {len(data)} rows: inserted={inserted_count}, skipped={len(skipped)}, errors={len(errors)}',
            'inserted_count': inserted_count,
            'skipped_count': len(skipped),
            'total_records': len(data),
            'inserted_ids': inserted_ids,
            'skipped': skipped,
        }
        if errors:
            summary['errors'] = errors

        logger.info(f"Excel headered import completed. Inserted: {inserted_count}, Skipped: {len(skipped)}, Errors: {len(errors)}")
        return summary
    
    def update_device_position(self, data):
        return {
            'success': False,
            'message': 'Deprecated: NETWORK_TOPOLOGY_MAIN endpoints removed. Use Dashboard endpoints.'
        }

    def update_block_position(self, data):
        return {
            'success': False,
            'message': 'Deprecated: NETWORK_TOPOLOGY_MAIN endpoints removed. Use Dashboard endpoints.'
        }

    def get_network_topology(self):
        return {
            'success': False,
            'message': 'Deprecated: NETWORK_TOPOLOGY_MAIN endpoints removed. Use get_network_topology_dashboard.'
        }

    def get_network_topology_dashboard(self):
        """
        Retrieve network topology data from Dashboard table formatted for Angular topology visualization component.
        Only returns devices and connections that have block assignments.
        """
        logger.debug(f"Starting network topology dashboard retrieval operation at {datetime.now()}")
        
        # _, error = self._enforce_allowed('access to dashboard topology')
        # if error:
        #     return error
        
        try:
            dashboard_data = self.db_utils.get_network_topology_dashboard_data()
            
            if dashboard_data['status'] != 'Success':
                return {
                    'success': False,
                    'message': dashboard_data['error']
                }
            
            logger.debug(f"Dashboard data count: {len(dashboard_data['connections'])} connections at {datetime.now()}")
            
            processed_data = self.topology_utils.process_dashboard_topology_data(
                dashboard_data['connections']
            )
            
            logger.info(f"Dashboard topology processing: {len(dashboard_data['connections'])} total records, {len(processed_data['networkData']['nodes'])} devices with blocks, {len(processed_data['networkData']['edges'])} connections with blocks at {datetime.now()}")
            
            return {
                'success': True,
                'data': processed_data,
                'count': {
                    'blocks': len(processed_data['networkData']['blocks']),
                    'nodes': len(processed_data['networkData']['nodes']),
                    'edges': len(processed_data['networkData']['edges'])
                }
            }
            
        except Exception as e:
            logger.error(f"Get network topology dashboard error: {str(e)}")
            return {
                'success': False,
                'message': f'Failed to retrieve dashboard topology data: {str(e)}'
            }

    def add_network_topology_record(self, data):
        """
        Add a single network topology record to the Dashboard table.
        Used by the Excel table component for adding new records via form.
        """
        logger.debug("Starting single network topology record add operation")
        created_name, error = self._enforce_allowed('add_network_topology_record')
        if error:
            return error  
        validation_errors = self.topology_utils.validate_topology_record(data)
        if validation_errors:
            return {
                'success': False,
                'message': validation_errors[0]
            }

        logger.debug(f"Inserting single record: A[{data['device_a_hostname']}/{data['device_a_interface']}] -> B[{data['device_b_hostname']}/{data['device_b_interface']}]")
     
        if not data.get('device_a_block'):
            data['device_a_block'] = self.topology_utils.determine_block(
                data['device_a_hostname'], 
                data['device_a_ip'], 
                data.get('device_a_type', 'unknown')
            )
        if not data.get('device_b_block'):
            data['device_b_block'] = self.topology_utils.determine_block(
                data['device_b_hostname'], 
                data['device_b_ip'], 
                data.get('device_b_type', 'unknown')
            )


        data['created_by'] = created_name
        data['updated_by'] = created_name

        # Insert record into database
        result = self.db_utils.insert_dashboard_connection(data)
        
        if result['status'] == 'Success':
            logger.info(f"Network topology record added successfully: ID {result.get('record_id', 'unknown')}")
            return {
                'success': True,
                'message': 'Record added successfully',
                'record_id': result.get('record_id'),
                'data': data
            }
        else:
            logger.warning(f"Network topology record add failed: {result['error']}")
            return {
                'success': False,
                'message': result['error']
            }

    def add_network_topology_records_bulk(self, data):
        """
        Add multiple network topology records to the Dashboard table in a single operation.
        Used by the Excel table component for bulk import operations.
        """
        logger.debug("Starting bulk network topology records add operation")
        created_name, error = self._enforce_allowed('add_network_topology_records_bulk')
        if error:
            return error
        if not data or not isinstance(data, list):
            return {
                'success': False,
                'message': 'Invalid data format. Expected array of objects.'
            }
        
        if len(data) == 0:
            return {
                'success': False,
                'message': 'No records provided'
            }

        logger.debug("Starting database bulk import operation")
        

        
        enriched = []
        for r in data:
            if isinstance(r, dict):
                r = dict(r)
                r['created_by'] = created_name
                r['updated_by'] = created_name
                enriched.append(r)

        try:
            result = self.db_utils.insert_dashboard_connections_bulk(enriched)
            
            if result['status'] == 'Success':
                logger.info(f"Bulk network topology records added successfully: {result['inserted_count']} records")
                return {
                    'success': True,
                    'message': f'Successfully added {result["inserted_count"]} records',
                    'inserted_count': result['inserted_count'],
                    'total_records': len(enriched),
                    'inserted_ids': result.get('inserted_ids', [])
                }
            else:
                logger.warning(f"Bulk network topology records add failed: {result['error']}")
                return {
                    'success': False,
                    'message': result['error']
                }
                
        except Exception as e:
            logger.error(f"Bulk network topology records add error: {str(e)}")
            return {
                'success': False,
                'message': f'Failed to add records: {str(e)}'
            }

    def update_network_topology_record(self, data):
        """
        Update an existing network topology record in the Dashboard table.
        Used by the Excel table component for editing existing records.
        """
        logger.debug("Starting network topology record update operation")
        updated_by, error = self._enforce_allowed('update_network_topology_record')
        if error:
            return error
        validation_errors = self.topology_utils.validate_topology_update_record(data)
        if validation_errors:
            return {
                'success': False,
                'message': validation_errors[0]
            }

        logger.debug(f"Updating record ID {data['record_id']}: A[{data['device_a_hostname']}/{data['device_a_interface']}] -> B[{data['device_b_hostname']}/{data.get('device_b_interface', 'N/A')}]")
        
        # Auto-assign blocks if missing
        # if not data.get('device_a_block'):
        #     data['device_a_block'] = self.topology_utils.determine_block(
        #         data['device_a_hostname'], 
        #         data['device_a_ip'], 
        #         data.get('device_a_type', 'unknown')
        #     )
        # if not data.get('device_b_block'):
        #     data['device_b_block'] = self.topology_utils.determine_block(
        #         data['device_b_hostname'], 
        #         data.get('device_b_ip', ''), 
        #         data.get('device_b_type', 'unknown')
        #     )


        data['updated_by'] = updated_by

        result = self.db_utils.update_dashboard_connection(data)
        
        if result['status'] == 'Success':
            logger.info(f"Network topology record updated successfully: ID {data['record_id']}, {result['rows_updated']} rows updated")
            return {
                'success': True,
                'message': 'Record updated successfully',
                'record_id': data['record_id'],
                'rows_updated': result['rows_updated'],
                'data': data
            }
        else:
            logger.warning(f"Network topology record update failed: {result['message']}")
            return {
                'success': False,
                'message': result['message']
            }

    def delete_network_topology_record(self, data):
        """
        Delete a network topology record from the Dashboard table.
        Used by the Excel table component for removing records.
        """
        logger.debug("Starting network topology record delete operation")
        
        # Validate required fields
        validation_errors = self.topology_utils.validate_topology_delete_record(data)
        if validation_errors:
            return {
                'success': False,
                'message': validation_errors[0]
            }

        record_id = data['record_id']

        updated_by, error = self._enforce_allowed('delete_network_topology_record')
        if error:
            return error

        logger.debug(f"Deleting record ID {record_id}")
        
        # Delete record from database
        result = self.db_utils.delete_dashboard_connection(record_id, updated_by)
        
        if result['status'] == 'Success':
            logger.info(f"Network topology record deleted successfully: ID {record_id}, {result['rows_deleted']} rows deleted")
            return {
                'success': True,
                'message': 'Record deleted successfully',
                'record_id': record_id,
                'rows_deleted': result['rows_deleted']
            }
        else:
            logger.warning(f"Network topology record delete failed: {result['message']}")
            return {
                'success': False,
                'message': result['message']
            }

    def get_network_topology_records(self, search=''):
        """
        Retrieve all network topology records from the Dashboard table with optional search.
        Used by the Excel table component for displaying and searching records.
        """
        logger.debug("Starting network topology records retrieval operation")
        
        try:
            # _, error = self._enforce_allowed('get_network_topology_records')
            # if error:
            #     return error

            # Get records from database with optional search
            result = self.db_utils.get_dashboard_connections(search)
            
            if result['status'] == 'Success':
                logger.info(f"Network topology records retrieved successfully: {len(result['records'])} records returned, {result['total_count']} total in database")
                return {
                    'success': True,
                    'data': result['records'],
                    'total_records': result['total_count']
                }
            else:
                logger.warning(f"Network topology records retrieval failed: {result['error']}")
                return {
                    'success': False,
                    'message': result['error']
                }
                
        except Exception as e:
            logger.error(f"Get network topology records error: {str(e)}")
            return {
                'success': False,
                'message': f'Failed to retrieve records: {str(e)}'
            }

    def update_device_type(self, data):
        """
        Update device type by IP and hostname.
        Searches both Device A and Device B columns and updates the type
        regardless of which side the device appears on.
        """
        logger.debug("Starting device type update operation")
        
        # Validate required fields
        validation_errors = self.topology_utils.validate_device_type_update(data)
        if validation_errors:
            return {
                'success': False,
                'message': validation_errors[0]
            }

        device_ip = data['device_ip']
        device_hostname = data['device_hostname']
        new_device_type = data['new_device_type'].lower()  # Convert to lowercase

        updated_by, error = self._enforce_allowed('update_device_type')
        if error:
            return error

        logger.debug(f"Updating device type: {device_hostname} ({device_ip}) to {new_device_type}")
        
        # Update device type in database
        result = self.db_utils.update_device_type(device_ip, device_hostname, new_device_type, updated_by)
        
        if result['status'] == 'Success':
            logger.info(f"Device type updated successfully: {device_hostname} ({device_ip}) -> {new_device_type}, {result['rows_updated']} rows updated")
            return {
                'success': True,
                'message': f'Successfully updated device type for {device_hostname} ({device_ip})',
                'device_ip': device_ip,
                'device_hostname': device_hostname,
                'new_device_type': new_device_type,
                'rows_updated': result['rows_updated'],
                'updated_at': result['updated_at']
            }
        else:
            logger.warning(f"Device type update failed: {result['message']}")
            return {
                'success': False,
                'message': result['message']
            }

    def save_device_positions(self, positions):
        """
        Save device and block positions in bulk.
        Accepts a map of positions keyed by nodeId. Node IDs that look like IPv4 addresses
        are treated as device IPs and will update DEVICE_A_/DEVICE_B_ position columns.
        Other node IDs are treated as block IDs and will update DEVICE_A_BLOCK_/DEVICE_B_BLOCK_ position columns.
        """
        logger.debug(f"Starting bulk device and block position save operation at {datetime.now()}")
        
        if not positions or not isinstance(positions, dict):
            return {
                'success': False,
                'message': f'Invalid payload: positions object is required {datetime.now()}'
            }

        device_updates = 0
        block_updates = 0
        per_key_rows = {}

        logger.debug(f"Starting bulk position update for {len(positions)} items at {datetime.now()}")
        
        try:
            # Use the database layer for bulk position updates
            changed_by, error = self._enforce_allowed('save_device_positions')
            if error:
                return error
            
            logger.debug(f"bulk position Changed by: {changed_by} at {datetime.now()}")

            result = self.db_utils.save_device_positions_bulk(positions, changed_by)
            
            if result['status'] == 'Success':
                device_updates = result['device_rows_updated']
                block_updates = result['block_rows_updated']
                per_key_rows = result['per_key_rows']
                
                logger.info(f"Device positions saved successfully: {device_updates} device updates, {block_updates} block updates {datetime.now()}")
                return {
                    'success': True,
                    'message': 'Positions saved successfully',
                    'summary': {
                        'device_rows_updated': device_updates,
                        'block_rows_updated': block_updates,
                        'total_rows_updated': device_updates + block_updates,
                    },
                    'details': per_key_rows,
                    'updated_at': result['updated_at']
                }
            else:
                logger.warning(f"Bulk position save failed: {result['error']}")
                return {
                    'success': False,
                    'message': result['error']
                }
                
        except Exception as e:
            logger.error(f"Bulk position save error: {str(e)}")
            return {
                'success': False,
                'message': f'Failed to save positions: {str(e)}'
            }



    
    def get_network_topology_blocks(self):
        """
        Get all network topology blocks from the database.
        Used by the Excel table component for displaying and searching blocks.
        """
        logger.debug("Starting network topology blocks retrieval operation")
        updated_by, error = self._enforce_allowed('get_network_topology_blocks')
        # if error:
        #     return error
        try:
            result = self.db_utils.get_network_topology_blocks()
            if result['status'] == 'Success':
                logger.info(f"Network topology blocks retrieved successfully: {len(result['blocks'])} blocks")
                return {
                    'success': True,
                    'data': result['blocks']
                }
            else:
                logger.warning(f"Network topology blocks retrieval failed: {result['error']}")
                return {
                    'success': False,
                    'message': result['error']
                }
        except Exception as e:
            logger.error(f"Get network topology blocks error: {str(e)}")
            return {
                'success': False,
                'message': f'Failed to retrieve blocks: {str(e)}'
            }

    def add_network_topology_block(self, data):
        """
        Add a network topology block to the database.
        Used by the Excel table component for adding new blocks.
        """
        logger.debug("Starting network topology block add operation")
        created_by, error = self._enforce_allowed('add_network_topology_block')
        # if error:
        #     return error
        logger.debug(f"Inserting block: {data['block_name']}")
        created_by_user = created_by or 'system'
        updated_by_user = created_by or 'system'
        result = self.db_utils.insert_network_topology_block(data, created_by_user, updated_by_user)
        if result['status'] == 'Success':
            logger.info(f"Network topology block added successfully: {data['block_name']}")
            return {
                'success': True,
                'message': 'Block added successfully',
                'block_id': result.get('block_id'),
                'data': data
            }
        else:
            logger.warning(f"Network topology block add failed: {result['error']}")
            return {
                'success': False,
                'message': result['error']
            }

    def update_network_topology_block(self, data):
        """
        Update a network topology block in the database.
        Used by the Excel table component for updating existing blocks.
        """
        logger.debug("Starting network topology block update operation")
        updated_by, error = self._enforce_allowed('update_network_topology_block')
        # if error:
        #     return error
        data['updated_by'] = updated_by or 'user'
        result = self.db_utils.update_network_topology_block(data)
        if result['status'] == 'Success':
            logger.info(f"Network topology block updated successfully: {result.get('new_block_name', 'Unknown')}")
            return {
                'success': True,
                'message': 'Block updated successfully',
                'block_id': result.get('block_id'),
                'old_block_name': result.get('old_block_name'),
                'new_block_name': result.get('new_block_name'),
                'data': data
            }
        else:
            logger.warning(f"Network topology block update failed: {result['error']}")
            return {
                'success': False,
                'message': result['error']
            }
        
    def delete_network_topology_block(self, data):
        """
        Delete a network topology block from the database.
        Used by the Excel table component for deleting existing blocks.
        """
        logger.debug("Starting network topology block delete operation")
        updated_by, error = self._enforce_allowed('delete_network_topology_block')
        # if error:
        #     return error
        data['updated_by'] = updated_by or 'user'
        result = self.db_utils.delete_network_topology_block(data)
        if result['status'] == 'Success':
            logger.info(f"Network topology block deleted successfully: {result.get('deleted_block_name', 'Unknown')}")
            return {
                'success': True,
                'message': 'Block deleted successfully',
                'block_id': result.get('block_id'),
                'block_name': result.get('deleted_block_name'),
                'data': data
            }
        else:
            logger.warning(f"Network topology block delete failed: {result['error']}")
            return {
                'success': False,
                'message': result['error']
            }


    def delete_all_topology_table_records(self):
        """
        Delete all records from all topology tables.
        Used by the Excel table component for deleting all records.
        """
        logger.debug("Starting all topology table records delete operation")
        updated_by, error = self._enforce_allowed('delete_all_topology_table_records')
        # if error:
        #     return error
        result = self.db_utils.delete_all_topology_table_records(updated_by)
        if result['status'] == 'Success':
            logger.info(f"All topology table records deleted successfully")
            return {
                'success': True,
                'message': 'All topology table records deleted successfully'
            }
        else:
            logger.warning(f"All topology table records delete failed: {result['error']}")
            return {
                'success': False,
                'message': result['error']
            }
        
    def add_network_topology_blocks_bulk(self, data):
        """
        Add multiple network topology blocks to the database.
        Used by the Excel table component for adding new blocks.
        """
        logger.debug("Starting network topology block bulk add operation")
        created_by, error = self._enforce_allowed('add_network_topology_blocks_bulk')
        # if error:
        #     return error
        
        # Extract block names and created_by from the request data
        block_names = data.get('block_names', [])
        created_by = data.get('created_by', created_by)
        
        if not block_names:
            return {
                'success': False,
                'message': 'No block names provided'
            }
        
        # Transform block names into the format expected by the database method
        blocks_data = [{'block_name': name} for name in block_names]
        
        result = self.db_utils.insert_network_topology_blocks_bulk(blocks_data, created_by)
        
        if result['status'] == 'Success':
            logger.info(f"Network topology block bulk added successfully: {result['created_count']} created, {result['skipped_count']} skipped")
            return {
                'success': True,
                'message': f'Blocks processed successfully: {result["created_count"]} created, {result["skipped_count"]} skipped',
                'created_count': result['created_count'],
                'skipped_count': result['skipped_count'],
                'total_processed': result['total_processed'],
                'created_block_ids': result['created_block_ids'],
                'skipped_blocks': result['skipped_blocks'],
                'data': result['data']
            }
        else:
            logger.warning(f"Network topology block bulk add failed: {result['error']}")
            return {
                'success': False,
                'message': result['error']
            }


    def delete_network_topology_bulk(self, data):
        """
        Delete multiple network topology records from the database.
        Used by the Excel table component for deleting multiple records.
        """
        logger.debug("Starting network topology bulk delete operation")
        updated_by, error = self._enforce_allowed('delete_network_topology_bulk')
        # if error:
        #     return error
        result = self.db_utils.delete_network_topology_bulk(data['hostname'], data['ip'], updated_by)
        if result['status'] == 'Success':
            logger.info(f"Network topology bulk deleted successfully: {result['deleted_count']} deleted")
            return {
                'success': True,
                'message': f'Successfully deleted {result["deleted_count"]} records',
                'deleted_count': result['deleted_count'],
                'data': result['data']
            }
        else:
            logger.warning(f"Network topology bulk delete failed: {result['error']}")
            return {
                'success': False,
                'message': result['error']
            }

    def delete_network_topology_bulk_by_ids(self, data):
        """
        Delete multiple network topology records by their IDs.
        Used by the Excel table component for deleting multiple selected records.
        """
        logger.debug("Starting network topology bulk delete by IDs operation")
        record_ids = data.get('record_ids', [])
        if not record_ids or not isinstance(record_ids, list):
            return {'success': False, 'message': 'record_ids array is required'}

        updated_by, error = self._enforce_allowed('delete_network_topology_bulk_by_ids')
        # if error:
        #     return error
        
        result = self.db_utils.delete_network_topology_bulk_by_ids(record_ids, updated_by)
        if result['status'] == 'Success':
            logger.info(f"Network topology bulk deleted by IDs successfully: {result['deleted_count']} deleted")
            return {
                'success': True,
                'message': f'Successfully deleted {result["deleted_count"]} records',
                'deleted_count': result['deleted_count'],
                'record_ids': record_ids
            }
        else:
            logger.warning(f"Network topology bulk delete by IDs failed: {result['error']}")
            return {
                'success': False,
                'message': result['error']
            }

    def delete_network_topology_by_host_ip(self, data):
        """
        Delete all rows where the given (hostname, ip) pair appears on either device side.
        """
        logger.debug("Starting delete by host/ip operation")
        hostname = (data or {}).get('hostname', '').strip()
        ip = (data or {}).get('ip', '').strip()
        if not hostname or not ip:
            return {'success': False, 'message': 'hostname and ip are required'}

        updated_by, error = self._enforce_allowed('delete_network_topology_by_host_ip')
        # if error:
        #     return error
        result = self.db_utils.delete_network_topology_bulk(hostname, ip, updated_by)
        if result['status'] == 'Success':
            logger.info(f"Delete by host/ip success: {hostname} ({ip}) -> {result['rows_deleted']} rows")
            return {
                'success': True,
                'message': 'Deleted successfully',
                'rows_deleted': result.get('rows_deleted', 0),
                'hostname': hostname,
                'ip': ip
            }
        else:
            logger.warning(f"Delete by host/ip failed: {result['error']}")
            return {
                'success': False,
                'message': result['error']
            }

# if __name__ == "__main__":
#     topology = TopologyApp()
#     result=topology.get_network_topology_dashboard()
#     print(result)
#     import json
#     # json.dump(result,open('cmic.json','w'),indent=2, default=str)
#     json.dump(result,open('topology.json','w'),indent=2, default=str)