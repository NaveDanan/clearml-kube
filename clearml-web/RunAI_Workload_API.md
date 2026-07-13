# Run:AI Workload API Quick Reference

## Authentication (required once)

``` bash
curl -X POST "https://<RUNAI_URL>/api/v1/token" \
  -H "Content-Type: application/json" \
  -d '{
    "grantType":"client_credentials",
    "clientId":"<CLIENT_ID>",
    "clientSecret":"<CLIENT_SECRET>"
  }'
```

The response contains an `accessToken` and an `expiresIn` field.

**Important:** The `<ACCESS_TOKEN>` is typically valid for **1800
seconds (30 minutes)**. After it expires, you must request a **new
access token** by calling the authentication endpoint again with your
`CLIENT_ID` and `CLIENT_SECRET`.

Use the token in all subsequent requests:

``` text
Authorization: Bearer <ACCESS_TOKEN>
```

------------------------------------------------------------------------

## 1. Workload Details

``` bash
curl -X GET "https://<RUNAI_URL>/api/v1/workloads/<WORKLOAD_ID>" \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

Returns general information about the workload (status, resources, pods,
etc.).

------------------------------------------------------------------------

## 2. Workload Event History

``` bash
curl -X GET "https://<RUNAI_URL>/api/v1/workloads/<WORKLOAD_ID>/events" \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

Returns the lifecycle events for the workload.

------------------------------------------------------------------------

## 3. Workload Logs

``` bash
curl -X GET "https://<RUNAI_URL>/api/v1/workloads/<WORKLOAD_ID>/logs" \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

Returns the workload logs.

Optional parameters supported on some Run:AI versions:

``` text
?tailLines=100
?follow=true
?container=<container-name>
```

------------------------------------------------------------------------

## 4. Workload Metrics

``` bash
curl -G "https://<RUNAI_URL>/api/v1/workloads/<WORKLOAD_ID>/metrics" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  --data-urlencode "metricType=GPU_UTILIZATION" \
  --data-urlencode "metricType=GPU_MEMORY_USAGE_BYTES" \
  --data-urlencode "metricType=CPU_USAGE_CORES" \
  --data-urlencode "metricType=CPU_MEMORY_USAGE_BYTES" \
  --data-urlencode "start=2026-07-13T09:00:00Z" \
  --data-urlencode "end=2026-07-13T10:00:00Z" \
  --data-urlencode "numberOfSamples=60"
```

Returns GPU, CPU, memory, and other time-series metrics.

------------------------------------------------------------------------

## Summary

  Information        Endpoint
  ------------------ ----------------------------------------------
  Workload details   `GET /api/v1/workloads/{workloadId}`
  Event history      `GET /api/v1/workloads/{workloadId}/events`
  Logs               `GET /api/v1/workloads/{workloadId}/logs`
  Metrics            `GET /api/v1/workloads/{workloadId}/metrics`

> **Note:** Endpoint availability varies between Run:AI versions. Older
> on-prem releases may expose different API paths, particularly for logs
> and events.
