export default {
	description: "Shows bot's ping",
	aliases: [ "pong" ],
	cooldown: 5,
	options: [],
	async run(ctx, services) {
		const shardId = ctx.guildId ? services.bot.guildShardMap[ctx.guildId] ?? 0 : 0;
		const latency = services.bot.shards.get(shardId)?.latency;
		return "Pong! " + (Number.isFinite(latency) ? latency + " ms" : "unknown");
	}
};
