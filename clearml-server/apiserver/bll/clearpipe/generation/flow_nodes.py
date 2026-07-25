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
    if meta and meta.get("type") == "task":
        return _lower_task_node(lowering, meta)
    if meta and meta.get("type") == "report":
        return _lower_report_node(lowering, meta)
    return lower_function_node(lowering)


# --------------------------------------------------------------------------- #
# Task node -> real PipelineController.add_step (clone the selected base task).
# --------------------------------------------------------------------------- #


def _resolve_base_task_id(config: dict) -> Optional[str]:
    """Return the single base task id for a Task node.

    Prefers the graph-aware ``baseTaskId``; falls back to a one-item legacy
    ``taskIds`` array so pre-migration graphs keep lowering to a real step.
    Multi-item legacy arrays are ambiguous and are NOT resolved here (the web
    migration blocks them with a "Split into Task nodes" action).
    """

    base = config.get("baseTaskId")
    if isinstance(base, str) and base.strip():
        return base.strip()
    legacy = config.get("taskIds")
    if isinstance(legacy, list):
        ids = [str(item).strip() for item in legacy if isinstance(item, str) and item.strip()]
        if len(ids) == 1:
            return ids[0]
    return None


def _render_task_step(
    node_name: str, base_task_id: str, execution_queue: Optional[str], parents
) -> str:
    """Render ``pipe.add_step(...)`` cloning the base task on its queue."""

    lines = [
        "pipe.add_step(",
        "    name={},".format(_python_literal(node_name)),
        "    base_task_id={},".format(_python_literal(base_task_id)),
    ]
    if execution_queue is not None:
        lines.append("    execution_queue={},".format(_python_literal(execution_queue)))
    if parents:
        lines.append("    parents={},".format(_python_literal(list(parents))))
    lines.append(")")
    return "\n".join(lines) + "\n"


def _lower_task_node(
    lowering: FunctionLoweringInput, meta: dict
) -> FunctionStepLowering:
    """Lower a Task flow node into a real cloned-base-task pipeline step.

    A configured Task node lowers to ``PipelineController.add_step`` cloning its
    single ``baseTaskId`` on its execution queue. An unconfigured Task node (no
    base task) preserves the backward-compatible no-op function step.
    """

    base = lower_function_node(lowering)
    node = lowering.node
    node_id = getattr(node, "id", "")
    path = "graph.nodes.{}".format(node_id or "unknown")
    config = meta.get("config") if isinstance(meta.get("config"), dict) else {}

    base_task_id = _resolve_base_task_id(config)
    if not base_task_id:
        # No base task selected yet -> keep the generic no-op step.
        return base

    execution_queue = _execution_queue(lowering, path, node_id)
    parents = _canonical_parents(lowering, set(), path, node_id)
    step_source = _render_task_step(node.name, base_task_id, execution_queue, parents)
    return replace(
        base,
        definition_source="",
        step_source=step_source,
        source=step_source,
    )


def _sanitize_mappings(raw: object) -> dict:
    """Return a JSON-safe {slotKey: {taskId,kind,ref,metric?,variant?}} dict.

    The web config panel stores template-fill mappings as an object keyed by
    template slot (``text:<TOKEN>`` / ``media:<iframe-name>``). We keep only the
    recognised primitive fields so the value serializes cleanly into the
    generated function source.
    """

    if not isinstance(raw, dict):
        return {}
    result = {}
    for slot_key, mapping in raw.items():
        if not isinstance(slot_key, str) or not isinstance(mapping, dict):
            continue
        clean = {}
        for field in ("taskId", "kind", "ref", "metric", "variant"):
            value = mapping.get(field)
            if isinstance(value, (str, int, float)) or value is None:
                clean[field] = value
        if clean.get("taskId") and clean.get("ref"):
            result[slot_key] = clean
    return result


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

    report_mappings = _sanitize_report_mappings(config.get("reportMappings"))
    sources = _report_source_params(lowering)

    if report_mappings or sources:
        # Graph-aware path: bind to upstream Task nodes and substitute their
        # runtime cloned task ids via ${step_name.id} kwargs.
        template_fingerprint = config.get("templateFingerprint")
        if not isinstance(template_fingerprint, str):
            template_fingerprint = ""
        function_kwargs = tuple(
            (param, "${" + step + ".id}") for (_nid, step, param) in sources
        )
        definition_source = _render_report_function_v2(
            node.name,
            title,
            template_report_id,
            template_fingerprint,
            report_mappings,
            sources,
        )
    else:
        # Legacy path: fixed taskId-keyed mappings + artifact sources.
        artifact_sources = [
            str(item)
            for item in (config.get("artifactSources") or [])
            if isinstance(item, (str, int, float))
        ]
        mappings = _sanitize_mappings(config.get("mappings"))
        function_kwargs = ()
        definition_source = _render_report_function(
            node.name, title, template_report_id, artifact_sources, mappings
        )

    execution_queue = _execution_queue(lowering, path, node_id)
    parents = _canonical_parents(lowering, set(), path, node_id)
    packages, retry_on_failure = _optional_execution_settings(node, path, node_id)
    task_type = getattr(getattr(node, "configuration", None), "task_type", "application")

    step_source = _render_step(
        controller_name="pipe",
        node_name=node.name,
        function_kwargs=function_kwargs,
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


_REPORT_OUTPUT_KINDS = frozenset(
    ("field", "scalar", "scalar_graph", "plot", "image", "artifact")
)


def _sanitize_report_mappings(raw: object) -> list:
    """Return a JSON-safe list of graph-aware Report slot mappings.

    Each entry keeps only recognised primitive fields and a source that is
    either a pipeline ``sourceNodeId`` or an advanced fixed ``externalTaskId``.
    Runtime task ids are never present here; the graph binds to a source node.
    """

    if not isinstance(raw, list):
        return []
    result = []
    for mapping in raw:
        if not isinstance(mapping, dict):
            continue
        slot_key = mapping.get("slotKey")
        if not isinstance(slot_key, str) or not slot_key:
            continue
        kind = mapping.get("outputKind")
        if kind not in _REPORT_OUTPUT_KINDS:
            continue
        raw_source = mapping.get("source") if isinstance(mapping.get("source"), dict) else {}
        source = {}
        node_ref = raw_source.get("sourceNodeId")
        external_ref = raw_source.get("externalTaskId")
        if isinstance(node_ref, str) and node_ref:
            source["sourceNodeId"] = node_ref
        elif isinstance(external_ref, str) and external_ref:
            source["externalTaskId"] = external_ref
        raw_selector = mapping.get("selector") if isinstance(mapping.get("selector"), dict) else {}
        selector = {}
        for field in ("metric", "variant", "artifactKey", "field"):
            value = raw_selector.get(field)
            if isinstance(value, str) and value:
                selector[field] = value
        clean = {
            "slotKey": slot_key,
            "source": source,
            "outputKind": kind,
            "selector": selector,
            "required": bool(mapping.get("required", True)),
            "confirmed": bool(mapping.get("confirmed", False)),
        }
        if mapping.get("ignored"):
            clean["ignored"] = True
        result.append(clean)
    return result


def _report_source_params(lowering: FunctionLoweringInput) -> list:
    """Return ordered (source_node_id, step_name, param_name) for connected Task nodes.

    Only directly connected pipeline Task nodes are report sources; each gets a
    stable ``s<index>`` runtime-argument name whose value is ``${step_name.id}``.
    """

    nodes = {getattr(item, "id", None): item for item in lowering.graph.nodes}
    sources = []
    index = 0
    for parent_id in lowering.parent_node_ids:
        parent = nodes.get(parent_id)
        if parent is None:
            continue
        parent_meta = flow_node_meta(parent)
        if parent_meta and parent_meta.get("type") == "task":
            sources.append((parent_id, parent.name, "s{}".format(index)))
            index += 1
    return sources


def _render_report_function(
    name: str, title: str, template_report_id: str, artifact_sources: list, mappings: dict = None
) -> str:
    """Render the module-level report-building function for a Report node."""

    title_literal = _python_literal(title)
    template_literal = _python_literal(template_report_id)
    sources_literal = _python_literal(list(artifact_sources))
    mappings_literal = _python_literal(mappings or {})

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
        "    mappings = {}".format(mappings_literal),
        "    def _task_lookup(ids):",
        "        ids = [i for i in ids if i]",
        "        if not ids:",
        "            return {}",
        "        try:",
        "            resp = session.send_request(",
        "                'tasks', 'get_all_ex', method='post',",
        "                json={'id': ids, 'page': 0, 'page_size': 100,",
        "                      'only_fields': ['id', 'name', 'status', 'company',",
        "                                      'project.name', 'started', 'completed',",
        "                                      'last_iteration', 'last_metrics',",
        "                                      'hyperparams', 'execution.artifacts']},",
        "            )",
        "            found = (resp.json().get('data') or {}).get('tasks') or []",
        "        except Exception:",
        "            found = []",
        "        return {t.get('id'): t for t in found if t.get('id')}",
        "    def _resolve_text(mp, td):",
        "        if not td:",
        "            return ''",
        "        kind = mp.get('kind')",
        "        ref = mp.get('ref') or ''",
        "        if kind == 'field':",
        "            if ref == 'project':",
        "                proj = td.get('project') or {}",
        "                return str((proj.get('name') if isinstance(proj, dict) else proj) or '')",
        "            if ref == 'iteration':",
        "                return str(td.get('last_iteration') or '')",
        "            return str(td.get(ref) or '')",
        "        if kind == 'hyperparam':",
        "            section, _, pname = ref.partition('/')",
        "            entry = ((td.get('hyperparams') or {}).get(section) or {}).get(pname) or {}",
        "            return str(entry.get('value') or '')",
        "        if kind == 'scalar':",
        "            metric = mp.get('metric'); variant = mp.get('variant')",
        "            for group in (td.get('last_metrics') or {}).values():",
        "                for v in (group or {}).values():",
        "                    if v.get('metric') == metric and (not variant or v.get('variant') == variant):",
        "                        val = v.get('value')",
        "                        if val is None: val = v.get('max_value')",
        "                        if val is None: val = v.get('min_value')",
        "                        return str(val) if val is not None else ''",
        "            return ''",
        "        if kind == 'artifact':",
        "            key = ref.split('\\x00')[-1]",
        "            for art in ((td.get('execution') or {}).get('artifacts') or []):",
        "                if art.get('key') == key:",
        "                    return str(art.get('uri') or art.get('key') or '')",
        "            return ''",
        "        return ''",
        "    if mappings:",
        "        _lookup = _task_lookup([mp.get('taskId') for mp in mappings.values()])",
        "        for _slot, _mp in mappings.items():",
        "            if not _slot.startswith('text:'):",
        "                continue",
        "            _token = _slot[len('text:'):]",
        "            _value = _redact(_resolve_text(_mp, _lookup.get(_mp.get('taskId'))))",
        "            content = content.replace('<' + _token + '>', _value)",
        "        _auto = [0]",
        "        def _rewrite_iframe(match):",
        "            block = match.group(0)",
        "            name_match = re.search(r'name\\s*=\\s*\"([^\"]+)\"', block)",
        "            if name_match:",
        "                key = 'media:' + name_match.group(1)",
        "            else:",
        "                _auto[0] += 1",
        "                key = 'media:embed-' + str(_auto[0])",
        "            mp = mappings.get(key)",
        "            if not isinstance(mp, dict):",
        "                return block",
        "            td = _lookup.get(mp.get('taskId')) or {}",
        "            company = td.get('company')",
        "            if isinstance(company, dict):",
        "                company = company.get('id')",
        "            metric = str(mp.get('metric') or '')",
        "            variant = str(mp.get('variant') or '')",
        "            from urllib.parse import quote as _uq",
        "            def _e(v):",
        "                return _uq(str(v if v is not None else ''), safe='')",
        "            repl = {",
        "                '<TASK_ID>': _e(mp.get('taskId')),",
        "                '<COMPANY_ID>': _e(company),",
        "                '<METRIC>': _e(metric),",
        "                '<PLOT_METRIC>': _e(metric),",
        "                '<IMAGE_METRIC>': _e(metric),",
        "                '<SCALAR_METRIC>': _e(metric),",
        "                '<VARIANT>': _e(variant),",
        "                '<PLOT_VARIANT>': _e(variant),",
        "                '<IMAGE_VARIANT>': _e(variant),",
        "                '<SCALAR_VARIANT>': _e(variant),",
        "            }",
        "            for tok, val in repl.items():",
        "                block = block.replace(tok, val)",
        "            block = block.replace('/widgets?', '/widgets/?')",
        "            return block",
        "        content = re.sub(r'<iframe\\b.*?</iframe>', _rewrite_iframe, content, flags=re.IGNORECASE | re.DOTALL)",
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


def _render_report_function_v2(
    name: str,
    title: str,
    template_report_id: str,
    template_fingerprint: str,
    report_mappings: list,
    sources: list,
) -> str:
    """Render the graph-aware report function that binds to upstream Task nodes.

    The function receives one runtime argument per pipeline source (``${step.id}``)
    and resolves every mapping from the newly cloned runtime task, never a base
    task id baked into the graph. Required missing outputs fail before the report
    is created; optional missing outputs publish with a "not reported" note.
    """

    params = [param for (_nid, _step, param) in sources]
    signature = "def {}({}) -> object:".format(
        name, ", ".join("{}=None".format(param) for param in params)
    ) if params else "def {}() -> object:".format(name)

    title_literal = _python_literal(title)
    template_literal = _python_literal(template_report_id)
    fingerprint_literal = _python_literal(template_fingerprint)
    mappings_literal = _python_literal(list(report_mappings))

    lines = [
        signature,
        "    import re",
        "    from clearml import Task",
        "    from urllib.parse import quote as _uq",
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
        "    def _e(v):",
        "        return _uq(str(v if v is not None else ''), safe='')",
        "    def _fingerprint(md):",
        "        md = md or ''",
        "        md = re.sub(r'<!--[\\s\\S]*?-->', ' ', md)",
        "        md = re.sub(r'```[\\s\\S]*?```', ' ', md)",
        "        md = re.sub(r'~~~[\\s\\S]*?~~~', ' ', md)",
        "        md = re.sub(r'\\s+', ' ', md).strip()",
        "        h = 0x811c9dc5",
        "        for ch in md:",
        "            h ^= ord(ch)",
        "            h = (h * 0x01000193) & 0xffffffff",
        "        return format(h, '08x')",
        "",
        "    title = {}".format(title_literal),
        "    template_report_id = {}".format(template_literal),
        "    template_fingerprint = {}".format(fingerprint_literal),
        "    mappings = {}".format(mappings_literal),
        "",
        "    runtime_task_ids = {}",
    ]
    for node_id, _step, param in sources:
        lines.append(
            "    runtime_task_ids[{}] = {}".format(_python_literal(node_id), param)
        )
    lines += [
        "    def _mapping_task_id(mp):",
        "        src = mp.get('source') or {}",
        "        nid = src.get('sourceNodeId')",
        "        if nid:",
        "            return runtime_task_ids.get(nid)",
        "        return src.get('externalTaskId')",
        "    def _task_lookup(ids):",
        "        ids = sorted({i for i in ids if i})",
        "        if not ids:",
        "            return {}",
        "        try:",
        "            resp = session.send_request(",
        "                'tasks', 'get_all_ex', method='post',",
        "                json={'id': ids, 'page': 0, 'page_size': 100,",
        "                      'only_fields': ['id', 'name', 'status', 'company',",
        "                                      'project.name', 'started', 'completed',",
        "                                      'last_iteration', 'last_metrics',",
        "                                      'execution.artifacts']},",
        "            )",
        "            found = (resp.json().get('data') or {}).get('tasks') or []",
        "        except Exception:",
        "            found = []",
        "        return {t.get('id'): t for t in found if t.get('id')}",
        "    def _resolve_text(kind, sel, td):",
        "        if kind == 'field':",
        "            f = sel.get('field') or ''",
        "            if f == 'project':",
        "                proj = td.get('project') or {}",
        "                return str((proj.get('name') if isinstance(proj, dict) else proj) or '')",
        "            if f == 'iteration':",
        "                return str(td.get('last_iteration') or '')",
        "            return str(td.get(f) or '')",
        "        if kind in ('scalar', 'scalar_graph'):",
        "            metric = sel.get('metric'); variant = sel.get('variant')",
        "            for group in (td.get('last_metrics') or {}).values():",
        "                for v in (group or {}).values():",
        "                    if v.get('metric') == metric and (not variant or v.get('variant') == variant):",
        "                        val = v.get('value')",
        "                        if val is None: val = v.get('max_value')",
        "                        if val is None: val = v.get('min_value')",
        "                        return str(val) if val is not None else ''",
        "            return ''",
        "        if kind == 'artifact':",
        "            key = sel.get('artifactKey') or ''",
        "            for art in ((td.get('execution') or {}).get('artifacts') or []):",
        "                if isinstance(art, dict) and art.get('key') == key:",
        "                    return str(art.get('uri') or art.get('key') or '')",
        "            return ''",
        "        return ''",
        "",
        "    _tasks = _task_lookup([_mapping_task_id(mp) for mp in mappings])",
        "",
        "    content = ''",
        "    if template_report_id:",
        "        try:",
        "            response = session.send_request(",
        "                'reports', 'get_all_ex', method='post',",
        "                json={'id': [template_report_id], 'only_fields': ['report']},",
        "            )",
        "            template_tasks = (response.json().get('data') or {}).get('tasks') or []",
        "            base_markdown = (template_tasks[0].get('report') if template_tasks else '') or ''",
        "        except Exception:",
        "            base_markdown = ''",
        "        if base_markdown:",
        "            if template_fingerprint and _fingerprint(base_markdown) != template_fingerprint:",
        "                raise RuntimeError('ClearPipe report template changed since mapping (fingerprint mismatch); re-open mapping before running.')",
        "            content = base_markdown",
        "    if not content:",
        "        content = '# ' + title",
        "",
        "    _media = {}",
        "    for mp in mappings:",
        "        slot = mp.get('slotKey') or ''",
        "        if slot.startswith('media:') and not mp.get('ignored'):",
        "            _media[slot[len('media:'):]] = mp",
        "",
        "    missing_required = []",
        "    not_reported = []",
        "",
        "    for mp in mappings:",
        "        if mp.get('ignored'):",
        "            continue",
        "        slot = mp.get('slotKey') or ''",
        "        if not slot.startswith('text:'):",
        "            continue",
        "        token = slot[len('text:'):]",
        "        tid = _mapping_task_id(mp)",
        "        td = _tasks.get(tid) or {}",
        "        value = _resolve_text(mp.get('outputKind'), mp.get('selector') or {}, td) if td else ''",
        "        if tid and value != '':",
        "            content = content.replace('<' + token + '>', _redact(str(value)))",
        "        elif mp.get('required'):",
        "            missing_required.append(slot)",
        "        else:",
        "            not_reported.append(slot)",
        "            content = content.replace('<' + token + '>', '_(not reported)_')",
        "",
        "    def _rewrite_iframe(match):",
        "        block = match.group(0)",
        "        name_match = re.search(r'name\\s*=\\s*\"([^\"]+)\"', block)",
        "        if not name_match:",
        "            return block",
        "        mp = _media.get(name_match.group(1))",
        "        if not isinstance(mp, dict):",
        "            return block",
        "        tid = _mapping_task_id(mp)",
        "        td = _tasks.get(tid) or {}",
        "        company = td.get('company')",
        "        if isinstance(company, dict):",
        "            company = company.get('id')",
        "        sel = mp.get('selector') or {}",
        "        metric = str(sel.get('metric') or '')",
        "        variant = str(sel.get('variant') or '')",
        "        repl = {",
        "            '<TASK_ID>': _e(tid),",
        "            '<COMPANY_ID>': _e(company),",
        "            '<METRIC>': _e(metric),",
        "            '<PLOT_METRIC>': _e(metric),",
        "            '<IMAGE_METRIC>': _e(metric),",
        "            '<SCALAR_METRIC>': _e(metric),",
        "            '<VARIANT>': _e(variant),",
        "            '<PLOT_VARIANT>': _e(variant),",
        "            '<IMAGE_VARIANT>': _e(variant),",
        "            '<SCALAR_VARIANT>': _e(variant),",
        "        }",
        "        for tok, val in repl.items():",
        "            block = block.replace(tok, val)",
        "        block = block.replace('/widgets?', '/widgets/?')",
        "        return block",
        "    content = re.sub(r'<iframe\\b.*?</iframe>', _rewrite_iframe, content, flags=re.IGNORECASE | re.DOTALL)",
        "",
        "    for _name, mp in _media.items():",
        "        if not _mapping_task_id(mp):",
        "            if mp.get('required'):",
        "                missing_required.append(mp.get('slotKey'))",
        "            else:",
        "                not_reported.append(mp.get('slotKey'))",
        "",
        "    if missing_required:",
        "        raise RuntimeError('ClearPipe report missing required outputs: ' + ', '.join(sorted(set(missing_required))))",
        "",
        "    if not_reported:",
        "        content += '\\n\\n> _Not reported: ' + ', '.join(sorted(set(not_reported))) + '_'",
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
        "            if not_reported:",
        "                task.get_logger().report_text('ClearPipe optional outputs not reported: ' + ', '.join(sorted(set(not_reported))))",
        "        except Exception:",
        "            pass",
        "    return report_id",
    ]
    return "\n".join(lines) + "\n"
