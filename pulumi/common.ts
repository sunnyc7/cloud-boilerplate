export const userDataPreamble = [
  '#!/bin/bash -eu',
  'set -x && set -o pipefail',
  'echo $(pwd) "${BASH_SOURCE}"',
  'export DEBIAN_FRONTEND="noninteractive"',
  'while ! (apt update; sleep 2; apt install --yes ruby); do sleep 2; done'
].join("\n");

export const userDataProvisioning = [
  'base64 -d provision.rb.base64 > provision.rb',
  'chmod +x provision.rb',
  'source ./env.sh',
  './provision.rb'
].join("\n");