# ArgoCD deployment manifests for ClearML on minikube

## Current layout

```text
argocd/
  clearml-app.yaml      ArgoCD Application for the local ClearML Helm chart
clearml-charts/
  Chart.yaml            ClearML Helm chart with the Run:ai worker template
  values-minikube.yaml  Local minikube image and NodePort overrides
```

## Deploy through ArgoCD

ArgoCD cannot deploy directly from `D:\Projects\clearml`. Push this project root
to a Git repository that the in-cluster ArgoCD repo server can access, then update
`argocd/clearml-app.yaml`:

```yaml
spec:
  source:
    repoURL: https://github.com/<owner>/<repo>.git
    path: clearml-charts
    targetRevision: main
```

Apply the app if you want to create the ArgoCD Application from kubectl:

```powershell
kubectl apply -f .\argocd\clearml-app.yaml
kubectl get applications -n argocd
```

Or create it manually in the ArgoCD UI:

```text
Application name: clearml
Project: default
Repository URL: https://github.com/NaveDanan/clearml-kube.git
Revision: main
Path: clearml-charts
Cluster URL: https://kubernetes.default.svc
Namespace: clearml
Helm value files:
  values.yaml
  values-testing.yaml
Sync option:
  Create namespace
```

If ArgoCD is already port-forwarded to `8443`, open:

```text
https://localhost:8443
```

## Restore minikube and local forwards

Use the helper script to start the `clearml` minikube profile if needed, wait
for ArgoCD applications to become healthy, and restore the saved local
port-forwards:

```powershell
.\argocd\start-argocd-port-forward.ps1
```

The saved configuration lives in `argocd/port-forward.config.json`. It
currently restores:

```text
https://localhost:8443  -> argocd/argocd-server
http://localhost:8080   -> clearml-server/clearml-server-webserver
http://localhost:8008   -> clearml-server/clearml-server-apiserver
http://localhost:8081   -> clearml-server/clearml-server-fileserver
```

This workstation also has a per-user Startup shortcut named `ClearML ArgoCD Port
Forward.lnk`, so the helper runs after login. If the minikube profile was
stopped, the helper starts it again. If you stop the minikube container from
Docker Desktop, do not start only the container there; run `minikube start -p
clearml` or run this helper so Minikube restarts the kubelet, apiserver, and
kubeconfig correctly. Kubernetes resources and ArgoCD Applications persist
across `minikube stop` / `minikube start`; if the profile is deleted,
recreate/apply the ArgoCD app first.

To check whether the forwards are active:

```powershell
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in @(8443,8080,8008,8081)
kubectl get svc -n argocd argocd-server
kubectl get applications -n argocd
kubectl get pods -n argocd
kubectl get svc -n clearml-server
```

## Local ClearML access

The testing values expose the services as NodePorts, but on Docker Desktop
minikube the most reliable local access is port-forwarding:

```powershell
kubectl port-forward -n clearml svc/clearml-webserver 8080:8080
kubectl port-forward -n clearml svc/clearml-apiserver 8008:8008
kubectl port-forward -n clearml svc/clearml-fileserver 8081:8081
```

Then open:

```text
http://localhost:8080
```

Quick API check:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8008/debug.ping
```

## Refresh local images

The testing values use `clearml/server:local` and
`clearml/runai-worker:local` with `imagePullPolicy: IfNotPresent`. Reusing the
same tag is fine for local work, but you must rebuild, load into minikube, and
restart the pods whenever source changes should appear in the cluster:

```powershell
docker build -f .\Dockerfile.local -t clearml/server:local .
docker build -f .\clearml-server\docker\build\runai-worker.Dockerfile -t clearml/runai-worker:local .

minikube image load clearml/server:local
minikube image load clearml/runai-worker:local

kubectl rollout restart deployment -n clearml clearml-apiserver clearml-apiserver-asyncdelete clearml-webserver clearml-fileserver clearml-runai-worker
kubectl rollout status deployment -n clearml clearml-apiserver
kubectl rollout status deployment -n clearml clearml-webserver
kubectl rollout status deployment -n clearml clearml-runai-worker
```

To confirm the expected image is running:

```powershell
kubectl describe pod -n clearml -l app.kubernetes.io/instance=clearml-webserver | Select-String "Image ID"
kubectl describe pod -n clearml -l app.kubernetes.io/instance=clearml-runai-worker | Select-String "Image ID"
```

