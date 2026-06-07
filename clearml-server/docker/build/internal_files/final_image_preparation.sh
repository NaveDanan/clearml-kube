#!/usr/bin/env bash
set -x
set -o errexit
set -o nounset
set -o pipefail

apt-get update -y
apt-get install -y python3-setuptools python3-dev build-essential nginx gettext vim curl

python3 -m ensurepip
python3 -m pip install --upgrade pip
python3 -m pip install -r /opt/clearml/apiserver/requirements.txt
mkdir -p /opt/clearml/log
mkdir -p /opt/clearml/config
ln -svf /dev/stdout /var/log/nginx/access.log
ln -svf /dev/stderr /var/log/nginx/error.log
mv /tmp/internal_files/clearml.conf.template /etc/nginx/clearml.conf.template
mv /tmp/internal_files/clearml_subpath.conf.template /etc/nginx/clearml_subpath.conf.template

# Create non-root user for running services
groupadd -g 1000 clearml || true
useradd -u 1000 -g clearml -m -s /bin/bash clearml

# Prepare directories with correct ownership
mkdir -p /var/log/clearml /mnt/fileserver
chown -R clearml:clearml /opt/clearml /var/log/clearml /mnt/fileserver

# Configure nginx to run as non-root:
# - remove 'user' directive (not allowed when not root)
# - move pid file to /tmp (writable by any user)
# - change listen port from 80 to 8080
sed -i 's/^user www-data;/# user www-data;  # removed for rootless/' /etc/nginx/nginx.conf
sed -i 's|pid /run/nginx.pid;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf
chown -R clearml:clearml \
    /usr/share/nginx/html \
    /var/log/nginx \
    /var/lib/nginx \
    /etc/nginx \
    /run
# Ensure nginx cache/temp directories exist and are writable
mkdir -p /var/cache/nginx
chown -R clearml:clearml /var/cache/nginx

rm -d -r "$(pip cache dir)"
apt-get clean
