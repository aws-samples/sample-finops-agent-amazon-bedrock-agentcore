"""
CloudFormation Custom Resource Lambda: Build Trigger

Triggers a CodeBuild build on stack Create/Update events.
Returns the build ID for the Build Waiter to poll.
On Delete, returns SUCCESS immediately (no cleanup needed).
"""

import json
import logging
import urllib.request
import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

codebuild = boto3.client('codebuild')


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


def handler(event, context):
    """Handle CloudFormation custom resource events."""
    logger.info(f'Event: {json.dumps(event)}')
    request_type = event['RequestType']
    project_name = event['ResourceProperties'].get('ProjectName', '')

    if request_type == 'Delete':
        logger.info('Delete event — nothing to clean up')
        send_cfn_response(event, 'SUCCESS')
        return

    try:
        logger.info(f'Starting build for project: {project_name}')
        response = codebuild.start_build(projectName=project_name)
        build_id = response['build']['id']
        logger.info(f'Build started: {build_id}')
        send_cfn_response(event, 'SUCCESS', data={'BuildId': build_id})
    except Exception as e:
        logger.error(f'Failed to start build: {e}')
        send_cfn_response(event, 'FAILED', reason=str(e))
