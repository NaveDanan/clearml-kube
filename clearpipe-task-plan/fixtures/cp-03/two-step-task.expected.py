from clearml import PipelineController


pipe = PipelineController(
    name="iris-task-pipeline",
    project="examples",
    version="1.0.0",
    add_pipeline_tags=False,
)
pipe.set_default_execution_queue("default")
pipe.add_parameter(
    name="dataset_url",
    default="https://example.invalid/iris.pkl",
    description="Dataset URL",
)
pipe.add_step(
    name="stage_data",
    base_task_project="examples",
    base_task_name="Pipeline step 1 dataset artifact",
    parameter_override={"General/dataset_url": "${pipeline.dataset_url}"},
)
pipe.add_step(
    name="stage_process",
    parents=["stage_data"],
    base_task_project="examples",
    base_task_name="Pipeline step 2 process dataset",
    parameter_override={
        "General/dataset_url": "${stage_data.artifacts.dataset.url}",
        "General/test_size": 0.25,
    },
)
