import { MultiRegionVPC } from './pulumi/aws/multi-region';

const multiRegionVPC = new MultiRegionVPC();
const vpcInformation = multiRegionVPC.create();