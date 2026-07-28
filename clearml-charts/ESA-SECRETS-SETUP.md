# ESA Secret Provisioning on Ubuntu

This guide provisions the three Kubernetes Secrets required by
`esa-values.yaml`:

- `clearml-fixed-users`, containing the ClearML username/password
  configuration in an `apiserver.conf` key.
- `clearml-provenance`, containing the dedicated ClearPipe graph-v2
  provenance-signing key in a `signing-key` key.
- `clearpipe-scheduler-credentials`, containing a valid ClearML App
  Credentials pair in `access_key` and `secret_key` keys.

The Kubernetes namespace is assumed to exist already. Run these commands once
from an Ubuntu administration or build machine that has `kubectl` access to the
cluster. Do not run them separately on every Kubernetes VM.

## 1. Select and verify the target cluster

Set the namespace used by the ESA deployment:

```bash
export CLEARML_NAMESPACE="clearml-server"
```

If the existing namespace has a different name, change the value above before
continuing.

Check the current Kubernetes context and confirm that the namespace exists:

```bash
kubectl config current-context
kubectl get namespace "$CLEARML_NAMESPACE"
```

These checks protect against creating credentials in the wrong cluster or
namespace. Stop if the displayed context is not the intended ESA cluster.

Confirm that the current Kubernetes identity can manage Secrets in the
namespace:

```bash
kubectl auth can-i create secrets -n "$CLEARML_NAMESPACE"
kubectl auth can-i get secrets -n "$CLEARML_NAMESPACE"
```

Both commands should print `yes`. Kubernetes Secrets are namespace-scoped, so a
Secret with the same name in a different namespace will not be used by the
ClearML pods.

## 2. Prepare bcrypt password generation

The ESA values enable password authentication with:

```yaml
auth:
  mode: "password"
  fixedUsers:
    passHashed: true
```

Therefore, `apiserver.conf` must contain base64-encoded bcrypt password hashes,
not clear-text passwords.

Check whether the Python bcrypt module is available:

```bash
python3 -c 'import bcrypt; print("python bcrypt is available")'
```

If it is missing on an Ubuntu machine with access to the configured package
repositories, install it:

```bash
sudo apt-get update
sudo apt-get install -y python3-bcrypt
```

For an air-gapped administration machine, install the package through the
approved offline package process, or generate the hash on a secured connected
build machine. Only the resulting hash is needed by Kubernetes.

## 3. Generate the fixed-user configuration

Restrict permissions on any files created by the current shell:

```bash
umask 077
```

Choose the ClearML login username and display name:

```bash
read -rp "ClearML username [admin]: " CLEARML_USERNAME
CLEARML_USERNAME="${CLEARML_USERNAME:-admin}"

read -rp "ClearML display name [ClearML Administrator]: " CLEARML_DISPLAY_NAME
CLEARML_DISPLAY_NAME="${CLEARML_DISPLAY_NAME:-ClearML Administrator}"
```

Read the password without displaying it or recording it in shell history, then
generate its base64-encoded bcrypt hash:

```bash
read -rsp "ClearML password: " CLEARML_PASSWORD
echo
export CLEARML_PASSWORD

CLEARML_PASSWORD_HASH="$(
python3 - <<'PY'
import base64
import bcrypt
import os

password = os.environ["CLEARML_PASSWORD"].encode()
hashed = bcrypt.hashpw(password, bcrypt.gensalt(rounds=12))
print(base64.b64encode(hashed).decode())
PY
)"

unset CLEARML_PASSWORD
```

The clear-text password exists only in the temporary shell variable and Python
process environment. The generated value is a bcrypt hash and cannot be used to
recover the original password.

Export the non-secret user metadata and generated hash so Python can safely
quote them when producing the HOCON configuration:

```bash
export CLEARML_USERNAME
export CLEARML_DISPLAY_NAME
export CLEARML_PASSWORD_HASH
```

Create `apiserver.conf`:

```bash
python3 - <<'PY' > apiserver.conf
import json
import os

username = json.dumps(os.environ["CLEARML_USERNAME"])
display_name = json.dumps(os.environ["CLEARML_DISPLAY_NAME"])
password_hash = json.dumps(os.environ["CLEARML_PASSWORD_HASH"])

print(
    f"""auth {{
  fixed_users {{
    enabled: true
    pass_hashed: true
    users: [
      {{
        username: {username}
        password: {password_hash}
        name: {display_name}
      }}
    ]
  }}
}}"""
)
PY

unset CLEARML_USERNAME
unset CLEARML_DISPLAY_NAME
unset CLEARML_PASSWORD_HASH
```

This produces the configuration structure expected by the ClearML apiserver.
The password stored in the file is the bcrypt hash, not the clear-text
password.

Confirm that the file exists and is readable only by its owner:

```bash
test -s apiserver.conf
ls -l apiserver.conf
```

Do not commit `apiserver.conf` to Git, even though it contains a password hash.

### Adding more fixed users

Generate a separate bcrypt hash for every user. Add another object inside the
`users` list:

```hocon
{
  username: "second-user"
  password: "<that-user's-base64-bcrypt-hash>"
  name: "Second User"
}
```

Do not share one password or hash between multiple human users.

## 4. Create `clearml-fixed-users`

First check whether the Secret already exists:

```bash
kubectl -n "$CLEARML_NAMESPACE" get secret clearml-fixed-users
```

If Kubernetes reports `NotFound`, create it:

```bash
kubectl -n "$CLEARML_NAMESPACE" create secret generic clearml-fixed-users \
  --from-file=apiserver.conf=./apiserver.conf
```

The explicit `apiserver.conf=...` mapping ensures that the Secret data key has
the exact name expected by the Helm values and apiserver volume mount.

After Kubernetes confirms creation, securely remove the local file:

```bash
shred -u apiserver.conf
```

If `shred` is unavailable or the filesystem does not support reliable
overwriting, remove the file and rely on encrypted storage for the
administration machine:

```bash
rm -f apiserver.conf
```

If the Secret already exists, do not overwrite it until its contents and the
effect on current users have been reviewed. The intentional update procedure is
documented below.

## 5. Create the ClearPipe provenance-signing key

Check whether the provenance Secret already exists:

```bash
kubectl -n "$CLEARML_NAMESPACE" get secret clearml-provenance
```

If it exists, stop this step. Do not replace it with a newly generated key.

If Kubernetes reports `NotFound`, create a protected temporary file and
generate a 256-bit random signing key:

```bash
PROVENANCE_KEY_FILE="$(mktemp)"
chmod 600 "$PROVENANCE_KEY_FILE"
openssl rand -hex 32 | tr -d '\n' > "$PROVENANCE_KEY_FILE"
```

Create the Secret:

```bash
kubectl -n "$CLEARML_NAMESPACE" create secret generic clearml-provenance \
  --from-file=signing-key="$PROVENANCE_KEY_FILE"
```

The `signing-key` name must match the `secretKeyRef` in `esa-values.yaml`.
ClearPipe uses this key to sign and verify graph-v2 runtime provenance.

Store the key through the organization's approved secret-management or
encrypted-backup process before deleting the temporary file. It must remain
stable across Helm upgrades, pod restarts, and cluster recovery.

After the backup is secured, delete the temporary file:

```bash
shred -u "$PROVENANCE_KEY_FILE" 2>/dev/null || rm -f "$PROVENANCE_KEY_FILE"
unset PROVENANCE_KEY_FILE
```

Do not regenerate this key on every deployment. Replacing a key under the same
key ID can make existing ClearPipe provenance records unverifiable.

## 6. Verify the Secret names and keys

List the Secrets:

```bash
kubectl -n "$CLEARML_NAMESPACE" get secret \
  clearml-fixed-users clearml-provenance
```

List only the data-key names, without printing their values:

```bash
kubectl -n "$CLEARML_NAMESPACE" get secret clearml-fixed-users \
  -o go-template='{{range $key, $value := .data}}{{printf "%s\n" $key}}{{end}}'

kubectl -n "$CLEARML_NAMESPACE" get secret clearml-provenance \
  -o go-template='{{range $key, $value := .data}}{{printf "%s\n" $key}}{{end}}'
```

Expected output:

```text
apiserver.conf
signing-key
```

`kubectl describe secret` is also safe for checking key names and byte counts
because it does not print the secret values:

```bash
kubectl -n "$CLEARML_NAMESPACE" describe secret clearml-fixed-users
kubectl -n "$CLEARML_NAMESPACE" describe secret clearml-provenance
```

## 7. Validate the Helm chart before deployment

Run Helm lint from the repository root:

```bash
helm lint ./clearml-charts \
  -f ./clearml-charts/esa-values.yaml
```

Render the Kubernetes manifests locally:

```bash
helm template clearml-server ./clearml-charts \
  --namespace "$CLEARML_NAMESPACE" \
  -f ./clearml-charts/esa-values.yaml \
  > /tmp/clearml-esa-rendered.yaml
```

These commands do not change the cluster. They catch YAML and Helm-template
errors before deployment.

Confirm that the rendered manifest contains references to the required
configuration:

```bash
grep -E \
  'clearml-fixed-users|clearml-provenance|provenance_keys|CLEARPIPE_SCHEDULER_POLL_SECONDS' \
  /tmp/clearml-esa-rendered.yaml
```

The rendered file contains Secret names and references, but it does not contain
the Secret values created with `kubectl`.

## 8. Deploy through the Argo CD UI

The ESA application is deployed only through Argo CD. Do not run
`helm upgrade` separately: Argo CD uses Helm to render the chart and then owns
the application lifecycle.

See the official
[Argo CD Helm documentation](https://argo-cd.readthedocs.io/en/latest/user-guide/helm/)
for the underlying values-file and rendering behavior.

### 8.1 Understand the scheduler bootstrap dependency

`clearpipe-scheduler-credentials` cannot contain random values. It must contain
a valid ClearML App Credentials pair generated by an authenticated ClearML
user:

```text
access_key
secret_key
```

The scheduler uses this pair to call the apiserver's `auth.login` endpoint and
then list and start scheduled ClearPipe definitions visible to that credential
owner.

On a brand-new deployment, the ClearML web UI is not available yet, so the App
Credentials cannot be generated before the first Sync. Use this bootstrap
sequence:

1. Configure the Argo CD Application with the scheduler temporarily disabled.
2. Sync the rest of ClearML.
3. Log in to the ClearML UI and generate dedicated App Credentials.
4. Create `clearpipe-scheduler-credentials`.
5. Remove the temporary disable override.
6. Hard-refresh and sync again to deploy the scheduler.

If a valid dedicated App Credentials pair already exists for this ESA ClearML
instance, create the Kubernetes Secret as described in Step 8.6 before the
first Sync and skip the temporary-disable workflow.

Do not use `test_user_key` and `test_user_secret` from
`clearml-server-secrets`. ESA enables fixed-user authentication, and the
ClearML server revokes the built-in test-user credentials in fixed-user mode.

### 8.2 Verify the initial external cluster dependencies

Before the bootstrap Sync, confirm the externally managed Secrets that can be
provisioned before ClearML starts:

```bash
kubectl -n "$CLEARML_NAMESPACE" get secret \
  nave-pull-secret \
  clearml-server-secrets \
  clearml-fixed-users \
  clearml-provenance \
  rf-ca-cert \
  wildcard-certs-secret
```

This command must list all six Secrets. A missing Secret can leave one or more
pods in `Pending`, `CreateContainerConfigError`, or `ImagePullBackOff`.

Check separately whether scheduler credentials already exist:

```bash
kubectl -n "$CLEARML_NAMESPACE" get secret \
  clearpipe-scheduler-credentials
```

If Kubernetes reports `NotFound` on a new installation, continue with the
bootstrap procedure. Do not create a placeholder Secret with random values.

Confirm the storage and ingress classes:

```bash
kubectl get storageclass nfs-main
kubectl get ingressclass nginx
```

The names must match `esa-values.yaml` exactly.

### 8.3 Create or edit the Argo CD Application

In the Argo CD UI, select **New App**. If the ClearML Application already
exists, open it and edit its source and destination instead.

Configure the general application fields:

| Field | Value |
|---|---|
| Application Name | `clearml-server` |
| Project | The approved Argo CD project, commonly `default` |
| Sync Policy | `Manual` for the first deployment |

Manual Sync is recommended initially so the generated manifests can be
reviewed before Argo CD changes the cluster.

Configure the source:

| Field | Value |
|---|---|
| Repository URL | The Git repository containing this project |
| Revision | The approved branch, tag, or commit |
| Path | `clearml-charts` |

For a controlled ESA release, prefer an approved tag or commit instead of a
moving development branch.

Configure the destination:

| Field | Value |
|---|---|
| Cluster | The ESA Kubernetes cluster |
| Namespace | `clearml-server`, or the value exported as `CLEARML_NAMESPACE` |
| Create Namespace | Disabled |

Namespace creation is disabled because this guide assumes it already exists.

### 8.4 Configure Helm and the bootstrap override

Set the Helm release name to:

```text
clearml-server
```

Under **Helm → Values Files**, add the files as two separate entries in this
exact order:

```text
values.yaml
esa-values.yaml
```

Argo CD passes multiple values files to Helm in the listed order. Helm gives
higher precedence to later files, so `esa-values.yaml` must be last.

Do not use a wildcard for these files. Explicit entries make the override order
clear and stable.

If `clearpipe-scheduler-credentials` does not exist yet, add this temporary
entry under **Helm → Parameters**:

| Name | Value |
|---|---|
| `clearpipeScheduler.enabled` | `false` |

Helm parameters take precedence over values files, so this prevents Argo CD
from creating the scheduler Deployment during the bootstrap Sync. This
parameter must be removed after the credential Secret is created.

Do not put passwords, hashes, signing keys, registry passwords, or other Secret
values into:

- Helm Parameters
- Values
- Values Object
- Any Git-tracked values file

The temporary scheduler parameter is safe because it is a non-secret boolean.
Save or create the Application without syncing it yet.

### 8.5 Review and perform the bootstrap Sync

Open the Application and select **Hard Refresh**. Wait for manifest generation
to finish, then resolve any source, values-file, Helm, or repository error.

Review the Application diff or generated manifests and confirm references to:

```text
clearml-fixed-users
clearml-provenance
rf-ca-cert
nave-pull-secret
```

When the bootstrap override is active, the generated manifests must not contain
a `clearml-server-clearpipe-scheduler` Deployment.

Also confirm:

- The destination namespace is `clearml-server`.
- The ClearML and RunAI worker image tags are `2026-07-27`.
- The apiserver contains both `provenance_keys` environment variables.
- The public ingress hostnames end in `mems.rafael.co.il`.
- No clear-text or base64-encoded credential values appear in the diff.

Select **Sync**, then **Synchronize**, using:

| Option | Bootstrap-Sync setting | Reason |
|---|---|---|
| Prune | Disabled | Avoid deleting resources until ownership and scope have been reviewed |
| Force | Disabled | Avoid delete-and-recreate behavior |
| Replace | Disabled | Use normal apply behavior |
| Create Namespace | Disabled | The namespace already exists |

Review the resource list, then start the Sync. Do not enable Force or Replace to
work around a manifest error.

Wait for the webserver and apiserver to become healthy. The Application can
reach `Synced` and `Healthy` without the scheduler because it is intentionally
disabled during this bootstrap Sync.

### 8.6 Generate and create `clearpipe-scheduler-credentials`

Open the deployed ClearML web UI:

```text
https://clearml.mems.rafael.co.il
```

Log in with a fixed user from `clearml-fixed-users`.

The scheduler receives the permissions and resource visibility of the user who
owns its App Credentials. Prefer a dedicated fixed user such as
`clearpipe-scheduler` instead of a personal account. If a dedicated user is
needed, add it to the complete `apiserver.conf` using Step 10, apply the updated
Secret, restart the apiserver, and log in as that user before continuing.

In the ClearML UI:

1. Open **Settings**.
2. Open **Workspace**.
3. Find **App Credentials**.
4. Create a new credentials pair.
5. Use a recognizable label such as `clearpipe-scheduler-esa`.
6. Copy both the access key and secret key when displayed.

The secret key is shown only when the credential pair is created. If it is
lost, revoke that pair and create a new one.

On the Ubuntu administration machine, first confirm the Kubernetes Secret does
not already exist:

```bash
kubectl -n "$CLEARML_NAMESPACE" get secret \
  clearpipe-scheduler-credentials
```

If it exists, stop and review it instead of overwriting it.

Restrict permissions on the generated Secret manifest:

```bash
umask 077
```

Paste the App Credentials into visible prompts so the values can be checked
before generating the manifest. Input supplied to `read` is not stored as a
shell command in history, but both values will be visible on screen. Use a
private terminal session without screen sharing or recording:

```bash
read -rp "ClearPipe scheduler access key: " CLEARPIPE_ACCESS_KEY

read -rp "ClearPipe scheduler secret key (visible): " CLEARPIPE_SECRET_KEY

export CLEARPIPE_ACCESS_KEY
export CLEARPIPE_SECRET_KEY
```

Visually compare both pasted values with the pair displayed by ClearML before
continuing. Do not paste them directly into an `export KEY="value"` command,
because that would store the credential in shell history.

Generate `clearpipe-scheduler-credentials.yaml` using the same protected Python
heredoc pattern used to generate `apiserver.conf`:

```bash
python3 - <<'PY' > clearpipe-scheduler-credentials.yaml
import base64
import json
import os

namespace = json.dumps(os.environ["CLEARML_NAMESPACE"])
access_key = json.dumps(
    base64.b64encode(os.environ["CLEARPIPE_ACCESS_KEY"].encode()).decode()
)
secret_key = json.dumps(
    base64.b64encode(os.environ["CLEARPIPE_SECRET_KEY"].encode()).decode()
)

print(
    f"""apiVersion: v1
kind: Secret
metadata:
  name: clearpipe-scheduler-credentials
  namespace: {namespace}
type: Opaque
data:
  access_key: {access_key}
  secret_key: {secret_key}
"""
)
PY

unset CLEARPIPE_ACCESS_KEY
unset CLEARPIPE_SECRET_KEY
```

The Python code base64-encodes the two values because they are written under
the Kubernetes Secret `data` field. Base64 encoding is not encryption; the file
must still be handled as clear-text secret material.

Confirm that the generated file is owner-readable only:

```bash
test -s clearpipe-scheduler-credentials.yaml
ls -l clearpipe-scheduler-credentials.yaml
```

Do not print the file and never commit it to Git.

Create the Kubernetes Secret:

```bash
kubectl create -f clearpipe-scheduler-credentials.yaml
```

`kubectl create` intentionally fails if the Secret already exists, preventing
an accidental credential replacement.

Store the App Credentials in the organization's approved secret manager before
removing the temporary manifest. Then delete it:

```bash
shred -u clearpipe-scheduler-credentials.yaml 2>/dev/null \
  || rm -f clearpipe-scheduler-credentials.yaml
```

Verify only the Secret's data-key names:

```bash
kubectl -n "$CLEARML_NAMESPACE" get secret \
  clearpipe-scheduler-credentials \
  -o go-template='{{range $key, $value := .data}}{{printf "%s\n" $key}}{{end}}'
```

Expected output:

```text
access_key
secret_key
```

Do not use the ClearML UI password, bcrypt password hash, provenance key, or
internal `clearml-server-secrets` values for this Secret. It requires the App
Credentials pair created by ClearML.

### 8.7 Enable and sync the scheduler

Return to the Argo CD Application configuration.

Remove the temporary Helm parameter:

```text
clearpipeScheduler.enabled=false
```

Remove the parameter entirely instead of changing it to `true`. Once removed,
the `clearpipeScheduler.enabled: true` value from `esa-values.yaml` becomes
effective again.

Save the Application and select **Hard Refresh**.

Review the diff and confirm it now includes:

- Deployment `clearml-server-clearpipe-scheduler`.
- Secret reference `clearpipe-scheduler-credentials`.
- Secret keys `access_key` and `secret_key`.
- Environment variable `CLEARPIPE_SCHEDULER_POLL_SECONDS`.
- Scheduler image tag `2026-07-27`.

Select **Sync**, then **Synchronize**. Keep Force and Replace disabled.

### 8.8 Monitor Argo CD and the scheduler

Watch the Argo CD resource tree and event panel. The desired final Application
state is:

```text
Sync Status: Synced
Health Status: Healthy
```

Confirm the scheduler rollout:

```bash
kubectl -n "$CLEARML_NAMESPACE" rollout status \
  deployment/clearml-server-clearpipe-scheduler \
  --timeout=10m
```

Inspect recent scheduler logs:

```bash
kubectl -n "$CLEARML_NAMESPACE" logs \
  deployment/clearml-server-clearpipe-scheduler \
  --tail=100
```

An `auth.login failed: 401` message means the values in
`clearpipe-scheduler-credentials` are not a valid active ClearML App
Credentials pair.

If the Application is `OutOfSync`, `Degraded`, or remains `Progressing`, open
the affected resource and read its event message before retrying.

The externally created Secrets are not tracked as chart resources. Argo CD must
reference them but must not attempt to create, replace, or prune them.

## 9. Verify the deployment

Check pod status:

```bash
kubectl -n "$CLEARML_NAMESPACE" get pods -w
```

Press `Ctrl+C` after the pods settle, then verify the principal Deployments:

```bash
kubectl -n "$CLEARML_NAMESPACE" rollout status \
  deployment/clearml-server-apiserver \
  --timeout=10m

kubectl -n "$CLEARML_NAMESPACE" rollout status \
  deployment/clearml-server-clearpipe-scheduler \
  --timeout=10m

kubectl -n "$CLEARML_NAMESPACE" rollout status \
  deployment/clearml-server-webserver \
  --timeout=10m
```

If a pod does not start, inspect events before printing application logs:

```bash
kubectl -n "$CLEARML_NAMESPACE" describe pod <pod-name>
```

Typical Secret-related errors are:

- `secret "clearml-fixed-users" not found`
- `secret "clearml-provenance" not found`
- `couldn't find key signing-key in Secret`

These indicate a namespace, Secret-name, or data-key mismatch.

## 10. Updating fixed users

To add a user or change a password:

1. Generate all required bcrypt hashes.
2. Recreate the complete `apiserver.conf`; it must contain every user who
   should remain authorized.
3. Review the file before applying it.
4. Update the Secret intentionally:

```bash
kubectl -n "$CLEARML_NAMESPACE" create secret generic clearml-fixed-users \
  --from-file=apiserver.conf=./apiserver.conf \
  --dry-run=client \
  -o yaml |
kubectl apply -f -
```

5. Restart both apiserver Deployments so they load the updated configuration:

```bash
kubectl -n "$CLEARML_NAMESPACE" rollout restart \
  deployment/clearml-server-apiserver

kubectl -n "$CLEARML_NAMESPACE" rollout restart \
  deployment/clearml-server-apiserver-asyncdelete
```

6. Wait for both rollouts to complete, test login, and securely remove the
   local `apiserver.conf`.

## 11. Provenance-key rotation warning

Do not rotate `clearml-provenance/signing-key` by simply replacing its value.
The current ESA values use the key ID `current`. Reusing that ID for different
key material can invalidate existing signatures.

A controlled rotation requires:

1. A new key ID.
2. The new signing key.
3. Retaining the old verification key for a transition period.
4. Updating the ClearPipe provenance key-ring configuration.
5. Verifying existing and newly created provenance records before retiring the
   old key.

Treat this as a planned application migration, not a routine `kubectl apply`.

## 12. What `render-tests.ps1` is for

`ci/render-tests.ps1` is a chart development and CI regression test. It:

- Runs `helm template` against several values combinations.
- Confirms that ESA password authentication is rendered.
- Confirms that the fixed-user and provenance Secret references are rendered.
- Confirms that scheduler configuration is rendered.
- Confirms that invalid OIDC and SMTP configurations fail with useful errors.

It does not:

- Connect to Kubernetes.
- Create or update Secrets.
- Install the Helm release.
- Run inside ClearML containers.
- Need to be installed on every Ubuntu cluster VM.

If PowerShell Core and Helm are installed on an Ubuntu administration or CI
machine, run the full regression test with:

```bash
cd clearml-charts
pwsh ./ci/render-tests.ps1
```

PowerShell is optional for deployment. On an Ubuntu-only administration
machine, the `helm lint` and `helm template` commands in this guide provide the
essential ESA-specific pre-deployment validation.

## Security notes

- Never commit generated Secret manifests, `apiserver.conf`, password hashes,
  or provenance keys to Git.
- Restrict RBAC access to Secrets and to workloads that can mount them.
- Enable Kubernetes Secret encryption at rest for the cluster's datastore.
- Keep the provenance key in an approved external secret manager or encrypted
  backup so the cluster can be recovered without changing the key.
- Review the official
  [Kubernetes Secrets guidance](https://kubernetes.io/docs/concepts/configuration/secret/)
  when defining cluster RBAC, encryption-at-rest, and backup policy.
