# Native OIDC authentication

ClearML authenticates users directly with an OpenID Connect provider by using
the authorization-code flow with PKCE. This replaces the former oauth2-proxy
Basic-auth session bridge. OIDC users do not need matching entries in
`auth.fixedUsers`, and no shared Basic-auth password is used.

## Required provider configuration

Create a confidential OIDC client and configure:

- authorization code flow enabled;
- the exact callback from `auth.oidc.redirectUrl`;
- the exact post-logout URL from `auth.oidc.postLogoutRedirectUrl`;
- `openid profile email` scopes;
- an `email_verified` claim;
- a `groups` claim when `allowedGroups` or `adminGroups` is configured;
- ID tokens signed by an algorithm in `allowedAlgorithms` (RS256 by default).

The client secret belongs in the externally managed Secret named by
`auth.oidc.existingSecret`, under the single key `client-secret`.

For the bundled local Keycloak deployment, the `keycloak-oidc` Secret in
`clearml-tools` and the ClearML OIDC Secret in the release namespace must
contain the same `client-secret` value.

## Identity and authorization

ClearML keys an external identity by the provider's immutable `(iss, sub)`
pair. Email is profile data, not the identity key. Verified-email linking to an
existing ClearML user is disabled by default and should be enabled only as an
explicit migration decision.

`allowedGroups` restricts login to members of at least one listed group.
`adminGroups` maps members to the ClearML `admin` role. Other admitted users
receive `defaultRole`. Profile and role synchronization occur at login when
their corresponding settings are enabled.

## Browser security

The API stores short-lived, one-time OIDC state, nonce, PKCE verifier, and
return path in Redis. The callback also requires an HttpOnly, SameSite state
cookie bound to the initiating browser. ID token signature, issuer, audience,
expiry, issued-at time, nonce, and verified email are validated before a
ClearML session cookie is issued.

Use HTTPS in non-local environments, set `clearml.cookieSecure: true`, and
configure exact HTTPS redirect and logout URLs. Do not use wildcard redirect
URIs.

## Migrating from password or session-bridge authentication

1. Create the confidential OIDC client and matching Kubernetes Secret.
2. Configure group and email claims, then decide the ClearML role mapping.
3. Set `auth.mode: oidc`, configure `auth.oidc`, and remove oauth2-proxy or
   session-bridge resources.
4. Leave `linkExistingUsersByEmail: false` unless verified-email account
   linking has been reviewed and approved.
5. Test login with a non-admin group and an admin group before rollout.
6. After all required users can log in, remove obsolete fixed-user mounts and
   rotate credentials used by the old bridge.

Switching back to `auth.mode: password` is the rollback. It requires the
fixed-user Secret and additional configuration Secret documented in
[CREDENTIALS.md](CREDENTIALS.md).

## Local minikube access

With `values-testing.yaml`, forward the ingress controller:

```powershell
kubectl port-forward --address 0.0.0.0 -n ingress-nginx `
  svc/ingress-nginx-controller 8080:80
```

Then use:

- ClearML: `http://127.0.0.1:8080`
- Keycloak: `http://keycloak.127.0.0.1.nip.io:8080`

The ClearML ingress is hostless for this local profile, while the Keycloak
ingress has a specific host and therefore takes precedence.
