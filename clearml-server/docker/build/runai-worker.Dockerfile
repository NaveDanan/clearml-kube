ARG BASE_IMAGE=clearml/server:latest
FROM ${BASE_IMAGE}

ARG RUNAI_WORKER_VERSION=2026-06-03
ARG RUNAI_SHA256=4f399c356df68bb0e163efa264d5b8f0e4f48e359d82c1ef8fceabc1fbb1d6f1
ARG OC_TAR_SHA256=98fa43ed39a7c20d5e4fe373267ab4ed51091d6a445277a9b62fa60303443532

LABEL org.opencontainers.image.title="ClearML Run:ai Worker"
LABEL org.opencontainers.image.version="${RUNAI_WORKER_VERSION}"

USER root
COPY runai /tmp/runai
COPY oc.tar.gz /tmp/oc.tar.gz

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates tar; \
    echo "${RUNAI_SHA256}  /tmp/runai" | sha256sum -c -; \
    echo "${OC_TAR_SHA256}  /tmp/oc.tar.gz" | sha256sum -c -; \
    install -m 0755 /tmp/runai /usr/local/bin/runai-v2; \
    ln -sf /usr/local/bin/runai-v2 /usr/local/bin/runai; \
    ln -sf /usr/local/bin/runai-v2 /usr/local/bin/runai-v1; \
    tar -xzf /tmp/oc.tar.gz -C /tmp; \
    install -m 0755 /tmp/oc /usr/local/bin/oc; \
    if [ -f /tmp/kubectl ]; then install -m 0755 /tmp/kubectl /usr/local/bin/kubectl; fi; \
    rm -f /tmp/runai /tmp/oc.tar.gz /tmp/oc /tmp/kubectl /tmp/README.md; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

USER 1000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD /usr/local/bin/oc version --client=true >/dev/null 2>&1 && \
      (/usr/local/bin/runai-v1 --version >/dev/null 2>&1 || /usr/local/bin/runai-v1 version >/dev/null 2>&1) && \
      (/usr/local/bin/runai-v2 --version >/dev/null 2>&1 || /usr/local/bin/runai-v2 version >/dev/null 2>&1) || exit 1
