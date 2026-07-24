# Keycloak external credential contract

Before applying `keycloak.yaml`, create these externally managed Secrets in the
`clearml-tools` namespace. This repository does not create them and does not
require an ExternalSecret, SealedSecret, or SOPS controller.

| Secret | Required keys | Consumer |
| --- | --- | --- |
| `keycloak-bootstrap` | `admin-username`, `admin-password` | Keycloak bootstrap administrator |
| `keycloak-oidc` | `client-secret` | ClearML OIDC client during realm import |

The Keycloak Deployment uses required `secretKeyRef` entries, so it cannot start
with a missing Secret or key. The realm import resolves its client credential
from the `CLEARML_OIDC_CLIENT_SECRET` environment variable; it contains no
credential data and seeds no users.

The `client-secret` in `keycloak-oidc` must be the same value as
`client-secret` in the chart's `auth.oidc.existingSecret` in the ClearML release
namespace. That chart Secret also requires `cookie-secret`, and requires the
session-bridge key configured by `auth.oidc.sessionBridge.passwordKey` when the
bridge is enabled.

Credentials previously committed to this repository must be revoked and rotated
outside Git before use. This change does not perform or verify that rotation.
