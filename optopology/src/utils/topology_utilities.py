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

        self.HEADERED_REQUIRED_FIELDS = [
            'device_a_ip', 'device_a_hostname', 'device_a_interface',
            'device_b_hostname'
        ]

        self.POSITION_REQUIRED_FIELDS = ['device_ip', 'position']

        self.BLOCK_POSITION_REQUIRED_FIELDS = ['block_id', 'position']

        self.TOPOLOGY_RECORD_REQUIRED_FIELDS = [
            'device_a_ip', 'device_a_hostname', 'device_a_interface',
            'device_b_ip', 'device_b_hostname', 'device_b_interface'
        ]

        self.TOPOLOGY_UPDATE_RECORD_REQUIRED_FIELDS = [
            'record_id', 'device_a_ip', 'device_a_hostname', 'device_a_interface',
            'device_b_hostname'
        ]

        self.TOPOLOGY_DELETE_RECORD_REQUIRED_FIELDS = ['record_id']

        self.DEVICE_TYPE_UPDATE_REQUIRED_FIELDS = ['device_ip', 'device_hostname', 'new_device_type']

        self.HEADER_TO_FIELD = {
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
        missing_fields = [field for field in self.REQUIRED_FIELDS if not record.get(field)]
        if missing_fields:
            return [f"Row {row_num}: Missing required fields: {missing_fields}"]
        return []

    def transform_record(self, record):
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
        try:
            raw = str(key)
            cleaned = ''.join(ch if ch.isalnum() or ch in [' ', '_'] else ' ' for ch in raw)
            cleaned = ' '.join(cleaned.strip().split())
            cleaned = cleaned.lower().replace(' ', '_')
            return cleaned
        except Exception:
            return str(key).strip().lower().replace(' ', '_')

    def extract_headered_record(self, raw_row):
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

        if record['device_a_type']:
            record['device_a_type'] = str(record['device_a_type']).lower()
        if record['device_b_type']:
            record['device_b_type'] = str(record['device_b_type']).lower()

        return record

    def validate_headered_record(self, record, row_num):
        missing = [f for f in self.HEADERED_REQUIRED_FIELDS if not str(record.get(f) or '').strip()]
        if missing:
            return [f"Missing required fields: {missing}"]
        return []

    def validate_position_data(self, data):
        missing_fields = [field for field in self.POSITION_REQUIRED_FIELDS if field not in data]
        if missing_fields:
            return [f'Missing required fields: {missing_fields}']

        if 'x' not in data['position'] or 'y' not in data['position']:
            return ['Position must contain x and y coordinates']

        try:
            float(data['position']['x'])
            float(data['position']['y'])
        except (ValueError, TypeError):
            return ['Position coordinates must be numeric values']

        return []

    def validate_block_position_data(self, data):
        missing_fields = [field for field in self.BLOCK_POSITION_REQUIRED_FIELDS if field not in data]
        if missing_fields:
            return [f'Missing required fields: {missing_fields}']

        if 'x' not in data['position'] or 'y' not in data['position']:
            return ['Position must contain x and y coordinates']

        try:
            float(data['position']['x'])
            float(data['position']['y'])
        except (ValueError, TypeError):
            return ['Position coordinates must be numeric values']

        return []

    def validate_topology_record(self, data):
        missing_fields = [field for field in self.TOPOLOGY_RECORD_REQUIRED_FIELDS if not data.get(field)]
        if missing_fields:
            return [f'Missing required fields: {missing_fields}']

        return []

    def validate_topology_update_record(self, data):
        missing_fields = [field for field in self.TOPOLOGY_UPDATE_RECORD_REQUIRED_FIELDS if not data.get(field)]
        if missing_fields:
            return [f'Missing required fields: {missing_fields}']

        return []

    def validate_topology_delete_record(self, data):
        missing_fields = [field for field in self.TOPOLOGY_DELETE_RECORD_REQUIRED_FIELDS if not data.get(field)]
        if missing_fields:
            return [f'Missing required fields: {missing_fields}']

        return []

    def validate_device_type_update(self, data):
        missing_fields = [field for field in self.DEVICE_TYPE_UPDATE_REQUIRED_FIELDS if not data.get(field)]
        if missing_fields:
            return [f'Missing required fields: {missing_fields}']

        return []

    def determine_block(self, hostname, ip, device_type):
        try:
            raw_name = (hostname or '')
            name = re.sub(r'[^A-Za-z0-9]+', ' ', raw_name).strip().upper()
            ip_str = (ip or '').strip()
            dtype = (device_type or '').strip().lower()

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

    def process_topology_data(self, connection_rows, block_rows):
        blocks = []
        nodes = []
        edges = []
        positions = {}
        device_status = {}
        device_types = {}
        connection_map = {}

        for row in block_rows:
            block_id, block_name, block_label, pos_x, pos_y = row
            blocks.append({
                'id': block_id,
                'label': block_label or block_name,
                'type': 'compound'
            })

            if pos_x is not None and pos_y is not None:
                positions[block_id] = {'x': float(pos_x), 'y': float(pos_y)}

        processed_devices = set()

        for row in connection_rows:
            (device_a_ip, device_a_name, device_a_interface, device_a_type, device_a_vendor,
             device_a_status, device_a_pos_x, device_a_pos_y, device_a_parent,
             device_b_ip, device_b_name, device_b_interface, device_b_type, device_b_vendor,
             device_b_status, device_b_pos_x, device_b_pos_y, device_b_parent,
             in_speed, out_speed, speed_unit, speed_percentage, bandwidth_util,
             connection_status, connection_type, crc_errors, total_packets_in, total_packets_out,
             error_rate, crc_status, comments, last_crc_check) = row

            if device_a_ip not in processed_devices:
                nodes.append({
                    'id': device_a_ip,
                    'label': device_a_name or device_a_ip,
                    'type': self.map_device_type(device_a_type),
                    'parent': device_a_parent,
                    'status': self.normalize_device_status(device_a_status)
                })
                processed_devices.add(device_a_ip)

                if device_a_pos_x is not None and device_a_pos_y is not None:
                    positions[device_a_ip] = {'x': float(device_a_pos_x), 'y': float(device_a_pos_y)}

                device_status[device_a_ip] = self.normalize_device_status(device_a_status)
                device_types[device_a_ip] = self.map_device_type(device_a_type)

            if device_b_ip not in processed_devices:
                nodes.append({
                    'id': device_b_ip,
                    'label': device_b_name or device_b_ip,
                    'type': self.map_device_type(device_b_type),
                    'parent': device_b_parent,
                    'status': self.normalize_device_status(device_b_status)
                })
                processed_devices.add(device_b_ip)

                if device_b_pos_x is not None and device_b_pos_y is not None:
                    positions[device_b_ip] = {'x': float(device_b_pos_x), 'y': float(device_b_pos_y)}

                device_status[device_b_ip] = self.normalize_device_status(device_b_status)
                device_types[device_b_ip] = self.map_device_type(device_b_type)

            speed_display = f"{in_speed or 0}{speed_unit or 'Mbps'}"
            capacity_display = f"{bandwidth_util or 0}{speed_unit or 'Mbps'}"

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
            'timestamp': int(datetime.now().timestamp() * 1000)
        }

    def find_device_position(self, device_id, device_ip, device_hostname, connection_rows):
        best_position = None
        logging.debug(f"find_device_position: {device_id} for device_ip: {device_ip} device_hostname: {device_hostname} _ {datetime.now()}")

        for row in connection_rows:
            (device_a_ip, device_a_hostname, device_a_interface, device_a_type, device_a_vendor, device_a_block,
             device_a_pos_x, device_a_pos_y, device_a_block_pos_x, device_a_block_pos_y,
             device_b_ip, device_b_hostname, device_b_interface, device_b_type, device_b_vendor, device_b_block,
             device_b_pos_x, device_b_pos_y, device_b_block_pos_x, device_b_block_pos_y,
             comments, created_date, updated_date) = row

            row_device_a_id = self.compute_device_id(device_a_ip, device_a_hostname)
            row_device_b_id = self.compute_device_id(device_b_ip, device_b_hostname)

            if (row_device_a_id == device_id and
                device_a_pos_x is not None and device_a_pos_y is not None):
                best_position = {'x': float(device_a_pos_x), 'y': float(device_a_pos_y)}
                break

            if (row_device_b_id == device_id and
                device_b_pos_x is not None and device_b_pos_y is not None):
                best_position = {'x': float(device_b_pos_x), 'y': float(device_b_pos_y)}
                break

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
                    break

                if (self.clean_field_value(device_b_ip) == clean_device_ip and
                    device_b_pos_x is not None and device_b_pos_y is not None):
                    best_position = {'x': float(device_b_pos_x), 'y': float(device_b_pos_y)}
                    break

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
                    break

                if (self.clean_field_value(device_b_hostname) == clean_device_hostname and
                    device_b_pos_x is not None and device_b_pos_y is not None):
                    best_position = {'x': float(device_b_pos_x), 'y': float(device_b_pos_y)}
                    break

        return best_position


    def process_dashboard_topology_data(self, connection_rows):
        logging.info(f"process_dashboard_topology_data at {datetime.now()}")
        blocks = []
        nodes = []
        edges = []
        positions = {}
        device_status = {}
        device_types = {}
        connection_map = {}

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
            (device_a_ip, device_a_hostname, device_a_interface, device_a_type, device_a_vendor, device_a_block,
             device_a_pos_x, device_a_pos_y, device_a_block_pos_x, device_a_block_pos_y,
             device_b_ip, device_b_hostname, device_b_interface, device_b_type, device_b_vendor, device_b_block,
             device_b_pos_x, device_b_pos_y, device_b_block_pos_x, device_b_block_pos_y,
             comments, created_date, updated_date) = row

            device_a_id = self.compute_device_id(device_a_ip, device_a_hostname)
            device_b_id = self.compute_device_id(device_b_ip, device_b_hostname)

            if device_a_id and device_a_id not in processed_devices:
                has_block = device_a_block and device_a_block.strip()

                nodes.append({
                    'id': device_a_id,
                    'label': (device_a_hostname or device_a_id),
                    'type': self.map_device_type(device_a_type),
                    'parent': device_a_block if has_block else None,
                    'status': 'off'
                })
                processed_devices.add(device_a_id)

                saved_position = self.find_device_position(device_a_id, device_a_ip, device_a_hostname, connection_rows)

                logging.debug(f"saved_position: {saved_position} for device_a_id: {device_a_id} device_a_ip: {device_a_ip} device_a_hostname: {device_a_hostname} _ {datetime.now()}")

                if saved_position:
                    positions[device_a_id] = saved_position
                elif not has_block:
                    angle = (blockless_device_count * 45) % 360
                    radius = 300 + (blockless_device_count // 8) * 100
                    x = radius * math.cos(math.radians(angle))
                    y = radius * math.sin(math.radians(angle))
                    positions[device_a_id] = {'x': x, 'y': y}
                    blockless_device_count += 1
                else:
                    positions[device_a_id] = {'x': 0, 'y': 0}

                device_status[device_a_id] = 'off'
                device_types[device_a_id] = device_a_type

            if device_b_id and device_b_id not in processed_devices:
                has_block = device_b_block and device_b_block.strip()

                nodes.append({
                    'id': device_b_id,
                    'label': (device_b_hostname or device_b_id),
                    'type': self.map_device_type(device_b_type),
                    'parent': device_b_block if has_block else None,
                    'status': 'off'
                })
                processed_devices.add(device_b_id)

                saved_position = self.find_device_position(device_b_id, device_b_ip, device_b_hostname, connection_rows)
                logging.info(f"saved_position: {saved_position} for device_b_id: {device_b_id} device_b_ip: {device_b_ip} device_b_hostname: {device_b_hostname} _ {datetime.now()}")
                if saved_position:
                    positions[device_b_id] = saved_position
                elif not has_block:
                    angle = (blockless_device_count * 45) % 360
                    radius = 300 + (blockless_device_count // 8) * 100
                    x = radius * math.cos(math.radians(angle))
                    y = radius * math.sin(math.radians(angle))
                    positions[device_b_id] = {'x': x, 'y': y}
                    blockless_device_count += 1
                else:
                    positions[device_b_id] = {'x': 0, 'y': 0}

                device_status[device_b_id] = 'off'
                device_types[device_b_id] = device_b_type

            if device_a_block and device_a_block_pos_x is not None and device_a_block_pos_y is not None:
                positions[device_a_block] = {
                    'x': float(device_a_block_pos_x),
                    'y': float(device_a_block_pos_y)
                }
            if device_b_block and device_b_block_pos_x is not None and device_b_block_pos_y is not None:
                positions[device_b_block] = {
                    'x': float(device_b_block_pos_x),
                    'y': float(device_b_block_pos_y)
                }
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
                connection_id = f"{device_a_id}#{device_a_interface}#{device_b_id}#{device_b_interface}"
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
        if db_status in ['on', 'up', 'active']:
            return 'on'
        elif db_status in ['off', 'down', 'inactive']:
            return 'off'
        return 'off'

    def map_crc_status(self, db_crc_status):
        status_mapping = {
            'good': 'good',
            'warning': 'warning',
            'critical': 'critical'
        }
        return status_mapping.get(db_crc_status, 'good')

    def get_speed_color(self, speed_percentage):
        if speed_percentage == 0:
            return '#ff0000'
        elif speed_percentage >= 90:
            return '#ff4757'
        elif speed_percentage >= 75:
            return '#ffa502'
        elif speed_percentage >= 50:
            return '#ffdd59'
        else:
            return '#2ed573'


    def get_speed_status(self, speed_percentage):
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
        DEVICES_PER_ROW = 4
        DEVICE_SPACING_X = 200
        DEVICE_SPACING_Y = 150
        BLOCK_SPACING = 1500
        BLOCKS_PER_ROW = 3

        block_devices = {}
        device_info = {}
        blockless_devices = set()

        for record in records:
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

        block_names = sorted(block_devices.keys())
        for block_idx, block_name in enumerate(block_names):
            block_row = block_idx // BLOCKS_PER_ROW
            block_col = block_idx % BLOCKS_PER_ROW

            block_center_x = block_col * BLOCK_SPACING
            block_center_y = block_row * BLOCK_SPACING

            block_positions[block_name] = {
                'x': block_center_x,
                'y': block_center_y
            }

            devices = sorted(list(block_devices[block_name]))
            num_devices = len(devices)

            num_rows = math.ceil(num_devices / DEVICES_PER_ROW)

            for device_idx, device_id in enumerate(devices):
                device_row = device_idx // DEVICES_PER_ROW
                device_col = device_idx % DEVICES_PER_ROW

                if device_row == num_rows - 1:
                    devices_in_row = num_devices - (device_row * DEVICES_PER_ROW)
                else:
                    devices_in_row = DEVICES_PER_ROW

                row_width = (devices_in_row - 1) * DEVICE_SPACING_X
                row_start_x = block_center_x - (row_width / 2)

                grid_height = (num_rows - 1) * DEVICE_SPACING_Y
                grid_start_y = block_center_y - (grid_height / 2)

                device_x = row_start_x + (device_col * DEVICE_SPACING_X)
                device_y = grid_start_y + (device_row * DEVICE_SPACING_Y)

                positions[device_id] = {
                    'x': device_x,
                    'y': device_y
                }

        if blockless_devices:
            if block_positions:
                center_x = sum(bp['x'] for bp in block_positions.values()) / len(block_positions)
                center_y = sum(bp['y'] for bp in block_positions.values()) / len(block_positions)
            else:
                center_x = 0
                center_y = 0

            blockless_list = sorted(list(blockless_devices))
            radius = max(BLOCK_SPACING, 800)

            for idx, device_id in enumerate(blockless_list):
                angle = (idx * 45) % 360
                ring = idx // 8
                current_radius = radius + (ring * 200)

                x = center_x + current_radius * math.cos(math.radians(angle))
                y = center_y + current_radius * math.sin(math.radians(angle))

                positions[device_id] = {'x': x, 'y': y}

        return {
            'device_positions': positions,
            'block_positions': block_positions
        }
