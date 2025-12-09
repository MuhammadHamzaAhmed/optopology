import logging
import re
import math
from datetime import datetime
import sys

class TopologyUtilities:
    def __init__(self):
        self.REQUIRED_FIELDS = [
            'device_a_ip', 'device_a_hostname', 'device_a_interface',
            'device_b_ip'
        ]

        # Header-based import required fields (more flexible)
        self.HEADERED_REQUIRED_FIELDS = [
            'device_a_ip', 'device_a_hostname', 'device_a_interface',
            'device_b_hostname'
        ]

        # Position update required fields
        self.POSITION_REQUIRED_FIELDS = ['device_ip', 'position']
        
        # Block position update required fields
        self.BLOCK_POSITION_REQUIRED_FIELDS = ['block_id', 'position']
        
        # Single topology record required fields
        self.TOPOLOGY_RECORD_REQUIRED_FIELDS = [
            'device_a_ip', 'device_a_hostname', 'device_a_interface',
            'device_b_ip', 'device_b_hostname', 'device_b_interface'
        ]
        
        # Topology record update required fields (allow missing B IP/Interface; require B hostname)
        self.TOPOLOGY_UPDATE_RECORD_REQUIRED_FIELDS = [
            'record_id', 'device_a_ip', 'device_a_hostname', 'device_a_interface',
            'device_b_hostname'
        ]
        
        # Topology record delete required fields
        self.TOPOLOGY_DELETE_RECORD_REQUIRED_FIELDS = ['record_id']
        
        # Device type update required fields
        self.DEVICE_TYPE_UPDATE_REQUIRED_FIELDS = ['device_ip', 'device_hostname', 'new_device_type']

        # Mapping from normalized header to internal field names
        self.HEADER_TO_FIELD = {
            # Device A
            'device_a_ip': 'device_a_ip',
            'devicea_ip': 'device_a_ip',
            'device_a_address': 'device_a_ip',
            'devicea_address': 'device_a_ip',
            'ip_a': 'device_a_ip',
            'ip_device_a': 'device_a_ip',
            'device_a_hostname': 'device_a_hostname',
            'devicea_hostname': 'device_a_hostname',
            'device_a_host_name': 'device_a_hostname',
            'devicea_host_name': 'device_a_hostname',
            'host_a': 'device_a_hostname',
            'hostname_a': 'device_a_hostname',
            'device_a_name': 'device_a_hostname',
            'name_a': 'device_a_hostname',
            'device_a_host': 'device_a_hostname',
            'host_name_a': 'device_a_hostname',
            'device_a_interface': 'device_a_interface',
            'devicea_interface': 'device_a_interface',
            'intf_a': 'device_a_interface',
            'interface_a': 'device_a_interface',
            'device_a_type': 'device_a_type',
            'devicea_type': 'device_a_type',
            'type_a': 'device_a_type',
            'device_a_vendor': 'device_a_vendor',
            'devicea_vendor': 'device_a_vendor',
            'vendor_a': 'device_a_vendor',
            'device_a_block': 'device_a_block',
            'devicea_block': 'device_a_block',
            'block_a': 'device_a_block',
            # Device B
            'device_b_ip': 'device_b_ip',
            'deviceb_ip': 'device_b_ip',
            'device_b_address': 'device_b_ip',
            'deviceb_address': 'device_b_ip',
            'ip_b': 'device_b_ip',
            'ip_device_b': 'device_b_ip',
            'device_b_hostname': 'device_b_hostname',
            'deviceb_hostname': 'device_b_hostname',
            'device_b_host_name': 'device_b_hostname',
            'deviceb_host_name': 'device_b_hostname',
            'host_b': 'device_b_hostname',
            'hostname_b': 'device_b_hostname',
            'device_b_name': 'device_b_hostname',
            'name_b': 'device_b_hostname',
            'device_b_host': 'device_b_hostname',
            'host_name_b': 'device_b_hostname',
            'device_b_interface': 'device_b_interface',
            'deviceb_interface': 'device_b_interface',
            'intf_b': 'device_b_interface',
            'interface_b': 'device_b_interface',
            'device_b_type': 'device_b_type',
            'deviceb_type': 'device_b_type',
            'type_b': 'device_b_type',
            'device_b_vendor': 'device_b_vendor',
            'deviceb_vendor': 'device_b_vendor',
            'vendor_b': 'device_b_vendor',
            'device_b_block': 'device_b_block',
            'deviceb_block': 'device_b_block',
            'block_b': 'device_b_block',
            # Comments
            'comments': 'comments',
            'remark': 'comments',
            'remarks': 'comments',
            'description': 'comments',
        }

    def clean_field_value(self, value):
        if value is None:
            return ''
        cleaned = str(value).strip()
        empty_values = {'-', '', 'none', 'null', 'undefined', 'n/a', 'na'}
        return '' if cleaned.lower() in empty_values else cleaned

    def compute_device_id(self, ip, hostname):
        clean_ip = self.clean_field_value(ip)
        clean_hostname = self.clean_field_value(hostname)
        return clean_ip or clean_hostname

    def is_ipv4(self, value):
        try:
            parts = value.split('.')
            if len(parts) != 4:
                return False
            for part in parts:
                if not part.isdigit():
                    return False
                num = int(part)
                if num < 0 or num > 255:
                    return False
            return True
        except Exception:
            return False

    def validate_record(self, record, row_num):
        """Validate required fields in a record."""
        missing_fields = [field for field in self.REQUIRED_FIELDS if not record.get(field)]
        if missing_fields:
            return [f"Row {row_num}: Missing required fields: {missing_fields}"]
        return []

    def transform_record(self, record):
        """Prepare record for DB insertion with defaults."""
        return {
            'device_a_ip': record['device_a_ip'],
            'device_a_hostname': record['device_a_hostname'],
            'device_a_interface': record['device_a_interface'],
            'device_a_type': record.get('device_a_type', 'unknown'),
            'device_a_vendor': record.get('device_a_vendor', 'unknown'),
            'device_a_block': record.get('device_a_block', ''),

            'device_b_ip': record['device_b_ip'],
            'device_b_hostname': record['device_b_hostname'],
            'device_b_interface': record['device_b_interface'],
            'device_b_type': record.get('device_b_type', 'unknown'),
            'device_b_vendor': record.get('device_b_vendor', 'unknown'),
            'device_b_block': record.get('device_b_block', ''),

            'comments': record.get('comments', ''),
            'data_source': 'excel',
            'processing_status': 'initial',
            'record_type': 'connection',
            'discovery_method': 'excel-import',
            'created_date': datetime.now(),
            'updated_date': datetime.now()
        }

    def normalize_key(self, key):
        """Normalize header keys for flexible matching."""
        try:
            raw = str(key)
            # Remove non-alphanum except space/_ and collapse whitespace
            cleaned = ''.join(ch if ch.isalnum() or ch in [' ', '_'] else ' ' for ch in raw)
            # Collapse any sequence of whitespace to single space
            cleaned = ' '.join(cleaned.strip().split())
            cleaned = cleaned.lower().replace(' ', '_')
            return cleaned
        except Exception:
            return str(key).strip().lower().replace(' ', '_')

    def extract_headered_record(self, raw_row):
        """Extract and normalize record from header-based row."""
        record = {
            'device_a_ip': '',
            'device_a_hostname': '',
            'device_a_interface': '',
            'device_a_type': 'unknown',
            'device_a_vendor': 'unknown',
            'device_a_block': '',
            'device_b_ip': '',
            'device_b_hostname': '',
            'device_b_interface': '',
            'device_b_type': 'unknown',
            'device_b_vendor': 'unknown',
            'device_b_block': '',
            'comments': '',
        }
        
        for k, v in raw_row.items():
            normalized_key = self.normalize_key(k)
            target_field = self.HEADER_TO_FIELD.get(normalized_key)
            if target_field:
                record[target_field] = (v if v is not None else '')
        
        # Normalize types to lowercase strings
        if record['device_a_type']:
            record['device_a_type'] = str(record['device_a_type']).lower()
        if record['device_b_type']:
            record['device_b_type'] = str(record['device_b_type']).lower()
        
        return record

    def validate_headered_record(self, record, row_num):
        """Validate required fields in a header-based record."""
        missing = [f for f in self.HEADERED_REQUIRED_FIELDS if not str(record.get(f) or '').strip()]
        if missing:
            return [f"Missing required fields: {missing}"]
        return []

    def validate_position_data(self, data):
        """Validate device position update data."""
        # Check required fields
        missing_fields = [field for field in self.POSITION_REQUIRED_FIELDS if field not in data]
        if missing_fields:
            return [f'Missing required fields: {missing_fields}']
        
        # Check position structure
        if 'x' not in data['position'] or 'y' not in data['position']:
            return ['Position must contain x and y coordinates']
        
        # Validate coordinates are numeric
        try:
            float(data['position']['x'])
            float(data['position']['y'])
        except (ValueError, TypeError):
            return ['Position coordinates must be numeric values']
        
        return []

    def validate_block_position_data(self, data):
        """Validate block position update data."""
        # Check required fields
        missing_fields = [field for field in self.BLOCK_POSITION_REQUIRED_FIELDS if field not in data]
        if missing_fields:
            return [f'Missing required fields: {missing_fields}']
        
        # Check position structure
        if 'x' not in data['position'] or 'y' not in data['position']:
            return ['Position must contain x and y coordinates']
        
        # Validate coordinates are numeric
        try:
            float(data['position']['x'])
            float(data['position']['y'])
        except (ValueError, TypeError):
            return ['Position coordinates must be numeric values']
        
        return []

    def validate_topology_record(self, data):
        """Validate single topology record data."""
        # Check required fields
        missing_fields = [field for field in self.TOPOLOGY_RECORD_REQUIRED_FIELDS if not data.get(field)]
        if missing_fields:
            return [f'Missing required fields: {missing_fields}']
        
        return []

    def validate_topology_update_record(self, data):
        """Validate topology record update data."""
        # Check required fields (allow missing B IP/Interface; require B hostname)
        missing_fields = [field for field in self.TOPOLOGY_UPDATE_RECORD_REQUIRED_FIELDS if not data.get(field)]
        if missing_fields:
            return [f'Missing required fields: {missing_fields}']
        
        return []

    def validate_topology_delete_record(self, data):
        """Validate topology record delete data."""
        # Check required fields
        missing_fields = [field for field in self.TOPOLOGY_DELETE_RECORD_REQUIRED_FIELDS if not data.get(field)]
        if missing_fields:
            return [f'Missing required fields: {missing_fields}']
        
        return []

    def validate_device_type_update(self, data):
        """Validate device type update data."""
        # Check required fields
        missing_fields = [field for field in self.DEVICE_TYPE_UPDATE_REQUIRED_FIELDS if not data.get(field)]
        if missing_fields:
            return [f'Missing required fields: {missing_fields}']
        
        return []

    def determine_block(self, hostname, ip, device_type):
        """Determine block assignment based on hostname, IP, and device type."""
        try:
            raw_name = (hostname or '')
            # Sanitize: remove control chars, collapse non-alnum to space, uppercase
            name = re.sub(r'[^A-Za-z0-9]+', ' ', raw_name).strip().upper()
            ip_str = (ip or '').strip()
            dtype = (device_type or '').strip().lower()

            # Do not assign any block to ISP devices
            if dtype == 'isp':
                return ''

            if ip_str in ('10.99.18.253', '10.99.18.254'):
                return 'core-block'
            if dtype == 'core_switch':
                return 'core-block'
            if ' COR ' in f' {name} ' or ' CORE ' in f' {name} ':
                return 'core-block'
            if ' INT ' in f' {name} ' or ' INTERNET ' in f' {name} ':
                return 'internet-block'
            if ' OOB ' in f' {name} ' or ' OUT OF BAND ' in f' {name} ':
                return 'oob-block'
            if ' WAN ' in f' {name} ' or ' WIDE AREA ' in f' {name} ':
                return 'wan-block'
            if ' EXTNET ' in f' {name} ' or ' EXTRANET ' in f' {name} ' or ' PARTNER ' in f' {name} ':
                return 'extranet-block'
            if ' OTV ' in f' {name} ' or ' REPL ' in f' {name} ' or ' REPLICATION ' in f' {name} ':
                return 'replication-block'
            if ' DC ' in f' {name} ' or ' DATACENTER ' in f' {name} ' or ' ACI ' in f' {name} ':
                return 'datacenter-block'
            if ' VIS ' in f' {name} ' or ' VISIBILITY ' in f' {name} ' or ' MONITOR ' in f' {name} ':
                return 'visibility-block'
            if ' DMZ ' in f' {name} ' or ' PERIMETER ' in f' {name} ' or ' BORDER ' in f' {name} ':
                return 'dmz-block'
            if ' EXT ' in f' {name} ' or ' EXTERNAL ' in f' {name} ' or ' EDGE ' in f' {name} ':
                return 'external-block'
            if dtype == 'firewall':
                return 'dmz-block'
            if dtype == 'ips':
                return 'dmz-block'
            if dtype == 'proxy':
                return 'dmz-block'
            return ''
        except Exception:
            return ''

    # def process_topology_data(self, connection_rows, block_rows):
    #     """
    #     Process raw database data into Angular topology component format.
    #     Returns processed blocks, nodes, edges, positions, and metadata.
    #     """
    #     blocks = []
    #     nodes = []
    #     edges = []
    #     positions = {}
    #     device_status = {}
    #     device_types = {}
    #     connection_map = {}
        
    #     # Process blocks
    #     for row in block_rows:
    #         block_id, block_name, block_label, pos_x, pos_y = row
    #         blocks.append({
    #             'id': block_id,
    #             'label': block_label or block_name,
    #             'type': 'compound'
    #         })
            
    #         # Save block position if available
    #         if pos_x is not None and pos_y is not None:
    #             positions[block_id] = {'x': float(pos_x), 'y': float(pos_y)}
        
    #     # Process connections to create nodes and edges
    #     processed_devices = set()
        
    #     for row in connection_rows:
    #         (device_a_ip, device_a_name, device_a_interface, device_a_type, device_a_vendor, 
    #          device_a_status, device_a_pos_x, device_a_pos_y, device_a_parent,
    #          device_b_ip, device_b_name, device_b_interface, device_b_type, device_b_vendor,
    #          device_b_status, device_b_pos_x, device_b_pos_y, device_b_parent,
    #          in_speed, out_speed, speed_unit, speed_percentage, bandwidth_util,
    #          connection_status, connection_type, crc_errors, total_packets_in, total_packets_out,
    #          error_rate, crc_status, comments, last_crc_check) = row
            
    #         # Process Device A
    #         if device_a_ip not in processed_devices:
    #             nodes.append({
    #                 'id': device_a_ip,
    #                 'label': device_a_name or device_a_ip,
    #                 'type': self.map_device_type(device_a_type),
    #                 'parent': device_a_parent,
    #                 'status': self.normalize_device_status(device_a_status)
    #             })
    #             processed_devices.add(device_a_ip)
                
    #             # Save device position
    #             if device_a_pos_x is not None and device_a_pos_y is not None:
    #                 positions[device_a_ip] = {'x': float(device_a_pos_x), 'y': float(device_a_pos_y)}
                
    #             # Save device status and type
    #             device_status[device_a_ip] = self.normalize_device_status(device_a_status)
    #             device_types[device_a_ip] = self.map_device_type(device_a_type)
            
    #         # Process Device B
    #         if device_b_ip not in processed_devices:
    #             nodes.append({
    #                 'id': device_b_ip,
    #                 'label': device_b_name or device_b_ip,
    #                 'type': self.map_device_type(device_b_type),
    #                 'parent': device_b_parent,
    #                 'status': self.normalize_device_status(device_b_status)
    #             })
    #             processed_devices.add(device_b_ip)
                
    #             # Save device position
    #             if device_b_pos_x is not None and device_b_pos_y is not None:
    #                 positions[device_b_ip] = {'x': float(device_b_pos_x), 'y': float(device_b_pos_y)}
                
    #             # Save device status and type
    #             device_status[device_b_ip] = self.normalize_device_status(device_b_status)
    #             device_types[device_b_ip] = self.map_device_type(device_b_type)
            
    #         # Create edge
    #         speed_display = f"{in_speed or 0}{speed_unit or 'Mbps'}"
    #         capacity_display = f"{bandwidth_util or 0}{speed_unit or 'Mbps'}"
    #         #new Add on
    #         # Check device statuses to determine if speed should be overridden
    #         device_a_status_normalized = self.normalize_device_status(device_a_status)
    #         device_b_status_normalized = self.normalize_device_status(device_b_status)
            
    #         # If either device is off, override speed color and status
    #         speed_percentage_value = float(speed_percentage or 0)
    #         speed_color = self.get_speed_color(speed_percentage_value)
    #         speed_status = self.get_speed_status(speed_percentage_value)
            
    #         if device_a_status_normalized == 'off' or device_b_status_normalized == 'off':
    #             speed_color = '#ff4757'  # Red
    #             speed_status = 'critical'
            
    #         # till here(new add on)
    #         # Generate CRC data
    #         crc_data = {
    #             'errors': crc_errors or 0,
    #             'totalPackets': total_packets_in or 0,
    #             'errorRate': float(error_rate or 0),
    #             'lastCheck': last_crc_check.isoformat() if last_crc_check else datetime.now().isoformat(),
    #             'status': self.map_crc_status(crc_status)
    #         }
            
    #         edge = {
    #             'source': device_a_ip,
    #             'target': device_b_ip,
    #             'speed': speed_display,
    #             'status': connection_status or 'unknown',
    #             'type': 'primary',
    #             'metadata': {
    #                 'interface_a': device_a_interface,
    #                 'interface_b': device_b_interface,
    #                 'description': comments or '',
    #                 'inSpeed': f"{in_speed or 0}{speed_unit or 'Mbps'}",
    #                 'outSpeed': f"{out_speed or 0}{speed_unit or 'Mbps'}",
    #                 'speedPercentage': speed_percentage_value,
    #                 'speedColor': speed_color,
    #                 'speedStatus': speed_status
    #             },
    #             'crc': crc_data
    #         }
            
    #         edges.append(edge)
            
    #         # Save connection data
    #         connection_id = f"{device_a_ip}#{device_a_interface}#{device_b_ip}#{device_b_interface}"
    #         connection_map[connection_id] = {
    #             'deviceAIP': device_a_ip,
    #             'deviceBIP': device_b_ip,
    #             'inSpeed': in_speed or 0,
    #             'outSpeed': out_speed or 0,
    #             'capacity': bandwidth_util or 0,
    #             'interface_a': device_a_interface,
    #             'interface_b': device_b_interface,
    #             'description': comments or '',
    #             'speedPercentage': float(speed_percentage or 0),
    #             'speedColor': self.get_speed_color(float(speed_percentage or 0)),
    #             'speedStatus': self.get_speed_status(float(speed_percentage or 0)),
    #             'speed': f"{in_speed or 0}G / {bandwidth_util or 0}G"
    #         }
        
    #     # Return data in Angular component format
    #     network_data = {
    #         'blocks': blocks,
    #         'nodes': nodes,
    #         'edges': edges
    #     }
        
    #     return {
    #         'networkData': network_data,
    #         'positions': positions,
    #         'connectionMap': connection_map,
    #         'deviceStatus': device_status,
    #         'deviceTypes': device_types,
    #         'timestamp': int(datetime.now().timestamp() * 1000)  # JavaScript timestamp format
    #     }

    def process_topology_data(self, connection_rows, block_rows):
        """
        Process raw database data into Angular topology component format.
        Returns processed blocks, nodes, edges, positions, and metadata.
        """
        blocks = []
        nodes = []
        edges = []
        positions = {}
        device_status = {}
        device_types = {}
        connection_map = {}
        
        # Process blocks
        for row in block_rows:
            block_id, block_name, block_label, pos_x, pos_y = row
            blocks.append({
                'id': block_id,
                'label': block_label or block_name,
                'type': 'compound'
            })
            
            # Save block position if available
            if pos_x is not None and pos_y is not None:
                positions[block_id] = {'x': float(pos_x), 'y': float(pos_y)}
        
        # Process connections to create nodes and edges
        processed_devices = set()
        
        for row in connection_rows:
            (device_a_ip, device_a_name, device_a_interface, device_a_type, device_a_vendor, 
             device_a_status, device_a_pos_x, device_a_pos_y, device_a_parent,
             device_b_ip, device_b_name, device_b_interface, device_b_type, device_b_vendor,
             device_b_status, device_b_pos_x, device_b_pos_y, device_b_parent,
             in_speed, out_speed, speed_unit, speed_percentage, bandwidth_util,
             connection_status, connection_type, crc_errors, total_packets_in, total_packets_out,
             error_rate, crc_status, comments, last_crc_check) = row
            
            # Process Device A
            if device_a_ip not in processed_devices:
                nodes.append({
                    'id': device_a_ip,
                    'label': device_a_name or device_a_ip,
                    'type': self.map_device_type(device_a_type),
                    'parent': device_a_parent,
                    'status': self.normalize_device_status(device_a_status)
                })
                processed_devices.add(device_a_ip)
                
                # Save device position
                if device_a_pos_x is not None and device_a_pos_y is not None:
                    positions[device_a_ip] = {'x': float(device_a_pos_x), 'y': float(device_a_pos_y)}
                
                # Save device status and type
                device_status[device_a_ip] = self.normalize_device_status(device_a_status)
                device_types[device_a_ip] = self.map_device_type(device_a_type)
            
            # Process Device B
            if device_b_ip not in processed_devices:
                nodes.append({
                    'id': device_b_ip,
                    'label': device_b_name or device_b_ip,
                    'type': self.map_device_type(device_b_type),
                    'parent': device_b_parent,
                    'status': self.normalize_device_status(device_b_status)
                })
                processed_devices.add(device_b_ip)
                
                # Save device position
                if device_b_pos_x is not None and device_b_pos_y is not None:
                    positions[device_b_ip] = {'x': float(device_b_pos_x), 'y': float(device_b_pos_y)}
                
                # Save device status and type
                device_status[device_b_ip] = self.normalize_device_status(device_b_status)
                device_types[device_b_ip] = self.map_device_type(device_b_type)
            
            # Create edge
            speed_display = f"{in_speed or 0}{speed_unit or 'Mbps'}"
            capacity_display = f"{bandwidth_util or 0}{speed_unit or 'Mbps'}"
            
            # Generate CRC data
            crc_data = {
                'errors': crc_errors or 0,
                'totalPackets': total_packets_in or 0,
                'errorRate': float(error_rate or 0),
                'lastCheck': last_crc_check.isoformat() if last_crc_check else datetime.now().isoformat(),
                'status': self.map_crc_status(crc_status)
            }
            
            edge = {
                'source': device_a_ip,
                'target': device_b_ip,
                'speed': speed_display,
                'status': connection_status or 'unknown',
                'type': 'primary',
                'metadata': {
                    'interface_a': device_a_interface,
                    'interface_b': device_b_interface,
                    'description': comments or '',
                    'inSpeed': f"{in_speed or 0}{speed_unit or 'Mbps'}",
                    'outSpeed': f"{out_speed or 0}{speed_unit or 'Mbps'}",
                    'capacity': capacity_display,
                    'speedPercentage': float(speed_percentage or 0),
                    'speedColor': self.get_speed_color(float(speed_percentage or 0)),
                    'speedStatus': self.get_speed_status(float(speed_percentage or 0))
                },
                'crc': crc_data
            }
            
            edges.append(edge)
            
            # Save connection data
            connection_id = f"{device_a_ip}#{device_a_interface}#{device_b_ip}#{device_b_interface}"
            connection_map[connection_id] = {
                'deviceAIP': device_a_ip,
                'deviceBIP': device_b_ip,
                'inSpeed': in_speed or 0,
                'outSpeed': out_speed or 0,
                'capacity': bandwidth_util or 0,
                'interface_a': device_a_interface,
                'interface_b': device_b_interface,
                'description': comments or '',
                'speedPercentage': float(speed_percentage or 0),
                'speedColor': self.get_speed_color(float(speed_percentage or 0)),
                'speedStatus': self.get_speed_status(float(speed_percentage or 0)),
                'speed': f"{in_speed or 0}G / {bandwidth_util or 0}G"
            }
        
        # Return data in Angular component format
        network_data = {
            'blocks': blocks,
            'nodes': nodes,
            'edges': edges
        }
        
        return {
            'networkData': network_data,
            'positions': positions,
            'connectionMap': connection_map,
            'deviceStatus': device_status,
            'deviceTypes': device_types,
            'timestamp': int(datetime.now().timestamp() * 1000)  # JavaScript timestamp format
        }

    # def find_device_position(self, device_id, device_ip, device_hostname, connection_rows):
    #     best_position = None
    #     best_timestamp = None 
         
    #     # Strategy 1: Try to find position by matching the computed device ID
    #     for row in connection_rows:
    #         (device_a_ip, device_a_hostname, device_a_interface, device_a_type, device_a_vendor, device_a_block,
    #          device_a_pos_x, device_a_pos_y, device_a_block_pos_x, device_a_block_pos_y,
    #          device_b_ip, device_b_hostname, device_b_interface, device_b_type, device_b_vendor, device_b_block,
    #          device_b_pos_x, device_b_pos_y, device_b_block_pos_x, device_b_block_pos_y,
    #          comments, created_date, updated_date) = row
             
    #         row_device_a_id = self.compute_device_id(device_a_ip, device_a_hostname)
    #         row_device_b_id = self.compute_device_id(device_b_ip, device_b_hostname)
            
    #         ts = updated_date or created_date
    #         if (row_device_a_id == device_id and
    #             device_a_pos_x is not None and device_a_pos_y is not None):
    #             if best_timestamp is None or (ts and ts > best_timestamp):
    #                 best_position = {'x': float(device_a_pos_x), 'y': float(device_a_pos_y)}
    #                 best_timestamp = ts
                
    #         if (row_device_b_id == device_id and
    #             device_b_pos_x is not None and device_b_pos_y is not None):
    #             if best_timestamp is None or (ts and ts > best_timestamp):
    #                 best_position = {'x': float(device_b_pos_x), 'y': float(device_b_pos_y)}
    #                 best_timestamp = ts
         
    #     # Strategy 2: Try to find position by IP address (if device has IP and no ID match found)
    #     clean_device_ip = self.clean_field_value(device_ip)
    #     if best_position is None and clean_device_ip:
    #         for row in connection_rows:
    #             (device_a_ip, device_a_hostname, device_a_interface, device_a_type, device_a_vendor, device_a_block,
    #              device_a_pos_x, device_a_pos_y, device_a_block_pos_x, device_a_block_pos_y,
    #              device_b_ip, device_b_hostname, device_b_interface, device_b_type, device_b_vendor, device_b_block,
    #              device_b_pos_x, device_b_pos_y, device_b_block_pos_x, device_b_block_pos_y,
    #              comments, created_date, updated_date) = row
                 
    #             ts = updated_date or created_date
    #             if (self.clean_field_value(device_a_ip) == clean_device_ip and
    #                 device_a_pos_x is not None and device_a_pos_y is not None):
    #                 if best_timestamp is None or (ts and ts > best_timestamp):
    #                     best_position = {'x': float(device_a_pos_x), 'y': float(device_a_pos_y)}
    #                     best_timestamp = ts
                
    #             if (self.clean_field_value(device_b_ip) == clean_device_ip and
    #                 device_b_pos_x is not None and device_b_pos_y is not None):
    #                 if best_timestamp is None or (ts and ts > best_timestamp):
    #                     best_position = {'x': float(device_b_pos_x), 'y': float(device_b_pos_y)}
    #                     best_timestamp = ts
         
    #     # Strategy 3: If no IP match found, try to find position by hostname
    #     clean_device_hostname = self.clean_field_value(device_hostname)
    #     if best_position is None and clean_device_hostname:
    #         for row in connection_rows:
    #             (device_a_ip, device_a_hostname, device_a_interface, device_a_type, device_a_vendor, device_a_block,
    #              device_a_pos_x, device_a_pos_y, device_a_block_pos_x, device_a_block_pos_y,
    #              device_b_ip, device_b_hostname, device_b_interface, device_b_type, device_b_vendor, device_b_block,
    #              device_b_pos_x, device_b_pos_y, device_b_block_pos_x, device_b_block_pos_y,
    #              comments, created_date, updated_date) = row
                 
    #             ts = updated_date or created_date
    #             if (self.clean_field_value(device_a_hostname) == clean_device_hostname and
    #                 device_a_pos_x is not None and device_a_pos_y is not None):
    #                 if best_timestamp is None or (ts and ts > best_timestamp):
    #                     best_position = {'x': float(device_a_pos_x), 'y': float(device_a_pos_y)}
    #                     best_timestamp = ts
                
    #             if (self.clean_field_value(device_b_hostname) == clean_device_hostname and
    #                 device_b_pos_x is not None and device_b_pos_y is not None):
    #                 if best_timestamp is None or (ts and ts > best_timestamp):
    #                     best_position = {'x': float(device_b_pos_x), 'y': float(device_b_pos_y)}
    #                     best_timestamp = ts
         
    #     return best_position

    def find_device_position(self, device_id, device_ip, device_hostname, connection_rows):
        best_position = None
        logging.debug(f"find_device_position: {device_id} for device_ip: {device_ip} device_hostname: {device_hostname} _ {datetime.now()}")
        
        # Strategy 1: Try to find position by matching the computed device ID
        for row in connection_rows:
            (device_a_ip, device_a_hostname, device_a_interface, device_a_type, device_a_vendor, device_a_block,
             device_a_pos_x, device_a_pos_y, device_a_block_pos_x, device_a_block_pos_y,
             device_b_ip, device_b_hostname, device_b_interface, device_b_type, device_b_vendor, device_b_block,
             device_b_pos_x, device_b_pos_y, device_b_block_pos_x, device_b_block_pos_y,
             comments, created_date, updated_date) = row
            
            row_device_a_id = self.compute_device_id(device_a_ip, device_a_hostname)
            row_device_b_id = self.compute_device_id(device_b_ip, device_b_hostname)
            # logging.info(f"row_device_a_id: {row_device_a_id} for device_id: {device_id} {datetime.now()}")
            # logging.info(f"row_device_b_id: {row_device_b_id} for device_id: {device_id} {datetime.now()}")

            
            if (row_device_a_id == device_id and
                device_a_pos_x is not None and device_a_pos_y is not None):
                best_position = {'x': float(device_a_pos_x), 'y': float(device_a_pos_y)}
                # logging.info(f"best_position: {best_position} for row_device_a_id: {row_device_a_id} {datetime.now()}")
                break
                
                
            if (row_device_b_id == device_id and
                device_b_pos_x is not None and device_b_pos_y is not None):
                best_position = {'x': float(device_b_pos_x), 'y': float(device_b_pos_y)}
                # logging.info(f"best_position: {best_position} for row_device_a_id: {row_device_b_id} {datetime.now()}")
                break
                
        
        # Strategy 2: Try to find position by IP address (if device has IP and no ID match found)
        clean_device_ip = self.clean_field_value(device_ip)
        if best_position is None and clean_device_ip:
            for row in connection_rows:
                (device_a_ip, device_a_hostname, device_a_interface, device_a_type, device_a_vendor, device_a_block,
                 device_a_pos_x, device_a_pos_y, device_a_block_pos_x, device_a_block_pos_y,
                 device_b_ip, device_b_hostname, device_b_interface, device_b_type, device_b_vendor, device_b_block,
                 device_b_pos_x, device_b_pos_y, device_b_block_pos_x, device_b_block_pos_y,
                 comments, created_date, updated_date) = row
                
                if (self.clean_field_value(device_a_ip) == clean_device_ip and
                    device_a_pos_x is not None and device_a_pos_y is not None):
                    best_position = {'x': float(device_a_pos_x), 'y': float(device_a_pos_y)}
                    # logging.info(f"best_position: {best_position} for device_a_ip: {device_a_ip} {datetime.now()}")
                    break
                
                if (self.clean_field_value(device_b_ip) == clean_device_ip and
                    device_b_pos_x is not None and device_b_pos_y is not None):
                    best_position = {'x': float(device_b_pos_x), 'y': float(device_b_pos_y)}
                    # logging.info(f"best_position: {best_position} for device_b_ip: {device_b_ip} {datetime.now()}")
                    break
        
        # Strategy 3: If no IP match found, try to find position by hostname
        clean_device_hostname = self.clean_field_value(device_hostname)
        if best_position is None and clean_device_hostname:
            for row in connection_rows:
                (device_a_ip, device_a_hostname, device_a_interface, device_a_type, device_a_vendor, device_a_block,
                 device_a_pos_x, device_a_pos_y, device_a_block_pos_x, device_a_block_pos_y,
                 device_b_ip, device_b_hostname, device_b_interface, device_b_type, device_b_vendor, device_b_block,
                 device_b_pos_x, device_b_pos_y, device_b_block_pos_x, device_b_block_pos_y,
                 comments, created_date, updated_date) = row
                
                if (self.clean_field_value(device_a_hostname) == clean_device_hostname and
                    device_a_pos_x is not None and device_a_pos_y is not None):
                    best_position = {'x': float(device_a_pos_x), 'y': float(device_a_pos_y)}
                    # logging.info(f"best_position: {best_position} for device_a_hostname: {device_a_hostname} {datetime.now()}")
                    break
                
                if (self.clean_field_value(device_b_hostname) == clean_device_hostname and
                    device_b_pos_x is not None and device_b_pos_y is not None):
                    best_position = {'x': float(device_b_pos_x), 'y': float(device_b_pos_y)}
                    # logging.info(f"best_position: {best_position} for device_b_hostname: {device_b_hostname} {datetime.now()}")
                    break
        
        return best_position


    def process_dashboard_topology_data(self, connection_rows):
        """
        Process Dashboard table data into Angular topology component format.
        Includes all devices regardless of block assignment.
        """
        logging.info(f"process_dashboard_topology_data at {datetime.now()}")
        blocks = []
        nodes = []
        edges = []
        positions = {}
        device_status = {}
        device_types = {}
        connection_map = {}
        
        # Create blocks based on unique block names from the data
        unique_blocks = set()
        for row in connection_rows:
            device_a_block = row[5]
            device_b_block = row[15]
            if device_a_block and device_a_block.strip():
                unique_blocks.add(device_a_block)
            if device_b_block and device_b_block.strip():
                unique_blocks.add(device_b_block)
        
        for block_name in unique_blocks:
            if block_name and block_name.strip():
                blocks.append({
                    'id': block_name,
                    'label': block_name.replace('-', ' ').title(),
                    'type': 'compound'
                })
                
                positions[block_name] = {'x': 0, 'y': 0}
        
        processed_devices = set()
        blockless_device_count = 0
        
        for row in connection_rows:
            # print('----row_',row, file=sys.stderr)
            

            (device_a_ip, device_a_hostname, device_a_interface, device_a_type, device_a_vendor, device_a_block,
             device_a_pos_x, device_a_pos_y, device_a_block_pos_x, device_a_block_pos_y,
             device_b_ip, device_b_hostname, device_b_interface, device_b_type, device_b_vendor, device_b_block,
             device_b_pos_x, device_b_pos_y, device_b_block_pos_x, device_b_block_pos_y,
             comments, created_date, updated_date) = row
            # print('----device_a_pos_x',device_a_pos_x, file=sys.stderr)
            # print('----device_a_pos_y',device_a_pos_y, file=sys.stderr)

            device_a_id = self.compute_device_id(device_a_ip, device_a_hostname)
            device_b_id = self.compute_device_id(device_b_ip, device_b_hostname)
            # print('----',device_a_id,device_b_id)


            if device_a_id and device_a_id not in processed_devices:
                has_block = device_a_block and device_a_block.strip()
                # logging.info(f"has_block: {has_block} for device_a_id: {device_a_id} _ {datetime.now()}")
                
                nodes.append({
                    'id': device_a_id,
                    'label': (device_a_hostname or device_a_id),
                    'type': self.map_device_type(device_a_type),
                    'parent': device_a_block if has_block else None,
                    'status': 'off'  # Default status to off
                })
                # logging.info(f"nodes: {nodes} _ {datetime.now()}")
                processed_devices.add(device_a_id)
                # logging.info(f"processed_devices: {processed_devices} _ {datetime.now()}")

                saved_position = self.find_device_position(device_a_id, device_a_ip, device_a_hostname, connection_rows)
                # print('saved_position_',saved_position, file=sys.stderr)
                # print('device_a_id__',device_a_id, file=sys.stderr)

                logging.debug(f"saved_position: {saved_position} for device_a_id: {device_a_id} device_a_ip: {device_a_ip} device_a_hostname: {device_a_hostname} _ {datetime.now()}")
                
                if saved_position:
                    positions[device_a_id] = saved_position
                    # logging.info(f"positions: {positions} for device_a_id: {device_a_id} _ {datetime.now()}")
                    # logging.info(f"positions: {positions} for device_a_id: {device_a_id} _ {datetime.now()}")
                elif not has_block:
                    angle = (blockless_device_count * 45) % 360  # 45 degree increments
                    radius = 300 + (blockless_device_count // 8) * 100  # Increase radius for each ring
                    x = radius * math.cos(math.radians(angle))
                    y = radius * math.sin(math.radians(angle))
                    positions[device_a_id] = {'x': x, 'y': y}
                    # logging.info(f"positions: {positions} for device_a_id: {device_a_id} _ {datetime.now()}")
                    blockless_device_count += 1
                else:
                    positions[device_a_id] = {'x': 0, 'y': 0}
                    # logging.info(f"positions: {positions} for device_a_id: {device_a_id} _ {datetime.now()}")

                device_status[device_a_id] = 'off'
                device_types[device_a_id] = device_a_type

            if device_b_id and device_b_id not in processed_devices:
                has_block = device_b_block and device_b_block.strip()
                # logging.info(f"has_block: {has_block} for device_b_id: {device_b_id} _ {datetime.now()}")
                
                nodes.append({
                    'id': device_b_id,
                    'label': (device_b_hostname or device_b_id),
                    'type': self.map_device_type(device_b_type),
                    'parent': device_b_block if has_block else None,
                    'status': 'off'  # Default status to off
                })
                # logging.info(f"nodes: {nodes} _ {datetime.now()}")
                processed_devices.add(device_b_id)
                # logging.info(f"processed_devices: {processed_devices} _ {datetime.now()}")

                saved_position = self.find_device_position(device_b_id, device_b_ip, device_b_hostname, connection_rows)
                logging.info(f"saved_position: {saved_position} for device_b_id: {device_b_id} device_b_ip: {device_b_ip} device_b_hostname: {device_b_hostname} _ {datetime.now()}")
                if saved_position:
                    positions[device_b_id] = saved_position
                    # logging.info(f"positions: {positions} for device_b_id: {device_b_id} _ {datetime.now()}")
                    # logging.info(f"positions: {positions} for device_b_id: {device_b_id} _ {datetime.now()}")
                elif not has_block:
                    angle = (blockless_device_count * 45) % 360  # 45 degree increments
                    radius = 300 + (blockless_device_count // 8) * 100  # Increase radius for each ring
                    x = radius * math.cos(math.radians(angle))
                    y = radius * math.sin(math.radians(angle))
                    positions[device_b_id] = {'x': x, 'y': y}
                    # logging.info(f"positions: {positions} for device_b_id: {device_b_id} _ {datetime.now()}")
                    blockless_device_count += 1
                else:
                    positions[device_b_id] = {'x': 0, 'y': 0}
                    # logging.info(f"positions: {positions} for device_b_id: {device_b_id} _ {datetime.now()}")

                device_status[device_b_id] = 'off'
                device_types[device_b_id] = device_b_type

            if device_a_block and device_a_block_pos_x is not None and device_a_block_pos_y is not None:
                positions[device_a_block] = {
                    'x': float(device_a_block_pos_x),
                    'y': float(device_a_block_pos_y)
                }
                # logging.info(f"positions: {positions} for device_a_block: {device_a_block} device_a_block_pos_x: {device_a_block_pos_x} device_a_block_pos_y: {device_a_block_pos_y} _ {datetime.now()}")
            if device_b_block and device_b_block_pos_x is not None and device_b_block_pos_y is not None:
                positions[device_b_block] = {
                    'x': float(device_b_block_pos_x),
                    'y': float(device_b_block_pos_y)
                }
                # logging.info(f"positions: {positions} for device_b_block: {device_b_block} device_b_block_pos_x: {device_b_block_pos_x} device_b_block_pos_y: {device_b_block_pos_y} _ {datetime.now()}")
            if device_a_id and device_b_id:
                edge = {
                    'source': device_a_id,
                    'target': device_b_id,
                    'speed': '0Gbps',
                    'status': 'inactive',
                    'type': 'primary',
                    'metadata': {
                        'interface_a': device_a_interface,
                        'interface_b': device_b_interface,
                        'description': comments or '',
                        'inSpeed': '0Gbps',
                        'outSpeed': '0Gbps',
                        'capacity': '0Gbps',
                        'speedPercentage': 0,
                        'speedColor': self.get_speed_color(0),
                        'speedStatus': self.get_speed_status(0)
                    },
                    'crc': {
                        'errors': 0,
                        'totalPackets': 0,
                        'errorRate': 0.0,
                        'lastCheck': datetime.now().isoformat(),
                        'status': self.map_crc_status('good')
                    }
                }

                edges.append(edge)
                # logging.info(f"edges: {edges} _ {datetime.now()}")
                connection_id = f"{device_a_id}#{device_a_interface}#{device_b_id}#{device_b_interface}"
                # logging.info(f"connection_id: {connection_id} _ {datetime.now()}")
                connection_map[connection_id] = {
                    'deviceAIP': device_a_id,
                    'deviceBIP': device_b_id,
                    'inSpeed': 0,
                    'outSpeed': 0,
                    'capacity': 0,
                    'interface_a': device_a_interface,
                    'interface_b': device_b_interface,
                    'description': comments or '',
                    'speedPercentage': 0,
                    'speedColor': self.get_speed_color(0),
                    'speedStatus': self.get_speed_status(0),
                    'speed': '0G / 0G'
                }
        logging.info(f"blocks: {blocks} _ {datetime.now()}")
        logging.info(f"nodes: {nodes} _ {datetime.now()}")
        logging.info(f"edges: {edges} _ {datetime.now()}")
        logging.info(f"positions: {positions} _ {datetime.now()}")
        logging.info(f"device_status: {device_status} _ {datetime.now()}")
        logging.info(f"device_types: {device_types} _ {datetime.now()}")
        logging.info(f"connection_map: {connection_map} _ {datetime.now()}")

        logging.info(f"about to finish------------------------ {datetime.now()}")
        network_data = {
            'blocks': blocks,
            'nodes': nodes,
            'edges': edges
        }

        logging.info(
            f"network_data: {{'networkData': {network_data}, "
            f"'positions': {positions}, "
            f"'connectionMap': {connection_map}, "
            f"'deviceStatus': {device_status}, "
            f"'deviceTypes': {device_types}, "
            f"'timestamp': {int(datetime.now().timestamp() * 1000)}}} _ {datetime.now()}"
        )

        logging.info(f"finshed------------------------ {datetime.now()}")
        
        return {
            'networkData': network_data,
            'positions': positions,
            'connectionMap': connection_map,
            'deviceStatus': device_status,
            'deviceTypes': device_types,
            'timestamp': int(datetime.now().timestamp() * 1000)
        }


    def map_device_type(self, db_type):
        """Map database device type to Angular component type"""
        type_mapping = {
            'firewall': 'firewall' or 'Firewall',
            'switch': 'switch' or 'Switch', 
            'router': 'router' or 'Router',
            'server': 'server' or 'Server',
            'internet': 'internet' or 'Internet',
            'ext_switch': 'ext_switch' or 'Ext Switch',
            'core_switch': 'core_switch' or 'Core Switch',
            'external_switch': 'ext_switch' or 'Ext Switch',
            'isp': 'isp'
        }
        return type_mapping.get(db_type, 'switch')

    def normalize_device_status(self, db_status):
        """Normalize database status to Angular component format"""
        if db_status in ['on', 'up', 'active']:
            return 'on'
        elif db_status in ['off', 'down', 'inactive']:
            return 'off'
        return 'off'  # Default to off

    def map_crc_status(self, db_crc_status):
        """Map database CRC status to Angular component format"""
        status_mapping = {
            'good': 'good',
            'warning': 'warning', 
            'critical': 'critical'
        }
        return status_mapping.get(db_crc_status, 'good')

    def get_speed_color(self, speed_percentage):
        """Get speed color based on percentage"""
        if speed_percentage == 0:
            return '#ff0000'  # Red - Stopped
        elif speed_percentage >= 90:
            return '#ff4757'  # Red - Critical
        elif speed_percentage >= 75:
            return '#ffa502'  # Orange - Warning  
        elif speed_percentage >= 50:
            return '#ffdd59'  # Yellow - Moderate
        else:
            return '#2ed573'  # Green - Good


    def get_speed_status(self, speed_percentage):
        """Get speed status based on percentage"""
        if speed_percentage == 0:
            return 'stopped'
        elif speed_percentage >= 90:
            return 'critical'
        elif speed_percentage >= 75:
            return 'warning'
        elif speed_percentage >= 50:
            return 'normal'
        else:
            return 'good'

    def calculate_auto_layout_positions(self, records):
        """
        Calculate initial positions for devices based on their block assignments.
        Uses a grid layout within each block to prevent overlapping.

        Args:
            records: List of record dictionaries with device_a_block, device_b_block,
                    device_a_ip, device_a_hostname, device_b_ip, device_b_hostname

        Returns:
            dict: Mapping of device_id -> {'x': float, 'y': float}
        """
        # Configuration for grid layout
        DEVICES_PER_ROW = 4          # Number of devices per row in a block
        DEVICE_SPACING_X = 200       # Horizontal spacing between devices
        DEVICE_SPACING_Y = 150       # Vertical spacing between rows
        BLOCK_SPACING = 1500         # Spacing between blocks
        BLOCKS_PER_ROW = 3           # Number of blocks per row

        # Collect unique devices per block
        block_devices = {}  # block_name -> set of device_ids
        device_info = {}    # device_id -> {'hostname': str, 'ip': str}
        blockless_devices = set()

        for record in records:
            # Process Device A
            device_a_id = self.compute_device_id(
                record.get('device_a_ip', ''),
                record.get('device_a_hostname', '')
            )
            device_a_block = (record.get('device_a_block') or '').strip()

            if device_a_id:
                device_info[device_a_id] = {
                    'hostname': record.get('device_a_hostname', ''),
                    'ip': record.get('device_a_ip', '')
                }
                if device_a_block:
                    if device_a_block not in block_devices:
                        block_devices[device_a_block] = set()
                    block_devices[device_a_block].add(device_a_id)
                else:
                    blockless_devices.add(device_a_id)

            # Process Device B
            device_b_id = self.compute_device_id(
                record.get('device_b_ip', ''),
                record.get('device_b_hostname', '')
            )
            device_b_block = (record.get('device_b_block') or '').strip()

            if device_b_id:
                device_info[device_b_id] = {
                    'hostname': record.get('device_b_hostname', ''),
                    'ip': record.get('device_b_ip', '')
                }
                if device_b_block:
                    if device_b_block not in block_devices:
                        block_devices[device_b_block] = set()
                    block_devices[device_b_block].add(device_b_id)
                else:
                    blockless_devices.add(device_b_id)

        positions = {}
        block_positions = {}

        # Calculate block positions (arrange blocks in a grid)
        block_names = sorted(block_devices.keys())
        for block_idx, block_name in enumerate(block_names):
            block_row = block_idx // BLOCKS_PER_ROW
            block_col = block_idx % BLOCKS_PER_ROW

            # Calculate block center position
            block_center_x = block_col * BLOCK_SPACING
            block_center_y = block_row * BLOCK_SPACING

            block_positions[block_name] = {
                'x': block_center_x,
                'y': block_center_y
            }

            # Calculate device positions within this block
            devices = sorted(list(block_devices[block_name]))
            num_devices = len(devices)

            # Calculate grid dimensions for devices in this block
            num_rows = math.ceil(num_devices / DEVICES_PER_ROW)

            for device_idx, device_id in enumerate(devices):
                device_row = device_idx // DEVICES_PER_ROW
                device_col = device_idx % DEVICES_PER_ROW

                # Calculate how many devices are in this row
                if device_row == num_rows - 1:
                    # Last row might have fewer devices
                    devices_in_row = num_devices - (device_row * DEVICES_PER_ROW)
                else:
                    devices_in_row = DEVICES_PER_ROW

                # Center the row
                row_width = (devices_in_row - 1) * DEVICE_SPACING_X
                row_start_x = block_center_x - (row_width / 2)

                # Center vertically
                grid_height = (num_rows - 1) * DEVICE_SPACING_Y
                grid_start_y = block_center_y - (grid_height / 2)

                device_x = row_start_x + (device_col * DEVICE_SPACING_X)
                device_y = grid_start_y + (device_row * DEVICE_SPACING_Y)

                positions[device_id] = {
                    'x': device_x,
                    'y': device_y
                }

        # Position blockless devices in a circle around the main layout
        if blockless_devices:
            # Calculate center of all blocks
            if block_positions:
                center_x = sum(bp['x'] for bp in block_positions.values()) / len(block_positions)
                center_y = sum(bp['y'] for bp in block_positions.values()) / len(block_positions)
            else:
                center_x = 0
                center_y = 0

            # Position blockless devices in concentric circles
            blockless_list = sorted(list(blockless_devices))
            radius = max(BLOCK_SPACING, 800)  # Start radius outside the block area

            for idx, device_id in enumerate(blockless_list):
                angle = (idx * 45) % 360  # 45-degree increments
                ring = idx // 8  # 8 devices per ring
                current_radius = radius + (ring * 200)

                x = center_x + current_radius * math.cos(math.radians(angle))
                y = center_y + current_radius * math.sin(math.radians(angle))

                positions[device_id] = {'x': x, 'y': y}

        return {
            'device_positions': positions,
            'block_positions': block_positions
        }



