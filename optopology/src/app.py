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

app = Flask(__name__)

CORS(app, resources={
    r"/*": {
        "origins": ["http://localhost:3007", "http://127.0.0.1:3007", "http://localhost:5017", "http://127.0.0.1:5017"],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"],
        "supports_credentials": False
    }
})

api_service_name = "topology-api"

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

        logging.info(f"Import completed: {response['inserted_count']} inserted, {response.get('error_count', 0)} errors")
        return jsonify(response), 200
    except Exception as e:
        logging.error(f"Import connections error: {str(e)}")
        return jsonify({'error': f'Import failed: {str(e)}'}), 500


@app.route('/' + api_service_name + '/import-excel-headered', methods=['POST'])
def import_excel_headered():
    logging.info("Import Excel headered endpoint called")
    try:
        payload = request.get_json(silent=True)
        if payload is None:
            logging.warning("Import Excel headered failed - invalid or missing JSON body")
            return jsonify({'success': False, 'message': 'Invalid or missing JSON body'}), 400

        if isinstance(payload, list):
            rows = payload
        elif isinstance(payload, dict) and isinstance(payload.get('rows'), list):
            rows = payload['rows']
        else:
            return jsonify({'success': False, 'message': 'Payload must be an array of row objects or { "rows": [...] }'}), 400

        if len(rows) == 0:
            return jsonify({'success': False, 'message': 'No rows provided'}), 400

        service = TopologyApp()
        response = service.import_excel_headered(rows)

        logging.info(f"Import Excel headered completed: {response['inserted_count']} inserted, {response['skipped_count']} skipped, {response.get('errors', []).__len__()} errors")
        return jsonify(response), 200
    except Exception as e:
        logging.error(f"Header-based Excel import failed: {str(e)}")
        return jsonify({'success': False, 'message': f'Import failed: {str(e)}'}), 500


@app.route('/' + api_service_name + '/update-device-position', methods=['POST'])
def update_device_position():
    logging.info("Update device position endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Update device position failed - invalid or missing JSON body")
            return jsonify({'success': False, 'message': 'Invalid or missing JSON body'}), 400

        service = TopologyApp()
        response = service.update_device_position(data)

        if response['success']:
            logging.info(f"Device position update completed: {response['device_ip']} at ({response['position']['x']}, {response['position']['y']})")
            return jsonify(response), 200
        else:
            logging.warning(f"Device position update failed: {response['message']}")
            return jsonify(response), 404 if 'No records found' in response['message'] else 400

    except Exception as e:
        logging.error(f"Update device position error: {str(e)}")
        return jsonify({'success': False, 'message': f'Position update failed: {str(e)}'}), 500


@app.route('/' + api_service_name + '/update-block-position', methods=['POST'])
def update_block_position():
    logging.info("Update block position endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Update block position failed - invalid or missing JSON body")
            return jsonify({'success': False, 'message': 'Invalid or missing JSON body'}), 400

        service = TopologyApp()
        response = service.update_block_position(data)

        if response['success']:
            logging.info(f"Block position update completed: {response['block_id']} at ({response['position']['x']}, {response['position']['y']})")
            return jsonify(response), 200
        else:
            logging.warning(f"Block position update failed: {response['message']}")
            return jsonify(response), 404 if 'No block found' in response['message'] else 400

    except Exception as e:
        logging.error(f"Update block position error: {str(e)}")
        return jsonify({'success': False, 'message': f'Block position update failed: {str(e)}'}), 500


@app.route('/' + api_service_name + '/get-network-topology', methods=['GET'])
def get_network_topology():
    logging.info("Get network topology endpoint called")
    try:
        service = TopologyApp()
        response = service.get_network_topology()

        if response['success']:
            logging.info(f"Network topology retrieved successfully: {response['count']['blocks']} blocks, {response['count']['nodes']} nodes, {response['count']['edges']} edges")
            return jsonify(response), 200
        else:
            logging.warning(f"Network topology retrieval failed: {response['message']}")
            return jsonify(response), 500

    except Exception as e:
        logging.error(f"Get network topology error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to retrieve topology data: {str(e)}'}), 500


@app.route('/' + api_service_name + '/get-network-topology-dashboard', methods=['GET'])
def get_network_topology_dashboard():
    logging.info(f"Get network topology dashboard endpoint called at {datetime.now()}")
    try:
        service = TopologyApp()
        response = service.get_network_topology_dashboard()

        if response['success']:
            logging.info(f"Dashboard topology retrieved successfully: {response['count']['blocks']} blocks, {response['count']['nodes']} nodes, {response['count']['edges']} edges")
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
    logging.info("Update network topology record endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Update network topology record failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.update_network_topology_record(data)

        if response['success']:
            logging.info(f"Network topology record updated successfully: ID {response['record_id']}, {response['rows_updated']} rows updated")
            return jsonify(response)
        else:
            logging.warning(f"Network topology record update failed: {response['message']}")
            return jsonify(response), 404 if 'No record found' in response['message'] else 400

    except Exception as e:
        logging.error(f"Update network topology record error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to update record: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-delete', methods=['DELETE'])
def delete_network_topology_record():
    logging.info("Delete network topology record endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Delete network topology record failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.delete_network_topology_record(data)

        if response['success']:
            logging.info(f"Network topology record deleted successfully: ID {response['record_id']}, {response['rows_deleted']} rows deleted")
            return jsonify(response), 200
        else:
            logging.warning(f"Network topology record delete failed: {response['message']}")
            return jsonify(response), 404 if 'No record found' in response['message'] else 400

    except Exception as e:
        logging.error(f"Delete network topology record error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to delete record: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-get', methods=['GET'])
def get_network_topology_records():
    logging.info("Get network topology records endpoint called")
    try:
        search = request.args.get('search', '')

        service = TopologyApp()
        response = service.get_network_topology_records(search)

        if response['success']:
            logging.info(f"Network topology records retrieved successfully: {len(response['data'])} records returned, {response['total_records']} total in database")
            return jsonify(response), 200
        else:
            logging.warning(f"Network topology records retrieval failed: {response['message']}")
            return jsonify(response), 500

    except Exception as e:
        logging.error(f"Get network topology records error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to retrieve records: {str(e)}'}), 500


@app.route('/' + api_service_name + '/update-device-type', methods=['PUT'])
def update_device_type():
    logging.info("Update device type endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Update device type failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.update_device_type(data)

        if response['success']:
            logging.info(f"Device type updated successfully: {response['device_hostname']} ({response['device_ip']}) -> {response['new_device_type']}, {response['rows_updated']} rows updated")
            return jsonify(response), 200
        else:
            logging.warning(f"Device type update failed: {response['message']}")
            return jsonify(response), 404 if 'No device found' in response['message'] else 400

    except Exception as e:
        logging.error(f"Update device type error: {str(e)}")
        return jsonify({'success': False, 'message': f'Device type update failed: {str(e)}'}), 500


@app.route('/' + api_service_name + '/save-device-positions', methods=['POST'])
def save_device_positions():
    logging.info(f"Save device positions endpoint called at {datetime.now()}")
    try:
        payload = request.get_json() or {}
        positions = payload.get('positions')

        if not positions or not isinstance(positions, dict):
            return jsonify({'success': False, 'message': 'Invalid payload: positions object is required'}), 400

        service = TopologyApp()
        response = service.save_device_positions(positions)

        if response['success']:
            logging.info(f"Device positions saved successfully: {response['summary']['device_rows_updated']} device updates, {response['summary']['block_rows_updated']} block updates at {datetime.now()}")
            return jsonify(response), 200
        else:
            logging.warning(f"Device positions save failed: {response['message']}")
            return jsonify(response), 500

    except Exception as e:
        logging.error(f"Save device positions error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to save positions: {str(e)}'}), 500


@app.route('/' + api_service_name + '/network-topology-block-get', methods=['GET'])
def get_network_topology_blocks():
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
    logging.info("Add network topology block bulk endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Add network topology block bulk failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.add_network_topology_blocks_bulk(data)
        if response['success']:
            logging.info(f"Network topology block bulk added successfully: {response.get('created_count', 0)} created, {response.get('skipped_count', 0)} skipped")
            return jsonify(response), 201
        else:
            logging.warning(f"Network topology block bulk add failed: {response['message']}")
            return jsonify(response), 400
    except Exception as e:
        logging.error(f"Add network topology block bulk error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to add blocks: {str(e)}'}), 500

@app.route('/' + api_service_name + '/network-topology-block-update', methods=['PUT'])
def update_network_topology_blocks():
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
    logging.info("Delete network topology bulk by IDs endpoint called")
    try:
        data = request.get_json()
        if not data:
            logging.warning("Delete network topology bulk by IDs failed - no data provided")
            return jsonify({'success': False, 'message': 'No data provided'}), 400

        service = TopologyApp()
        response = service.delete_network_topology_bulk_by_ids(data)
        if response['success']:
            logging.info(f"Network topology bulk deleted by IDs successfully: {response.get('deleted_count', 0)} deleted")
            return jsonify(response), 200
        else:
            logging.warning(f"Network topology bulk delete by IDs failed: {response['message']}")
            return jsonify(response), 400
    except Exception as e:
        logging.error(f"Delete network topology bulk by IDs error: {str(e)}")
        return jsonify({'success': False, 'message': f'Failed to delete bulk by IDs: {str(e)}'}), 500

@app.route('/' + api_service_name + '/network-topology-bulk-delete', methods=['DELETE'])
def delete_network_topology_bulk():
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
    service = TopologyApp()
    response = service.permission_check()
    return jsonify(response), 200
