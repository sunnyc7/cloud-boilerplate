import * as aws from "@pulumi/aws";

// Common options for subnets
interface SubnetArgs<B extends boolean> extends aws.ec2.SubnetArgs {
    mapPublicIpOnLaunch: B;
    tags: { Name: string; };
}

// Encapsulate everything inside a class for easier re-use
export class MultiRegionVPC {

    // The constructor only requires the regions
    constructor(public regions: aws.Region[] = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2']) { }

    // Given the relevant pieces of information create a public subnet
    createSubnet<B extends boolean>(p: aws.Provider, vpc: aws.ec2.Vpc, az: string, ipAssignment: B, cidr: string) {
        const name = ipAssignment ? `public-subnet-${az}` : `private-subnet-${az}`;
        const subnetArgs: SubnetArgs<B> = {
            cidrBlock: cidr, vpcId: vpc.id, mapPublicIpOnLaunch: ipAssignment,
            tags: { Name: name }
        };
        const subnet = new aws.ec2.Subnet(name, subnetArgs, { provider: p });
        return subnet;
    }

    // Create the subnets for each availability zone for the given regional provider
    async createSubnets(p: aws.Provider, vpc: aws.ec2.Vpc, regionAzs: aws.GetAvailabilityZonesResult) {
        // Subnets in different availability zones must have different CIDR blocks.
        // We use this counter as an index for generating /24 subnets
        let counter = -1;
        const subnets = regionAzs.names.map((az) => {
            // 10.0.{index}.0/24. This is used below to create the CIDR
            const privateIndex = ++counter;
            const publicIndex = ++counter;
            // Private gets even index, public gets odd index.
            const privateCidr = `10.0.${privateIndex}.0/24`;
            const publicCidr = `10.0.${publicIndex}.0/24`;
            // Create the private subnet
            const privateSubnet = this.createSubnet(p, vpc, az, false, privateCidr)
            // Create the public subnet
            const publicSubnet = this.createSubnet(p, vpc, az, true, publicCidr)
            // Return the results upstream in case we need to use it
            return { az: az, privateSubnet: privateSubnet, publicSubnet: publicSubnet };
        });
    
        return subnets;
    }

    // Create 10.0.0.0/16 VPC
    createVpc(p: aws.Provider, vpcName: string): aws.ec2.Vpc {
        // VPC for the region
        const vpcArguments: aws.ec2.VpcArgs = {
            cidrBlock: '10.0.0.0/16',
            assignGeneratedIpv6CidrBlock: true,
            enableDnsHostnames: true,
            enableDnsSupport: true,
            tags: { Name: vpcName }
        };
        const vpc = new aws.ec2.Vpc(vpcName, vpcArguments, { provider: p });
        return vpc;
    }

    // Where we put everything together for creating VPCs, subnets, security groups, routing tables, etc.
    async create() {
        // Iterate over each region and create the VPC and associate public/private subnets
        const networkConfig = this.regions.map(async (r: aws.Region) => {
            const vpcName = `${r}-vpc`;
            const providerName = `${r}-provider`;
            // Provider for the region
            const p = new aws.Provider(providerName, { region: r });
            // Availability zones for each region. Used when creating the subnets
            const azs = await aws.getAvailabilityZones(undefined, { provider: p });
            // Creat the VPC
            const vpc = this.createVpc(p, vpcName);
            // Create the internet gateway for the public subnet
            const gatewayName = `${r}-gateway`;
            const gatewayOptions: aws.ec2.InternetGatewayArgs = {
                vpcId: vpc.id,
                tags: { Name: gatewayName }
            };
            const gateway = new aws.ec2.InternetGateway(gatewayName, gatewayOptions, { provider: p })
            // Create the route for outbound internet access
            const routeTableName = `${r}-public-route-table`;
            const routeTableOptions: aws.ec2.RouteTableArgs = {
                routes: [
                    {
                        cidrBlock: '0.0.0.0/0',
                        gatewayId: gateway.id
                    }
                ],
                vpcId: vpc.id
            };
            const publicRouteTable = new aws.ec2.RouteTable(routeTableName, routeTableOptions, { provider: p });
            // Private and public subnets for each availability zone
            const subnets = await this.createSubnets(p, vpc, azs);
            // Associate the route table with the subnets
            const associations = subnets.map(subnetInformation => {
                const publicSubnet = subnetInformation.publicSubnet;
                const associationArgs: aws.ec2.RouteTableAssociationArgs = {
                    routeTableId: publicRouteTable.id,
                    subnetId: publicSubnet.id
                };
                const association = publicSubnet.tags.apply(tags => {
                    const name = tags!['Name'];
                    const associationName = `${name}-association`;
                    const routeTableAssociation = new aws.ec2.RouteTableAssociation(associationName, associationArgs, { provider: p });
                    return routeTableAssociation;
                });
                return association;
            });
            return { region: r, vpc: vpc, subnets: subnets, associations: associations };
        });
        return networkConfig;
    }

}