"""
uWSGI Spooler Tasks Module

This module contains background task definitions that run asynchronously
via the uWSGI spooler. Tasks are queued by writing files to the spooler
directory and processed by spooler worker processes.

Usage:
    from tasks import queue_task

    # Queue a background task
    queue_task('my_task', {'param1': 'value1', 'param2': 'value2'})
"""

import os
import json
import logging
from datetime import datetime

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Try to import uwsgi (only available when running under uWSGI)
try:
    import uwsgi
    HAS_UWSGI = True
except ImportError:
    HAS_UWSGI = False
    logger.warning("uWSGI not available - background tasks will run synchronously")


def spooler_handler(env):
    """
    Main spooler handler function.
    This is called by uWSGI when processing spooled tasks.

    Args:
        env: Dictionary containing task data

    Returns:
        uwsgi.SPOOL_OK on success, uwsgi.SPOOL_RETRY on failure
    """
    try:
        task_name = env.get(b'task_name', b'unknown').decode('utf-8')
        task_data = json.loads(env.get(b'task_data', b'{}').decode('utf-8'))

        logger.info(f"Processing background task: {task_name}")
        logger.debug(f"Task data: {task_data}")

        # Route to appropriate task handler
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
        # Return SPOOL_RETRY to retry the task later
        return uwsgi.SPOOL_RETRY


# Register the spooler handler with uWSGI
if HAS_UWSGI:
    uwsgi.spooler = spooler_handler


def queue_task(task_name: str, task_data: dict = None, priority: int = 0):
    """
    Queue a background task for async processing.

    Args:
        task_name: Name of the task to execute
        task_data: Dictionary of data to pass to the task
        priority: Task priority (lower = higher priority)

    Returns:
        bool: True if task was queued successfully
    """
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
        # Fallback: run synchronously when not under uWSGI
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


# ===========================================
# Task Handlers
# ===========================================

def handle_example_task(data: dict):
    """Example task handler."""
    logger.info(f"Running example task with data: {data}")
    # Add your task logic here
    return True


def handle_send_notification(data: dict):
    """Send notification task."""
    recipient = data.get('recipient')
    message = data.get('message')
    logger.info(f"Sending notification to {recipient}: {message}")
    # Add notification logic here (email, webhook, etc.)
    return True


def handle_cleanup_old_records(data: dict):
    """Cleanup old records from database."""
    days_old = data.get('days_old', 30)
    logger.info(f"Cleaning up records older than {days_old} days")
    # Add cleanup logic here
    return True


def handle_export_data(data: dict):
    """Export data to file."""
    export_format = data.get('format', 'json')
    logger.info(f"Exporting data in {export_format} format")
    # Add export logic here
    return True


# ===========================================
# Cron Task Functions (called from uwsgi.ini)
# ===========================================

def run_scheduled_cleanup():
    """Called by uWSGI cron for scheduled cleanup."""
    logger.info(f"Running scheduled cleanup at {datetime.now()}")
    handle_cleanup_old_records({'days_old': 30})


def run_scheduled_health_check():
    """Called by uWSGI cron for health checks."""
    logger.info(f"Running scheduled health check at {datetime.now()}")
    # Add health check logic here
