"""Reference list access with compatibility for existing single-reference snapshots."""

def reference_assets(node: dict) -> list[dict]:
    if 'referenceAssets' in node:
        return node['referenceAssets'] or []
    return [node['referenceAsset']] if node.get('referenceAsset') else []


def asset_entries(node: dict):
    if node.get('templateAsset'):
        yield 'templateAsset', node['templateAsset']
    for asset in reference_assets(node):
        yield 'referenceAsset', asset
