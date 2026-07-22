def normalize(value: int, increment: int = 1) -> int:
    return value + increment

pipe.add_function_step(
    name="normalize",
    function=normalize,
    function_kwargs={"value": 41, "increment": 1},
    function_return=["normalized"],
    task_type=TaskTypes.data_processing,
    cache_executed_step=True,
)

def format_result(value: int, prefix: str = 'result=') -> str:
    return f"{prefix}{value}"

pipe.add_function_step(
    name="format_result",
    function=format_result,
    function_kwargs={"value": "${normalize.normalized}", "prefix": "result="},
    function_return=["text"],
    task_type=TaskTypes.qc,
    cache_executed_step=True,
    parents=["normalize"],
)
