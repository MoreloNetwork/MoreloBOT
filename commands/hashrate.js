import { getNetworkStats } from "../api/features.js";
import { reply, sendMessage } from "../core/command-utils.js";

export default {
	description: "Shows the current Morelo network hashrate",
	options: [],
	async run(message, cmd, args, hide, services) {
		const stats = await getNetworkStats(services.daemon);
		await sendMessage(services.bot, message.channel, "Network hashrate: " + stats.hashrate);
	},
	async runSlash(interaction, hide, services) {
		const stats = await getNetworkStats(services.daemon);
		await reply(interaction, "Network hashrate: " + stats.hashrate);
	}
};
