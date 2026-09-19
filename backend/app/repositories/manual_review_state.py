"""File review feedback and downstream invalidation."""


def review_evidence(connection, instance_id, config, node_key):
    from app.repositories.file_reviews import file_review_evidence
    return file_review_evidence(connection, instance_id, config, node_key)


def current_rejection(connection, node_instance_id):
    return connection.execute(
        """SELECT r.* FROM manual_node_rejections r JOIN node_instances n ON n.id = r.node_instance_id
           WHERE r.node_instance_id = ? AND r.attempt_no = n.attempt_no
             AND (n.approved_at IS NULL OR n.approved_at <= r.created_at)
           ORDER BY r.created_at DESC, r.id DESC LIMIT 1""", (node_instance_id,),
    ).fetchone()


def invalidate_nodes(connection, instance_id, config, node_keys, now):
    rows = {row['node_key']: row for row in connection.execute(
        'SELECT * FROM node_instances WHERE flow_instance_id = ?', (instance_id,),
    ).fetchall()}
    for node_key in node_keys:
        row = rows.get(node_key)
        if row is None:
            continue
        connection.execute(
            "UPDATE node_instances SET status = 'locked', approved_at = NULL, attempt_reset_no = attempt_no WHERE id = ?", (row['id'],),
        )
        connection.execute('''UPDATE file_review_runs SET status = 'cancelled' WHERE submission_id IN (SELECT id FROM submissions WHERE node_instance_id = ?) AND status = 'active' ''', (row['id'],))
        node = next(item for item in config['nodes'] if item['id'] == node_key)
        if node.get('kind') in {'form', 'answer_sheet'}:
            connection.execute(
                """INSERT INTO node_drafts (node_instance_id, payload, updated_at)
                   SELECT node_instance_id, payload_snapshot, ? FROM submissions
                   WHERE node_instance_id = ? AND attempt_no = ?
                   ON CONFLICT(node_instance_id) DO NOTHING""",
                (now, row['id'], row['attempt_no']),
            )
        connection.execute(
            """UPDATE audit_jobs SET status = 'cancelled', cancellation_reason = 'source_updated',
               finished_at = ?, updated_at = ?
               WHERE node_instance_id = ? AND status IN ('pending', 'running')""",
            (now, now, row['id']),
        )
    connection.execute(
        "UPDATE flow_instances SET status = 'in_progress', completed_at = NULL WHERE id = ?", (instance_id,),
    )
