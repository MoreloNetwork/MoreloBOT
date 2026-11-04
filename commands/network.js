import { getNetworkReport } from "../features.js";
import { reply } from "./command-utils.js";

export default {
	description: "Shows Morelo network, price, and pool statistics",
	options: [],
	async run(message, cmd, args, hide, services) {
		await message.channel.createMessage(await getNetworkReport(services.daemon, services.config));
	},
	async runSlash(interaction, hide, services) {
		await reply(interaction, await getNetworkReport(services.daemon, services.config));
	}
};
