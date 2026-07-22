from clearml import PipelineController, TaskTypes

# ClearPipe graph schema v2 sha256:27915552fb6c94cb257b4e01755c35e974caaea7d77782815b5fd47dd305abb0

def split_data(value: str = "input", prefix: str = 'a\b"c') -> tuple[str, str]:
    return (f"{prefix}{value}", value.upper())

pipe = PipelineController(
    name="generator_packet",
    project="clearpipe-tests",
    version="1.0.0",
    add_pipeline_tags=False,
)

pipe.set_default_execution_queue("default")

pipe.add_parameter(
    name="task_threshold",
    default=0.75,
)

pipe.add_parameter(
    name="prefix",
    default="a\\b\"c",
)

pipe.add_step(
    name="extract_data",
    base_task_id="base-task-\"extract\"",
    parameter_override={"General/threshold": "${pipeline.task_threshold}"},
    execution_queue="gpu-fast",
    clone_base_task=False,
    cache_executed_step=True,
    retry_on_failure=2,
)

pipe.add_step(
    name="publish_model",
    parents=["extract_data"],
    base_task_id="base-task-publish",
    parameter_override={"General/model_url": "${extract_data.artifacts.model.url}"},
    execution_queue="gpu-fast",
    retry_on_failure=1,
)

pipe.add_function_step(
    name="split_data",
    function=split_data,
    function_kwargs={"value": "input", "prefix": "${pipeline.prefix}"},
    function_return=["left", "right"],
    task_type=TaskTypes.data_processing,
    execution_queue="default",
    cache_executed_step=True,
    packages=["pandas==2.2.3"],
    retry_on_failure=3,
)
