# Air-Gapped ESA Deployment

This chart is prepared for the ESA cluster values in `esa-values.yaml`.

## Images

`esa-values.yaml` expects these images in the air-gapped registry:

```text
dvd12af:5113/clearml/clearml:autoscalar-v2026-06-07
dvd12af:5113/clearml/runai-worker:2026-06-07
dvd12af:5113/clearml/redis:7.0.9-debian-11-r1
dvd12af:5113/clearml/mongodb:6.0.10-debian-11-r8
dvd12af:5113/clearml/elasticsearch:7.17.3
```

Load the exported tar on the connected staging host or registry host:

```bash
docker load -i clearml-airgap-images-2026-06-07.tar
```

If the load target is not already the final registry host, push the images:

```bash
docker push dvd12af:5113/clearml/clearml:autoscalar-v2026-06-07
docker push dvd12af:5113/clearml/runai-worker:2026-06-07
docker push dvd12af:5113/clearml/redis:7.0.9-debian-11-r1
docker push dvd12af:5113/clearml/mongodb:6.0.10-debian-11-r8
docker push dvd12af:5113/clearml/elasticsearch:7.17.3
```

## Required Existing Cluster Resources

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
(`clearml-server`). Image pull secrets are namespace-scoped; a secret with the
same name in `default`, `argocd`, or another namespace will not be used by
ClearML pods.

Create or copy it before syncing the ArgoCD application:

```bash
kubectl create namespace clearml-server
kubectl create secret docker-registry nave-pull-secret \
  --namespace clearml-server \
  --docker-server=dvd12af:5113 \
  --docker-username=<username> \
  --docker-password=<password>
```

The `clearml-server-secrets` secret must contain the ClearML keys expected by
the chart. The chart comments in `values.yaml` document the required key names.

## Helm/ArgoCD Values

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
the ArgoCD application is using the wrong values file. Replace
`values-testing.yaml` with `esa-values.yaml`, then hard refresh and sync.

For ArgoCD:

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
