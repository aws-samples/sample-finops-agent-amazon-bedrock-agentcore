"""
Billing MCP Server - Lambda handler for AWS Cost Explorer and billing tools
Gateway sends only tool arguments, not tool name - detect tool from arguments
"""

import boto3
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Any

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
ce_client = boto3.client('ce')
budgets_client = boto3.client('budgets')
compute_optimizer_client = boto3.client('compute-optimizer')
freetier_client = boto3.client('freetier')


def format_mcp_response(text: str) -> Dict[str, Any]:
    """Format response in MCP format"""
    return {
        "content": [
            {
                "type": "text",
                "text": text
            }
        ]
    }


def get_cost_and_usage(start_date: str, end_date: str, granularity: str = "MONTHLY", 
                       metrics: list = None, group_by: list = None) -> Dict[str, Any]:
    """Get AWS cost and usage data from Cost Explorer"""
    try:
        if metrics is None:
            metrics = ["UnblendedCost"]
        
        params = {
            'TimePeriod': {
                'Start': start_date,
                'End': end_date
            },
            'Granularity': granularity,
            'Metrics': metrics
        }
        
        if group_by:
            params['GroupBy'] = [{'Type': 'DIMENSION', 'Key': key} for key in group_by]
        
        response = ce_client.get_cost_and_usage(**params)
        return format_mcp_response(json.dumps(response, default=str, indent=2))
    except Exception as e:
        logger.error(f"Error in get_cost_and_usage: {e}", exc_info=True)
        return format_mcp_response(f"Error getting cost and usage: {str(e)}")


def get_cost_forecast(start_date: str, end_date: str, metric: str = "UNBLENDED_COST") -> Dict[str, Any]:
    """Get cost forecast from Cost Explorer"""
    try:
        response = ce_client.get_cost_forecast(
            TimePeriod={
                'Start': start_date,
                'End': end_date
            },
            Metric=metric,
            Granularity='MONTHLY'
        )
        return format_mcp_response(json.dumps(response, default=str, indent=2))
    except Exception as e:
        logger.error(f"Error in get_cost_forecast: {e}", exc_info=True)
        return format_mcp_response(f"Error getting cost forecast: {str(e)}")


def get_rightsizing_recommendations() -> Dict[str, Any]:
    """Get EC2 rightsizing recommendations from Cost Explorer"""
    try:
        response = ce_client.get_rightsizing_recommendation(
            Service='AmazonEC2',
            Configuration={
                'RecommendationTarget': 'SAME_INSTANCE_FAMILY',
                'BenefitsConsidered': True
            }
        )
        
        # Check if there are recommendations
        recommendations = response.get('RightsizingRecommendations', [])
        if not recommendations:
            return format_mcp_response(
                "No EC2 rightsizing recommendations found. This could mean:\n"
                "1. All EC2 instances are optimally sized\n"
                "2. Rightsizing recommendations need to be enabled in Cost Explorer Preferences\n"
                "3. Insufficient usage data (requires 14 days of data)\n\n"
                "To enable: Go to AWS Cost Explorer > Preferences > Enable rightsizing recommendations"
            )
        
        return format_mcp_response(json.dumps(response, default=str, indent=2))
    except ce_client.exceptions.LimitExceededException as e:
        logger.error(f"Rate limit exceeded: {e}")
        return format_mcp_response("Rate limit exceeded. Please try again in a few moments.")
    except Exception as e:
        logger.error(f"Error in get_rightsizing_recommendations: {e}", exc_info=True)
        error_msg = str(e)
        
        if "not enabled" in error_msg.lower() or "not subscribed" in error_msg.lower():
            return format_mcp_response(
                "EC2 rightsizing recommendations are not enabled. "
                "To enable: Go to AWS Cost Explorer > Preferences > Enable rightsizing recommendations"
            )
        
        return format_mcp_response(f"Error getting rightsizing recommendations: {error_msg}")


def get_savings_plans_recommendations() -> Dict[str, Any]:
    """Get Savings Plans purchase recommendations"""
    try:
        response = ce_client.get_savings_plans_purchase_recommendation(
            SavingsPlansType='COMPUTE_SP',
            TermInYears='ONE_YEAR',
            PaymentOption='NO_UPFRONT',
            LookbackPeriodInDays='SIXTY_DAYS'
        )
        
        # Check if there are actual recommendations
        recommendation = response.get('SavingsPlansPurchaseRecommendation', {})
        if not recommendation or not recommendation.get('SavingsPlansPurchaseRecommendationDetails'):
            return format_mcp_response(
                "No Savings Plans purchase recommendations found. This means:\n"
                "1. Your current usage patterns don't show significant savings opportunities\n"
                "2. You may already have optimal Savings Plans coverage\n"
                "3. Your workload usage is too variable or low to benefit from commitments\n"
                "4. You might need more consistent usage history (analyzed last 60 days)\n\n"
                "Savings Plans work best for steady-state workloads with predictable usage patterns."
            )
        
        return format_mcp_response(json.dumps(response, default=str, indent=2))
    except Exception as e:
        logger.error(f"Error in get_savings_plans_recommendations: {e}", exc_info=True)
        return format_mcp_response(f"Error getting Savings Plans recommendations: {str(e)}")


def get_compute_optimizer_recommendations(resource_type: str = "EC2Instance") -> Dict[str, Any]:
    """Get recommendations from AWS Compute Optimizer"""
    try:
        # Check if Compute Optimizer is enabled by getting enrollment status
        try:
            enrollment_status = compute_optimizer_client.get_enrollment_status()
            status = enrollment_status.get('status', 'Unknown')
            
            if status != 'Active':
                return format_mcp_response(
                    f"AWS Compute Optimizer is not enabled for this account. "
                    f"Current status: {status}. "
                    f"To enable it, visit the AWS Compute Optimizer console at "
                    f"https://console.aws.amazon.com/compute-optimizer/ and opt-in."
                )
        except Exception as enrollment_error:
            logger.warning(f"Could not check enrollment status: {enrollment_error}")
        
        # Get recommendations based on resource type
        if resource_type == "EC2Instance":
            response = compute_optimizer_client.get_ec2_instance_recommendations()
        elif resource_type == "EBSVolume":
            response = compute_optimizer_client.get_ebs_volume_recommendations()
        elif resource_type == "Lambda":
            response = compute_optimizer_client.get_lambda_function_recommendations()
        else:
            return format_mcp_response(f"Unsupported resource type: {resource_type}")
        
        # Check if there are any recommendations
        recommendations_key = {
            "EC2Instance": "instanceRecommendations",
            "EBSVolume": "volumeRecommendations",
            "Lambda": "lambdaFunctionRecommendations"
        }.get(resource_type, "recommendations")
        
        recommendations = response.get(recommendations_key, [])
        if not recommendations:
            return format_mcp_response(
                f"No {resource_type} optimization recommendations found. This is good news and means:\n"
                f"1. There are no {resource_type} resources in your account, OR\n"
                f"2. All your {resource_type} resources are already optimally sized, OR\n"
                f"3. Compute Optimizer needs more time to analyze (requires 30 hours of metrics data)\n\n"
                f"If you recently enabled Compute Optimizer, check back in 24-48 hours."
            )
        
        return format_mcp_response(json.dumps(response, default=str, indent=2))
        
    except compute_optimizer_client.exceptions.OptInRequiredException as e:
        logger.error(f"Compute Optimizer opt-in required: {e}")
        return format_mcp_response(
            "AWS Compute Optimizer is not enabled for this account. "
            "To enable it, visit https://console.aws.amazon.com/compute-optimizer/ and opt-in."
        )
    except Exception as e:
        logger.error(f"Error in get_compute_optimizer_recommendations: {e}", exc_info=True)
        error_msg = str(e)
        
        # Provide helpful error messages
        if "AccessDenied" in error_msg or "UnauthorizedOperation" in error_msg:
            return format_mcp_response(
                f"Access denied to Compute Optimizer. Error: {error_msg}\n"
                f"Please ensure the Lambda execution role has the 'compute-optimizer:*' permission."
            )
        elif "OptInRequired" in error_msg:
            return format_mcp_response(
                "AWS Compute Optimizer is not enabled. "
                "Visit https://console.aws.amazon.com/compute-optimizer/ to opt-in."
            )
        else:
            return format_mcp_response(f"Error getting Compute Optimizer recommendations: {error_msg}")


def get_free_tier_usage() -> Dict[str, Any]:
    """Get AWS Free Tier usage information"""
    try:
        response = freetier_client.get_free_tier_usage()
        return format_mcp_response(json.dumps(response, default=str, indent=2))
    except Exception as e:
        logger.error(f"Error in get_free_tier_usage: {e}", exc_info=True)
        return format_mcp_response(f"Error getting Free Tier usage: {str(e)}")


def get_budgets(account_id: str) -> Dict[str, Any]:
    """Get AWS Budgets information"""
    try:
        response = budgets_client.describe_budgets(AccountId=account_id)
        return format_mcp_response(json.dumps(response, default=str, indent=2))
    except Exception as e:
        logger.error(f"Error in get_budgets: {e}", exc_info=True)
        return format_mcp_response(f"Error getting budgets: {str(e)}")


def get_budget_details(account_id: str, budget_name: str) -> Dict[str, Any]:
    """Get detailed information about a specific budget"""
    try:
        response = budgets_client.describe_budget(
            AccountId=account_id,
            BudgetName=budget_name
        )
        return format_mcp_response(json.dumps(response, default=str, indent=2))
    except Exception as e:
        logger.error(f"Error in get_budget_details: {e}", exc_info=True)
        return format_mcp_response(f"Error getting budget details: {str(e)}")


def get_cost_anomalies(start_date: str, end_date: str) -> Dict[str, Any]:
    """Get cost anomalies from Cost Explorer"""
    try:
        response = ce_client.get_anomalies(
            DateInterval={
                'StartDate': start_date,
                'EndDate': end_date
            }
        )
        return format_mcp_response(json.dumps(response, default=str, indent=2))
    except Exception as e:
        logger.error(f"Error in get_cost_anomalies: {e}", exc_info=True)
        return format_mcp_response(f"Error getting cost anomalies: {str(e)}")


def handler(event, context):
    """
    Lambda handler for Gateway invocations.
    Gateway sends only tool arguments (not tool name) - detect tool from arguments present.
    """
    logger.info(f"Received event: {json.dumps(event)}")
    
    try:
        # Gateway sends only arguments, detect tool from which arguments are present
        account_id = context.invoked_function_arn.split(':')[4]
        
        # Detect tool based on unique argument combinations
        if 'budget_name' in event:
            # get_budget_details - has budget_name
            result = get_budget_details(
                event.get('account_id', account_id),
                event['budget_name']
            )
        elif 'resource_type' in event:
            # get_compute_optimizer_recommendations - has resource_type
            result = get_compute_optimizer_recommendations(event.get('resource_type', 'EC2Instance'))
        elif 'list_budgets' in event:
            # get_budgets - has list_budgets flag
            logger.info("Detected get_budgets tool")
            result = get_budgets(event.get('account_id', account_id))
        elif 'check_free_tier' in event:
            # get_free_tier_usage - has check_free_tier flag
            logger.info("Detected get_free_tier_usage tool")
            result = get_free_tier_usage()
        elif 'get_rightsizing' in event:
            # get_rightsizing_recommendations - has get_rightsizing flag
            logger.info("Detected get_rightsizing_recommendations tool")
            result = get_rightsizing_recommendations()
        elif 'get_savings_plans' in event:
            # get_savings_plans_recommendations - has get_savings_plans flag
            logger.info("Detected get_savings_plans_recommendations tool")
            result = get_savings_plans_recommendations()
        elif 'start_date' in event and 'end_date' in event:
            # Multiple tools use start_date/end_date, check for other indicators
            if 'group_by_service' in event and event['group_by_service']:
                # get_cost_by_service - has group_by_service=true
                logger.info("Detected get_cost_by_service tool")
                result = get_cost_and_usage(
                    event['start_date'],
                    event['end_date'],
                    event.get('granularity', 'MONTHLY'),
                    group_by=['SERVICE']
                )
            elif 'group_by_usage_type' in event and event['group_by_usage_type']:
                # get_cost_by_usage_type - has group_by_usage_type=true
                logger.info("Detected get_cost_by_usage_type tool")
                result = get_cost_and_usage(
                    event['start_date'],
                    event['end_date'],
                    event.get('granularity', 'MONTHLY'),
                    group_by=['USAGE_TYPE']
                )
            elif 'detect_anomalies' in event:
                # get_cost_anomalies - has detect_anomalies flag
                logger.info("Detected get_cost_anomalies tool")
                result = get_cost_anomalies(event['start_date'], event['end_date'])
            elif 'metric' in event:
                # get_cost_forecast - has metric parameter
                logger.info("Detected get_cost_forecast tool")
                result = get_cost_forecast(
                    event['start_date'],
                    event['end_date'],
                    event.get('metric', 'UNBLENDED_COST')
                )
            elif 'group_by_dimension' in event:
                # get_cost_and_usage with custom dimension grouping
                logger.info(f"Detected get_cost_and_usage tool with group_by_dimension: {event['group_by_dimension']}")
                result = get_cost_and_usage(
                    event['start_date'],
                    event['end_date'],
                    event.get('granularity', 'MONTHLY'),
                    group_by=[event['group_by_dimension']]
                )
            else:
                # get_cost_and_usage - default for start_date/end_date
                logger.info("Detected get_cost_and_usage tool")
                result = get_cost_and_usage(
                    event['start_date'],
                    event['end_date'],
                    event.get('granularity', 'MONTHLY'),
                    event.get('metrics'),
                    event.get('group_by')
                )
        else:
            # Unknown tool pattern
            result = format_mcp_response(f"Cannot detect tool from arguments: {json.dumps(event)}")
        
        logger.info(f"Result: {json.dumps(result)}")
        return result
        
    except Exception as e:
        logger.error(f"Error in handler: {e}", exc_info=True)
        return format_mcp_response(f"Error processing request: {str(e)}")
