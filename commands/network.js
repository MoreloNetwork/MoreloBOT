import { getNetworkReport } from "../features.js";

export default {
	description: "Shows Morelo network, price, and pool statistics",
	cooldown: 5,
	options: [],
	async run(ctx, services) {
		return getNetworkReport(services.daemon, services.config);
	}
};
