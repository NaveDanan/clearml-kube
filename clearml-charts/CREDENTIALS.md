# Externally managed credentials

This chart never creates ClearML, ClearPipe scheduler, ClearPipe provenance,
OIDC, SMTP, or image-pull credentials. Before Helm or Argo CD sync, the platform
team or its approved secret manager must create the required Kubernetes Secrets
in the release namespace. The chart does not require or assume an
ExternalSecret, SealedSecret, or SOPS controller.

`clearml.existingSecret` is required and names the ClearML credential Secret.
It must contain these keys:

- `apiserver_key`
- `apiserver_secret`
- `fileserver_key`
- `fileserver_secret`
- `readinessprobe_key`
- `readinessprobe_secret`
- `secure_auth_token_secret`
- `test_user_key`
- `test_user_secret`

When `clearpipeScheduler.enabled` is true,
`clearpipeScheduler.existingSecret` is required. That Secret must contain
`access_key` and `secret_key`. These must be an active ClearML App Credentials
pair generated in **Settings → Workspace → App Credentials**, not random
values or the built-in test-user credentials. For a new Argo CD deployment,
follow the scheduler bootstrap procedure in
[`ESA-SECRETS-SETUP.md`](ESA-SECRETS-SETUP.md).

ClearPipe graph-v2 execution requires a dedicated provenance-signing key.
Deployments that configure
`secure.clearpipe.provenance_keys.keys.<current-key-id>` from a Secret must
provision that referenced Secret and key before syncing. The ESA values use
Secret `clearml-provenance`, key `signing-key`. Do not reuse
`secure_auth_token_secret` as the provenance-signing key.

When `imageCredentials.enabled` is true,
`imageCredentials.existingSecret` is required. It must name a Secret of type
`kubernetes.io/dockerconfigjson`.

When `email.enabled` and `email.authentication.enabled` are both true (the
default), `email.existingSecret` is required. It must contain `smtp-username`
and `smtp-password`. When `email.authentication.enabled` is false, configure
an unauthenticated relay with `email.smtpServer`, port, and TLS mode; no SMTP
credential Secret is required or referenced.

When `auth.mode` is `password`, both
`auth.fixedUsers.existingSecret` and
`apiserver.existingAdditionalConfigsSecret` are required and must name the
same Secret. It must contain an `apiserver.conf` file with the fixed-user
configuration. Do not use inline `additionalConfigs` for that authentication
configuration.

When native OIDC is enabled, the ClearML API uses a confidential
authorization-code client. `auth.oidc.existingSecret` is required and must
contain only `client-secret`. OIDC users are provisioned in ClearML after the
API validates the provider's signed ID token; no fixed-user entries or shared
Basic-auth password are used.

See [`OIDC.md`](OIDC.md) for provider setup, identity and group mapping,
migration, rollback, and local testing.

For the bundled Keycloak manifests, also read
[`infra/keycloak/README.md`](../infra/keycloak/README.md). Its externally
managed `keycloak-oidc` Secret must supply the same client secret as the
chart's OIDC Secret `client-secret` key, even though the Secrets may be in
different namespaces.

## Rotation prerequisite

Credentials previously committed to this repository must be revoked and rotated
outside Git before the affected environment is enabled. This change neither
performs nor verifies that revocation or rotation.
