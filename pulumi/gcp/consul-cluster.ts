import * as crypto from 'crypto';
import * as fs from 'fs';
import { NetworkInformation } from './multi-region';
import * as gcp from '@pulumi/gcp';
import { userDataPreamble, userDataProvisioning } from '../common';

export class ConsulCluster {
  constructor(
    readonly networkInformation: Promise<NetworkInformation>[],
    readonly machineType: string = "n1-standard-1",
    readonly image: string = "ubuntu-18-04"
  ) { }

  async create() {
    const network = await this.networkInformation[0];
    // We will want to assign the VPC security groups to each instance we launch
    const subnets = network.subnets;
    const subnetInformation = subnets[0];

    const buddyUser = 'admin';
    const buddyPassword = crypto.createHash('sha256').update(
      crypto.randomBytes(32)).digest('base64').replace(/[\+\=\/]/g, '');

    // Cloud-init-buddy cloud-init script
    const buddyUserData = [
      userDataPreamble,
      'cat <<EOF > env.sh',
      `export BUDDY_PASSWORD="${buddyPassword}"`,
      `export BUDDY_USER="${buddyUser}"`,
      'EOF',
      'cat <<EOF > provision.rb.base64',
      fs.readFileSync(`${__dirname}/../../scripts/ruby/cloud-init-buddy.rb`).toString('base64'),
      'EOF',
      userDataProvisioning
    ].join("\n");

    // We need the creation time because Pulumi can not recreate the instance otherwise
    const clusterTime = (new Date()).getTime();
    // Cloud init buddy node creation
    const cloudInitBuddyArgs: gcp.compute.InstanceArgs = {
      bootDisk: {
        autoDelete: true,
        initializeParams: { image: this.image }
      },
      deletionProtection: false,
      description: "Cloud-init-buddy",
      labels: {
        name: "cloud-init-buddy",
        purpose: "coordination"
      },
      machineType: this.machineType,
      metadata: {
        name: "cloud-init-buddy"
      },
      metadataStartupScript: buddyUserData,
      name: `cloud-init-buddy-${clusterTime}`,
      zone: subnetInformation.zone,
      networkInterfaces: [
        {
          subnetwork: subnetInformation.subnet.id,
          accessConfigs: [{}] // This is required for ephemeral public IP addresses
        }
      ]
    };

    // Create the instance
    const cloudInitBuddy = new gcp.compute.Instance('cloud-init-buddy',
      cloudInitBuddyArgs, { provider: network.provider });

    // And now the consul cluster creation. We are going to create a 3 node cluster and coordinate
    // the bootstrapping process with cloud-init-buddy node we created above.
    const consulUrl = 'https://releases.hashicorp.com/consul/1.3.0/consul_1.3.0_linux_amd64.zip';
    const nodeCount = 3;
    // Pass along the private IP address of the cloud-init-buddy node so the consul nodes can coordinate
    const consulNodeBootstrapScript = cloudInitBuddy.networkInterfaces.apply(buddyNetwork => {
      const buddyIp = buddyNetwork[0].networkIp;
      const consulNodeUserData = [
        userDataPreamble,
        'cat <<EOF > env.sh',
        `export ENDPOINT="https://${buddyUser}:${buddyPassword}@${buddyIp}:8443"`,
        `export NODE_COUNT="${nodeCount}"`,
        `export CONSUL_DOWNLOAD_URL="${consulUrl}"`,
        'EOF',
        'cat <<EOF > provision.rb.base64',
        fs.readFileSync(`${__dirname}/../../scripts/ruby/consul.rb`).toString('base64'),
        'EOF',
        userDataProvisioning
      ].join("\n");
      return consulNodeUserData;
    });

    // 3 node cluster
    const consulNodes = [1, 2, 3].map(async (nodeNumber) => {
      const consulNodeArguments: gcp.compute.InstanceArgs = {
        bootDisk: {
          autoDelete: true,
          initializeParams: { image: this.image }
        },
        deletionProtection: false,
        description: `consul-${nodeNumber}`,
        labels: {
          name: `consul-${nodeNumber}`,
          purpose: "consul"
        },
        machineType: this.machineType,
        metadata: {
          name: `consul-${nodeNumber}`
        },
        metadataStartupScript: consulNodeBootstrapScript,
        name: `consul-${nodeNumber}-${clusterTime}`,
        zone: subnetInformation.zone,
        networkInterfaces: [
          {
            subnetwork: subnetInformation.subnet.id,
            accessConfigs: [{}]
          }
        ]
      };
      const consulNode = new gcp.compute.Instance(`consul-node-${nodeNumber}`, consulNodeArguments);
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
}