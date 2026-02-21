from __future__ import annotations

TOOL_META = {
    'name': 'netlify_app_insights_tool',
    'description': 'Collect app insights and run smoke tests via Playwright',
    'input_schema': {'type': 'object'},
    'output_schema': {'type': 'object'},
    'risk_level': 'READ',
    'default_requires_approval': False
}


def execute(context, args):
    app_runner = context.clients['webapp']
    if args['mode'] == 'insights':
        return {'results': app_runner.collect_insights(args.get('app_ids'))}
    if args['mode'] == 'smoke':
        return {'results': app_runner.run_smoke(args.get('app_ids'))}
    raise ValueError('unsupported mode')
