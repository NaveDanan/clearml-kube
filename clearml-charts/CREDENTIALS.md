# Externally managed credentials

This chart never creates ClearML, ClearPipe scheduler, OIDC, SMTP, or image-pull
credentials. Before Helm or Argo CD sync, the platform team or its approved
secret manager must create the required Kubernetes Secrets in the release
namespace. The chart does not require or assume an ExternalSecret, SealedSecret,
or SOPS controller.

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
`access_key` and `secret_key`.

When `imageCredentials.enabled` is true,
`imageCredentials.existingSecret` is required. It must name a Secret of type
`kubernetes.io/dockerconfigjson`.

When `email.enabled` is true, `email.existingSecret` is required. It must
contain `smtp-username` and `smtp-password`.

When `auth.mode` is `password` or `oidc`, both
`auth.fixedUsers.existingSecret` and
`apiserver.existingAdditionalConfigsSecret` are required and must name the
same Secret. It must contain an `apiserver.conf` file with the fixed-user
configuration. Do not use inline `additionalConfigs` for that authentication
configuration.

When OIDC is enabled, `auth.oidc.existingSecret` is required. It must contain
`client-secret` and `cookie-secret`; when the session bridge is enabled, it must
also contain the key named by `auth.oidc.sessionBridge.passwordKey`.

For the bundled Keycloak manifests, also read
[`infra/keycloak/README.md`](../infra/keycloak/README.md). Its externally
managed client-secret value must be the same value used by the chart OIDC
Secret's `client-secret` key, even though the two Secrets may be in different
namespaces.

## Rotation prerequisite

Credentials previously committed to this repository must be revoked and rotated
outside Git before the affected environment is enabled. This change neither
performs nor verifies that revocation or rotation.
