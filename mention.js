import { reply } from "./command-utils.js";

function response(services) {
	const prefix = services.config.prefix || "";
	return "Hello! I'm MoreloBOT, made by Morelo Network. Type `" + prefix + "usage`, mention me with `usage`, or use `/usage` to see the command list.";
}

export default {
	async run(message, cmd, args, hide, services) {
		await message.channel.createMessage(response(services));
	},
	async runSlash(interaction, hide, services) {
		await reply(interaction, response(services));
	}
};
