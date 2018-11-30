Growing collection of ready to use templates for bootstrapping cloud systems.
![](demo.gif)

# `pulumi/aws`
Contains AWS patterns and best practices. Everything is codified with Pulumi's TypeScript SDK.

## `multi-region.ts`
Code for setting up a standard networking stack with public and private subnets across
any number of specified regions.

## `consul-cluster.ts`
Example of how to use the output from the multi-region class to bootstrap a consul cluster with
the help of [cloud-init-buddy](https://github.com/cloudbootup/cloud-init-buddy).

## `mysql-replication.ts`
GTID based replication cluster with a single master node and configurable number of replicas.

# `pulumi/gcp`
Contains GCP patterns and best practices. Everything is codified with Pulumi's TypeScript SDK.

## `multi-region.ts`
Code for setting up a standard networking stack with a single subnet in each zone with a network
per region for isolation.

## `consul-cluster.ts`
Same as for the AWS example. Set of classes outlining a pattern for setting up a consul cluster
in GCP using the same bootstrapping script as for AWS.

## `mysql-replication.ts`
GTID based replication cluster with a single master node and configurable number of replicas.
