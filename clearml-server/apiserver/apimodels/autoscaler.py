from jsonmodels.fields import StringField, EmbeddedField
from jsonmodels.models import Base


class RunaiConnectionSettings(Base):
    connection_method = StringField()
    openshift_login_mode = StringField()
    openshift_api_url = StringField()
    openshift_token = StringField()
    openshift_login_command = StringField()
    runai_access_key = StringField()
    runai_secret_key = StringField()
    runai_cluster = StringField()
    runai_project = StringField()
    runai_cli_version = StringField()
    user = StringField()
    worker = StringField()


class SetSettingsRequest(RunaiConnectionSettings):
    pass


class WorkloadRequest(Base):
    workload_type = StringField()
    workload_name = StringField()
    project = StringField()
    image = StringField()
    command = StringField()
    args = StringField()
    environment_variables = StringField()
    template = StringField()
    cpu_core_request = StringField()
    cpu_core_limit = StringField()
    cpu_memory_request = StringField()
    cpu_memory_limit = StringField()
    gpu_devices_request = StringField()
    gpu_memory_request = StringField()
    gpu_portion_request = StringField()
    gpu_request_type = StringField()
    node_pools = StringField()
    node_type = StringField()
    priority = StringField()
    preemptibility = StringField()
    existing_pvc = StringField()
    working_dir = StringField()
    parallelism = StringField()
    runs = StringField()
    restart_policy = StringField()
    backoff_limit = StringField()
    external_url = StringField()
    serving_port = StringField()
    min_replicas = StringField()
    max_replicas = StringField()
    initial_replicas = StringField()
    metric = StringField()
    metric_threshold = StringField()
    scale_to_zero_retention = StringField()


class SubmitWorkloadRequest(Base):
    workload = EmbeddedField(WorkloadRequest)


class SaveAppInstanceRequest(Base):
    workload = EmbeddedField(WorkloadRequest)


class GetExecutionRequest(Base):
    execution_id = StringField()


class GetDashboardRequest(Base):
    pass


class DeleteWorkloadRequest(Base):
    instance_id = StringField()
    workload_name = StringField()
    workload_type = StringField()
    project = StringField()
