import { getNetworkStats } from "../features.js";

export default {
	description: "Shows the current Morelo network hashrate",
	options: [],
	async run(ctx, services) {
		return "Network hashrate: " + (await getNetworkStats(services.daemon)).hashrate;
	}
};
