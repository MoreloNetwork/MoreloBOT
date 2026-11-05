import { reply } from "../command-utils.js";

export default {
	args_min: 0, args_max: 0, hide_msg: false,
	admin_only: false, where: 0, cooldown: 5,
	options: [],
	description: "Shows bot's ping",
	aliases: [ "pong" ],
	async run(message, cmd, args, hide, services) {
		const latency = message.channel.guild?.shard?.latency ?? services.bot.shards.get(0)?.latency;
		await message.channel.createMessage("Pong! " + (latency == null || !Number.isFinite(latency) ? "unknown" : latency + " ms"));
	},
	async runSlash(interaction, hide, services) {
		const shardId = services.bot.guildShardMap[interaction.guildID] ?? 0;
		const latency = services.bot.shards.get(shardId)?.latency;
		await reply(interaction, "Pong! " + (latency == null || !Number.isFinite(latency) ? "unknown" : latency + " ms"));
	}
};
