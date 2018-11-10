import { MultiRegionVPC } from './pulumi/aws/multi-region';
import { ec2 } from '@pulumi/aws';
import * as crypto from 'crypto';

async function main() {
  // We just need to create a VPC in a single region for the time being
  const multiRegionVPC = new MultiRegionVPC(['us-east-1']);
  const vpcInformation = multiRegionVPC.create();

  // Extract the availability zone where we will deploy the instance
  const vpc = await vpcInformation[0];
  // We will want to assign the VPC security groups to each instance we launch
  const vpcSecurityGroups = vpc.vpc.securityGroups;
  const subnets = vpc.subnets;
  const subnetInformation = subnets[0];

  // Some common options
  const ami = 'ami-a06bd7df';
  const keyPairName = 'dell-laptop-xps-15';
  const instanceType = ec2.T2InstanceMedium;
  const buddyUser = 'admin';
  // Generate a random password for the node
  const buddyPassword = crypto.createHash('sha256').update(
    crypto.randomBytes(32)).digest('base64').replace(/[\+\=\/]/g, '');
  // Log the username and password
  console.log('Buddy username', buddyUser);
  console.log('Buddy passowrd', buddyPassword);
  // All the code necessary for bootstrapping cloud-init-buddy node
  const buddyUserData = `#!/bin/bash -eu
    set -x
    set -o pipefail
    echo $(pwd)
    apt update && sudo apt install --yes ruby git
    git clone https://github.com/cloudbootup/cloud-init-buddy.git
    cd cloud-init-buddy
    rake setup:initialize
    rake flyway:check || rake flyway:install
    rake postgres:configure
    npm install
    # We need to listen on all interfaces
    sed -i 's/127.0.0.1/0.0.0.0/' lib/config.ts
    # Compile everything to js
    ./node_modules/.bin/tsc || true
    # Generate certificates
    node utils/generate-certificate.js
    tmux new-session -d -s cloud-init-buddy 'node app.js' && sleep 1
    echo '${buddyPassword}' > node-password
    node utils/users.js add-user '${buddyUser}' '${buddyPassword}'
  `;

  // Cloud init buddy node creation
  const cloudInitBuddyArgs: ec2.InstanceArgs = {
    ami: ami, // pre-baked AMI
    instanceType: instanceType, // The size we want
    availabilityZone: subnetInformation.az, // Where is the instance running
    subnetId: subnetInformation.publicSubnet.id, // What is the subnet it's running in
    keyName: keyPairName, // The ssh key we need to log into the instance
    userData: buddyUserData, // Bootstrapping the node with cloud-init
    vpcSecurityGroupIds: vpcSecurityGroups, // Security group IDs we want to attach to the instance
    tags: {
      Name: 'cloud-init-buddy'
    }
  };
  // Create the instance
  const cloudInitBuddy = new ec2.Instance('cloud-init-buddy', cloudInitBuddyArgs);

  // We need the latest consul binary. They make it surprisingly hard to get programmatically
  const consulUrl = 'https://releases.hashicorp.com/consul/1.3.0/consul_1.3.0_linux_amd64.zip';
  const consulNodes = [1, 2, 3].map(async nodeNumber => {
    // The cloud-init script has to be different so that the consul nodes can talk to the cloud-init
    // buddy node and coordinate the consul cluster bootstrap process
    const nodeCount = 3;
    console.log('Consul node count', nodeCount);
    // Grab the latest version of consul from the releases URL. This really needs to be better
    const consulNodeBootstrapScript = cloudInitBuddy.privateIp.apply(buddyIp => {
      // Log the IP address of the buddy node
      console.log('Buddy IP address', buddyIp);
      const consulNodeUserData = `#!/bin/bash -eu
        set -x
        set -o pipefail
        echo $(pwd)
        export CLOUD_INIT_BUDDY="${buddyIp}"
        export PASSWORD="${buddyPassword}"
        export ENDPOINT="https://${buddyUser}:${buddyPassword}@${buddyIp}:8443"
        export NODE_COUNT="${nodeCount}"
        mkdir /consul
        cd /consul
        while ! (wget '${consulUrl}'); do
          echo "Waiting for network to be ready"
          sleep 2
        done
        apt install -y zip
        unzip -o *.zip
        rm -f *.zip
        # We need the private address for coordination
        export SELF_ADDRESS="$(ip addr show eth0 | grep 'inet ' | awk '{print $2}' | cut -f1 -d'/')"
        # Metadata endpoint for coordination
        export CONSUL_ENDPOINT="$\{ENDPOINT}/metadata/consul"
        # Initialize the hosts so it can be populated. This can fail so we need to loop until success
        while ! (curl -k -XPOST "$\{CONSUL_ENDPOINT}" -d '{"hosts":[]}'); do
          echo "Failed to initialize metadata endpoint. Sleeping and retrying"
          sleep 2
        done
        # If we don't have enough registered nodes then loop until we do
        while [[ "$(curl -k "$\{CONSUL_ENDPOINT}/hosts.length")" -lt "$\{NODE_COUNT}" ]]; do
          # It is possible some other node reset everything so make sure we re-register
          if ! (curl -k "$\{CONSUL_ENDPOINT}" | grep "$\{SELF_ADDRESS}"); then
            curl -k -XPOST "$\{CONSUL_ENDPOINT}/hosts" -d "\"$\{SELF_ADDRESS}\""
          fi
          echo "Waiting for other nodes to register."
          sleep 1
        done
        # Whoever registered first will set a key
        if [[ "$(curl -k "$\{CONSUL_ENDPOINT}/hosts/0")" == "\"$\{SELF_ADDRESS}\"" ]]; then
          key="$(./consul keygen | head -c 24)"
          curl -k -XPOST -d "{\"key\":\"$\{key}\"}" "$\{CONSUL_ENDPOINT}"
        fi
        # Wait for the key to be set
        while ! (curl -k "$\{CONSUL_ENDPOINT}.keys" | grep "key"); do
          echo "Waiting for key to be set"
          sleep 1
        done
        # Everyone is registered and there is a key so we can form the cluster.
        # In a production setting this would be an actual systemd unit file 
        # and you would not use public facing IP addresses, i.e. you'd run
        # the nodes in a private address space
        nohup ./consul agent -ui -syslog -server -bootstrap-expect "$\{NODE_COUNT}" \
          -data-dir "/consul" \
          -bind "$\{SELF_ADDRESS}" \
          -advertise "$\{SELF_ADDRESS}" \
          -encrypt "$(curl -k "$\{CONSUL_ENDPOINT}/key" | tr -d '"')" \
        -retry-join "$(curl -k "$\{CONSUL_ENDPOINT}/hosts/0" | tr -d '"')" &
      `;
      return consulNodeUserData;
    })
    // The arguments are basically the same as for the cloud-init-buddy node
    const consulNodeArguments: ec2.InstanceArgs = {
      ami: ami,
      instanceType: instanceType,
      availabilityZone: subnetInformation.az,
      subnetId: subnetInformation.publicSubnet.id,
      keyName: keyPairName,
      userData: consulNodeBootstrapScript,
      vpcSecurityGroupIds: vpcSecurityGroups,
      tags: {
        Name: `consul-node-${nodeNumber}`
      }
    };
    const consulNode = new ec2.Instance(`consul-node-${nodeNumber}`, consulNodeArguments);
    return consulNode;
  });

  // Return the node information upstream
  return {
    buddyNode: cloudInitBuddy,
    consulNodes: consulNodes
  };
}

main();