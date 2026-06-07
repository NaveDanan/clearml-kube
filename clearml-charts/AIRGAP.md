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

The `clearml-server-secrets` secret must contain the ClearML keys expected by
the chart. The chart comments in `values.yaml` document the required key names.

## Helm/ArgoCD Values

Use both values files, in this order:

```text
values.yaml
esa-values.yaml
```

For ArgoCD:

```text
Repository/path: the transferred chart folder
Namespace: clearml-server
Value files:
  values.yaml
  esa-values.yaml
```
