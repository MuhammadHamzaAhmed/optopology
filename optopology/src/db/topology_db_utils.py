import traceback
from flask import logging
from pymongo import MongoClient
from bson import ObjectId
from datetime import datetime
from props import mongo_host, mongo_port, mongo_user, mongo_password, mongo_db
from props import topology_dashboard_collection, topology_block_collection
import logging
import sys


class TopologyDBUtils:
    def __init__(self):
        """Initialize MongoDB connection using pymongo."""
        print(f"Connecting to MongoDB at {mongo_host}:{mongo_port}", file=sys.stderr)
        try:
            connection_string = f"mongodb://{mongo_user}:{mongo_password}@{mongo_host}:{mongo_port}/?authSource=admin"
            self.client = MongoClient(connection_string)
            self.db = self.client[mongo_db]
            self.dashboard_collection = self.db[topology_dashboard_collection]
            self.block_collection = self.db[topology_block_collection]

            # Create indexes for better query performance
            self._create_indexes()

            # Test connection
            self.client.admin.command('ping')
            print(f"Successfully connected to MongoDB database: {mongo_db}", file=sys.stderr)
        except Exception as e:
            print(f"Error connecting to MongoDB at {mongo_host}:{mongo_port}: {str(e)}", file=sys.stderr)
            raise e

    def _create_indexes(self):
        """Create indexes for optimal query performance."""
        try:
            # Indexes for dashboard collection
            self.dashboard_collection.create_index([("device_a_hostname", 1), ("device_a_interface", 1)])
            self.dashboard_collection.create_index([("device_b_hostname", 1), ("device_b_interface", 1)])
            self.dashboard_collection.create_index([("device_a_ip", 1)])
            self.dashboard_collection.create_index([("device_b_ip", 1)])
            self.dashboard_collection.create_index([("device_a_block", 1)])
            self.dashboard_collection.create_index([("device_b_block", 1)])
            self.dashboard_collection.create_index([("created_date", -1)])

            # Index for block collection
            self.block_collection.create_index([("block_name", 1)], unique=True)
            self.block_collection.create_index([("created_date", -1)])
        except Exception as e:
            print(f"Warning: Could not create indexes: {str(e)}", file=sys.stderr)

    def _str_to_objectid(self, id_str):
        """Convert string ID to ObjectId, return None if invalid."""
        try:
            return ObjectId(id_str)
        except:
            return None

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
            direct_query = {
                "device_a_hostname": da_host,
                "device_a_interface": da_intf,
                "device_b_hostname": db_host,
                "device_b_interface": db_intf,
                "device_a_ip": da_ip,
                "device_b_ip": db_ip,
                "device_a_type": at,
                "device_b_type": bt,
                "device_a_vendor": av,
                "device_b_vendor": bv,
                "comments": cm
            }
            direct_count = self.dashboard_collection.count_documents(direct_query)

            # Check swapped order (B->A)
            swapped_query = {
                "device_a_hostname": db_host,
                "device_a_interface": db_intf,
                "device_b_hostname": da_host,
                "device_b_interface": da_intf,
                "device_a_ip": db_ip,
                "device_b_ip": da_ip,
                "device_a_type": bt,
                "device_b_type": at,
                "device_a_vendor": bv,
                "device_b_vendor": av,
                "comments": cm
            }
            swapped_count = self.dashboard_collection.count_documents(swapped_query)

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
        Insert a single connection record into dashboard collection.
        Skips insertion if an exact duplicate (A->B or B->A) already exists.
        """
        try:
            # Normalize inputs (trim spaces, lowercase where needed)
            da_ip = str(record.get('device_a_ip', '')).strip()
            da_host = str(record.get('device_a_hostname', '')).strip()
            da_intf = str(record.get('device_a_interface', '')).strip()
            da_type = str(record.get('device_a_type', 'unknown')).strip().lower()
            da_vendor = str(record.get('device_a_vendor', 'unknown')).strip().lower()

            db_ip = str(record.get('device_b_ip', '')).strip()
            db_host = str(record.get('device_b_hostname', '')).strip()
            db_intf = str(record.get('device_b_interface', '')).strip()
            db_type = str(record.get('device_b_type', 'unknown')).strip().lower()
            db_vendor = str(record.get('device_b_vendor', 'unknown')).strip().lower()

            comments = str(record.get('comments', '')).strip()

            # Debug logging
            print("DEBUG: Checking values for duplicate:")
            print(f"  Device A -> {da_host}/{da_intf}, IP={da_ip}, Type={da_type}, Vendor={da_vendor}")
            print(f"  Device B -> {db_host}/{db_intf}, IP={db_ip}, Type={db_type}, Vendor={db_vendor}")
            print(f"  Comments : {comments}")

            # Direct duplicate check (A -> B)
            direct_query = {
                "device_a_hostname": da_host,
                "device_a_interface": da_intf,
                "device_b_hostname": db_host,
                "device_b_interface": db_intf,
                "device_a_ip": da_ip,
                "device_b_ip": db_ip,
                "device_a_type": da_type,
                "device_b_type": db_type,
                "device_a_vendor": da_vendor,
                "device_b_vendor": db_vendor,
                "comments": comments
            }
            direct_count = self.dashboard_collection.count_documents(direct_query)

            # Reverse duplicate check (B -> A)
            reverse_query = {
                "device_a_hostname": db_host,
                "device_a_interface": db_intf,
                "device_b_hostname": da_host,
                "device_b_interface": da_intf,
                "device_a_ip": db_ip,
                "device_b_ip": da_ip,
                "device_a_type": db_type,
                "device_b_type": da_type,
                "device_a_vendor": db_vendor,
                "device_b_vendor": da_vendor,
                "comments": comments
            }
            reverse_count = self.dashboard_collection.count_documents(reverse_query)

            if direct_count > 0 or reverse_count > 0:
                print("DEBUG: Exact duplicate found -> Skipping insertion")
                return {
                    'status': 'Skipped',
                    'message': 'Exact record already exists in database',
                    'is_duplicate': True,
                    'inserted_count': 0
                }

            # Insert new record
            print("DEBUG: No duplicate found -> Inserting new record")
            current_time = datetime.now()
            document = {
                "device_a_ip": da_ip,
                "device_a_hostname": da_host,
                "device_a_interface": da_intf,
                "device_a_type": da_type,
                "device_a_vendor": da_vendor,
                "device_a_block": record.get('device_a_block', ''),
                "device_a_position_x": None,
                "device_a_position_y": None,
                "device_a_block_position_x": None,
                "device_a_block_position_y": None,
                "device_b_ip": db_ip,
                "device_b_hostname": db_host,
                "device_b_interface": db_intf,
                "device_b_type": db_type,
                "device_b_vendor": db_vendor,
                "device_b_block": record.get('device_b_block', ''),
                "device_b_position_x": None,
                "device_b_position_y": None,
                "device_b_block_position_x": None,
                "device_b_block_position_y": None,
                "comments": comments,
                "updated_by": record['updated_by'],
                "created_by": record['created_by'],
                "created_date": current_time,
                "updated_date": current_time
            }

            result = self.dashboard_collection.insert_one(document)
            return {
                'status': 'Success',
                'record_id': str(result.inserted_id),
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
        Update an existing connection record in dashboard collection.
        """
        try:
            record_id = self._str_to_objectid(record['record_id'])
            if not record_id:
                return {'status': 'Failed', 'message': f'Invalid record ID: {record["record_id"]}'}

            update_doc = {
                "$set": {
                    "device_a_ip": record['device_a_ip'],
                    "device_a_hostname": record['device_a_hostname'],
                    "device_a_interface": record['device_a_interface'],
                    "device_a_type": record.get('device_a_type', 'unknown') or 'unknown',
                    "device_a_vendor": record.get('device_a_vendor', 'unknown') or 'unknown',
                    "device_a_block": record.get('device_a_block', '') or '',
                    "device_b_ip": record.get('device_b_ip', '') or '',
                    "device_b_hostname": record['device_b_hostname'],
                    "device_b_interface": record.get('device_b_interface', '') or '',
                    "device_b_type": record.get('device_b_type', 'unknown') or 'unknown',
                    "device_b_vendor": record.get('device_b_vendor', 'unknown') or 'unknown',
                    "device_b_block": record.get('device_b_block', '') or '',
                    "comments": record.get('comments', '') or '',
                    "updated_by": record['updated_by'],
                    "updated_date": datetime.now()
                }
            }

            result = self.dashboard_collection.update_one({"_id": record_id}, update_doc)

            if result.matched_count == 0:
                return {
                    'status': 'Failed',
                    'message': f'No record found with ID: {record["record_id"]}'
                }

            return {
                'status': 'Success',
                'rows_updated': result.modified_count
            }

        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}

    def delete_dashboard_connection(self, record_id, updated_by):
        """
        Delete a connection record from dashboard collection.
        """
        try:
            obj_id = self._str_to_objectid(record_id)
            if not obj_id:
                return {'status': 'Failed', 'message': f'Invalid record ID: {record_id}'}

            result = self.dashboard_collection.delete_one({"_id": obj_id})

            if result.deleted_count == 0:
                return {
                    'status': 'Failed',
                    'message': f'No record found with ID: {record_id}'
                }

            return {
                'status': 'Success',
                'rows_deleted': result.deleted_count,
                'delete_type': 'hard'
            }

        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}

    def get_dashboard_connections(self, search=''):
        """
        Retrieve all connection records from dashboard collection with optional search.
        """
        try:
            query = {}

            if search and search.strip():
                search_term = search.strip()
                query = {
                    "$or": [
                        {"device_a_ip": {"$regex": search_term, "$options": "i"}},
                        {"device_a_hostname": {"$regex": search_term, "$options": "i"}},
                        {"device_b_ip": {"$regex": search_term, "$options": "i"}},
                        {"device_b_hostname": {"$regex": search_term, "$options": "i"}}
                    ]
                }

            cursor = self.dashboard_collection.find(query).sort("created_date", -1)
            records = []

            for doc in cursor:
                records.append({
                    'id': str(doc['_id']),
                    'device_a_ip': doc.get('device_a_ip', ''),
                    'device_a_hostname': doc.get('device_a_hostname', ''),
                    'device_a_interface': doc.get('device_a_interface', ''),
                    'device_a_type': doc.get('device_a_type', ''),
                    'device_a_vendor': doc.get('device_a_vendor', ''),
                    'device_a_block': doc.get('device_a_block', ''),
                    'device_b_ip': doc.get('device_b_ip', ''),
                    'device_b_hostname': doc.get('device_b_hostname', ''),
                    'device_b_interface': doc.get('device_b_interface', ''),
                    'device_b_type': doc.get('device_b_type', ''),
                    'device_b_vendor': doc.get('device_b_vendor', ''),
                    'device_b_block': doc.get('device_b_block', ''),
                    'comments': doc.get('comments', ''),
                    'updated_by': doc.get('updated_by', ''),
                    'created_date': doc['created_date'].isoformat() if doc.get('created_date') else None,
                    'updated_date': doc['updated_date'].isoformat() if doc.get('updated_date') else None
                })

            total_count = self.dashboard_collection.count_documents(query)

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
        Searches both Device A and Device B columns and updates the type.
        """
        try:
            current_time = datetime.now()

            # Update device type in Device A fields
            result_a = self.dashboard_collection.update_many(
                {"device_a_ip": device_ip, "device_a_hostname": device_hostname},
                {"$set": {"device_a_type": new_device_type, "updated_by": updated_by, "updated_date": current_time}}
            )

            # Update device type in Device B fields
            result_b = self.dashboard_collection.update_many(
                {"device_b_ip": device_ip, "device_b_hostname": device_hostname},
                {"$set": {"device_b_type": new_device_type, "updated_by": updated_by, "updated_date": current_time}}
            )

            total_rows_updated = result_a.modified_count + result_b.modified_count

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
        """
        try:
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
                if not key:
                    continue

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

                # Strategy 1: Try to update by IP address
                if topology_utils.is_ipv4(key):
                    result_a = self.dashboard_collection.update_many(
                        {"device_a_ip": key},
                        {"$set": {"device_a_position_x": x, "device_a_position_y": y,
                                  "updated_date": current_time, "updated_by": changed_by}}
                    )

                    result_b = self.dashboard_collection.update_many(
                        {"device_b_ip": key},
                        {"$set": {"device_b_position_x": x, "device_b_position_y": y,
                                  "updated_date": current_time, "updated_by": changed_by}}
                    )

                    total_rows_for_key = result_a.modified_count + result_b.modified_count
                    device_updates += total_rows_for_key

                # Strategy 2: Try to update by hostname (for devices without IPs)
                if total_rows_for_key == 0 and not topology_utils.is_ipv4(key):
                    result_a = self.dashboard_collection.update_many(
                        {"device_a_hostname": key, "$or": [{"device_a_ip": None}, {"device_a_ip": ""}]},
                        {"$set": {"device_a_position_x": x, "device_a_position_y": y,
                                  "updated_date": current_time, "updated_by": changed_by}}
                    )

                    result_b = self.dashboard_collection.update_many(
                        {"device_b_hostname": key, "$or": [{"device_b_ip": None}, {"device_b_ip": ""}]},
                        {"$set": {"device_b_position_x": x, "device_b_position_y": y,
                                  "updated_date": current_time, "updated_by": changed_by}}
                    )

                    hostname_rows = result_a.modified_count + result_b.modified_count
                    total_rows_for_key += hostname_rows
                    device_updates += hostname_rows

                # Strategy 3: Try to update block positions
                if total_rows_for_key == 0:
                    result_ba = self.dashboard_collection.update_many(
                        {"device_a_block": key},
                        {"$set": {"device_a_block_position_x": x, "device_a_block_position_y": y,
                                  "updated_date": current_time, "updated_by": changed_by}}
                    )

                    result_bb = self.dashboard_collection.update_many(
                        {"device_b_block": key},
                        {"$set": {"device_b_block_position_x": x, "device_b_block_position_y": y,
                                  "updated_date": current_time, "updated_by": changed_by}}
                    )

                    block_rows = result_ba.modified_count + result_bb.modified_count
                    total_rows_for_key += block_rows
                    block_updates += block_rows

                per_key_rows[key] = total_rows_for_key

                if total_rows_for_key > 50:
                    logging.warning(f"Large position update: Key '{key}' affected {total_rows_for_key} rows")

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
        Insert multiple connection records into dashboard collection.
        """
        try:
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

                    current_time = datetime.now()
                    document = {
                        "device_a_ip": record['device_a_ip'],
                        "device_a_hostname": record['device_a_hostname'],
                        "device_a_interface": record['device_a_interface'],
                        "device_a_type": record.get('device_a_type', 'unknown') or 'unknown',
                        "device_a_vendor": record.get('device_a_vendor', 'unknown') or 'unknown',
                        "device_a_block": record.get('device_a_block', '') or '',
                        "device_a_position_x": None,
                        "device_a_position_y": None,
                        "device_a_block_position_x": None,
                        "device_a_block_position_y": None,
                        "device_b_ip": record['device_b_ip'],
                        "device_b_hostname": record['device_b_hostname'],
                        "device_b_interface": record['device_b_interface'],
                        "device_b_type": record.get('device_b_type', 'unknown') or 'unknown',
                        "device_b_vendor": record.get('device_b_vendor', 'unknown') or 'unknown',
                        "device_b_block": record.get('device_b_block', '') or '',
                        "device_b_position_x": None,
                        "device_b_position_y": None,
                        "device_b_block_position_x": None,
                        "device_b_block_position_y": None,
                        "comments": record.get('comments', '') or '',
                        "updated_by": record['updated_by'],
                        "created_by": record['created_by'],
                        "created_date": current_time,
                        "updated_date": current_time
                    }

                    result = self.dashboard_collection.insert_one(document)
                    inserted_ids.append(str(result.inserted_id))
                    inserted_count += 1

                except Exception as e:
                    errors.append(f"Row {idx + 1}: {str(e)}")

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

    def get_network_topology_dashboard_data(self):
        """
        Retrieve network topology data from dashboard collection.
        Returns connection records for processing.
        """
        try:
            cursor = self.dashboard_collection.find().sort("created_date", -1)

            connection_rows = []
            for doc in cursor:
                # Return tuple format similar to SQL cursor for compatibility
                connection_rows.append((
                    doc.get('device_a_ip', ''),
                    doc.get('device_a_hostname', ''),
                    doc.get('device_a_interface', ''),
                    doc.get('device_a_type', ''),
                    doc.get('device_a_vendor', ''),
                    doc.get('device_a_block', ''),
                    doc.get('device_a_position_x'),
                    doc.get('device_a_position_y'),
                    doc.get('device_a_block_position_x'),
                    doc.get('device_a_block_position_y'),
                    doc.get('device_b_ip', ''),
                    doc.get('device_b_hostname', ''),
                    doc.get('device_b_interface', ''),
                    doc.get('device_b_type', ''),
                    doc.get('device_b_vendor', ''),
                    doc.get('device_b_block', ''),
                    doc.get('device_b_position_x'),
                    doc.get('device_b_position_y'),
                    doc.get('device_b_block_position_x'),
                    doc.get('device_b_block_position_y'),
                    doc.get('comments', ''),
                    doc.get('created_date'),
                    doc.get('updated_date')
                ))

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
        """
        try:
            cursor = self.block_collection.find().sort("created_date", -1)

            blocks = []
            for doc in cursor:
                blocks.append({
                    'ID': str(doc['_id']),
                    'BLOCK_NAME': doc.get('block_name', '')
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
        Insert a network topology block into block collection.
        """
        try:
            current_time = datetime.now()
            document = {
                "block_name": data['block_name'],
                "created_date": current_time,
                "updated_date": current_time,
                "updated_by": updated_by,
                "created_by": created_by
            }

            result = self.block_collection.insert_one(document)

            return {
                'status': 'Success',
                'block_id': str(result.inserted_id),
                'data': data
            }
        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}

    def update_network_topology_block(self, data):
        """
        Update a network topology block in block collection.
        Also updates references to the old block name in dashboard collection.
        """
        try:
            current_time = datetime.now()
            block_id = self._str_to_objectid(data['block_id'])

            if not block_id:
                return {'status': 'Failed', 'error': 'Invalid block ID'}

            # Get the old block name
            old_block = self.block_collection.find_one({"_id": block_id})

            if not old_block:
                return {'status': 'Failed', 'error': 'Block not found'}

            old_block_name = old_block.get('block_name', '')
            new_block_name = data['block_name']

            # Update the block name in block collection
            self.block_collection.update_one(
                {"_id": block_id},
                {"$set": {"block_name": new_block_name, "updated_date": current_time, "updated_by": data['updated_by']}}
            )

            # Update references in dashboard collection
            self.dashboard_collection.update_many(
                {"device_a_block": old_block_name},
                {"$set": {"device_a_block": new_block_name, "updated_date": current_time, "updated_by": data['updated_by']}}
            )

            self.dashboard_collection.update_many(
                {"device_b_block": old_block_name},
                {"$set": {"device_b_block": new_block_name, "updated_date": current_time, "updated_by": data['updated_by']}}
            )

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
        Delete a network topology block from block collection.
        Prevents deletion if the block is assigned to any device.
        """
        try:
            block_id = self._str_to_objectid(data['block_id'])

            if not block_id:
                return {'status': 'Failed', 'error': 'Invalid block ID'}

            block = self.block_collection.find_one({"_id": block_id})

            if not block:
                return {'status': 'Failed', 'error': 'Block not found'}

            block_name = block.get('block_name', '')

            # Check if block is in use
            usage_count = self.dashboard_collection.count_documents({
                "$or": [
                    {"device_a_block": block_name},
                    {"device_b_block": block_name}
                ]
            })

            if usage_count > 0:
                return {
                    'status': 'Failed',
                    'error': f"This block ('{block_name}') is assigned to {usage_count} device(s). Please unassign before deleting."
                }

            self.block_collection.delete_one({"_id": block_id})

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
        """
        try:
            if not record_ids or len(record_ids) == 0:
                return {
                    'status': 'Failed',
                    'error': 'No record IDs provided',
                    'deleted_count': 0
                }

            # Convert string IDs to ObjectIds
            object_ids = [self._str_to_objectid(rid) for rid in record_ids if self._str_to_objectid(rid)]

            if not object_ids:
                return {
                    'status': 'Failed',
                    'error': 'No valid record IDs provided',
                    'deleted_count': 0
                }

            result = self.dashboard_collection.delete_many({"_id": {"$in": object_ids}})

            return {
                'status': 'Success',
                'deleted_count': result.deleted_count,
                'record_ids': record_ids,
                'updated_by': updated_by
            }

        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}

    def delete_network_topology_bulk(self, hostname, ip, updated_by):
        """
        Delete all rows where the given (hostname, ip) pair appears on either device side.
        """
        try:
            hostname = hostname.strip() if hostname else ''
            ip = ip.strip() if ip else ''

            result = self.dashboard_collection.delete_many({
                "$or": [
                    {"device_a_hostname": hostname, "device_a_ip": ip},
                    {"device_b_hostname": hostname, "device_b_ip": ip}
                ]
            })

            return {
                'status': 'Success',
                'rows_deleted': result.deleted_count,
                'hostname': hostname,
                'ip': ip,
                'updated_by': updated_by
            }

        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}

    def delete_all_topology_table_records(self, updated_by):
        """
        Delete all records from dashboard collection.
        """
        try:
            result = self.dashboard_collection.delete_many({})
            return {
                'status': 'Success',
                'deleted_count': result.deleted_count,
                'updated_by': updated_by
            }
        except Exception as e:
            traceback.print_exc()
            return {'status': 'Failed', 'error': str(e)}

    def insert_network_topology_blocks_bulk(self, data, created_by):
        """
        Insert multiple network topology blocks into block collection.
        Only inserts blocks that don't already exist.
        """
        try:
            current_time = datetime.now()

            created_count = 0
            skipped_count = 0
            created_block_ids = []
            skipped_blocks = []

            for record in data:
                block_name = record['block_name']

                # Check if block already exists
                existing_block = self.block_collection.find_one({"block_name": block_name})

                if existing_block:
                    skipped_count += 1
                    skipped_blocks.append(block_name)
                else:
                    document = {
                        "block_name": block_name,
                        "created_date": current_time,
                        "updated_date": current_time,
                        "updated_by": created_by,
                        "created_by": created_by
                    }

                    result = self.block_collection.insert_one(document)
                    created_count += 1
                    created_block_ids.append(str(result.inserted_id))

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
