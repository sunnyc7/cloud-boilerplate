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
  const buddyUserData = `#!/bin/bash
    echo $(pwd)
    apt update && sudo apt install --yes ruby git
    git clone https://github.com/cloudbootup/cloud-init-buddy.git
    cd cloud-init-buddy
    rake setup:initialize
    rake flyway:check || rake flyway:install
    rake postgres:configure
    npm install
    ./node_modules/.bin/tsc
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
    vpcSecurityGroupIds: vpcSecurityGroups // Security group IDs we want to attach to the instance
  };
  // Create the instance
  const cloudInitBuddy = new ec2.Instance('cloud-init-buddy', cloudInitBuddyArgs);

  // Now create 3 consul nodes
  const consulNodes = [1, 2, 3].map(nodeNumber => {
    // The cloud-init script has to be different so that the consul nodes can talk to the cloud-init
    // buddy node and coordinate the consul cluster bootstrap process
    const nodeCount = 3;
    const consulNodeBootstrapScript = cloudInitBuddy.privateIp.apply(buddyIp => {
      // Log the IP address of the buddy node
      console.log('Buddy IP address', buddyIp);
      const consulNodeUserData = `#!/bin/bash
        echo $(pwd)
        export CLOUD_INIT_BUDDY=${buddyIp}
        export PASSWORD=${buddyPassword}
        export ENDPOINT="https:${buddyUser}:${buddyPassword}@${buddyIp}:8443"
        export NODE_COUNT=${nodeCount}
        mkdir /consul
        cd /consul
        while ! (wget http://releases.hashicorp.com/consul/1.0.6/consul_1.0.6_linux_amd64.zip); do
          echo "Waiting for network to be ready"
          sleep 2
        done
        apt install -y zip
        unzip -o *.zip
        rm -f *.zip
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
      vpcSecurityGroupIds: vpcSecurityGroups
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