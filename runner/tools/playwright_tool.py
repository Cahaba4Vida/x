TOOL_META = {
    'name': 'playwright_tool',
    'description': 'Generic browser automation helper (reserved for extension)',
    'input_schema': {'type': 'object'},
    'output_schema': {'type': 'object'},
    'risk_level': 'READ',
    'default_requires_approval': False
}

def execute(context, args):
    return {'ok': True, 'note': 'Use specific tools for workflows in MVP'}
