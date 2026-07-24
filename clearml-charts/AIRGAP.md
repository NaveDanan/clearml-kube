# Air-Gapped ESA Deployment

This chart is prepared for the ESA cluster values in `esa-values.yaml`.

## Images

`esa-values.yaml` expects these image names to exist in the air-gapped cluster
or in the registry/mirror used by the cluster:

```text
clearml/clearml:2026-06-24
clearml/runai-worker:2026-07-26
clearml/redis:7.0.9-debian-11-r1
clearml/mongodb:6.0.10-debian-11-r8
clearml/elasticsearch:7.17.3
```

Load the exported slim tar on the connected staging host or registry host:

```bash
docker load -i clearml-images-slim-2026-07-26.tar
```

The slim tar contains only the ClearML application images. The Redis, MongoDB,
and Elasticsearch images listed above must already exist in the cluster registry,
registry mirror, or node image cache. If the final cluster uses an internal
registry hostname, retag these images for that registry and update
`global.imageRegistry` in `esa-values.yaml` to match.

```bash
docker tag clearml/clearml:2026-06-24 <registry>/clearml/clearml:2026-06-24
docker tag clearml/runai-worker:2026-07-26 <registry>/clearml/runai-worker:2026-07-26
docker push <registry>/clearml/clearml:2026-06-24
docker push <registry>/clearml/runai-worker:2026-07-26
```

## Required existing cluster resources

The ESA values intentionally keep the existing cluster-specific names. Confirm
these resources already exist in the deployment namespace before syncing:

```text
Secret: nave-pull-secret
Secret: clearml-server-secrets
Secret: wildcard-certs-secret
StorageClass: nfs-main
IngressClass: nginx
```

`nave-pull-secret` must exist in the same namespace as the ClearML pods
(`clearml-server`). Image pull Secrets are namespace-scoped; a Secret with the
same name in another namespace will not be used by ClearML pods.

Provision or copy `nave-pull-secret` through the approved secret-management
process before syncing the Argo CD application. Do not put registry credential
data in this repository or in Helm values. Its name must match
`imageCredentials.existingSecret` when private image credentials are enabled.

The `clearml-server-secrets` Secret must be provisioned as
`clearml.existingSecret` for the ESA release. Its required keys, along with all
other chart credential contracts and rotation guidance, are documented in
[CREDENTIALS.md](CREDENTIALS.md).

## Helm/Argo CD values

Use both values files, in this order:

```text
values.yaml
esa-values.yaml
```

Do not use `values-testing.yaml` on the ESA or air-gapped cluster. That file is
only for local minikube and renders local Docker Hub image names such as:

```text
docker.io/clearml/server:local
docker.io/clearml/runai-worker:local
```

If a pod reports `ImagePullBackOff` for `docker.io/clearml/runai-worker:local`,
the Argo CD application is using the wrong values file. Replace
`values-testing.yaml` with `esa-values.yaml`, then hard refresh and sync.

For Argo CD:

```text
Repository/path: the transferred chart folder
Namespace: clearml-server
Value files:
  values.yaml
  esa-values.yaml
```

`esa-values.yaml` exposes ClearML through TLS ingress, not local NodePorts:

```text
https://clearml.mems.rafael.co.il       -> clearml-server-webserver:8080
https://api-clearml.mems.rafael.co.il   -> clearml-server-apiserver:8008
https://files-clearml.mems.rafael.co.il -> clearml-server-fileserver:8081
```

After syncing, validate the HTTPS layer with:

```bash
kubectl get ingress -n clearml-server
kubectl describe ingress -n clearml-server clearml-server-webserver
kubectl describe ingress -n clearml-server clearml-server-apiserver
kubectl describe ingress -n clearml-server clearml-server-fileserver
kubectl get secret -n clearml-server wildcard-certs-secret
kubectl get ingressclass nginx
```
