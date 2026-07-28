ARG PYTHON_RUNTIME_IMAGE=python:3.11-slim
FROM ${PYTHON_RUNTIME_IMAGE}

ARG PIP_INDEX_URL=https://pypi.org/simple
ARG PIP_TRUSTED_HOST=
ARG AIRGAP_CA_CERT_B64=

ENV PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST} \
    PIP_CERT=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

USER root

RUN if [ -n "${AIRGAP_CA_CERT_B64}" ]; then \
        mkdir -p /usr/local/share/ca-certificates; \
        printf '%s' "${AIRGAP_CA_CERT_B64}" | base64 -d > /usr/local/share/ca-certificates/airgap-custom-ca.crt; \
        chmod 0644 /usr/local/share/ca-certificates/airgap-custom-ca.crt; \
        update-ca-certificates; \
    fi

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY scheduler.py ./

# Runs as an unprivileged user; no ports are exposed (outbound API calls only).
RUN useradd --create-home --uid 10001 scheduler && chown -R scheduler:scheduler /app
USER scheduler

ENTRYPOINT ["python", "-u", "scheduler.py"]
