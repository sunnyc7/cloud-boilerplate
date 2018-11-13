import * as gcp from '@pulumi/gcp';

// Encapsulate everything inside a class for easier re-use
export class MultiRegionNetwork {

    // The constructor only requires the regions
    constructor(readonly project: string, readonly regions: string[] = ['us-central1', 'us-east1', 'us-east4', 'us-west1', 'us-west2']) { }

    // Where we put everything together for creating the VPC along with other required pieces
    create() {
        // I'm going to create a network per region to emulate AWS configuration
        const networkConfig = this.regions.map(async (r: string) => {
            // Create a provider for the region and grab the zones
            const providerName = `${r}-provider`;
            const p = new gcp.Provider(providerName, { project: this.project, region: r });
            // Create a network for the region
            const regionNetwork = this.createRegionNetwork(r, p);
            // Now create a subnet in each zone
            const zoneSubnets = await this.createZoneSubnets(r, p, regionNetwork);
            // Firewall rules for internal access
            const firewallRules = this.createFirewallRules(r, p, regionNetwork);
            // Return everything upstream
            return {
                provider: p,
                network: regionNetwork,
                subnets: zoneSubnets,
                firewall: firewallRules
            };
        });
        return networkConfig;
    }

    // Create the firewall rules for internal and SSH access
    private createFirewallRules(r: string, p: gcp.Provider, regionNetwork: gcp.compute.Network) {
        const internalAccessArgs: gcp.compute.FirewallArgs = {
            description: `${r} internall access on all ports`,
            name: `${r}-internal-access`,
            network: regionNetwork.id,
            allows: [
                { ports: ["0-65535"], protocol: "tcp" },
                { ports: ["0-65535"], protocol: "udp" },
                { protocol: "icmp" }
            ],
            sourceRanges: ["10.0.0.0/16"]
        };
        const internalAccess = new gcp.compute.Firewall(`${r}-network-internal-access`, internalAccessArgs, { provider: p });
        // Firewal rule for SSH access
        const sshAccessArgs: gcp.compute.FirewallArgs = {
            description: `${r} ssh access from anywhere`,
            name: `${r}-ssh-access`,
            network: regionNetwork.id,
            allows: [
                { ports: ["22"], protocol: "tcp" }
            ]
        };
        const sshAccess = new gcp.compute.Firewall(`${r}-ssh-access`, sshAccessArgs, { provider: p });
        return [internalAccess, sshAccess];
    }

    // Create subnets for each region in the zone for the given network
    private async createZoneSubnets(r: string, p: gcp.Provider, regionNetwork: gcp.compute.Network) {
        const getZoneArgs: gcp.compute.GetZonesArgs = { region: r };
        const regionZones: gcp.compute.GetZonesResult = await gcp.compute.getZones(getZoneArgs, { provider: p });
        const zoneSubnets = regionZones.names.map((zone, index) => {
            const subnetworkArgs: gcp.compute.SubnetworkArgs = {
                description: `${zone}-subnet`,
                enableFlowLogs: false,
                ipCidrRange: `10.0.${index}.0/24`,
                name: `${zone}-subnet`,
                network: regionNetwork.id,
                privateIpGoogleAccess: true
            };
            const subnet = new gcp.compute.Subnetwork(`${zone}-subnet`, subnetworkArgs, { provider: p });
            return subnet;
        });
        return zoneSubnets;
    }

    // Creates a network in the region for the given provider
    private createRegionNetwork(r: string, p: gcp.Provider) {
        const networkArgs: gcp.compute.NetworkArgs = {
            autoCreateSubnetworks: false, description: `Regional network for ${r}`, name: `${r}-network`
        };
        const regionNetwork = new gcp.compute.Network(`${r}-network`, networkArgs, { provider: p });
        return regionNetwork;
    }
}