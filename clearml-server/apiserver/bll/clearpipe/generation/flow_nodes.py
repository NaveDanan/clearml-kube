"""Flow-editor node dispatch for ClearPipe generation.

The web flow editor lowers every authored node to an identical no-op function
node and embeds the real node type + config in a ``# clearpipe-flow-node:``
source comment (see ``clearpipe-flow-codec.ts``).  The generic function lowerer
in :mod:`function` ignores that metadata, so authored nodes that carry runtime
semantics (currently the Report output node) need a dispatcher that reads the
metadata and emits a real implementation.

Nodes without recognised metadata fall through to :func:`lower_function_node`
unchanged, so existing function graphs keep byte-identical generated output.
"""

import json
from dataclasses import replace
from typing import Optional

from .contracts import FunctionLoweringInput
from .function import (
    FunctionStepLowering,
    _canonical_parents,
    _execution_queue,
    _optional_execution_settings,
    _python_literal,
    _render_step,
    lower_function_node,
)


FLOW_NODE_META_TAG = "# clearpipe-flow-node:"


def flow_node_meta(node: object) -> Optional[dict]:
    """Return the embedded flow-node metadata dict, or ``None`` when absent."""

    source = getattr(node, "source", None)
    if not isinstance(source, str):
        return None
    for line in source.splitlines():
        stripped = line.strip()
        if stripped.startswith(FLOW_NODE_META_TAG):
            payload = stripped[len(FLOW_NODE_META_TAG):].strip()
            try:
                meta = json.loads(payload)
            except (ValueError, TypeError):
                return None
            return meta if isinstance(meta, dict) else None
    return None


def lower_flow_function_node(lowering: FunctionLoweringInput) -> FunctionStepLowering:
    """Dispatch a flow-authored function node to its specialized lowerer.

    Recognised flow node types are lowered into a real implementation; every
    other node (including graphs authored outside the flow editor) is lowered by
    the standard :func:`lower_function_node`.
    """

    meta = flow_node_meta(lowering.node)
    if meta and meta.get("type") == "report":
        return _lower_report_node(lowering, meta)
    return lower_function_node(lowering)


def _report_title(config: dict, node: object) -> str:
    for key in ("title", "name", "label"):
        value = config.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    name = getattr(node, "label", None) or getattr(node, "name", None) or "ClearPipe report"
    return str(name)


def _lower_report_node(
    lowering: FunctionLoweringInput, meta: dict
) -> FunctionStepLowering:
    """Lower a Report flow node into a step that creates a real ClearML Report.

    The generated step builds Markdown from the optional template report and the
    configured artifact sources, then calls ``reports.create`` + ``reports.update``
    so the result appears in the ClearML Reports section. No pickled return
    artifact is produced (``function_return`` is empty).
    """

    # Validate node name/queue/ports/source shape and surface the standard
    # diagnostics, then replace the no-op body with the real implementation.
    base = lower_function_node(lowering)

    node = lowering.node
    node_id = getattr(node, "id", "")
    path = "graph.nodes.{}".format(node_id or "unknown")
    config = meta.get("config") if isinstance(meta.get("config"), dict) else {}

    title = _report_title(config, node)
    template_report_id = config.get("templateReportId")
    if not isinstance(template_report_id, str):
        template_report_id = ""
    artifact_sources = [
        str(item)
        for item in (config.get("artifactSources") or [])
        if isinstance(item, (str, int, float))
    ]

    definition_source = _render_report_function(
        node.name, title, template_report_id, artifact_sources
    )

    execution_queue = _execution_queue(lowering, path, node_id)
    parents = _canonical_parents(lowering, set(), path, node_id)
    packages, retry_on_failure = _optional_execution_settings(node, path, node_id)
    task_type = getattr(getattr(node, "configuration", None), "task_type", "application")

    step_source = _render_step(
        controller_name="pipe",
        node_name=node.name,
        function_kwargs=(),
        output_names=(),
        task_type=task_type,
        execution_queue=execution_queue,
        cache=False,
        packages=packages,
        retry_on_failure=retry_on_failure,
        parents=parents,
    )

    source = "{}\n{}".format(definition_source, step_source)
    return replace(
        base,
        definition_source=definition_source,
        step_source=step_source,
        source=source,
    )


def _render_report_function(
    name: str, title: str, template_report_id: str, artifact_sources: list
) -> str:
    """Render the module-level report-building function for a Report node."""

    title_literal = _python_literal(title)
    template_literal = _python_literal(template_report_id)
    sources_literal = _python_literal(list(artifact_sources))

    lines = [
        "def {}() -> object:".format(name),
        "    import json",
        "    import re",
        "    from clearml import Task",
        "",
        "    task = Task.current_task()",
        "    session = Task._get_default_session()",
        "",
        "    _secret_re = re.compile(",
        "        r\"(?i)(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\"",
        "        r\"(\\s*[:=]\\s*)(\\S+)\"",
        "    )",
        "    _aws_re = re.compile(r\"AKIA[0-9A-Z]{16}\")",
        "    _bearer_re = re.compile(r\"(?i)(bearer\\s+)[A-Za-z0-9._-]{12,}\")",
        "    def _redact(text):",
        "        text = str(text)",
        "        text = _secret_re.sub(lambda m: m.group(1) + m.group(2) + '***REDACTED***', text)",
        "        text = _aws_re.sub('***REDACTED***', text)",
        "        text = _bearer_re.sub(lambda m: m.group(1) + '***REDACTED***', text)",
        "        return text",
        "",
        "    title = {}".format(title_literal),
        "    template_report_id = {}".format(template_literal),
        "    artifact_sources = {}".format(sources_literal),
        "",
        "    sections = []",
        "    if template_report_id:",
        "        try:",
        "            response = session.send_request(",
        "                'reports', 'get_all_ex', method='post',",
        "                json={'id': [template_report_id], 'only_fields': ['report']},",
        "            )",
        "            template_tasks = (response.json().get('data') or {}).get('tasks') or []",
        "            base_markdown = (template_tasks[0].get('report') if template_tasks else '') or ''",
        "            if base_markdown:",
        "                sections.append(base_markdown)",
        "        except Exception as error:",
        "            sections.append('<!-- template report unavailable: ' + _redact(str(error)) + ' -->')",
        "",
        "    sections.append('# ' + title)",
        "",
        "    for raw_source in artifact_sources:",
        "        source = str(raw_source)",
        "        rendered = None",
        "        if '.' in source:",
        "            source_task_id, _, artifact_name = source.partition('.')",
        "            try:",
        "                other = Task.get_task(task_id=source_task_id)",
        "                artifact = (other.artifacts or {}).get(artifact_name)",
        "                if artifact is not None:",
        "                    preview = getattr(artifact, 'preview', None)",
        "                    url = getattr(artifact, 'url', None)",
        "                    rendered = '## ' + artifact_name + '\\n\\n'",
        "                    if preview:",
        "                        rendered += '```\\n' + _redact(str(preview)[:4000]) + '\\n```'",
        "                    elif url:",
        "                        rendered += '[' + artifact_name + '](' + _redact(str(url)) + ')'",
        "                    else:",
        "                        rendered += '_(artifact has no preview)_'",
        "            except Exception as error:",
        "                rendered = '## ' + source + '\\n\\n_(unavailable: ' + _redact(str(error)) + ')_'",
        "        if rendered is None:",
        "            rendered = '- ' + source",
        "        sections.append(rendered)",
        "",
        "    content = '\\n\\n'.join(part for part in sections if part)",
        "",
        "    create_payload = {'name': title}",
        "    project_id = getattr(task, 'project', None)",
        "    if project_id:",
        "        create_payload['project'] = project_id",
        "    created = session.send_request(",
        "        'reports', 'create', method='post', json=create_payload,",
        "    )",
        "    report_id = (created.json().get('data') or {}).get('id')",
        "    if report_id:",
        "        session.send_request(",
        "            'reports', 'update', method='post',",
        "            json={'task': report_id, 'report': content},",
        "        )",
        "    if task is not None:",
        "        try:",
        "            task.get_logger().report_text('ClearPipe report created: ' + str(report_id))",
        "        except Exception:",
        "            pass",
        "    return report_id",
    ]
    return "\n".join(lines) + "\n"
