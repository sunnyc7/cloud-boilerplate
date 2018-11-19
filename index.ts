import { MultiRegionVPC } from './pulumi/aws/multi-region';
import { ConsulCluster as AWSConsul } from './pulumi/aws/consul-cluster';
import { MultiRegionNetwork } from './pulumi/gcp/multi-region';
import { ConsulCluster as GCPConsul } from './pulumi/gcp/consul-cluster';
import { MySQLReplication as GCPMySQLReplication } from './pulumi/gcp/msyql-replication';
import { MySQLReplication as AWSMySQLReplication } from './pulumi/aws/mysql-replication';
import { ec2 } from '@pulumi/aws';

async function createCluster() {
  const multiRegionVPC = new MultiRegionVPC(['us-east-1']);
  const networkInformation = multiRegionVPC.create();

  // const consulCluster = new AWSConsul(networkInformation);
  // const clusterInformation = consulCluster.create();

  // const multiRegionNetwork = new MultiRegionNetwork('pulumi-test-222418', ['us-central1']);
  // const networkInformation = multiRegionNetwork.create();

  // const consulCluster = new GCPConsul(networkInformation);
  // const clusterInformation = consulCluster.create();

  // const mysqlReplication = new GCPMySQLReplication(networkInformation);
  // const mysqlReplicationInformation = mysqlReplication.create();

  const mysqlReplication = new AWSMySQLReplication(networkInformation);
  const mysqlReplicationInformation = mysqlReplication.create();

  return {
    // network: networkInformation,
    // consul: clusterInformation,
    // mysql: mysqlReplicationInformation
  };
}

createCluster();