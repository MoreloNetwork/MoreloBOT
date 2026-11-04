import { getNetworkStats } from "../features.js";
import { reply } from "../command-utils.js";

export default {
	description: "Shows the current Morelo network difficulty",
	options: [],
	async run(message, cmd, args, hide, services) {
		const stats = await getNetworkStats(services.daemon);
		await message.channel.createMessage("Network difficulty: " + stats.difficulty);
	},
	async runSlash(interaction, hide, services) {
		const stats = await getNetworkStats(services.daemon);
		await reply(interaction, "Network difficulty: " + stats.difficulty);
	}
};
