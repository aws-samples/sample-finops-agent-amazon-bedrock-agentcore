"""
CloudFormation Custom Resource Lambda: Build Waiter

Polls CodeBuild build status until completion or failure.
Signals SUCCESS/FAILED back to CloudFormation via the response URL.
Times out after a configurable max duration (default: 20 minutes).
"""

import json
import logging
import time
import urllib.request
import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

codebuild = boto3.client('codebuild')

DEFAULT_MAX_WAIT_SECONDS = 1200  # 20 minutes
POLL_INTERVAL_SECONDS = 15
TERMINAL_STATUSES = {'SUCCEEDED', 'FAILED', 'FAULT', 'TIMED_OUT', 'STOPPED'}
SUCCESS_STATUSES = {'SUCCEEDED'}
FAILURE_STATUSES = {'FAILED', 'FAULT', 'TIMED_OUT', 'STOPPED'}


def send_cfn_response(event, status, data=None, reason=None):
    """Send response to CloudFormation via the pre-signed response URL."""
    response_body = json.dumps({
        'Status': status,
        'Reason': reason or f'See CloudWatch Log Stream: {event.get("LogStreamName", "N/A")}',
        'PhysicalResourceId': event.get('PhysicalResourceId', event['RequestId']),
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'Data': data or {},
    })

    logger.info(f'Sending CFN response: {status}')
    req = urllib.request.Request(
        event['ResponseURL'],
        data=response_body.encode('utf-8'),
        headers={'Content-Type': ''},
        method='PUT',
    )
    urllib.request.urlopen(req)


def get_build_status(build_id):
    """Get the current status of a CodeBuild build."""
    response = codebuild.batch_get_builds(ids=[build_id])
    builds = response.get('builds', [])
    if not builds:
        raise ValueError(f'Build not found: {build_id}')
    return builds[0]['buildStatus']


def determine_outcome(status):
    """Map a CodeBuild status to a CFN outcome."""
    if status in SUCCESS_STATUSES:
        return 'SUCCESS'
    if status in FAILURE_STATUSES:
        return 'FAILED'
    return None


def handler(event, context):
    """Handle CloudFormation custom resource events."""
    logger.info(f'Event: {json.dumps(event)}')
    request_type = event['RequestType']

    if request_type == 'Delete':
        logger.info('Delete event — nothing to clean up')
        send_cfn_response(event, 'SUCCESS')
        return

    build_id = event['ResourceProperties'].get('BuildId', '')
    max_wait = int(event['ResourceProperties'].get('MaxWaitSeconds', DEFAULT_MAX_WAIT_SECONDS))

    logger.info(f'Waiting for build: {build_id} (max {max_wait}s)')
    start_time = time.time()

    try:
        while True:
            elapsed = time.time() - start_time
            if elapsed >= max_wait:
                reason = f'Build timeout after {int(elapsed)}s (max: {max_wait}s)'
                logger.error(reason)
                send_cfn_response(event, 'FAILED', reason=reason)
                return

            status = get_build_status(build_id)
            logger.info(f'Build status: {status} (elapsed: {int(elapsed)}s)')

            outcome = determine_outcome(status)
            if outcome == 'SUCCESS':
                send_cfn_response(event, 'SUCCESS', data={'BuildStatus': status})
                return
            if outcome == 'FAILED':
                send_cfn_response(event, 'FAILED', reason=f'Build {status}')
                return

            time.sleep(POLL_INTERVAL_SECONDS)

    except Exception as e:
        logger.error(f'Error polling build: {e}')
        send_cfn_response(event, 'FAILED', reason=str(e))
