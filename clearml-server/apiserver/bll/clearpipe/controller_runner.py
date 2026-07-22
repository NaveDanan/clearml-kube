"""Source template embedded into every ClearPipe controller task.

The generated task has no dependency on ClearML Server's Python package. It
only requires the public ``clearml`` SDK already supported by ClearML Agent.
The scheduler classes intentionally live inside the template so the exact code
that runs remotely can be compiled and exercised in server tests.
"""

RUNNER_SOURCE = r'''
import json
import os
import re
import subprocess
import tempfile
import time
from collections import defaultdict


TERMINAL = {"completed", "failed", "stopped", "closed", "published"}
SUCCESS = {"completed", "closed", "published"}


CHILD_SOURCE = r"""
import json
import os
import re
import subprocess
import tempfile
import urllib.request
from pathlib import Path

from clearml import Dataset, Task


def run_command(command, env=None):
    if isinstance(command, str):
        command = [command]
    subprocess.run(command, check=True, env=env)


def manifest(task, values):
    path = Path(tempfile.mkdtemp(prefix="clearpipe-manifest-")) / "manifest.json"
    path.write_text(json.dumps(values, indent=2, sort_keys=True))
    task.upload_artifact("clearpipe_manifest", artifact_object=str(path))


def dataset(task, config, inputs):
    source = config.get("source")
    result = {"source": source}
    dataset_id = config.get("datasetId") or config.get("selectedDatasetId")
    if source == "clearml" and dataset_id:
        result.update(dataset_id=dataset_id, path=Dataset.get(dataset_id=dataset_id).get_local_copy())
    elif config.get("taskId") and config.get("artifact"):
        artifact = Task.get_task(task_id=config["taskId"]).artifacts[config["artifact"]]
        result.update(task_id=config["taskId"], artifact=config["artifact"], path=artifact.get_local_copy())
    elif source == "url":
        target = Path(tempfile.mkdtemp(prefix="clearpipe-url-")) / (config.get("filename") or "download")
        urllib.request.urlretrieve(config["path"], target)
        result["path"] = str(target)
    elif config.get("artifactUri"):
        result["artifact_uri"] = config["artifactUri"]
    else:
        result["storage_uri"] = config.get("path")
    manifest(task, result)


def versioning(task, config, inputs):
    tool = config.get("tool")
    action = config.get("clearmlAction")
    if tool == "clearml-data":
        if action in {"download", "list"}:
            ds = Dataset.get(dataset_id=config.get("selectedDatasetId"))
            result = {"dataset_id": ds.id, "path": ds.get_local_copy() if action == "download" else None}
        else:
            parent = config.get("selectedDatasetId") if action == "version" else None
            ds = Dataset.create(
                dataset_name=config.get("newDatasetName") or "ClearPipe dataset",
                dataset_project=config.get("newDatasetProject"),
                parent_datasets=[parent] if parent else None,
            )
            for path in config.get("inputPaths") or [config.get("inputPath")]:
                if path:
                    ds.add_files(path)
            ds.upload()
            ds.finalize()
            result = {"dataset_id": ds.id}
        manifest(task, result)
        return
    commands = {
        "dvc": ["dvc", config.get("action", "status")],
        "git-lfs": ["git", "lfs", config.get("action", "pull")],
        "mlflow-artifacts": ["mlflow", "artifacts", config.get("action", "download")],
    }
    command = config.get("command") if tool == "custom" else commands.get(tool)
    if not command:
        raise ValueError("Unsupported versioning operation")
    run_command(command)
    manifest(task, {"tool": tool, "version": config.get("version")})


def execute(task, config, inputs):
    env = os.environ.copy()
    for key, value in inputs.items():
        safe = re.sub(r"[^A-Za-z0-9_]", "_", key).upper()
        env["CLEARPIPE_" + safe] = json.dumps(value) if not isinstance(value, str) else value
    outputs = []
    for step in config.get("steps") or []:
        if not step.get("enabled", True):
            continue
        inline = step.get("inlineScript")
        path = step.get("scriptPath")
        if inline:
            script = Path(tempfile.mkdtemp(prefix="clearpipe-execute-")) / "step.py"
            script.write_text(inline)
            path = str(script)
        if path:
            run_command([os.environ.get("PYTHON", "python"), path], env=env)
        outputs.extend(step.get("outputVariables") or [])
    values = {name: env.get(name) for name in outputs if env.get(name)}
    manifest(task, {"outputs": values})


def training(task, config, inputs):
    # Training nodes created from an existing task are cloned by the controller.
    # This adapter handles repository/inline definitions.
    git = config.get("gitConfig") or {}
    script = git.get("entryScript") or config.get("localScriptPath") or config.get("inlineScript")
    if config.get("scriptArtifactTaskId") and config.get("scriptArtifact"):
        script = Task.get_task(task_id=config["scriptArtifactTaskId"]).artifacts[
            config["scriptArtifact"]
        ].get_local_copy()
    if not script:
        raise ValueError("Training script is missing")
    if "\n" in script:
        target = Path(tempfile.mkdtemp(prefix="clearpipe-training-")) / "train.py"
        target.write_text(script)
        script = str(target)
    params = config.get("parameterValues") or {}
    args = [os.environ.get("PYTHON", "python"), script]
    for name, value in params.items():
        args.extend(["--" + str(name).replace("_", "-"), str(value)])
    run_command(args)


def experiment(task, config, inputs):
    tracker = config.get("tracker", "clearml")
    if tracker == "clearml":
        task.set_tags(list(set((task.get_tags() or []) + (config.get("tags") or []))))
        manifest(task, {"tracker": "clearml", "project": config.get("projectName")})
        return
    commands = {
        "mlflow": ["mlflow", "artifacts", "download"],
        "wandb": ["wandb", "sync", config.get("runPath", ".")],
        "comet": ["python", "-m", "comet_ml", config.get("runPath", ".")],
    }
    run_command(config.get("command") or commands[tracker])
    manifest(task, {"tracker": tracker})


def report(task, config, inputs):
    fmt = config.get("outputFormat", "html")
    suffix = {"markdown": ".md", "json": ".json", "pdf": ".pdf"}.get(fmt, ".html")
    path = Path(tempfile.mkdtemp(prefix="clearpipe-report-")) / ("report" + suffix)
    title = config.get("title", "ClearPipe report")
    sections = config.get("customSections") or []
    if fmt == "json":
        path.write_text(json.dumps({"title": title, "inputs": inputs, "sections": sections}, indent=2))
    elif fmt == "pdf":
        text = (title + "\n" + "\n".join(str(item.get("content", "")) for item in sections))[:2000]
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").replace("\n", ") Tj 0 -14 Td (")
        stream = ("BT /F1 12 Tf 50 760 Td (" + escaped + ") Tj ET").encode("latin-1", "replace")
        objects = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        ]
        pdf = bytearray(b"%PDF-1.4\n")
        offsets = [0]
        for index, obj in enumerate(objects, 1):
            offsets.append(len(pdf))
            pdf.extend((str(index) + " 0 obj\n").encode() + obj + b"\nendobj\n")
        xref = len(pdf)
        pdf.extend(("xref\n0 " + str(len(objects) + 1) + "\n0000000000 65535 f \n").encode())
        for offset in offsets[1:]:
            pdf.extend((f"{offset:010d} 00000 n \n").encode())
        pdf.extend(("trailer << /Size " + str(len(objects) + 1) + " /Root 1 0 R >>\nstartxref\n" + str(xref) + "\n%%EOF\n").encode())
        path.write_bytes(pdf)
    else:
        content = "# " + title + "\n\n" + "\n\n".join(str(item.get("content", "")) for item in sections)
        if fmt == "html":
            content = "<html><body><h1>" + title + "</h1><pre>" + content + "</pre></body></html>"
        path.write_text(content)
    task.upload_artifact("clearpipe_report", artifact_object=str(path))
    manifest(task, {"report": str(path), "format": fmt})


def main():
    task = Task.current_task()
    config = task.get_configuration_object("ClearPipeNode") or {}
    inputs = task.get_configuration_object("ClearPipeInputs") or {}
    node_type = config.pop("_node_type")
    adapters = {
        "dataset": dataset,
        "versioning": versioning,
        "execute": execute,
        "training": training,
        "experiment": experiment,
        "experiment_tracking": experiment,
        "report": report,
    }
    adapters[node_type](task, config, inputs)


if __name__ == "__main__":
    main()
"""


def node_data(node):
    data = node.get("data")
    return data if isinstance(data, dict) else node


class DagRunner:
    def __init__(self, graph, backend, parameters=None, node_queues=None, poll_interval=2):
        self.graph = graph
        self.backend = backend
        self.parameters = parameters or {}
        self.node_queues = node_queues or {}
        self.poll_interval = poll_interval
        self.nodes = {str(node["id"]): node for node in graph.get("nodes", [])}
        self.parents = defaultdict(set)
        self.children = defaultdict(set)
        for edge in graph.get("edges", []):
            self.parents[str(edge["target"])].add(str(edge["source"]))
            self.children[str(edge["source"])].add(str(edge["target"]))

    def run(self):
        state = {node_id: "pending" for node_id in self.nodes}
        attempts = defaultdict(int)
        handles = {}
        launched_at = {}
        transient_errors = defaultdict(int)
        restore = getattr(self.backend, "restore", None)
        if restore:
            for node_id in self.nodes:
                restored = restore(node_id)
                if not restored:
                    continue
                handle, status = restored
                handles[node_id] = handle
                state[node_id] = status
                launched_at[node_id] = time.time()
        while True:
            if self.backend.cancelled():
                for node_id, handle in handles.items():
                    if state[node_id] not in TERMINAL:
                        self.backend.cancel(handle)
                raise RuntimeError("ClearPipe controller was cancelled")

            progressed = False
            for node_id, handle in list(handles.items()):
                if state[node_id] in TERMINAL:
                    continue
                try:
                    status = self.backend.status(handle)
                    transient_errors[node_id] = 0
                except Exception:
                    transient_errors[node_id] += 1
                    if transient_errors[node_id] < 5:
                        continue
                    status = "failed"
                timeout = (node_data(self.nodes[node_id]).get("config") or {}).get("timeout")
                if timeout and time.time() - launched_at.get(node_id, time.time()) > float(timeout):
                    self.backend.cancel(handle)
                    status = "failed"
                if status in TERMINAL:
                    state[node_id] = status
                    self.backend.update_pipeline(node_id, handle, status)
                    progressed = True
                    if status not in SUCCESS:
                        config = node_data(self.nodes[node_id]).get("config") or {}
                        retries = int(config.get("retries", 0) or 0)
                        if attempts[node_id] <= retries:
                            state[node_id] = "pending"
                            handles.pop(node_id, None)

            for node_id, node in self.nodes.items():
                if state[node_id] != "pending":
                    continue
                parent_states = [state[parent] for parent in self.parents[node_id]]
                if any(status in TERMINAL and status not in SUCCESS for status in parent_states):
                    config = node_data(node).get("config") or {}
                    if not config.get("continueOnFail", False):
                        state[node_id] = "stopped"
                        self.backend.update_pipeline(node_id, None, "aborted")
                        progressed = True
                        continue
                config = node_data(node).get("config") or {}
                ready = (
                    all(status in TERMINAL for status in parent_states)
                    if config.get("continueOnFail", False)
                    else all(status in SUCCESS for status in parent_states)
                )
                if not ready:
                    continue
                inputs = {
                    parent: self.backend.outputs(handles[parent])
                    for parent in self.parents[node_id]
                    if parent in handles and state[parent] in SUCCESS
                }
                attempts[node_id] += 1
                queue = self.node_queues.get(node_id) or (node_data(node).get("config") or {}).get("queue")
                handle = self.backend.launch(node, inputs, self.parameters, queue)
                handles[node_id] = handle
                launched_at[node_id] = time.time()
                state[node_id] = "queued"
                self.backend.update_pipeline(node_id, handle, "queued")
                progressed = True

            if all(status in TERMINAL for status in state.values()):
                failed = [node_id for node_id, status in state.items() if status not in SUCCESS]
                if failed:
                    raise RuntimeError("ClearPipe nodes failed or aborted: " + ", ".join(failed))
                return {node_id: self.backend.handle_id(handle) for node_id, handle in handles.items()}
            if not progressed:
                time.sleep(self.poll_interval)


class ClearMLBackend:
    def __init__(self, controller):
        from clearml import Task

        self.Task = Task
        self.controller = controller
        self.project_name = controller.get_project_name()
        pipeline = controller.get_configuration_object("Pipeline") or {}
        self.pipeline = json.loads(pipeline) if isinstance(pipeline, str) else pipeline

    def cancelled(self):
        try:
            self.controller.reload()
        except Exception:
            pass
        return str(getattr(self.controller, "status", "")).lower() in {"stopped", "failed"}

    def launch(self, node, inputs, parameters, queue):
        data = node_data(node)
        config = dict(data.get("config") or {})
        merged = dict(config.get("parameterValues") or {})
        merged.update(parameters.get(str(node["id"]), parameters.get("global", {})))
        base_task_id = config.get("taskId") or config.get("baseTaskId")
        if base_task_id:
            child = self.Task.clone(source_task=base_task_id, parent=self.controller.id)
        elif data.get("type") == "training" and (config.get("gitConfig") or {}).get("repoUrl"):
            git = config["gitConfig"]
            child = self.Task.create(
                project_name=self.project_name,
                task_name=data.get("label") or str(node["id"]),
                task_type="training",
                repo=git["repoUrl"],
                branch=git.get("branch"),
                commit=git.get("commitId"),
                script=git.get("entryScript"),
                packages=config.get("packages") or ["clearml>=1.16"],
                argparse_args=merged or None,
            )
            child._edit(parent=self.controller.id)
        else:
            folder = tempfile.mkdtemp(prefix="clearpipe-child-")
            path = os.path.join(folder, "clearpipe_node.py")
            with open(path, "w", encoding="utf-8") as stream:
                stream.write(CHILD_SOURCE)
            child = self.Task.create(
                project_name=self.project_name,
                task_name=data.get("label") or str(node["id"]),
                task_type={"training": "training", "report": "report", "experiment": "monitor"}.get(data.get("type"), "data_processing"),
                script=path,
                packages=config.get("packages") or ["clearml>=1.16"],
                force_single_script_file=True,
            )
            child._edit(parent=self.controller.id)
        config["_node_type"] = data.get("type")
        child.set_configuration_object("ClearPipeNode", config)
        child.set_configuration_object("ClearPipeInputs", inputs)
        if merged:
            child.set_parameters_as_dict({"ClearPipe": merged})
        self.Task.enqueue(child, queue_id=queue) if queue else self.Task.enqueue(child, queue_name="default")
        return child

    def restore(self, node_id):
        step = self.pipeline.get(node_id) or {}
        child_id = step.get("job_id")
        if not child_id:
            return None
        try:
            child = self.Task.get_task(task_id=child_id)
            child.reload()
            return child, str(child.status).lower()
        except Exception:
            # A missing recorded child is a deterministic failure and must not
            # create a duplicate child after controller restart.
            return _MissingChild(child_id), "failed"

    def status(self, child):
        child.reload()
        return str(child.status).lower()

    def outputs(self, child):
        child.reload()
        outputs = {}
        for name, artifact in (child.artifacts or {}).items():
            outputs[name] = {"uri": getattr(artifact, "url", None), "task_id": child.id}
        return outputs

    def cancel(self, child):
        child.mark_stopped(force=True, status_reason="ClearPipe controller cancelled")

    @staticmethod
    def handle_id(child):
        return child.id

    def update_pipeline(self, node_id, child, status):
        step = self.pipeline.setdefault(node_id, {"parents": []})
        step["job_id"] = getattr(child, "id", None)
        step["status"] = status
        self.controller.set_configuration_object("Pipeline", self.pipeline)


class _MissingChild:
    def __init__(self, child_id):
        self.id = child_id

    def reload(self):
        return None


def main():
    from clearml import Task

    controller = Task.current_task()
    parameters = controller.get_parameters_as_dict(cast=True).get("ClearPipe", {})
    graph = json.loads(CLEARPIPE_GRAPH)
    node_queues = graph.get("default_queues") or {}
    DagRunner(graph, ClearMLBackend(controller), parameters, node_queues).run()


if __name__ == "__main__":
    main()
'''
