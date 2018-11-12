import { MultiRegionVPC, VPCInformation } from './pulumi/aws/multi-region';
import { ec2 } from '@pulumi/aws';
import * as crypto from 'crypto';
import * as fs from 'fs';

async function main() {
  // We just need to create a VPC in a single region for the time being
  const multiRegionVPC = new MultiRegionVPC(['us-east-1']);
  const vpcInformation = multiRegionVPC.create();

  return createConsulCluster(
    vpcInformation,
    'ami-a06bd7df',
    'dell-laptop-xps-15',
    ec2.T2InstanceMedium);
}

async function createConsulCluster(vpcInformation: Promise<VPCInformation>[], ami: string, keyPairName: string, instanceType: ec2.InstanceType) {
  const vpc = await vpcInformation[0];
  // We will want to assign the VPC security groups to each instance we launch
  const vpcSecurityGroups = vpc.vpc.securityGroups;
  const subnets = vpc.subnets;
  const subnetInformation = subnets[0];

  const buddyUser = 'admin';
  const buddyPassword = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('base64').replace(/[\+\=\/]/g, '');

  // Preamble and the provisioning parts are the same for all scripts so they're factored out.
  const userDataPreamble = [
    '#!/bin/bash -eu',
    'set -x && set -o pipefail',
    'echo $(pwd) "${BASH_SOURCE}"',
    'apt update && apt install --yes ruby',
  ].join("\n");
  const userDataProvisioning = [
    'base64 -d provision.rb.base64 > provision.rb',
    'chmod +x provision.rb',
    'source ./env.sh',
    './provision.rb'
  ].join("\n");

  // Cloud-init-buddy cloud-init script
  const buddyUserData = [
    userDataPreamble,
    'cat <<EOF > env.sh',
    `export BUDDY_PASSWORD="${buddyPassword}"`,
    `export BUDDY_USER="${buddyUser}"`,
    'EOF',
    'cat <<EOF > provision.rb.base64',
    fs.readFileSync(`${__dirname}/scripts/ruby/cloud-init-buddy.rb`).toString('base64'),
    'EOF',
    userDataProvisioning
  ].join("\n");

  // Cloud init buddy node creation
  const cloudInitBuddyArgs: ec2.InstanceArgs = {
    ami: ami,
    instanceType: instanceType,
    availabilityZone: subnetInformation.az,
    subnetId: subnetInformation.publicSubnet.id,
    keyName: keyPairName,
    userData: buddyUserData,
    vpcSecurityGroupIds: vpcSecurityGroups,
    tags: { Name: 'cloud-init-buddy' }
  };
  // Create the instance
  const cloudInitBuddy = new ec2.Instance('cloud-init-buddy', cloudInitBuddyArgs);

  // And now the consul cluster creation. We are going to create a 3 node cluster and coordinate
  // the bootstrapping process with cloud-init-buddy node we created above.
  const consulUrl = 'https://releases.hashicorp.com/consul/1.3.0/consul_1.3.0_linux_amd64.zip';
  const nodeCount = 3;
  // Pass along the private IP address of the cloud-init-buddy node so the consul nodes can coordinate
  const consulNodeBootstrapScript = cloudInitBuddy.privateIp.apply(buddyIp => {
    const consulNodeUserData = [
      userDataPreamble,
      'cat <<EOF > env.sh',
      `export ENDPOINT="https://${buddyUser}:${buddyPassword}@${buddyIp}:8443"`,
      `export NODE_COUNT="${nodeCount}"`,
      `export CONSUL_DOWNLOAD_URL="${consulUrl}"`,
      'EOF',
      'cat <<EOF > provision.rb.base64',
      fs.readFileSync(`${__dirname}/scripts/ruby/consul.rb`).toString('base64'),
      'EOF',
      userDataProvisioning
    ].join("\n");
    return consulNodeUserData;
  });

  // 3 node cluster
  const consulNodes = [1, 2, 3].map(async (nodeNumber) => {
    const consulNodeArguments: ec2.InstanceArgs = {
      ami: ami,
      instanceType: instanceType,
      availabilityZone: subnetInformation.az,
      subnetId: subnetInformation.publicSubnet.id,
      keyName: keyPairName,
      userData: consulNodeBootstrapScript,
      vpcSecurityGroupIds: vpcSecurityGroups,
      tags: { Name: `consul-node-${nodeNumber}` }
    };
    const consulNode = new ec2.Instance(`consul-node-${nodeNumber}`, consulNodeArguments);
    return consulNode;
  });

  // Return the node information upstream in case other nodes need to know the consul node addresses
  // or need to coordinate their own bootstrapping process with cloud-init-buddy
  return {
    buddyNode: {
      node: cloudInitBuddy,
      user: buddyUser,
      password: buddyPassword
    },
    consulNodes: consulNodes
  };
}

// Kick off the process
main();