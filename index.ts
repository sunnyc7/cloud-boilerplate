import { MultiRegionVPC } from './pulumi/aws/multi-region';
import { ConsulCluster } from './pulumi/aws/consul-cluster';
import { ec2 } from '@pulumi/aws';

async function createCluster() {
  // Create the VPC
  const multiRegionVPC = new MultiRegionVPC(['us-east-1']);
  const vpcInformation = multiRegionVPC.create();

  // Create the consul cluster
  const consulCluster = new ConsulCluster(vpcInformation,
    'ami-a06bd7df', 'dell-laptop-xps-15', ec2.T2InstanceMedium);
  const clusterInformation = consulCluster.create();

  // Return the information upstream for further use
  return {
    vpc: vpcInformation,
    consul: clusterInformation
  };
}

createCluster();