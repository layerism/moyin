"""Enqueue structured review steps in the shared audit job queue."""
from app.repositories.audit_jobs import create_audit_job
from app.repositories.audit_policies import policy_hash
from app.repositories.node_configuration import node_metadata


def enqueue_steps(connection, submission_id, node, now):
    from app.services.audit_script_catalog import find_audit_script
    from app.services.audit_script_parameters import default_script_settings, validate_script_params, validate_script_settings
    context = connection.execute('''SELECT n.id AS node_instance_id, n.node_key, v.flow_id
        FROM node_submissions s JOIN node_instances n ON n.id = s.node_instance_id
        JOIN flow_instances i ON i.id = n.flow_instance_id
        JOIN flow_versions v ON v.id = i.flow_version_id WHERE s.id = ?''', (submission_id,)).fetchone()
    for index, step in enumerate(node['fileReviewSteps']):
        if step['kind'] == 'manual':
            continue
        record = find_audit_script(step['auditScriptId'])
        state = connection.execute('SELECT * FROM audit_script_runtime_states WHERE script_id = ?', (record.id,)).fetchone()
        if not state or state['status'] != 'ready' or state['content_hash'] != record.content_hash:
            raise ValueError('审核脚本正在更新，请稍后提交')
        snapshot = {**step, 'scriptName': record.name, 'generation': state['generation'], 'hash': state['content_hash'],
                    'params': validate_script_params(record.config, step.get('auditScriptParams') or {}),
                    'settings': validate_script_settings(record.config, default_script_settings(record.config))}
        create_audit_job(connection, submission_id=submission_id, node_instance_id=context['node_instance_id'],
                         flow_id=context['flow_id'], node_key=context['node_key'], script_id=record.id,
                         script_generation=state['generation'], script_content_hash=state['content_hash'],
                         policy_generation=node_metadata(node, 'review')['generation'],
                         policy_hash=policy_hash(record.id, snapshot['params'], step.get('auditModelCardId')),
                         script_params=snapshot['params'], script_settings=snapshot['settings'],
                         now=now, step_index=index, snapshot=snapshot)
