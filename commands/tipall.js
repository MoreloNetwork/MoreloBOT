import { getOption, reply, sendMessage } from "../command-utils.js";
import { distributeTip, getOnlineRecipientIds } from "../tip-utils.js";

async function makeTip(senderId, amount, services, guildId) {
	if(!guildId) {
		return "This command can only be used in a server.";
	}
	if(amount == null) {
		return "Usage: `" + (services.config.prefix || "m!") + "tipall amount`.";
	}
	return distributeTip(
		services,
		senderId,
		getOnlineRecipientIds(services, guildId),
		amount
	);
}

export default {
	args_min: 1, args_max: 1, where: 1,
	description: "Distributes an MRL tip among online server users",
	options: [ {
		name: "amount",
		description: "Total amount of MRL to distribute",
		type: 3,
		required: true
	} ],
	async run(message, cmd, args, hide, services) {
		await sendMessage(services.bot, message.channel, await makeTip(
			message.author.id,
			args[0],
			services,
			message.guildID
		));
	},
	async runSlash(interaction, hide, services) {
		await reply(interaction, await makeTip(
			interaction.user.id,
			getOption(interaction, "amount"),
			services,
			interaction.guildID
		));
	}
};
