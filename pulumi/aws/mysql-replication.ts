import * as crypto from 'crypto';
import * as fs from 'fs';
import { VPCInformation } from './multi-region';
import { ec2 } from '@pulumi/aws';
import { userDataPreamble, userDataProvisioning } from '../common';

export class MySQLReplication {
  constructor(
    readonly vpcInformation: Promise<VPCInformation>[],
    readonly ami: string = 'ami-a06bd7df',
    readonly keyPairName: string = 'dell-laptop-xps-15',
    readonly instanceType: ec2.InstanceType = ec2.T2InstanceMedium
  ) { }

  async create() {
    const vpc = await this.vpcInformation[0];
    const vpcSecurityGroups = vpc.vpc.securityGroups;
    const subnets = vpc.subnets;
    const subnetInformation = subnets[0];

    const replicationUser = 'replication';
    const replicationPassword = crypto.createHash('sha256').update(
      crypto.randomBytes(32)).digest('base64').replace(/[\+\=\/]/g, '').slice(0, 31);

    // Master node cloud-init script
    const masterUserData = [
      userDataPreamble,
      'cat <<EOF > env.sh',
      `export REPLICATION_USER="${replicationUser}"`,
      `export REPLICATION_PASSWORD="${replicationPassword}"`,
      `export IS_REPLICA=0`, // The master node is not a replica
      `export MASTER_HOST=SELF`, // The master node doesn't need to connect to anything so any string will work
      `export SERVER_ID=1`, // Just personal convention but lowest ID is reserved for the master
      'EOF',
      'cat <<EOF > provision.rb.base64',
      fs.readFileSync(`${__dirname}/../../scripts/ruby/mysql.rb`).toString('base64'),
      'EOF',
      userDataProvisioning
    ].join("\n");

    const masterNodeName = 'mysql-master-node';
    const masterNodeArgs: ec2.InstanceArgs = {
      ami: this.ami,
      instanceType: this.instanceType,
      availabilityZone: subnetInformation.az,
      subnetId: subnetInformation.publicSubnet.id,
      keyName: this.keyPairName,
      userData: masterUserData,
      vpcSecurityGroupIds: vpcSecurityGroups,
      tags: { Name: masterNodeName }
    };
    const masterNode = new ec2.Instance(masterNodeName, masterNodeArgs);

    // 1 replicas
    const replicaNodes = [2].map(async (nodeNumber) => {
      const replicaNodeName = 'mysql-replica';
      // Pass along the private IP address of the master node
      const replicaNodeBootstrapScript = masterNode.privateIp.apply(masterIp => {
        const replicaUserData = [
          userDataPreamble,
          'cat <<EOF > env.sh',
          `export REPLICATION_USER="${replicationUser}"`,
          `export REPLICATION_PASSWORD="${replicationPassword}"`,
          `export IS_REPLICA=1`, // This is a replica node
          `export MASTER_HOST=${masterIp}`,
          `export SERVER_ID=${nodeNumber}`,
          'EOF',
          'cat <<EOF > provision.rb.base64',
          fs.readFileSync(`${__dirname}/../../scripts/ruby/mysql.rb`).toString('base64'),
          'EOF',
          userDataProvisioning
        ].join("\n");
        return replicaUserData;
      });
      const replicaNodeArguments: ec2.InstanceArgs = {
        ami: this.ami,
        instanceType: this.instanceType,
        availabilityZone: subnetInformation.az,
        subnetId: subnetInformation.publicSubnet.id,
        keyName: this.keyPairName,
        userData: replicaNodeBootstrapScript,
        vpcSecurityGroupIds: vpcSecurityGroups,
        tags: { Name: `${replicaNodeName}-${nodeNumber}` }
      };
      const replicaNode = new ec2.Instance(`${replicaNodeName}-${nodeNumber}`, replicaNodeArguments);
      return replicaNode;
    });

    // Return the node information upstream in case other nodes need to know the consul node addresses
    // or need to coordinate their own bootstrapping process with cloud-init-buddy
    return {
      masterNode: {
        node: masterNode,
        user: replicationUser,
        password: replicationPassword
      },
      replicas: replicaNodes
    };
  }
}