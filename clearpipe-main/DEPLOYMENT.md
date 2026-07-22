# ClearPipe - Docker & Kubernetes Deployment

This document provides instructions for deploying ClearPipe using Docker Compose (local development) and Helm (Kubernetes production).

## Table of Contents

- [Prerequisites](#prerequisites)
- [Docker Compose (Local Development)](#docker-compose-local-development)
- [Kubernetes (Production)](#kubernetes-production)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### For Docker Compose
- Docker Engine 20.10+
- Docker Compose v2.0+

### For Kubernetes
- Kubernetes 1.25+
- Helm 3.10+
- kubectl configured with cluster access
- (Optional) cert-manager for automatic TLS
- (Optional) nginx-ingress controller

---

## Docker Compose (Local Development)

### Quick Start

1. **Copy the environment file:**
   ```bash
   cp .env.docker.example .env
   ```

2. **Generate secure keys (recommended):**
   ```bash
   # Generate JWT secret
   openssl rand -base64 32
   
   # Update .env with the generated values
   ```

3. **Start all services:**
   ```bash
   docker compose up -d
   ```

4. **Access the application:**
   - Application: http://localhost
   - Supabase Studio: http://localhost:3001
   - Supabase API: http://localhost:8000

### Common Commands

```bash
# Start services
docker compose up -d

# View logs
docker compose logs -f

# View specific service logs
docker compose logs -f app

# Stop services
docker compose down

# Stop and remove volumes (clean slate)
docker compose down -v

# Rebuild application
docker compose build app
docker compose up -d app
```

### Development with Hot Reload

For development with hot reload, you can mount your source code:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

---

## Kubernetes (Production)

### Prerequisites Setup

1. **Install nginx-ingress controller:**
   ```bash
   helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
   helm install ingress-nginx ingress-nginx/ingress-nginx
   ```

2. **Install cert-manager (for TLS):**
   ```bash
   helm repo add jetstack https://charts.jetstack.io
   helm install cert-manager jetstack/cert-manager \
     --namespace cert-manager \
     --create-namespace \
     --set installCRDs=true
   ```

### Deployment

1. **Add Bitnami repo (for PostgreSQL/Redis):**
   ```bash
   helm repo add bitnami https://charts.bitnami.com/bitnami
   helm repo update
   ```

2. **Update Helm dependencies:**
   ```bash
   cd helm/clearpipe
   helm dependency update
   ```

3. **Create namespace:**
   ```bash
   kubectl create namespace clearpipe
   ```

4. **Create secrets (production):**
   ```bash
   kubectl create secret generic clearpipe-secrets \
     --namespace clearpipe \
     --from-literal=postgres-password='YOUR_SECURE_PASSWORD' \
     --from-literal=jwt-secret='YOUR_32_CHAR_JWT_SECRET' \
     --from-literal=anon-key='YOUR_ANON_KEY' \
     --from-literal=service-role-key='YOUR_SERVICE_ROLE_KEY'
   ```

5. **Deploy for development:**
   ```bash
   helm install clearpipe ./helm/clearpipe \
     --namespace clearpipe \
     -f ./helm/clearpipe/values-dev.yaml
   ```

6. **Deploy for production:**
   ```bash
   helm install clearpipe ./helm/clearpipe \
     --namespace clearpipe \
     -f ./helm/clearpipe/values-prod.yaml \
     --set ingress.hosts[0].host=clearpipe.yourdomain.com
   ```

### Upgrade Deployment

```bash
helm upgrade clearpipe ./helm/clearpipe \
  --namespace clearpipe \
  -f ./helm/clearpipe/values-prod.yaml
```

### Rollback

```bash
# List releases
helm history clearpipe -n clearpipe

# Rollback to previous version
helm rollback clearpipe -n clearpipe
```

### Uninstall

```bash
helm uninstall clearpipe -n clearpipe
```

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL | `http://localhost:8000` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | Demo key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Demo key |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | Demo secret |
| `POSTGRES_PASSWORD` | PostgreSQL password | `postgres` |

### Generating Supabase Keys

Use the Supabase key generator or create JWT tokens:

```bash
# Install jwt-cli
npm install -g jwt-cli

# Generate anon key
jwt encode --secret YOUR_JWT_SECRET '{"role":"anon","iss":"supabase","iat":1609459200,"exp":1893456000}'

# Generate service role key
jwt encode --secret YOUR_JWT_SECRET '{"role":"service_role","iss":"supabase","iat":1609459200,"exp":1893456000}'
```

### TLS/SSL Configuration

For production, configure TLS in Helm values:

```yaml
ingress:
  tls:
    - secretName: clearpipe-tls
      hosts:
        - clearpipe.yourdomain.com
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
```

---

## Troubleshooting

### Docker Compose Issues

**Services not starting:**
```bash
# Check logs
docker compose logs

# Check specific service
docker compose logs db
docker compose logs kong
```

**Database connection issues:**
```bash
# Verify database is healthy
docker compose exec db pg_isready -U postgres

# Check database logs
docker compose logs db
```

**Port conflicts:**
```bash
# Check what's using the port
netstat -tulpn | grep :80

# Change ports in .env
NGINX_PORT=8080
```

### Kubernetes Issues

**Pods not starting:**
```bash
# Check pod status
kubectl get pods -n clearpipe

# Describe failing pod
kubectl describe pod <pod-name> -n clearpipe

# Check logs
kubectl logs <pod-name> -n clearpipe
```

**Database connectivity:**
```bash
# Port forward to PostgreSQL
kubectl port-forward svc/clearpipe-postgresql 5432:5432 -n clearpipe

# Test connection
psql -h localhost -U postgres -d postgres
```

**Ingress not working:**
```bash
# Check ingress status
kubectl get ingress -n clearpipe

# Check ingress controller logs
kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx
```

---

## Architecture

```
                    ┌─────────────┐
                    │   Nginx     │
                    │   Ingress   │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
   ┌───────────┐    ┌───────────┐    ┌───────────┐
   │ ClearPipe │    │   Kong    │    │  Studio   │
   │    App    │    │   (API)   │    │ (Dev UI)  │
   └───────────┘    └─────┬─────┘    └───────────┘
                          │
         ┌────────┬───────┼───────┬────────┐
         │        │       │       │        │
         ▼        ▼       ▼       ▼        ▼
   ┌─────────┐ ┌──────┐ ┌────┐ ┌──────┐ ┌──────┐
   │  Auth   │ │ REST │ │ RT │ │ Stor │ │ Meta │
   │(GoTrue) │ │(PGRST)│ │    │ │ age  │ │      │
   └────┬────┘ └───┬──┘ └─┬──┘ └───┬──┘ └───┬──┘
        │          │      │        │        │
        └──────────┴──────┴────────┴────────┘
                          │
                    ┌─────┴─────┐
                    │ PostgreSQL│
                    └───────────┘
```

---

## Support

For issues and feature requests, please open a GitHub issue.
