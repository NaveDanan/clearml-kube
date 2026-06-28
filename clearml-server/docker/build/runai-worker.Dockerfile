ARG BASE_IMAGE=clearml/server:latest
FROM ${BASE_IMAGE}

ARG RUNAI_WORKER_VERSION=2026-06-03
ARG RUNAI_V1_SHA256=
ARG RUNAI_V2_SHA256=
ARG OC_TAR_SHA256=98fa43ed39a7c20d5e4fe373267ab4ed51091d6a445277a9b62fa60303443532

LABEL org.opencontainers.image.title="ClearML Run:ai Worker"
LABEL org.opencontainers.image.version="${RUNAI_WORKER_VERSION}"

USER root
COPY runai-v1 /tmp/runai-v1
COPY runai-v2 /tmp/runai-v2
COPY oc.tar.gz /tmp/oc.tar.gz

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates tar; \
    echo "${RUNAI_V1_SHA256}  /tmp/runai-v1" | sha256sum -c -; \
    echo "${RUNAI_V2_SHA256}  /tmp/runai-v2" | sha256sum -c -; \
    echo "${OC_TAR_SHA256}  /tmp/oc.tar.gz" | sha256sum -c -; \
    install -m 0755 /tmp/runai-v1 /usr/local/bin/runai-v1; \
    install -m 0755 /tmp/runai-v2 /usr/local/bin/runai-v2; \
    ln -sf /usr/local/bin/runai-v2 /usr/local/bin/runai; \
    tar -xzf /tmp/oc.tar.gz -C /tmp; \
    install -m 0755 /tmp/oc /usr/local/bin/oc; \
    if [ -f /tmp/kubectl ]; then install -m 0755 /tmp/kubectl /usr/local/bin/kubectl; fi; \
    rm -f /tmp/runai-v1 /tmp/runai-v2 /tmp/oc.tar.gz /tmp/oc /tmp/kubectl /tmp/README.md; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

USER 1000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD /usr/local/bin/oc version --client=true >/dev/null 2>&1 && \
      (/usr/local/bin/runai-v1 --version >/dev/null 2>&1 || /usr/local/bin/runai-v1 version >/dev/null 2>&1) && \
      (/usr/local/bin/runai-v2 --version >/dev/null 2>&1 || /usr/local/bin/runai-v2 version >/dev/null 2>&1) || exit 1
