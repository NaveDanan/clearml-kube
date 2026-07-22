from __future__ import annotations

import ast
from difflib import unified_diff
from pathlib import Path


class GoldenMismatch(AssertionError):
    """Raised when a generated definition changes Python semantics."""


_REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
_GOLDEN_DIRECTORY = _REPOSITORY_ROOT / "clearpipe-task-plan" / "fixtures" / "cp-03"


def golden_fixture(name: str) -> Path:
    if Path(name).name != name:
        raise GoldenMismatch("golden fixture names must not contain a path")
    path = _GOLDEN_DIRECTORY / name
    if not path.is_file():
        raise GoldenMismatch(f"missing golden fixture: {name}")
    return path


def canonical_python(source: str) -> str:
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise GoldenMismatch(f"generated source is not valid Python: {exc.msg}") from exc
    return ast.dump(tree, annotate_fields=True, include_attributes=False)


def assert_python_golden(actual_source: str, expected_path: Path) -> None:
    expected_source = expected_path.read_text(encoding="utf-8")
    expected = canonical_python(expected_source)
    actual = canonical_python(actual_source)
    if actual == expected:
        return
    diff = "\n".join(
        unified_diff(
            expected.splitlines(),
            actual.splitlines(),
            fromfile=str(expected_path),
            tofile="generated",
            lineterm="",
        )
    )
    raise GoldenMismatch(f"generated Python differs semantically from its golden:\n{diff}")
