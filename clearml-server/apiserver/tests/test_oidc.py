import json
import time
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from apiserver.bll.oidc import (
    OidcClient,
    OidcLoginError,
    OidcSettings,
    cookie_value,
    safe_return_path,
)
from apiserver.database.model.auth import Role


class FakeRedis:
    def __init__(self):
        self.values = {}

    def setex(self, key, _ttl, value):
        self.values[key] = value

    def eval(self, _script, _num_keys, key):
        return self.values.pop(key, None)


class FakeResponse:
    def __init__(self, data, status_code=200):
        self.data = data
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self.data


class FakeHttp:
    def __init__(self, responses):
        self.responses = responses
        self.requests = []

    def request(self, method, url, **kwargs):
        self.requests.append((method, url, kwargs))
        response = self.responses[(method, url)]
        return response if isinstance(response, FakeResponse) else FakeResponse(response)


def settings(**overrides):
    values = dict(
        enabled=True,
        issuer_url="https://issuer.example/realms/clearml",
        client_id="clearml",
        client_secret="secret",
        redirect_url="https://clearml.example/api/login.oidc_callback",
        scopes="openid profile email",
        display_name="Keycloak",
        start_url="/api/login.oidc_start",
        authorization_url="https://issuer.example/auth",
        token_url="https://issuer.internal/token",
        jwks_url="https://issuer.internal/jwks",
        end_session_url="https://issuer.example/logout",
        post_logout_redirect_url="https://clearml.example/login",
        login_error_url="https://clearml.example/login",
        verify_tls=True,
        http_timeout_sec=10,
        state_ttl_sec=600,
        state_cookie_name="clearml_oidc_state",
        allowed_algorithms=["RS256"],
        require_verified_email=True,
        email_claim="email",
        name_claim="name",
        given_name_claim="given_name",
        family_name_claim="family_name",
        groups_claim="groups",
        allowed_groups=["/clearml-users", "/clearml-admins"],
        admin_groups=["/clearml-admins"],
        default_role=Role.user,
        sync_roles=True,
        sync_profile=True,
        link_existing_users_by_email=False,
        client_authentication_method="client_secret_post",
    )
    values.update(overrides)
    return OidcSettings(**values)


def test_return_path_and_cookie_parsing_are_safe():
    assert safe_return_path("/projects?id=1") == "/projects?id=1"
    assert safe_return_path("https://evil.example/") == "/"
    assert safe_return_path("//evil.example/") == "/"
    assert safe_return_path("/safe\\evil") == "/"
    assert (
        cookie_value("a=1; clearml_oidc_state=expected", "clearml_oidc_state")
        == "expected"
    )


def test_authorization_uses_state_nonce_and_pkce():
    redis = FakeRedis()
    client = OidcClient(settings=settings(), redis=redis, http_session=FakeHttp({}))

    result = client.create_authorization("/projects")

    query = parse_qs(urlsplit(result["url"]).query)
    assert query["response_type"] == ["code"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["state"] == [result["state"]]
    assert query["nonce"][0]
    assert query["code_challenge"][0]
    record = json.loads(redis.values[client._state_key(result["state"])])
    assert record["return_to"] == "/projects"
    assert record["nonce"] == query["nonce"][0]
    assert record["code_verifier"]


def test_callback_state_is_cookie_bound_and_single_use():
    redis = FakeRedis()
    client = OidcClient(settings=settings(), redis=redis, http_session=FakeHttp({}))
    authorization = client.create_authorization("/")

    with pytest.raises(OidcLoginError, match="oidc_state_invalid"):
        client.complete_authorization(
            code="code",
            state=authorization["state"],
            state_cookie="different",
        )

    record = client._consume_state(authorization["state"])
    assert record["nonce"]
    with pytest.raises(OidcLoginError, match="oidc_state_invalid"):
        client._consume_state(authorization["state"])


def test_signed_id_token_is_validated_and_completed(monkeypatch):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key()))
    public_jwk.update({"kid": "test-key", "alg": "RS256", "use": "sig"})
    redis = FakeRedis()
    configured = settings()
    client = OidcClient(
        settings=configured,
        redis=redis,
        http_session=FakeHttp(
            {
                ("POST", configured.token_url): {
                    "id_token": "filled-after-state-created"
                },
                ("GET", configured.jwks_url): {"keys": [public_jwk]},
            }
        ),
    )
    authorization = client.create_authorization("/dashboard")
    record = json.loads(redis.values[client._state_key(authorization["state"])])
    now = int(time.time())
    claims = {
        "iss": configured.issuer_url,
        "sub": "stable-subject",
        "aud": configured.client_id,
        "iat": now - 10,
        "exp": now + 3600,
        "nonce": record["nonce"],
        "email": "User@Example.com",
        "email_verified": True,
        "name": "Test User",
        "groups": ["/clearml-users"],
    }
    encoded = jwt.encode(
        claims,
        private_key,
        algorithm="RS256",
        headers={"kid": "test-key"},
    )
    client.http.responses[("POST", configured.token_url)] = {"id_token": encoded}
    provisioned = SimpleNamespace(
        id="user-id", company="company-id", role=Role.user
    )
    monkeypatch.setattr(client, "provision_user", lambda token_claims: provisioned)
    monkeypatch.setattr(client, "issue_session", lambda _user: "clearml-session")
    completed = client.complete_authorization(
        code="authorization-code",
        state=authorization["state"],
        state_cookie=authorization["state"],
    )

    assert completed["token"] == "clearml-session"
    assert completed["return_to"] == "/dashboard"
    post = client.http.requests[0]
    assert post[0:2] == ("POST", configured.token_url)
    assert post[2]["data"]["code_verifier"] == record["code_verifier"]
    assert post[2]["data"]["client_secret"] == configured.client_secret


def test_claim_policy_requires_verified_allowed_identity():
    client = OidcClient(settings=settings(), redis=FakeRedis(), http_session=FakeHttp({}))
    base = {
        "iss": client.settings.issuer_url,
        "sub": "subject",
        "email": "USER@example.com",
        "email_verified": True,
        "name": "User Name",
        "groups": ["/clearml-admins"],
    }

    identity = client._identity_data(base)
    assert identity["email"] == "user@example.com"
    assert identity["role"] == Role.admin

    with pytest.raises(OidcLoginError, match="oidc_email_unverified"):
        client._identity_data({**base, "email_verified": False})
    with pytest.raises(OidcLoginError, match="oidc_access_denied"):
        client._identity_data({**base, "groups": ["/other"]})


def test_logout_redirect_cannot_be_sent_to_another_origin():
    client = OidcClient(settings=settings(), redis=FakeRedis(), http_session=FakeHttp({}))
    result = client.logout_url("https://evil.example/capture")
    query = parse_qs(urlsplit(result).query)
    assert query["post_logout_redirect_uri"] == [
        client.settings.post_logout_redirect_url
    ]
