import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from http.cookies import SimpleCookie
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlencode, urlsplit, urlunsplit

import jwt
import requests
from mongoengine import NotUniqueError

from apiserver.config.info import get_default_company
from apiserver.config_repo import config
from apiserver.database.model.auth import Role, User as AuthUser
from apiserver.database.model.user import User as BackendUser
from apiserver.redis_manager import redman

log = config.logger("OidcBLL")


class OidcLoginError(Exception):
    """An expected OIDC failure with a safe error code for the browser."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code = code
        self.detail = detail or code


def _as_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple, set)):
        return [str(item) for item in value]
    return [str(value)]


def _claim(claims: Dict[str, Any], path: str, default: Any = None) -> Any:
    value: Any = claims
    for part in (path or "").split("."):
        if not part:
            continue
        if not isinstance(value, dict) or part not in value:
            return default
        value = value[part]
    return value


def _origin(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), "", "", ""))


def safe_return_path(value: Optional[str], default: str = "/") -> str:
    """Only permit a same-origin relative application path."""
    if not value:
        return default
    parsed = urlsplit(value)
    if (
        parsed.scheme
        or parsed.netloc
        or not parsed.path.startswith("/")
        or parsed.path.startswith("//")
        or "\\" in value
    ):
        return default
    return urlunsplit(("", "", parsed.path, parsed.query, parsed.fragment))


def cookie_value(cookie_header: str, name: str) -> Optional[str]:
    cookie = SimpleCookie()
    try:
        cookie.load(cookie_header or "")
    except Exception:
        return None
    morsel = cookie.get(name)
    return morsel.value if morsel else None


@dataclass
class OidcSettings:
    enabled: bool
    issuer_url: str
    client_id: str
    client_secret: str
    redirect_url: str
    scopes: str
    display_name: str
    start_url: str
    authorization_url: str
    token_url: str
    jwks_url: str
    end_session_url: str
    post_logout_redirect_url: str
    login_error_url: str
    verify_tls: bool
    http_timeout_sec: float
    state_ttl_sec: int
    state_cookie_name: str
    allowed_algorithms: List[str]
    require_verified_email: bool
    email_claim: str
    name_claim: str
    given_name_claim: str
    family_name_claim: str
    groups_claim: str
    allowed_groups: List[str]
    admin_groups: List[str]
    default_role: str
    sync_roles: bool
    sync_profile: bool
    link_existing_users_by_email: bool
    client_authentication_method: str

    @classmethod
    def from_config(cls) -> "OidcSettings":
        values = config.get("apiserver.auth.oidc", {}) or {}

        def get(name: str, default: Any = None) -> Any:
            return values.get(name, default)

        client_secret = os.getenv("CLEARML_OIDC_CLIENT_SECRET") or get(
            "client_secret", ""
        )
        return cls(
            enabled=bool(get("enabled", False)),
            issuer_url=str(get("issuer_url", "")).rstrip("/"),
            client_id=str(get("client_id", "")),
            client_secret=str(client_secret or ""),
            redirect_url=str(get("redirect_url", "")),
            scopes=str(get("scopes", "openid profile email")),
            display_name=str(get("display_name", "Keycloak")),
            start_url=str(get("start_url", "/api/login.oidc_start")),
            authorization_url=str(get("authorization_url", "")),
            token_url=str(get("token_url", "")),
            jwks_url=str(get("jwks_url", "")),
            end_session_url=str(get("end_session_url", "")),
            post_logout_redirect_url=str(
                get("post_logout_redirect_url", "/login")
            ),
            login_error_url=str(get("login_error_url", "/login")),
            verify_tls=bool(get("verify_tls", True)),
            http_timeout_sec=float(get("http_timeout_sec", 10)),
            state_ttl_sec=int(get("state_ttl_sec", 600)),
            state_cookie_name=str(
                get("state_cookie_name", "clearml_oidc_state")
            ),
            allowed_algorithms=_as_list(get("allowed_algorithms", ["RS256"])),
            require_verified_email=bool(get("require_verified_email", True)),
            email_claim=str(get("email_claim", "email")),
            name_claim=str(get("name_claim", "name")),
            given_name_claim=str(get("given_name_claim", "given_name")),
            family_name_claim=str(get("family_name_claim", "family_name")),
            groups_claim=str(get("groups_claim", "groups")),
            allowed_groups=_as_list(get("allowed_groups", [])),
            admin_groups=_as_list(get("admin_groups", [])),
            default_role=str(get("default_role", Role.user)),
            sync_roles=bool(get("sync_roles", True)),
            sync_profile=bool(get("sync_profile", True)),
            link_existing_users_by_email=bool(
                get("link_existing_users_by_email", False)
            ),
            client_authentication_method=str(
                get("client_authentication_method", "client_secret_post")
            ),
        )

    def validate(self) -> None:
        if not self.enabled:
            raise OidcLoginError("oidc_disabled")
        missing = [
            name
            for name, value in (
                ("issuer_url", self.issuer_url),
                ("client_id", self.client_id),
                ("client_secret", self.client_secret),
                ("redirect_url", self.redirect_url),
            )
            if not value
        ]
        if missing:
            raise OidcLoginError(
                "oidc_misconfigured", "missing " + ", ".join(missing)
            )
        if "openid" not in self.scopes.split():
            raise OidcLoginError(
                "oidc_misconfigured", "scopes must include openid"
            )
        if self.default_role not in Role.get_company_roles():
            raise OidcLoginError("oidc_misconfigured", "invalid default role")
        if self.client_authentication_method not in (
            "client_secret_post",
            "client_secret_basic",
        ):
            raise OidcLoginError(
                "oidc_misconfigured",
                "invalid client authentication method",
            )


class OidcClient:
    _cache: Dict[str, Any] = {}
    _cache_lock = threading.Lock()
    _cache_ttl_sec = 300

    def __init__(
        self,
        settings: Optional[OidcSettings] = None,
        redis=None,
        http_session=None,
    ):
        self.settings = settings or OidcSettings.from_config()
        self.redis = redis or redman.connection("apiserver")
        self.http = http_session or requests.Session()

    @classmethod
    def enabled(cls) -> bool:
        return bool(config.get("apiserver.auth.oidc.enabled", False))

    def provider(self) -> Dict[str, str]:
        return {
            "name": "oidc",
            "display_name": self.settings.display_name,
            "displayName": self.settings.display_name,
            "url": self.settings.start_url,
        }

    def _request_json(self, method: str, url: str, **kwargs) -> Dict[str, Any]:
        try:
            response = self.http.request(
                method,
                url,
                timeout=self.settings.http_timeout_sec,
                verify=self.settings.verify_tls,
                **kwargs,
            )
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError("response is not an object")
            return data
        except Exception as ex:
            raise OidcLoginError("oidc_provider_unavailable", str(ex))

    def _cached_json(self, url: str, force: bool = False) -> Dict[str, Any]:
        now = time.time()
        with self._cache_lock:
            entry = self._cache.get(url)
            if not force and entry and entry[0] > now:
                return entry[1]
        data = self._request_json("GET", url)
        with self._cache_lock:
            self._cache[url] = (now + self._cache_ttl_sec, data)
        return data

    def discovery(self) -> Dict[str, Any]:
        self.settings.validate()
        url = self.settings.issuer_url + "/.well-known/openid-configuration"
        document = self._cached_json(url)
        if document.get("issuer", "").rstrip("/") != self.settings.issuer_url:
            raise OidcLoginError(
                "oidc_discovery_invalid", "discovery issuer mismatch"
            )
        return document

    def endpoint(self, configured: str, discovered_name: str) -> str:
        if configured:
            return configured
        value = self.discovery().get(discovered_name)
        if not value:
            raise OidcLoginError(
                "oidc_discovery_invalid", f"missing {discovered_name}"
            )
        return str(value)

    @staticmethod
    def _state_key(state: str) -> str:
        return "clearml:oidc:state:" + state

    def create_authorization(self, return_to: Optional[str]) -> Dict[str, str]:
        self.settings.validate()
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        record = {
            "nonce": nonce,
            "code_verifier": verifier,
            "return_to": safe_return_path(return_to),
        }
        self.redis.setex(
            self._state_key(state),
            self.settings.state_ttl_sec,
            json.dumps(record),
        )
        params = {
            "response_type": "code",
            "client_id": self.settings.client_id,
            "redirect_uri": self.settings.redirect_url,
            "scope": self.settings.scopes,
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        authorization_url = self.endpoint(
            self.settings.authorization_url, "authorization_endpoint"
        )
        return {
            "state": state,
            "url": authorization_url + "?" + urlencode(params),
        }

    def _consume_state(self, state: str) -> Dict[str, Any]:
        script = (
            "local v=redis.call('GET',KEYS[1]);"
            "if v then redis.call('DEL',KEYS[1]); end;"
            "return v"
        )
        raw = self.redis.eval(script, 1, self._state_key(state))
        if not raw:
            raise OidcLoginError("oidc_state_invalid")
        if isinstance(raw, bytes):
            raw = raw.decode()
        try:
            record = json.loads(raw)
        except Exception:
            raise OidcLoginError("oidc_state_invalid")
        if not isinstance(record, dict):
            raise OidcLoginError("oidc_state_invalid")
        return record

    def _exchange_code(self, code: str, verifier: str) -> Dict[str, Any]:
        token_url = self.endpoint(self.settings.token_url, "token_endpoint")
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self.settings.redirect_url,
            "client_id": self.settings.client_id,
            "code_verifier": verifier,
        }
        kwargs: Dict[str, Any] = {"data": data}
        if self.settings.client_authentication_method == "client_secret_basic":
            kwargs["auth"] = (
                self.settings.client_id,
                self.settings.client_secret,
            )
        else:
            data["client_secret"] = self.settings.client_secret
        token_data = self._request_json("POST", token_url, **kwargs)
        if not token_data.get("id_token"):
            raise OidcLoginError(
                "oidc_token_invalid", "provider omitted id_token"
            )
        return token_data

    def _jwks(self, force: bool = False) -> Dict[str, Any]:
        jwks_url = self.endpoint(
            self.settings.jwks_url, "jwks_uri"
        )
        return self._cached_json(jwks_url, force=force)

    def _signing_key(self, encoded_token: str):
        try:
            header = jwt.get_unverified_header(encoded_token)
        except Exception as ex:
            raise OidcLoginError("oidc_token_invalid", str(ex))
        algorithm = header.get("alg")
        if algorithm not in self.settings.allowed_algorithms:
            raise OidcLoginError(
                "oidc_token_invalid", "token algorithm is not allowed"
            )
        kid = header.get("kid")
        for force in (False, True):
            keys = self._jwks(force=force).get("keys", [])
            jwk = next(
                (
                    item
                    for item in keys
                    if isinstance(item, dict)
                    and (not kid or item.get("kid") == kid)
                    and item.get("alg", algorithm) == algorithm
                ),
                None,
            )
            if jwk:
                try:
                    return jwt.PyJWK.from_dict(jwk, algorithm=algorithm).key
                except Exception as ex:
                    raise OidcLoginError("oidc_token_invalid", str(ex))
        raise OidcLoginError("oidc_token_invalid", "signing key not found")

    def _validate_id_token(
        self, encoded_token: str, expected_nonce: str
    ) -> Dict[str, Any]:
        try:
            claims = jwt.decode(
                encoded_token,
                key=self._signing_key(encoded_token),
                algorithms=self.settings.allowed_algorithms,
                audience=self.settings.client_id,
                issuer=self.settings.issuer_url,
                options={
                    "require": ["exp", "iat", "iss", "sub", "aud", "nonce"]
                },
                leeway=30,
            )
        except OidcLoginError:
            raise
        except Exception as ex:
            raise OidcLoginError("oidc_token_invalid", str(ex))
        if not hmac.compare_digest(
            str(claims.get("nonce", "")), str(expected_nonce)
        ):
            raise OidcLoginError("oidc_token_invalid", "nonce mismatch")
        return claims

    def complete_authorization(
        self,
        code: str,
        state: str,
        state_cookie: Optional[str],
    ) -> Dict[str, Any]:
        self.settings.validate()
        if not code or not state or not state_cookie:
            raise OidcLoginError("oidc_callback_invalid")
        if not hmac.compare_digest(state, state_cookie):
            raise OidcLoginError("oidc_state_invalid")
        record = self._consume_state(state)
        token_data = self._exchange_code(code, record["code_verifier"])
        claims = self._validate_id_token(
            token_data["id_token"], record["nonce"]
        )
        user = self.provision_user(claims)
        token = self.issue_session(user)
        return {
            "token": token,
            "return_to": safe_return_path(record.get("return_to")),
            "user": user,
        }

    @staticmethod
    def issue_session(user: AuthUser) -> str:
        from apiserver.bll.auth import AuthBLL

        return AuthBLL.get_token_for_user(
            user_id=user.id, company_id=user.company
        ).token

    def _groups(self, claims: Dict[str, Any]) -> List[str]:
        return _as_list(_claim(claims, self.settings.groups_claim, []))

    @staticmethod
    def _intersects(left: Iterable[str], right: Iterable[str]) -> bool:
        return bool(set(left).intersection(right))

    def _role(self, groups: List[str]) -> str:
        if self._intersects(groups, self.settings.admin_groups):
            return Role.admin
        return self.settings.default_role

    def _identity_data(self, claims: Dict[str, Any]) -> Dict[str, Any]:
        issuer = str(claims.get("iss", "")).rstrip("/")
        subject = str(claims.get("sub", ""))
        email = str(_claim(claims, self.settings.email_claim, "")).strip().lower()
        if issuer != self.settings.issuer_url or not subject:
            raise OidcLoginError("oidc_identity_invalid")
        if not email:
            raise OidcLoginError("oidc_email_missing")
        if self.settings.require_verified_email and claims.get(
            "email_verified"
        ) is not True:
            raise OidcLoginError("oidc_email_unverified")
        groups = self._groups(claims)
        if self.settings.allowed_groups and not self._intersects(
            groups, self.settings.allowed_groups
        ):
            raise OidcLoginError("oidc_access_denied")
        given_name = str(
            _claim(claims, self.settings.given_name_claim, "") or ""
        ).strip()
        family_name = str(
            _claim(claims, self.settings.family_name_claim, "") or ""
        ).strip()
        name = str(
            _claim(claims, self.settings.name_claim, "") or ""
        ).strip()
        if not name:
            name = " ".join(
                part for part in (given_name, family_name) if part
            ) or email
        return {
            "issuer": issuer,
            "subject": subject,
            "email": email,
            "name": name,
            "given_name": given_name,
            "family_name": family_name,
            "groups": groups,
            "role": self._role(groups),
        }

    def provision_user(self, claims: Dict[str, Any]) -> AuthUser:
        from apiserver.apimodels.auth import CreateUserRequest
        from apiserver.bll.auth import AuthBLL

        identity = self._identity_data(claims)
        user = AuthUser.objects(
            oidc_issuer=identity["issuer"],
            oidc_subject=identity["subject"],
        ).first()

        if not user:
            existing = AuthUser.objects(email=identity["email"]).first()
            if existing:
                if (
                    existing.oidc_issuer
                    and existing.oidc_subject
                    and (
                        existing.oidc_issuer != identity["issuer"]
                        or existing.oidc_subject != identity["subject"]
                    )
                ):
                    raise OidcLoginError("oidc_identity_conflict")
                if not self.settings.link_existing_users_by_email:
                    raise OidcLoginError("oidc_identity_conflict")
                user = existing
                user.oidc_issuer = identity["issuer"]
                user.oidc_subject = identity["subject"]
            else:
                try:
                    user_id = AuthBLL.create_user(
                        CreateUserRequest(
                            name=identity["name"],
                            company=get_default_company(),
                            role=identity["role"],
                            email=identity["email"],
                            given_name=identity["given_name"],
                            family_name=identity["family_name"],
                        )
                    )
                    user = AuthUser.objects(id=user_id).first()
                    user.oidc_issuer = identity["issuer"]
                    user.oidc_subject = identity["subject"]
                except NotUniqueError:
                    user = AuthUser.objects(
                        oidc_issuer=identity["issuer"],
                        oidc_subject=identity["subject"],
                    ).first()
                    if not user:
                        raise OidcLoginError("oidc_identity_conflict")

        user.validated = datetime.utcnow()
        changed = False
        if user.email != identity["email"]:
            user.email = identity["email"]
            changed = True
        if self.settings.sync_profile and user.name != identity["name"]:
            user.name = identity["name"]
            changed = True
        if self.settings.sync_roles and user.role != identity["role"]:
            user.role = identity["role"]
            changed = True
        if changed or user.pk:
            user.save()

        if self.settings.sync_profile:
            BackendUser.objects(id=user.id, company=user.company).update_one(
                set__name=identity["name"],
                set__given_name=identity["given_name"],
                set__family_name=identity["family_name"],
                upsert=False,
            )
        return user

    def logout_url(self, requested_redirect: Optional[str]) -> Optional[str]:
        redirect = self.settings.post_logout_redirect_url
        requested_origin = _origin(requested_redirect or "")
        configured_origin = _origin(redirect) or _origin(
            self.settings.redirect_url
        )
        if requested_redirect and requested_origin == configured_origin:
            redirect = requested_redirect
        endpoint = self.settings.end_session_url
        if not endpoint:
            try:
                endpoint = self.discovery().get("end_session_endpoint", "")
            except OidcLoginError:
                log.warning("OIDC discovery failed during logout", exc_info=True)
                return None
        if not endpoint:
            return None
        return str(endpoint) + "?" + urlencode(
            {
                "client_id": self.settings.client_id,
                "post_logout_redirect_uri": redirect,
            }
        )
