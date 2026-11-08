export default async function publishCasinoWin({ bot, config, logger }, content, userIds) {
	let channel = config.casinoWinsChannel && bot.getChannel(config.casinoWinsChannel);
	if(!channel) {
		const channels = [];
		for(const guild of bot.guilds.values()) {
			for(const candidate of guild.channels.values()) {
				if(candidate.name?.toLowerCase() === "wins" && typeof candidate.createMessage === "function") {
					channels.push(candidate);
				}
			}
		}
		if(channels.length === 1) {
			channel = channels[0];
		} else {
			logger.err("Casino wins channel is not configured and %s channels named wins were found", channels.length);
			return false;
		}
	}
	try {
		await bot.createMessage(channel.id, {
			content,
			allowedMentions: { users: userIds }
		});
	} catch(ex) {
		logger.err("Can't publish casino win:", ex);
		return false;
	}
	return true;
}
