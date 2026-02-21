from __future__ import annotations

TOOL_META = {
    'name': 'netlify_app_insights_tool',
    'description': 'Collect app insights and run smoke tests via Playwright',
    'input_schema': {'type': 'object'},
    'output_schema': {'type': 'object'},
    'risk_level': 'READ',
    'default_requires_approval': False
}


def _attach_artifacts(context, results):
    attached = 0
    for result in results:
        artifact = result.pop('artifact', None)
        if artifact:
            context.clients['cockpit'].add_artifact(context.task_id, artifact)
            attached += 1
    return attached


def execute(context, args):
    app_runner = context.clients['webapp']
    watch_enabled = bool(args.get('watch_mode', True))

    def watch_uploader(jpeg_bytes: bytes):
        if watch_enabled:
            context.clients['cockpit'].upload_watch_latest_screenshot(context.task_id, jpeg_bytes)

    if args['mode'] == 'insights':
        results = app_runner.collect_insights(args.get('app_ids'), logger=context.logger, watch_uploader=watch_uploader)
        attached = _attach_artifacts(context, results)
        return {'results': results, 'artifactsAttached': attached}
    if args['mode'] == 'smoke':
        results = app_runner.run_smoke(args.get('app_ids'), logger=context.logger, watch_uploader=watch_uploader)
        attached = _attach_artifacts(context, results)
        return {'results': results, 'artifactsAttached': attached}
    raise ValueError('unsupported mode')
