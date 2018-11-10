#!/bin/bash eu
# Intercace: ENDPOINT, NODE_COUNT, CONSUL_DOWNLOAD_URL
set -x
set -o pipefail
echo $(pwd) "${BASH_SOURCE}"
mkdir -p /consul
cd /consul
while ! (wget "${CONSUL_DOWNLOAD_URL}"); do
  echo "Waiting for network to be ready"
  sleep 2
done
apt install -y zip
unzip -o *.zip
rm -f *.zip
# We need the private address for coordination
export SELF_ADDRESS="$(ip addr show eth0 | grep 'inet ' | awk '{print $2}' | cut -f1 -d'/')"
# Metadata endpoint for coordination
export CONSUL_ENDPOINT="${ENDPOINT}/metadata/consul"
# Initialize the hosts so it can be populated. This can fail so we need to loop until success
while ! (curl -k -XPOST "${CONSUL_ENDPOINT}" -d '{"hosts":[]}'); do
  echo "Failed to initialize metadata endpoint. Sleeping and retrying"
  sleep 2
done
# If we don't have enough registered nodes then loop until we do
while [[ "$(curl -k "${CONSUL_ENDPOINT}/hosts.length")" -lt "${NODE_COUNT}" ]]; do
  # It is possible some other node reset everything so make sure we re-register
  if ! (curl -k "${CONSUL_ENDPOINT}" | grep "${SELF_ADDRESS}"); then
    curl -k -XPOST "${CONSUL_ENDPOINT}/hosts" -d "${SELF_ADDRESS}"
  fi
  echo "Waiting for other nodes to register."
  sleep 1
done
# Whoever registered first will set a key
if [[ "$(curl -k "${CONSUL_ENDPOINT}/hosts/0")" == "${SELF_ADDRESS}" ]]; then
  key="$(./consul keygen | head -c 24)"
  curl -k -XPOST -d \"{\"key\":\"${key}\"}\" "${CONSUL_ENDPOINT}"
fi
# Wait for the key to be set
while ! (curl -k "${CONSUL_ENDPOINT}.keys" | grep "key"); do
  echo "Waiting for key to be set"
  sleep 1
done
# Everyone is registered and there is a key so we can form the cluster.
# In a production setting this would be an actual systemd unit file 
# and you would not use public facing IP addresses, i.e. you'd run
# the nodes in a private address space
nohup ./consul agent -ui -syslog -server -bootstrap-expect "${NODE_COUNT}" \
  -data-dir "/consul" \
  -bind "${SELF_ADDRESS}" \
  -advertise "${SELF_ADDRESS}" \
  -encrypt "$(curl -k "${CONSUL_ENDPOINT}/key" | tr -d '"')" \
-retry-join "$(curl -k "${CONSUL_ENDPOINT}/hosts/0" | tr -d '"')" &