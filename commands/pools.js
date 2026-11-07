import { formatHashrateValue, getPools } from "../features.js";
import { reply, sendMessage } from "../command-utils.js";

function formatPools(pools) {
	if(!pools?.length) {
		return "No mining pool data is available.";
	}
	return pools.slice(0, 15).map(pool =>
		pool.url.replace(/@(everyone|here)/gi, "@\u200b$1")
			+ " (Hashrate: " + formatHashrateValue(pool.hashrate) + ")"
	).join("\n").slice(0, 1900);
}

export default {
	description: "Shows Morelo mining pool statistics",
	options: [],
	async run(message, cmd, args, hide, services) {
		await sendMessage(services.bot, message.channel, formatPools(await getPools(services.config)));
	},
	async runSlash(interaction, hide, services) {
		await reply(interaction, formatPools(await getPools(services.config)));
	}
};
