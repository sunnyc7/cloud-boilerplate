import { MultiRegionVPC } from './pulumi/aws/multi-region';
import { ConsulCluster as AWSConsul } from './pulumi/aws/consul-cluster';
import { MultiRegionNetwork } from './pulumi/gcp/multi-region';
import { ConsulCluster as GCPConsul } from './pulumi/gcp/consul-cluster';
import { ec2 } from '@pulumi/aws';

async function createCluster() {
  // // Create the VPC
  // const multiRegionVPC = new MultiRegionVPC(['us-east-1']);
  // const networkInformation = multiRegionVPC.create();

  // // Create the consul cluster
  // const consulCluster = new AWSConsul(networkInformation,
  //   'ami-a06bd7df', 'dell-laptop-xps-15', ec2.T2InstanceMedium);
  // const clusterInformation = consulCluster.create();

  // // Return the information upstream for further use
  // return {
  //   network: networkInformation,
  //   consul: clusterInformation
  // };
  const multiRegionNetwork = new MultiRegionNetwork('pulumi-test-222418', ['us-central1']);
  const networkInformation = multiRegionNetwork.create();

  const consulCluster = new GCPConsul(networkInformation);
  const clusterInformation = consulCluster.create();

  return {
    network: networkInformation,
    consul: clusterInformation
  };
}

createCluster();