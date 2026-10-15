"""Form API adapter backed by the shared published-node parameter document."""
from app.repositories.published_node_parameters import (
    NodeParametersConflict as FormParametersConflict,
    get_node_parameters,
    update_node_parameters,
)


def get_form_parameters(flow_id, node_key, teacher_id):
    return get_node_parameters(flow_id, node_key, teacher_id, 'form')


def update_form_parameters(flow_id, node_key, teacher_id, expected_generation, params):
    return update_node_parameters(flow_id, node_key, teacher_id, expected_generation, params, 'form')
