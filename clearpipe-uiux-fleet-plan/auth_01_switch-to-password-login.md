---
id: AUTH-01
title: "Switch ClearML from name-only to password login"
lane: "Deployment authentication"
wave: "Supplemental"
complexity_points: 5
hard_dependencies: []
parallel_wave_peers: []
directly_blocks: []
recommended_owner: "ClearML deployment administrator"
---

# AUTH-01: Switch ClearML from name-only to password login

## Outcome

Configure the deployed ClearML instance so users authenticate with a configured username and password instead of entering a full name that can create or impersonate a user.

## Confirmed implementation findings

### Current name-only flow

- The frontend calls `login.supported_modes` and selects `simple` when `basic.enabled` is false.
- The simple form asks for `Full Name`, looks up matching existing users, and otherwise calls `auth.create_user` followed by `auth.login` with an impersonation header.
- The current default server configuration leaves the built-in guest account disabled at `services.auth.fixed_users.guest.enabled: false`; no `apiserver.auth.fixed_users` block is enabled.

### Password-login flow

- The server exposes password login when `apiserver.auth.fixed_users.enabled` is `true`.
- The frontend then selects `password`, changes the first field label to `Username`, requires a `Password` field, and submits Basic `username:password` credentials to `auth.login`.
- Authentication succeeds only for configured fixed users. This mode does not create a user from the entered display name and does not use the impersonation flow.

### Related, but not sufficient, guest toggle

- `services.auth.fixed_users.guest.enabled` only enables the built-in guest fixed user.
- That guest setting is considered only when `apiserver.auth.fixed_users.enabled` is already true. It is not the switch that enables password login by itself.

## In scope

- Confirm the live deployment target and current effective authentication configuration.
- Add a secure fixed-user configuration that enables password login.
- Use a Kubernetes Secret for the authentication fragment or otherwise inject credentials through the deployment secret-management path; do not commit real credentials to Helm values or source control.
- Deploy and verify the username/password login journey, failed-login behavior, logout, and protected routes.
- Document a tested rollback to the prior name-only configuration.

## Out of scope

- Changing graph, ClearPipe, task, user, or permission behavior unrelated to login.
- Storing passwords in browser state, URLs, frontend environment files, ConfigMaps, screenshots, logs, or Markdown handoffs.
- Using the default example credentials from the repository documentation.
- Enabling a guest account unless there is a separately approved need for anonymous/limited access.

## Owned surfaces and contracts

- Deployment authentication configuration and secret reference.
- ClearML API-server authentication-mode verification.
- Login and rollback evidence.

Do not alter the frontend login implementation unless the server reports password mode and the existing username/password form demonstrably fails.

## Implementation plan

1. Identify the active Argo CD application before editing values:
   - `argocd/clearml-app.yaml` deploys into namespace `clearml` with `values.yaml` and `values-testing.yaml`.
   - `argocd/clearml-esa-app.yaml` deploys into namespace `clearml-server` with `values.yaml` and `esa-values.yaml`.
2. Inspect the active application, rendered API-server manifest, and running pod to establish which values file and config source are effective. Do not assume the local checkout is the deployed revision.
3. Create a secret-managed `apiserver.conf` fragment equivalent to the following shape, with unique production credentials supplied out-of-band:

   ```hocon
   auth {
     fixed_users {
       enabled: true
       pass_hashed: true
       users: [
         {
           username: "<administrator-username>"
           password: "<base64-bcrypt-password-hash>"
           name: "<administrator-display-name>"
         }
       ]
     }
   }
   ```

4. Mount the fragment through the chart's `apiserver.existingAdditionalConfigsSecret`, or an approved equivalent secret-injection path. The chart's `apiserver.additionalConfigs` supports an `apiserver.conf` fragment, but it produces a ConfigMap and therefore must not contain passwords.
5. Sync the application and wait for a healthy API-server rollout.
6. Verify `POST /api/login.supported_modes` reports `data.basic.enabled: true` before exercising the browser flow.
7. In a clean browser session, verify the login page shows `Username` and `Password`; validate successful login, invalid-credential feedback, logout, direct navigation to a protected URL, and session restoration after refresh.
8. Capture the exact rollback: remove or disable the fixed-user fragment/reference, sync, confirm `data.basic.enabled: false`, and verify the original name-only form returns only when rollback is intentionally required.

## Acceptance criteria

- The production authentication mode is deliberate and is detectable through `login.supported_modes`.
- `data.basic.enabled` is `true` after the change.
- The browser login presents both `Username` and `Password`, not `Full Name` and `START`.
- A configured user can log in, receives the normal auth cookie, reaches the requested protected route, and can log out.
- Invalid credentials remain rejected without leaking whether a username exists.
- No plaintext or reusable password is committed, logged, or included in task evidence.
- A documented rollback is tested in a non-production environment or otherwise approved before production rollout.

## Verification

- Inspect the rendered Helm manifest to confirm the secret is mounted into the API-server pod and no credential-bearing ConfigMap is generated.
- Call the live supported-modes endpoint before and after the deployment and save only redacted response evidence.
- Run the browser journey in a clean profile/session to avoid a stale auth cookie or the frontend's ten-minute login-mode cache.
- Review API-server logs for authentication errors without printing authorization headers or credentials.

## Handoff

Return the active Argo CD application and namespace, changed non-secret files, secret reference name only, rendered-manifest evidence, endpoint result, browser-journey result, rollback result, and any blockers. Never include the password, password hash, or Basic authorization header.

## Definition of done

- All acceptance and verification criteria pass.
- The deployment's effective configuration and rollback path are recorded.
- The application is healthy after synchronization.
- No unrelated ClearPipe or UI/UX behavior changed.