import * as crypto from 'crypto';
import * as fs from 'fs';
import { NetworkInformation } from './multi-region';
import * as gcp from '@pulumi/gcp';
import { userDataPreamble, userDataProvisioning } from '../common';

export class MySQLReplication {
  constructor(
    readonly networkInformation: Promise<NetworkInformation>[],
    readonly machineType: string = "n1-standard-2",
    readonly image: string = "ubuntu-18-04"
  ) { }

  async create() {
    const network = await this.networkInformation[0];
    const subnets = network.subnets;
    const subnetInformation = subnets[0];

    const replicationUser = 'replication';
    // MySQL passwords can't exceed 32 characters
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

    const masterNodeName = "mysql-master-node";
    // We need the creation time because Pulumi can not recreate the instance otherwise
    const clusterTime = (new Date()).getTime();
    // Cloud init buddy node creation
    const masterNodeArgs: gcp.compute.InstanceArgs = {
      bootDisk: {
        autoDelete: true,
        initializeParams: { image: this.image }
      },
      deletionProtection: false,
      description: masterNodeName,
      labels: {
        name: masterNodeName,
        purpose: "database"
      },
      machineType: this.machineType,
      metadata: {
        name: masterNodeName
      },
      metadataStartupScript: masterUserData,
      name: `${masterNodeName}-${clusterTime}`,
      zone: subnetInformation.zone,
      networkInterfaces: [
        {
          subnetwork: subnetInformation.subnet.id,
          accessConfigs: [{}] // This is required for ephemeral public IP addresses
        }
      ]
    };

    // Create the instance
    const masterNode = new gcp.compute.Instance(masterNodeName,
      masterNodeArgs, { provider: network.provider });

    // 1 replicas
    const replicaNodes = [2].map(async (nodeNumber) => {
      const replicaNodeName = 'mysql-replica';
      // Pass along the private IP address of the master node
      const replicaNodeBootstrapScript = masterNode.networkInterfaces.apply(network => {
        const masterIp = network[0].networkIp;
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
      const replicaNodeArguments: gcp.compute.InstanceArgs = {
        bootDisk: {
          autoDelete: true,
          initializeParams: { image: this.image }
        },
        deletionProtection: false,
        description: `${replicaNodeName}-${nodeNumber}`,
        labels: {
          name: `${replicaNodeName}-${nodeNumber}`,
          purpose: "database"
        },
        machineType: this.machineType,
        metadata: {
          name: `${replicaNodeName}-${nodeNumber}`
        },
        metadataStartupScript: replicaNodeBootstrapScript,
        name: `${replicaNodeName}-${nodeNumber}-${clusterTime}`,
        zone: subnetInformation.zone,
        networkInterfaces: [
          {
            subnetwork: subnetInformation.subnet.id,
            accessConfigs: [{}]
          }
        ]
      };
      const replicaNode = new gcp.compute.Instance(`${replicaNodeName}-${nodeNumber}`, replicaNodeArguments);
      return replicaNode;
    });

    return {
      masterNode: {
        node: masterNode,
        user: replicationUser,
        password: replicationPassword
      },
      replicaNodes: replicaNodes
    };
  }
}