import helper from "../helper.js";

export default {
	description: "Shows bot's uptime",
	cooldown: 5,
	options: [],
	async run(ctx, services) {
		return "Uptime: " + helper.formatTime(services.bot.uptime);
	}
};
