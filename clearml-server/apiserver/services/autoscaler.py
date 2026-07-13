from apiserver.apimodels.autoscaler import (
    SetSettingsRequest,
    SubmitWorkloadRequest,
    GetExecutionRequest,
    GetDashboardRequest,
    GetProjectResourcesRequest,
    DeleteWorkloadRequest,
    StopWorkloadRequest,
    SaveAppInstanceRequest,
    GetWorkloadLogsRequest,
    GetWorkloadInfoRequest,
)
from apiserver.bll.autoscaler import AutoscalerBLL
from apiserver.service_repo import endpoint, APICall

autoscaler_bll = AutoscalerBLL()


@endpoint("autoscaler.get_settings")
def get_settings(call: APICall, company: str, _):
    call.result.data = {"settings": autoscaler_bll.get_company_settings(company)}


@endpoint("autoscaler.set_settings")
def set_settings(call: APICall, company: str, request: SetSettingsRequest):
    call.result.data = {
        "updated": autoscaler_bll.set_company_settings(
            company, request, user_id=call.identity.user, worker_id=call.worker
        )
    }


@endpoint("autoscaler.reset_settings")
def reset_settings(call: APICall, company: str, _):
    call.result.data = {"updated": autoscaler_bll.reset_company_settings(company)}


@endpoint("autoscaler.get_command_templates")
def get_command_templates(call: APICall, company: str, _):
    call.result.data = autoscaler_bll.get_command_templates(company)


@endpoint("autoscaler.set_command_templates")
def set_command_templates(call: APICall, company: str, _):
    call.result.data = {
        "updated": autoscaler_bll.set_command_templates(
            company, call.data.get("overrides")
        )
    }


@endpoint("autoscaler.run_command_playground")
def run_command_playground(call: APICall, company: str, _):
    call.result.data = autoscaler_bll.run_command_playground(
        company,
        version=call.data.get("version"),
        key=call.data.get("key"),
        command=call.data.get("command"),
        placeholders=call.data.get("placeholders"),
        user_id=call.identity.user,
        worker_id=call.worker,
    )


@endpoint("autoscaler.test_connection")
def test_connection(call: APICall, company: str, _):
    call.result.data = autoscaler_bll.test_connection(
        company, user_id=call.identity.user, worker_id=call.worker
    )


@endpoint("autoscaler.submit_workload")
def submit_workload(call: APICall, company: str, request: SubmitWorkloadRequest):
    call.result.data = autoscaler_bll.submit_workload(
        company, request, user_id=call.identity.user, worker_id=call.worker
    )


@endpoint("autoscaler.get_execution")
def get_execution(call: APICall, company: str, request: GetExecutionRequest):
    result = autoscaler_bll.get_execution(company, request.execution_id)
    if result is None:
        call.result.data = {"status": "error", "stderr": "Execution not found"}
    else:
        call.result.data = result


@endpoint("autoscaler.get_dashboard")
def get_dashboard(call: APICall, company: str, _: GetDashboardRequest):
    call.result.data = autoscaler_bll.get_dashboard(company)


@endpoint("autoscaler.get_project_resources")
def get_project_resources(call: APICall, company: str, request: GetProjectResourcesRequest):
    call.result.data = autoscaler_bll.get_project_resources(company, request.project)


@endpoint("autoscaler.save_app_instance")
def save_app_instance(call: APICall, company: str, request: SaveAppInstanceRequest):
    call.result.data = autoscaler_bll.save_app_instance(
        company, request, user_id=call.identity.user, worker_id=call.worker
    )


@endpoint("autoscaler.delete_workload")
def delete_workload(call: APICall, company: str, request: DeleteWorkloadRequest):
    call.result.data = autoscaler_bll.delete_workload(
        company, request, user_id=call.identity.user, worker_id=call.worker
    )


@endpoint("autoscaler.stop_workload")
def stop_workload(call: APICall, company: str, request: StopWorkloadRequest):
    call.result.data = autoscaler_bll.stop_workload(
        company, request, user_id=call.identity.user, worker_id=call.worker
    )


@endpoint("autoscaler.get_workload_logs")
def get_workload_logs(call: APICall, company: str, request: GetWorkloadLogsRequest):
    call.result.data = autoscaler_bll.get_workload_logs(
        company, request, user_id=call.identity.user, worker_id=call.worker
    )


@endpoint("autoscaler.get_workload_info")
def get_workload_info(call: APICall, company: str, request: GetWorkloadInfoRequest):
    call.result.data = autoscaler_bll.get_workload_info(company, request.workload_id)
