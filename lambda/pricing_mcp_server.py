"""
Pricing MCP Server - Lambda handler for AWS Pricing API tools
Gateway sends only tool arguments, not tool name - detect tool from arguments
"""

import boto3
import json
import logging
from typing import Dict, Any, List, Optional

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS Pricing client (only available in us-east-1)
pricing_client = boto3.client('pricing', region_name='us-east-1')


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


def get_service_codes() -> Dict[str, Any]:
    """Get all available AWS service codes for pricing"""
    try:
        response = pricing_client.describe_services()
        services = [
            {
                'ServiceCode': s['ServiceCode'],
                'ServiceName': s.get('ServiceName', '')
            }
            for s in response.get('Services', [])
        ]
        return format_mcp_response(json.dumps(services, indent=2))
    except Exception as e:
        logger.error(f"Error in get_service_codes: {e}", exc_info=True)
        return format_mcp_response(f"Error getting service codes: {str(e)}")


def get_service_attributes(service_code: str) -> Dict[str, Any]:
    """Get pricing attributes for a specific AWS service"""
    try:
        response = pricing_client.describe_services(ServiceCode=service_code)
        if response.get('Services'):
            service = response['Services'][0]
            return format_mcp_response(json.dumps(service.get('AttributeNames', []), indent=2))
        return format_mcp_response("Service not found")
    except Exception as e:
        logger.error(f"Error in get_service_attributes: {e}", exc_info=True)
        return format_mcp_response(f"Error getting service attributes: {str(e)}")


def get_attribute_values(service_code: str, attribute_name: str) -> Dict[str, Any]:
    """Get possible values for a pricing attribute"""
    try:
        response = pricing_client.get_attribute_values(
            ServiceCode=service_code,
            AttributeName=attribute_name
        )
        values = [av['Value'] for av in response.get('AttributeValues', [])]
        return format_mcp_response(json.dumps(values, indent=2))
    except Exception as e:
        logger.error(f"Error in get_attribute_values: {e}", exc_info=True)
        return format_mcp_response(f"Error getting attribute values: {str(e)}")


def get_products(service_code: str, filters: Optional[List[Dict[str, Any]]] = None, 
                 max_results: int = 10) -> Dict[str, Any]:
    """Get pricing products for an AWS service with optional filters"""
    try:
        params = {
            'ServiceCode': service_code,
            'MaxResults': max_results
        }
        
        if filters:
            params['Filters'] = filters
        
        response = pricing_client.get_products(**params)
        
        # Parse and format the pricing data
        products = []
        for price_list in response.get('PriceList', []):
            if isinstance(price_list, str):
                product = json.loads(price_list)
                products.append(product)
        
        return format_mcp_response(json.dumps(products, indent=2, default=str))
    except Exception as e:
        logger.error(f"Error in get_products: {e}", exc_info=True)
        return format_mcp_response(f"Error getting products: {str(e)}")


def get_service_pricing(service_code: str, region: str = "us-east-1", 
                       filters: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Get pricing for a specific AWS service"""
    try:
        # Map region names to pricing API location names
        region_map = {
            'us-east-1': 'US East (N. Virginia)',
            'us-west-2': 'US West (Oregon)',
            'eu-west-1': 'EU (Ireland)',
            # Add more as needed
        }
        
        location = region_map.get(region, region)
        
        service_filters = [
            {'Type': 'TERM_MATCH', 'Field': 'location', 'Value': location}
        ]
        
        if filters:
            service_filters.extend(filters)
        
        return get_products(service_code, service_filters, max_results=10)
    except Exception as e:
        logger.error(f"Error in get_service_pricing: {e}", exc_info=True)
        return format_mcp_response(f"Error getting service pricing: {str(e)}")


def get_ec2_pricing(instance_type: str, region: str = "us-east-1", 
                   operating_system: str = "Linux") -> Dict[str, Any]:
    """Get pricing for a specific EC2 instance type"""
    try:
        # Map region names to pricing API location names
        region_map = {
            'us-east-1': 'US East (N. Virginia)',
            'us-west-2': 'US West (Oregon)',
            'eu-west-1': 'EU (Ireland)',
            # Add more as needed
        }
        
        location = region_map.get(region, region)
        
        filters = [
            {'Type': 'TERM_MATCH', 'Field': 'location', 'Value': location},
            {'Type': 'TERM_MATCH', 'Field': 'instanceType', 'Value': instance_type},
            {'Type': 'TERM_MATCH', 'Field': 'operatingSystem', 'Value': operating_system},
            {'Type': 'TERM_MATCH', 'Field': 'tenancy', 'Value': 'Shared'},
            {'Type': 'TERM_MATCH', 'Field': 'preInstalledSw', 'Value': 'NA'},
            {'Type': 'TERM_MATCH', 'Field': 'capacitystatus', 'Value': 'Used'}
        ]
        
        response = pricing_client.get_products(
            ServiceCode='AmazonEC2',
            Filters=filters,
            MaxResults=1
        )
        
        products = []
        for price_list in response.get('PriceList', []):
            product = json.loads(price_list)
            products.append(product)
        
        return format_mcp_response(json.dumps(products, indent=2, default=str))
    except Exception as e:
        logger.error(f"Error in get_ec2_pricing: {e}", exc_info=True)
        return format_mcp_response(f"Error getting EC2 pricing: {str(e)}")


def get_rds_pricing(instance_type: str, engine: str, region: str = "us-east-1") -> Dict[str, Any]:
    """Get pricing for RDS instances"""
    try:
        # Map region names to pricing API location names
        region_map = {
            'us-east-1': 'US East (N. Virginia)',
            'us-west-2': 'US West (Oregon)',
            'eu-west-1': 'EU (Ireland)',
            # Add more as needed
        }
        
        # Map common engine names to AWS Pricing API values
        engine_map = {
            'postgres': 'PostgreSQL',
            'postgresql': 'PostgreSQL',
            'mysql': 'MySQL',
            'mariadb': 'MariaDB',
            'oracle': 'Oracle',
            'sqlserver': 'SQL Server',
            'aurora-mysql': 'Aurora MySQL',
            'aurora-postgresql': 'Aurora PostgreSQL',
            'aurora': 'Aurora MySQL'
        }
        
        location = region_map.get(region, region)
        # Normalize engine name (case-insensitive lookup)
        normalized_engine = engine_map.get(engine.lower(), engine)
        
        filters = [
            {'Type': 'TERM_MATCH', 'Field': 'location', 'Value': location},
            {'Type': 'TERM_MATCH', 'Field': 'instanceType', 'Value': instance_type},
            {'Type': 'TERM_MATCH', 'Field': 'databaseEngine', 'Value': normalized_engine}
        ]
        
        response = pricing_client.get_products(
            ServiceCode='AmazonRDS',
            Filters=filters,
            MaxResults=5
        )
        
        products = []
        for price_list in response.get('PriceList', []):
            product = json.loads(price_list)
            products.append(product)
        
        return format_mcp_response(json.dumps(products, indent=2, default=str))
    except Exception as e:
        logger.error(f"Error in get_rds_pricing: {e}", exc_info=True)
        return format_mcp_response(f"Error getting RDS pricing: {str(e)}")


def get_lambda_pricing(region: str = "us-east-1") -> Dict[str, Any]:
    """Get Lambda pricing for a specific region"""
    try:
        # Map region names to pricing API location names
        region_map = {
            'us-east-1': 'US East (N. Virginia)',
            'us-west-2': 'US West (Oregon)',
            'eu-west-1': 'EU (Ireland)',
            # Add more as needed
        }
        
        location = region_map.get(region, region)
        
        filters = [
            {'Type': 'TERM_MATCH', 'Field': 'location', 'Value': location}
        ]
        
        response = pricing_client.get_products(
            ServiceCode='AWSLambda',
            Filters=filters,
            MaxResults=10
        )
        
        products = []
        for price_list in response.get('PriceList', []):
            product = json.loads(price_list)
            products.append(product)
        
        return format_mcp_response(json.dumps(products, indent=2, default=str))
    except Exception as e:
        logger.error(f"Error in get_lambda_pricing: {e}", exc_info=True)
        return format_mcp_response(f"Error getting Lambda pricing: {str(e)}")


def compare_instance_pricing(instance_types: List[str], region: str = "us-east-1", 
                             operating_system: str = "Linux") -> Dict[str, Any]:
    """Compare pricing for multiple EC2 instance types"""
    try:
        # Map region names to pricing API location names
        region_map = {
            'us-east-1': 'US East (N. Virginia)',
            'us-west-2': 'US West (Oregon)',
            'eu-west-1': 'EU (Ireland)',
            # Add more as needed
        }
        
        location = region_map.get(region, region)
        
        filters = [
            {'Type': 'TERM_MATCH', 'Field': 'location', 'Value': location},
            {'Type': 'TERM_MATCH', 'Field': 'operatingSystem', 'Value': operating_system},
            {'Type': 'TERM_MATCH', 'Field': 'tenancy', 'Value': 'Shared'},
            {'Type': 'TERM_MATCH', 'Field': 'preInstalledSw', 'Value': 'NA'},
            {'Type': 'TERM_MATCH', 'Field': 'capacitystatus', 'Value': 'Used'}
        ]
        
        results = {}
        for instance_type in instance_types:
            instance_filters = filters + [
                {'Type': 'TERM_MATCH', 'Field': 'instanceType', 'Value': instance_type}
            ]
            
            response = pricing_client.get_products(
                ServiceCode='AmazonEC2',
                Filters=instance_filters,
                MaxResults=1
            )
            
            if response.get('PriceList'):
                product = json.loads(response['PriceList'][0])
                results[instance_type] = product
        
        return format_mcp_response(json.dumps(results, indent=2, default=str))
    except Exception as e:
        logger.error(f"Error in compare_instance_pricing: {e}", exc_info=True)
        return format_mcp_response(f"Error comparing instance pricing: {str(e)}")


def handler(event, context):
    """
    Lambda handler for Gateway invocations.
    Gateway sends only tool arguments (not tool name) - detect tool from arguments present.
    """
    logger.info(f"Received event: {json.dumps(event)}")
    
    try:
        # Gateway sends only arguments, detect tool from which arguments are present
        
        # Detect tool based on unique argument combinations
        if 'instance_types' in event:
            # compare_instance_pricing - has instance_types (array)
            logger.info("Detected compare_instance_pricing tool")
            result = compare_instance_pricing(
                event['instance_types'],
                event.get('region', 'us-east-1'),
                event.get('operating_system', 'Linux')
            )
        elif 'instance_type' in event and 'engine' in event:
            # get_rds_pricing - has both instance_type and engine
            logger.info("Detected get_rds_pricing tool")
            result = get_rds_pricing(
                event['instance_type'],
                event['engine'],
                event.get('region', 'us-east-1')
            )
        elif 'instance_type' in event:
            # get_ec2_pricing - has instance_type only
            logger.info("Detected get_ec2_pricing tool")
            result = get_ec2_pricing(
                event['instance_type'],
                event.get('region', 'us-east-1'),
                event.get('operating_system', 'Linux')
            )
        elif 'service_code' in event and 'attribute_name' in event:
            # get_attribute_values - has both service_code and attribute_name
            logger.info("Detected get_attribute_values tool")
            result = get_attribute_values(event['service_code'], event['attribute_name'])
        elif 'service_code' in event and 'get_attributes' in event:
            # get_service_attributes - has service_code and get_attributes flag
            logger.info("Detected get_service_attributes tool")
            result = get_service_attributes(event['service_code'])
        elif 'service_code' in event:
            # get_service_pricing - has service_code (without get_attributes flag)
            logger.info("Detected get_service_pricing tool")
            result = get_service_pricing(
                event['service_code'],
                event.get('region', 'us-east-1'),
                event.get('filters')
            )
        elif 'get_lambda_pricing' in event:
            # get_lambda_pricing - has get_lambda_pricing flag
            logger.info("Detected get_lambda_pricing tool")
            result = get_lambda_pricing(event.get('region', 'us-east-1'))
        elif len(event) == 0:
            # get_service_codes - no arguments
            logger.info("Detected get_service_codes tool")
            result = get_service_codes()
        else:
            # Unknown tool pattern
            result = format_mcp_response(f"Cannot detect tool from arguments: {json.dumps(event)}")
        
        logger.info(f"Result: {json.dumps(result)}")
        return result
        
    except Exception as e:
        logger.error(f"Error in handler: {e}", exc_info=True)
        return format_mcp_response(f"Error processing request: {str(e)}")
