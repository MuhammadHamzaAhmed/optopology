import os
import json
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    import uwsgi
    HAS_UWSGI = True
except ImportError:
    HAS_UWSGI = False
    logger.warning("uWSGI not available - background tasks will run synchronously")


def spooler_handler(env):
    try:
        task_name = env.get(b'task_name', b'unknown').decode('utf-8')
        task_data = json.loads(env.get(b'task_data', b'{}').decode('utf-8'))

        logger.info(f"Processing background task: {task_name}")

        if task_name == 'example_task':
            result = handle_example_task(task_data)
        elif task_name == 'send_notification':
            result = handle_send_notification(task_data)
        elif task_name == 'cleanup_old_records':
            result = handle_cleanup_old_records(task_data)
        elif task_name == 'export_data':
            result = handle_export_data(task_data)
        else:
            logger.warning(f"Unknown task: {task_name}")
            return uwsgi.SPOOL_OK

        logger.info(f"Task {task_name} completed successfully")
        return uwsgi.SPOOL_OK

    except Exception as e:
        logger.error(f"Error processing task: {str(e)}")
        return uwsgi.SPOOL_RETRY


if HAS_UWSGI:
    uwsgi.spooler = spooler_handler


def queue_task(task_name: str, task_data: dict = None, priority: int = 0):
    if task_data is None:
        task_data = {}

    if HAS_UWSGI:
        try:
            uwsgi.spool({
                b'task_name': task_name.encode('utf-8'),
                b'task_data': json.dumps(task_data).encode('utf-8'),
                b'queued_at': datetime.now().isoformat().encode('utf-8'),
            })
            logger.info(f"Task {task_name} queued successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to queue task {task_name}: {str(e)}")
            return False
    else:
        logger.info(f"Running task {task_name} synchronously (no uWSGI)")
        try:
            if task_name == 'example_task':
                handle_example_task(task_data)
            elif task_name == 'send_notification':
                handle_send_notification(task_data)
            elif task_name == 'cleanup_old_records':
                handle_cleanup_old_records(task_data)
            elif task_name == 'export_data':
                handle_export_data(task_data)
            return True
        except Exception as e:
            logger.error(f"Error running task synchronously: {str(e)}")
            return False


def handle_example_task(data: dict):
    logger.info(f"Running example task with data: {data}")
    return True


def handle_send_notification(data: dict):
    recipient = data.get('recipient')
    message = data.get('message')
    logger.info(f"Sending notification to {recipient}: {message}")
    return True


def handle_cleanup_old_records(data: dict):
    days_old = data.get('days_old', 30)
    logger.info(f"Cleaning up records older than {days_old} days")
    return True


def handle_export_data(data: dict):
    export_format = data.get('format', 'json')
    logger.info(f"Exporting data in {export_format} format")
    return True


def run_scheduled_cleanup():
    logger.info(f"Running scheduled cleanup at {datetime.now()}")
    handle_cleanup_old_records({'days_old': 30})


def run_scheduled_health_check():
    logger.info(f"Running scheduled health check at {datetime.now()}")
