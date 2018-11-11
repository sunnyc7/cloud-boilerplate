#!/bin/bash -eu
# Interface to this script is exporting the relevant variables.
# The relevant variables: BUDDY_USER, BUDDY_PASSWORD
set -x
set -o pipefail
# Useful information for debugging when looking at /var/log/cloud-init-output.log
echo $(pwd) "${BASH_SOURCE}"
# Start the provisinoing process
apt update && sudo apt install --yes ruby git
git clone https://github.com/cloudbootup/cloud-init-buddy.git
cd cloud-init-buddy
rake setup:initialize
rake flyway:check || rake flyway:install
rake postgres:configure
npm install
# We need to listen on all interfaces. Default configuration listens
# only on localhost (127.0.0.1)
sed -i 's/127.0.0.1/0.0.0.0/' lib/config.ts
# Compile everything to js. Don't error out if there is an error because
# some files will not have type information so tsc will complain.
./node_modules/.bin/tsc || true
# Generate certificates. We want to sever everything over HTTPS.
node utils/generate-certificate.js
# Start the application in a tmux session. In a production environment
# this should be a systemd unit file.
tmux new-session -d -s cloud-init-buddy 'node app.js' && sleep 1
# Keep the password around just in case
echo "${BUDDY_PASSWORD}" > password
# Add the admin user and any other necessary users so that other nodes
# can talk to cloud-init-buddy and coordinate.
node utils/users.js add-user "${BUDDY_USER}" "${BUDDY_PASSWORD}"