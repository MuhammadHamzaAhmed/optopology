import traceback
from flask import Flask, request, jsonify
import os
import requests
import logging
from logging.handlers import RotatingFileHandler
from flask_cors import CORS
from topology_app import TopologyApp
import sys
from datetime import datetime

# print('testing-----------------------------------------',file=sys.stderr)


app = Flask(__name__)

# Configure CORS to allow requests from the frontend
CORS(app, resources={
    r"/*": {
        "origins": ["http://localhost:3007", "http://127.0.0.1:3007", "http://localhost:5017", "http://127.0.0.1:5017"],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"],
        "supports_credentials": False
    }
})

api_service_name = "topology-api"

# print('testing-------------------555555555555555555555----------------------',file=sys.stderr)


logging.basicConfig(
    handlers=[RotatingFileHandler('/usr/src/applogs/app_log.log', maxBytes=10)],
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s [%(name)s.%(funcName)s:%(lineno)d] %(message)s",
    datefmt='%Y-%m-%dT%H:%M:%S')

app.config['UPLOAD_FOLDER'] = 'uploads'
if not 'uploads' in os.listdir():
    os.mkdir('uploads')


@app.route('/' + api_service_name + '/health-check', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok'})


@app.route('/' + api_service_name + '/import-excel-connections', methods=['POST'])
def import_excel_connections():
    logging.info("Import Excel connections endpoint called")
    try:
        data = request.get_json()
        if not data or not isinstance(data, list):
            logging.warning("Invalid data format for import")
            return jsonify({'error': 'Invalid data format. Expected array of objects.'}), 400

        service = TopologyApp()
        response = service.import_connections(data)

        logging.info(
            f"Import completed: {response['inserted_count']} inserted, {response.get('error_count', 0)} errors")
        return jsonify(response), 200
    except Exception as e:
        logging.error(f"Import connections error: {str(e)}")
        return jsonify({'error': f'Import failed: {str(e)}'}), 500


@app.route('/' + api_service_name + '/import-excel-headered', methods=['POST'])
def import_excel_headered():
    """
    EXCEL IMPORT: Import header-based Excel rows and insert into Dashboard table
    ========================================================================

    - Accepts an array of row objects keyed by Excel column headers (case-insensitive)
      OR an object with a 'rows' array field.
    - Parses headers in backend and maps to DB columns.
    - Dedup policy: only skip when BOTH ends match by (hostname + interface) pair
      with an existing record, considering A/B order or swapped (A<->B). IP is not used
      for dedup. All other cases are allowed.
    - Skips duplicates and logs reasons.
    - Returns a summary of inserted vs skipped rows.

    - Server-side: If block fields are missing, backend auto-assigns blocks based on hostname/IP/type.

    Expected minimal headers (case-insensitive, flexible naming supported):
    - Device A: IP, Hostname, Interface, Type (optional), Vendor (optional), Block (optional)
    - Device B: IP, Hostname, Interface, Type (optional), Vendor (optional), Block (optional)
    - Comments (optional)
    """
    logging.info("Import Excel headered endpoint called")
    try:
        payload = request.get_json(silent=True)
        if payload is None:
            logging.warning("Import Excel headered failed - invalid or missing JSON body")
            return jsonify({'success': False, 'message': 'Invalid or missing JSON body'}), 400

        # Payload can be an array of objects, or { rows: [...] }
        if isinstance(payload, list):
            rows = payload
        elif isinstance(payload, dict) and isinstance(payload.get('rows'), list):
            rows = payload['rows']
        else:
            return jsonify(
                {'success': False, 'message': 'Payload must be an array of row objects or { "rows": [...] }'}), 400

        if len(rows) == 0:
            return jsonify({'success': False, 'message': 'No rows provided'}), 400

        service = TopologyApp()
        response = service.import_excel_headered(rows)

        logging.info(
            f"Import Excel headered completed: {response['inserted_count']} inserted, {response['skipped_count']} skipped, {response.get('errors', []).__len__()} errors")
        return jsonify(response), 200
    except Exception as e:
        logging.error(f"Header-based Excel import failed: {str(e)}")
        return jsonify({'success': False, 'message': f'Import failed: {str(e)}'}), 500


@app.route('/' + api_service_name + '/update-device-position', methods=['POST'])
def update_device_position():
    """
    TOPOLOGY VISUALIZATION: Update device position on topology map
    =============================================================

    Updates the position of a device when user drags it on the topology visualization.
    Used by the network topology visualization component.

    Expected format:
    {
        "device_ip": "10.99.18.253",
        "position": {
            "x": 150.5,
            "y": 200.0
        },
        "changed_by": "admin@company.com",
        "drag_type": "device_drag"
    }

    Database: NETWORK_TOPOLOGY_MAIN (topology visualization table)
    """
    logging.info("Update device position endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Update device position failed - invalid or missing JSON body")
            return jsonify({'success': False, 'message': 'Invalid or missing JSON body'}), 400

        service = TopologyApp()
        response = service.update_device_position(data)

        if response['success']:
            logging.info(
                f"Device position update completed: {response['device_ip']} at ({response['position']['x']}, {response['position']['y']})")
            return jsonify(response), 200
        else:
            logging.warning(f"Device position update failed: {response['message']}")
            return jsonify(response), 404 if 'No records found' in response['message'] else 400

    except Exception as e:
        logging.error(f"Update device position error: {str(e)}")
        return jsonify({'success': False, 'message': f'Position update failed: {str(e)}'}), 500


@app.route('/' + api_service_name + '/update-block-position', methods=['POST'])
def update_block_position():
    """
    TOPOLOGY VISUALIZATION: Update block position on topology map
    ============================================================

    Updates the position of a network block when user drags it on the topology visualization.
    Used by the network topology visualization component.

    Expected format:
    {
        "block_id": "core-block",
        "position": {
            "x": 300.0,
            "y": 150.0
        },
        "changed_by": "admin@company.com",
        "drag_type": "block_drag"
    }

    Database: NETWORK_TOPOLOGY_MAIN (topology visualization table)
    """
    logging.info("Update block position endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Update block position failed - invalid or missing JSON body")
            return jsonify({'success': False, 'message': 'Invalid or missing JSON body'}), 400

        service = TopologyApp()
        response = service.update_block_position(data)

        if response['success']:
            logging.info(
                f"Block position update completed: {response['block_id']} at ({response['position']['x']}, {response['position']['y']})")
            return jsonify(response), 200
        else:
            logging.warning(f"Block position update failed: {response['message']}")
            return jsonify(response), 404 if 'No block found' in response['message'] else 400

    except Exception as e:
        logging.error(f"Update block position error: {str(e)}")
        return jsonify({'success': False, 'message': f'Block position update failed: {str(e)}'}), 500


@app.route('/' + api_service_name + '/get-network-topology', methods=['GET'])
def get_network_topology():
    """
    TOPOLOGY VISUALIZATION: Get network topology data for visualization
    ==================================================================

    Retrieves network topology data formatted for Angular topology visualization component.
    Returns nodes, edges, blocks, and positions for the network graph.

    Database: NETWORK_TOPOLOGY_MAIN (topology visualization table)
    """
    logging.info("Get network topology endpoint called")
    try:
        service = TopologyApp()
        response = service.get_network_topology()

        if response['success']:
            logging.info(
                f"Network topology retrieved successfully: {response['count']['blocks']} blocks, {response['count']['nodes']} nodes, {response['count']['edges']} edges")
            return jsonify(response), 200
        else:
            logging.warning(f"Network topology retrieval failed: {response['message']}")
            return jsonify(response), 500

    except Exception as e:
        logging.error(f"Get network topology error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to retrieve topology data: {str(e)}'}), 500


@app.route('/' + api_service_name + '/get-network-topology-dashboard', methods=['GET'])
def get_network_topology_dashboard():
    """
    TOPOLOGY VISUALIZATION: Get network topology data from Dashboard table
    =====================================================================

    Retrieves network topology data from NETWORK_TOPOLOGY_Dashboard table and formats it
    for Angular topology visualization component. This endpoint uses the Excel table data
    to generate topology visualization.

    NOTE: This endpoint only returns devices and connections that have block assignments.
    Records without block assignments are stored in the database but not displayed in
    the topology visualization. Connections where either device lacks a block assignment
    are completely hidden from the topology (no edges created).

    Database: NETWORK_TOPOLOGY_Dashboard (Excel table operations)
    """
    logging.info(f"Get network topology dashboard endpoint called at {datetime.now()}")
    try:
        service = TopologyApp()
        response = service.get_network_topology_dashboard()

        if response['success']:
            logging.info(
                f"Dashboard topology retrieved successfully: {response['count']['blocks']} blocks, {response['count']['nodes']} nodes, {response['count']['edges']} edges")
            logging.info(f"Get network topology dashboard endpoint completed at {datetime.now()}")
            return jsonify(response), 200
        else:
            logging.warning(f"Dashboard topology retrieval failed: {response['message']}, {datetime.now()}")
            return jsonify(response), 500

    except Exception as e:
        logging.error(f"Get network topology dashboard error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to retrieve dashboard topology data: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-add', methods=['POST'])
def add_network_topology_record():
    """
    EXCEL TABLE CRUD: Add single network topology record
    ===================================================

    Adds a single network topology record to the database.
    Used by the Excel table component for adding new records via form.

    NOTE: ALL records are stored in the database regardless of block assignment.
    Records without block assignments will be stored but not displayed in topology
    visualization until blocks are assigned.

    Expected format:
    {
        "device_a_ip": "192.168.1.1",
        "device_a_hostname": "Core-Switch-01",
        "device_a_interface": "Gi0/1",
        "device_a_type": "switch",
        "device_a_vendor": "Cisco",
        "device_b_ip": "192.168.1.2",
        "device_b_hostname": "Access-Switch-01",
        "device_b_interface": "Gi0/1",
        "device_b_type": "switch",
        "device_b_vendor": "Cisco",
        "comments": "Connection description",
        "updated_by": "admin@company.com"
    }

    Database: NETWORK_TOPOLOGY_Dashboard (Excel table operations)
    """
    logging.info("Add network topology record endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Add network topology record failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.add_network_topology_record(data)

        if response['success']:
            logging.info(f"Network topology record added successfully: ID {response.get('record_id', 'unknown')}")
            return jsonify(response), 201
        else:
            logging.warning(f"Network topology record add failed: {response['message']}")
            return jsonify(response), 400

    except Exception as e:
        logging.error(f"Add network topology record error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to add record: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-add-bulk', methods=['POST'])
def add_network_topology_records_bulk():
    """
    EXCEL TABLE CRUD: Add multiple network topology records
    ======================================================

    Adds multiple network topology records to the database in a single operation.
    Used by the Excel table component for bulk import operations.

    NOTE: ALL records are stored in the database regardless of block assignment.
    Records without block assignments will be stored but not displayed in topology
    visualization until blocks are assigned.

    Expected format:
    [
        {
            "device_a_ip": "192.168.1.1",
            "device_a_hostname": "Core-Switch-01",
            "device_a_interface": "Gi0/1",
            "device_a_type": "switch",
            "device_a_vendor": "Cisco",
            "device_b_ip": "192.168.1.2",
            "device_b_hostname": "Access-Switch-01",
            "device_b_interface": "Gi0/1",
            "device_b_type": "switch",
            "device_b_vendor": "Cisco",
            "comments": "Connection description"
        }
    ]

    Database: NETWORK_TOPOLOGY_Dashboard (Excel table operations)
    """
    logging.info("Add network topology records bulk endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Add network topology records bulk failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.add_network_topology_records_bulk(data)

        if response['success']:
            logging.info(f"Bulk network topology records added successfully: {response['inserted_count']} records")
            return jsonify(response), 201
        else:
            logging.warning(f"Bulk network topology records add failed: {response['message']}")
            return jsonify(response), 400

    except Exception as e:
        logging.error(f"Add network topology records bulk error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to add records: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-update', methods=['PUT'])
def update_network_topology_record():
    """
    EXCEL TABLE CRUD: Update existing network topology record
    ========================================================

    Updates an existing network topology record in the database.
    Used by the Excel table component for editing existing records.

    Expected format:
    {
        "record_id": 123,
        "device_a_ip": "192.168.1.1",
        "device_a_hostname": "Core-Switch-01",
        "device_a_interface": "Gi0/1",
        "device_a_type": "switch",
        "device_a_vendor": "Cisco",
        "device_b_ip": "192.168.1.2",
        "device_b_hostname": "Access-Switch-01",
        "device_b_interface": "Gi0/1",
        "device_b_type": "switch",
        "device_b_vendor": "Cisco",
        "comments": "Updated connection description",
        "updated_by": "admin@company.com"
    }

    Database: NETWORK_TOPOLOGY_Dashboard (Excel table operations)
    """
    logging.info("Update network topology record endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Update network topology record failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.update_network_topology_record(data)

        if response['success']:
            logging.info(
                f"Network topology record updated successfully: ID {response['record_id']}, {response['rows_updated']} rows updated")
            return jsonify(response)
        else:
            logging.warning(f"Network topology record update failed: {response['message']}")
            return jsonify(response), 404 if 'No record found' in response['message'] else 400

    except Exception as e:
        logging.error(f"Update network topology record error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to update record: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-delete', methods=['DELETE'])
def delete_network_topology_record():
    """
    EXCEL TABLE CRUD: Delete network topology record
    ===============================================

    Deletes a network topology record from the database.
    Used by the Excel table component for removing records.

    Expected format:
    {
        "record_id": 123,
        "updated_by": "admin@company.com"
    }

    Database: NETWORK_TOPOLOGY_Dashboard (Excel table operations)
    """
    logging.info("Delete network topology record endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Delete network topology record failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.delete_network_topology_record(data)

        if response['success']:
            logging.info(
                f"Network topology record deleted successfully: ID {response['record_id']}, {response['rows_deleted']} rows deleted")
            return jsonify(response), 200
        else:
            logging.warning(f"Network topology record delete failed: {response['message']}")
            return jsonify(response), 404 if 'No record found' in response['message'] else 400

    except Exception as e:
        logging.error(f"Delete network topology record error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to delete record: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-get', methods=['GET'])
def get_network_topology_records():
    """
    EXCEL TABLE CRUD: Get all network topology records
    ================================================

    Retrieves all network topology records from the database with optional search.
    Used by the Excel table component for displaying and searching records.

    Optional query parameters:
    - search: Search term for device IPs or hostnames

    Database: NETWORK_TOPOLOGY_Dashboard (Excel table operations)
    """
    logging.info("Get network topology records endpoint called")
    try:
        search = request.args.get('search', '')

        service = TopologyApp()
        response = service.get_network_topology_records(search)

        if response['success']:
            logging.info(
                f"Network topology records retrieved successfully: {len(response['data'])} records returned, {response['total_records']} total in database")
            return jsonify(response), 200
        else:
            logging.warning(f"Network topology records retrieval failed: {response['message']}")
            return jsonify(response), 500

    except Exception as e:
        logging.error(f"Get network topology records error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to retrieve records: {str(e)}'}), 500


@app.route('/' + api_service_name + '/update-device-type', methods=['PUT'])
def update_device_type():
    """
    DEVICE TYPE UPDATE: Update device type by IP and hostname
    ========================================================

    Updates the device type for a device identified by IP and hostname.
    Searches both Device A and Device B columns and updates the type
    regardless of which side the device appears on.

    Expected format:
    {
        "device_ip": "192.168.1.1",
        "device_hostname": "Core-Switch-01",
        "new_device_type": "switch",
        "updated_by": "admin@company.com"
    }

    Database: NETWORK_TOPOLOGY_Dashboard (Excel table operations)
    """
    logging.info("Update device type endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Update device type failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.update_device_type(data)

        if response['success']:
            logging.info(
                f"Device type updated successfully: {response['device_hostname']} ({response['device_ip']}) -> {response['new_device_type']}, {response['rows_updated']} rows updated")
            return jsonify(response), 200
        else:
            logging.warning(f"Device type update failed: {response['message']}")
            return jsonify(response), 404 if 'No device found' in response['message'] else 400

    except Exception as e:
        logging.error(f"Update device type error: {str(e)}")
        return jsonify({'success': False, 'message': f'Device type update failed: {str(e)}'}), 500


@app.route('/' + api_service_name + '/save-device-positions', methods=['POST'])
def save_device_positions():
    """
    TOPOLOGY VISUALIZATION: Save device and block positions in bulk
    ===============================================================

    Accepts a map of positions keyed by nodeId. Node IDs that look like IPv4 addresses
    are treated as device IPs and will update DEVICE_A_/DEVICE_B_ position columns.
    Other node IDs are treated as block IDs and will update DEVICE_A_BLOCK_/DEVICE_B_BLOCK_ position columns.

    Expected payload:
    {
        "positions": {
            "192.168.1.1": { "x": 120.5, "y": 340.2 },
            "CORE": { "x": 600, "y": 300 }
        },
        "changed_by": "admin@company.com"
    }

    Database: NETWORK_TOPOLOGY_Dashboard (Excel/dashboard topology table)
    """
    logging.info(f"Save device positions endpoint called at {datetime.now()}")
    try:
        payload = request.get_json() or {}
        positions = payload.get('positions')

        if not positions or not isinstance(positions, dict):
            return jsonify({'success': False, 'message': 'Invalid payload: positions object is required'}), 400

        service = TopologyApp()
        response = service.save_device_positions(positions)

        if response['success']:
            logging.info(
                f"Device positions saved successfully: {response['summary']['device_rows_updated']} device updates, {response['summary']['block_rows_updated']} block updates at {datetime.now()}")
            return jsonify(response), 200
        else:
            logging.warning(f"Device positions save failed: {response['message']}")
            return jsonify(response), 500

    except Exception as e:
        logging.error(f"Save device positions error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to save positions: {str(e)}'}), 500


# CREATE TABLE NETWORK_TOPOLOGY_Block (
#     ID BIGINT IDENTITY(1,1) PRIMARY KEY,
#     BLOCK_NAME NVARCHAR(100) NOT NULL,
#     CREATED_DATE datetime2(7) DEFAULT GETDATE(),
#     UPDATED_DATE datetime2(7) DEFAULT GETDATE(),
#     UPDATED_BY VARCHAR(100) NULL,
#     CREATED_BY VARCHAR(100) NULL
# );


@app.route('/' + api_service_name + '/network-topology-block-get', methods=['GET'])
def get_network_topology_blocks():
    """
    NETWORK TOPOLOGY BLOCK GET: Get all network topology blocks
    =======================================================

    Retrieves all network topology blocks from the database.
    Used by the Excel table component for displaying and searching blocks.
    """
    logging.info("Get network topology blocks endpoint called")
    try:
        service = TopologyApp()
        response = service.get_network_topology_blocks()
        return jsonify(response), 200
    except Exception as e:
        logging.error(f"Get network topology blocks error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to retrieve blocks: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-block-add', methods=['POST'])
def add_network_topology_blocks():
    """
    NETWORK TOPOLOGY BLOCK ADD: Add a network topology block
    =======================================================

    Adds a network topology block to the database.
    Used by the Excel table component for adding new blocks.

    Expected format:
    {
        "block_name": "Core-Block-01",
        "created_by": "admin@company.com"
    }
    """
    logging.info("Add network topology block endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Add network topology block failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.add_network_topology_block(data)

        if response['success']:
            logging.info(f"Network topology block added successfully: {response.get('block_id', 'unknown')}")
            return jsonify(response), 201
        else:
            logging.warning(f"Network topology block add failed: {response['message']}")
            return jsonify(response), 400
    except Exception as e:
        logging.error(f"Add network topology block error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to add block: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-block-add-bulk', methods=['POST'])
def add_network_topology_blocks_bulk():
    """
    NETWORK TOPOLOGY BLOCK ADD BULK: Add multiple network topology blocks
    ===============================================================

    Adds multiple network topology blocks to the database.
    Used by the Excel table component for adding new blocks.
    """
    logging.info("Add network topology block bulk endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Add network topology block bulk failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.add_network_topology_blocks_bulk(data)
        if response['success']:
            logging.info(
                f"Network topology block bulk added successfully: {response.get('created_count', 0)} created, {response.get('skipped_count', 0)} skipped")
            return jsonify(response), 201
        else:
            logging.warning(f"Network topology block bulk add failed: {response['message']}")
            return jsonify(response), 400
    except Exception as e:
        logging.error(f"Add network topology block bulk error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to add blocks: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-block-update', methods=['PUT'])
def update_network_topology_blocks():
    """
    NETWORK TOPOLOGY BLOCK UPDATE: Update a network topology block
    =============================================================

    Updates a network topology block in the database.
    Used by the Excel table component for updating existing blocks.
    """
    logging.info("Update network topology block endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Update network topology block failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.update_network_topology_block(data)

        if response['success']:
            logging.info(f"Network topology block updated successfully: {response}")
            return jsonify(response), 200
        else:
            logging.warning(f"Network topology block update failed: {response['message']}")
            return jsonify(response), 400
    except Exception as e:
        logging.error(f"Update network topology block error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to update block: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-block-delete', methods=['DELETE'])
def delete_network_topology_blocks():
    """
    NETWORK TOPOLOGY BLOCK DELETE: Delete a network topology block
    =============================================================

    Deletes a network topology block from the database.
    Used by the Excel table component for deleting existing blocks.
    """
    logging.info("Delete network topology block endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Delete network topology block failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.delete_network_topology_block(data)

        if response['success']:
            logging.info(f"Network topology block deleted successfully: {response.get('block_id', 'unknown')}")
            return jsonify(response), 200
        else:
            logging.warning(f"Network topology block delete failed: {response['message']}")
            return jsonify(response), 400
    except Exception as e:
        logging.error(f"Delete network topology block error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to delete block: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-delete-all-records', methods=['DELETE'])
def delete_all_topology_table_records():
    """
    DELETE ALL TOPOLOGY TABLE RECORDS: Delete all records from all topology tables
    ===============================================================

    Deletes all records from all topology tables.
    Used by the Excel table component for deleting all records.
    """
    logging.info("Delete all topology table records endpoint called")
    try:
        service = TopologyApp()
        response = service.delete_all_topology_table_records()
        if response['success']:
            logging.info(f"All topology table records deleted successfully")
            return jsonify(response), 200
    except Exception as e:
        logging.error(f"Delete all topology table records error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to delete all records: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-bulk-delete-by-ids', methods=['DELETE'])
def delete_network_topology_bulk_by_ids():
    """
    NETWORK TOPOLOGY BULK DELETE BY IDs: Delete multiple network topology records by IDs
    ==================================================================================

    Deletes multiple network topology records from the database by their IDs.
    Used by the Excel table component for deleting multiple selected records.

    Expected format:
    {
        "record_ids": [1, 2, 3, ...],
        "updated_by": "admin@company.com"
    }
    """
    logging.info("Delete network topology bulk by IDs endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Delete network topology bulk by IDs failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.delete_network_topology_bulk_by_ids(data)
        if response['success']:
            logging.info(
                f"Network topology bulk deleted by IDs successfully: {response.get('deleted_count', 0)} deleted")
            return jsonify(response), 200
        else:
            logging.warning(f"Network topology bulk delete by IDs failed: {response['message']}")
            return jsonify(response), 400
    except Exception as e:
        logging.error(f"Delete network topology bulk by IDs error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to delete bulk by IDs: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-bulk-delete', methods=['DELETE'])
def delete_network_topology_bulk():
    """
    NETWORK TOPOLOGY BULK DELETE: Delete multiple network topology records
    ===============================================================

    Deletes multiple network topology records from the database.
    Used by the Excel table component for deleting multiple records.
    """
    logging.info("Delete network topology bulk endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Delete network topology bulk failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.delete_network_topology_bulk(data)
        if response['success']:
            logging.info(f"Network topology bulk deleted successfully: {response.get('deleted_count', 0)} deleted")
            return jsonify(response), 200
        else:
            logging.warning(f"Network topology bulk delete failed: {response['message']}")
            return jsonify(response), 400
    except Exception as e:
        logging.error(f"Delete network topology bulk error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to delete bulk: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-delete-by-host-ip', methods=['DELETE'])
def delete_network_topology_by_host_ip():
    """
    NETWORK TOPOLOGY DELETE BY HOST/IP: Delete all rows where given (hostname, ip) appears on either side
    ===================================================================================================
    Expected JSON body: { "hostname": "...", "ip": "...", "updated_by": "..." }
    """
    logging.info("Delete network topology by host/ip endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Delete by host/ip failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.delete_network_topology_by_host_ip(data)
        if response['success']:
            logging.info(f"Delete by host/ip success: {response.get('rows_deleted', 0)} rows deleted")
            return jsonify(response), 200
        else:
            logging.warning(f"Delete by host/ip failed: {response['message']}")
            return jsonify(response), 400
    except Exception as e:
        logging.error(f"Delete network topology by host/ip error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to delete: {str(e)}'}), 500


@app.route('/' + api_service_name + '/permission-check', methods=['GET'])
def permission_check():
    # Handled by Flask-CORS, but define explicitly to guarantee 204 for preflight
    service = TopologyApp()
    response = service.permission_check()
    return jsonify(response), 200

# application = app