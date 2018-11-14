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

# `pulumi/gcp`
Contains GCP patterns and best practices. Everything is codified with Pulumi's TypeScript SDK.

## `multi-region.ts`
Code for setting up a standard networking stack with a single subnet in each zone with a network
per region for isolation.

## `consul-cluster.ts`
Same as for the AWS example. Set of classes outlining a pattern for setting up a consul cluster
in GCP using the same bootstrapping script as for AWS.

# Licensing

This package is free to use for commercial purposes for a trial period under the terms of the [Prosperity Public License](./LICENSE).

Licenses for long-term commercial use are available via [licensezero.com](https://licensezero.com).

[![licensezero.com pricing](https://licensezero.com/projects/dda20927-a4e0-4875-8f2f-f7c467331eef/badge.svg)](https://licensezero.com/projects/dda20927-a4e0-4875-8f2f-f7c467331eef)
