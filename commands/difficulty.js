import { getNetworkStats } from "../features.js";

export default {
	description: "Shows the current Morelo network difficulty",
	options: [],
	async run(ctx, services) {
		return "Network difficulty: " + (await getNetworkStats(services.daemon)).difficulty;
	}
};
