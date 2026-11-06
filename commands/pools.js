import { formatPool, getPools } from "../features.js";

export default {
	description: "Shows Morelo mining pool statistics",
	cooldown: 5,
	options: [],
	async run(ctx, services) {
		const pools = await getPools(services.config);
		if(!pools?.length) {
			return "No mining pool data is available.";
		}
		return pools.slice(0, 15).map(formatPool).join("\n").slice(0, 1900);
	}
};
