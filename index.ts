import { MultiRegionVPC } from './pulumi/aws/multi-region';
import { ec2 } from '@pulumi/aws';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { KeyPair } from '@pulumi/aws/lightsail';
import { KeyPairArgs } from '@pulumi/aws/ec2';

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
  // The cloud-init script is a little tricky to get right because of escaping issues so we try to do the
  // next best thing. Each provisioning script has a pre-amble that exposes the required script variables,
  // followed by a base64 encoded block that is written to a file, follow by base64 decoding and execution.
  // This avoids all encoding issues and forces each provisioning script to have a nice and clean interface.
  const buddyUserData = [
    '#!/bin/bash -eu',
    'set -x',
    'set -o pipefail',
    `export BUDDY_PASSWORD="${buddyPassword}"`,
    `export BUDDY_USER="${buddyUser}"`,
    'cat <<EOF > provision.sh.base64',
    fs.readFileSync(`${__dirname}/scripts/cloud-init-buddy.sh`).toString('base64'),
    'EOF',
    'base64 -d provision.sh.base64 > provision.sh',
    'chmod +x provision.sh',
    './provision.sh'
  ].join("\n");

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
      const consulNodeUserData = [
        '#!/bin/bash -eu',
        'set -x',
        'set -o pipefail',
        'echo $(pwd) "${BASH_SOURCE}"',
        `export ENDPOINT="https://${buddyUser}:${buddyPassword}@${buddyIp}:8443"`,
        `export NODE_COUNT="${nodeCount}"`,
        `export CONSUL_DOWNLOAD_URL="${consulUrl}"`,
        'cat <<EOF > provision.sh.base64',
        fs.readFileSync(`${__dirname}/scripts/consul.sh`).toString('base64'),
        'EOF',
        'base64 -d provision.sh.base64 > provision.sh',
        'chmod +x provision.sh',
        './provision.sh'
      ].join("\n");
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