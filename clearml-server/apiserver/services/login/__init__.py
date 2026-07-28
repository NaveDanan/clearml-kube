from apiserver.apimodels.login import (
    GetSupportedModesRequest,
    GetSupportedModesResponse,
    BasicMode,
    BasicGuestMode,
    LogoutRequest,
    LogoutResponse,
    OidcCallbackRequest,
    OidcStartRequest,
    ServerErrors,
)
from apiserver.bll.oidc import OidcClient, OidcLoginError, cookie_value
from apiserver.config import info
from apiserver.config_repo import config
from apiserver.service_repo import endpoint, APICall
from apiserver.service_repo.auth import revoke_auth_token
from apiserver.service_repo.auth.fixed_user import FixedUser

log = config.logger(__file__)


def _oidc_error_redirect(client: OidcClient, code: str) -> str:
    separator = "&" if "?" in client.settings.login_error_url else "?"
    return f"{client.settings.login_error_url}{separator}oidc_error={code}"


@endpoint("login.supported_modes", response_data_model=GetSupportedModesResponse)
def supported_modes(call: APICall, _, __: GetSupportedModesRequest):
    guest_user = FixedUser.get_guest_user()
    if guest_user:
        guest = BasicGuestMode(
            enabled=True,
            name=guest_user.name,
            username=guest_user.username,
            password=guest_user.password,
        )
    else:
        guest = BasicGuestMode()

    oidc = OidcClient() if OidcClient.enabled() else None
    provider = oidc.provider() if oidc else None
    return GetSupportedModesResponse(
        basic=BasicMode(enabled=FixedUser.enabled(), guest=guest),
        sso={"oidc": provider["url"]} if provider else {},
        sso_providers=[provider] if provider else [],
        server_errors=ServerErrors(
            missed_es_upgrade=info.missed_es_upgrade,
            es_connection_error=info.es_connection_error,
        ),
        authenticated=call.auth is not None,
    )


@endpoint("login.oidc_start")
def oidc_start(call: APICall, _, request: OidcStartRequest):
    client = OidcClient()
    try:
        authorization = client.create_authorization(request.return_to)
    except OidcLoginError as ex:
        log.warning("OIDC authorization start failed: %s", ex.detail)
        call.result.redirect = _oidc_error_redirect(client, ex.code)
        return
    call.result.cookies[client.settings.state_cookie_name] = authorization["state"]
    call.result.redirect = authorization["url"]


@endpoint("login.oidc_callback")
def oidc_callback(call: APICall, _, request: OidcCallbackRequest):
    client = OidcClient()
    state_cookie = cookie_value(
        call.get_header("Cookie", ""), client.settings.state_cookie_name
    )
    call.result.cookies[client.settings.state_cookie_name] = None
    if request.error:
        log.warning(
            "OIDC provider returned an error: %s (%s)",
            request.error,
            request.error_description or "",
        )
        call.result.redirect = _oidc_error_redirect(
            client, "oidc_provider_error"
        )
        return
    try:
        completed = client.complete_authorization(
            code=request.code,
            state=request.state,
            state_cookie=state_cookie,
        )
    except OidcLoginError as ex:
        log.warning("OIDC callback failed: %s", ex.detail)
        call.result.redirect = _oidc_error_redirect(client, ex.code)
        return
    call.result.set_auth_cookie(completed["token"])
    call.result.redirect = completed["return_to"]


@endpoint(
    "login.logout",
    min_version="2.13",
    request_data_model=LogoutRequest,
    response_data_model=LogoutResponse,
)
def logout(call: APICall, _, request: LogoutRequest):
    revoke_auth_token(call.auth)
    call.result.set_auth_cookie(None)
    redirect_url = None
    if OidcClient.enabled():
        redirect_url = OidcClient().logout_url(request.redirect_url)
    return LogoutResponse(redirect_url=redirect_url)
