import ast
import re
from typing import Any, Dict, List

from .validation import MAX_INLINE_SCRIPT_BYTES


def _literal(node):
    try:
        return ast.literal_eval(node)
    except (ValueError, TypeError):
        return None


def _arg_type(node) -> str:
    if isinstance(node, ast.Name) and node.id in {"int", "float", "str", "bool", "list"}:
        return node.id
    return "unknown"


def parse_python_script(script: str) -> dict:
    if not isinstance(script, str):
        raise ValueError("script must be a string")
    size = len(script.encode("utf-8"))
    if size > MAX_INLINE_SCRIPT_BYTES:
        raise ValueError(f"script exceeds {MAX_INLINE_SCRIPT_BYTES} bytes")
    try:
        tree = ast.parse(script)
    except (SyntaxError, ValueError, RecursionError, MemoryError) as ex:
        if not isinstance(ex, SyntaxError):
            raise ValueError("script could not be parsed safely") from ex
        raise ValueError(f"invalid Python syntax at line {ex.lineno}: {ex.msg}") from ex

    parameters: Dict[str, dict] = {}
    environment = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr == "add_argument" and node.args:
                raw_name = _literal(node.args[0])
                if not isinstance(raw_name, str):
                    continue
                name = raw_name.lstrip("-").replace("-", "_")
                keywords = {kw.arg: kw.value for kw in node.keywords if kw.arg}
                choices = _literal(keywords.get("choices")) if keywords.get("choices") else None
                parameters[name] = {
                    "name": name,
                    "type": _arg_type(keywords.get("type")),
                    "default": _literal(keywords.get("default")) if keywords.get("default") else None,
                    "help": _literal(keywords.get("help")) if keywords.get("help") else None,
                    "choices": list(choices) if isinstance(choices, (list, tuple, set)) else None,
                    "required": bool(_literal(keywords.get("required"))) if keywords.get("required") else False,
                    "source": "argparse",
                }
            if node.func.attr in {"getenv", "get"} and node.args:
                owner = node.func.value
                is_env = (
                    isinstance(owner, ast.Attribute)
                    and isinstance(owner.value, ast.Name)
                    and owner.value.id == "os"
                    and owner.attr == "environ"
                ) or (isinstance(owner, ast.Name) and owner.id == "os" and node.func.attr == "getenv")
                if is_env:
                    name = _literal(node.args[0])
                    if isinstance(name, str):
                        environment.append(name)

    imports = sorted(
        {
            alias.name.split(".")[0]
            for node in tree.body
            if isinstance(node, (ast.Import, ast.ImportFrom))
            for alias in (node.names if isinstance(node, ast.Import) else [ast.alias(name=node.module or "")])
            if alias.name
        }
    )
    return {
        "valid": True,
        "parameters": list(parameters.values()),
        "environment": sorted(set(environment)),
        "imports": imports,
        "line_count": script.count("\n") + 1,
    }
