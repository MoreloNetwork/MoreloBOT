import { getNetworkStats } from "../features.js";
import { reply, sendMessage } from "../command-utils.js";

export default {
	description: "Shows the current Morelo network difficulty",
	options: [],
	async run(message, cmd, args, hide, services) {
		const stats = await getNetworkStats(services.daemon);
		await sendMessage(services.bot, message.channel, "Network difficulty: " + stats.difficulty);
	},
	async runSlash(interaction, hide, services) {
		const stats = await getNetworkStats(services.daemon);
		await reply(interaction, "Network difficulty: " + stats.difficulty);
	}
};
