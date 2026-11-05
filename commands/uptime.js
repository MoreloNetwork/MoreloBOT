import helper from "../helper.js";
import { reply } from "../command-utils.js";

export default {
	args_min: 0, args_max: 0, hide_msg: false,
	admin_only: false, where: 0, cooldown: 5,
	options: [],
	description: "Shows bot's uptime",
	async run(message, cmd, args, hide, services) {
		await message.channel.createMessage("Uptime: " + helper.formatTime(services.bot.uptime));
	},
	async runSlash(interaction, hide, services) {
		await reply(interaction, "Uptime: " + helper.formatTime(services.bot.uptime));
	}
};
