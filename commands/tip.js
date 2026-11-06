import { sendUserTip } from "../wallet-users.js";
import { getMentionedUserId, getOption, reply, sendMessage } from "../command-utils.js";

async function makeTip(senderId, recipientId, amount, services) {
	if(!recipientId) {
		throw new Error("Select a recipient to tip.");
	}
	const hash = await sendUserTip(
		services.wallet,
		services.config.walletUsersPath,
		senderId,
		recipientId,
		amount,
		services.config.legacyAddressesPath
	);
	return "Tip sent. Transaction: " + hash;
}

export default {
	description: "Tips another user with MRL from your wallet",
	options: [
		{
			name: "user",
			description: "The user to tip",
			type: 6,
			required: true
		},
		{
			name: "amount",
			description: "Amount of MRL to send",
			type: 3,
			required: true
		}
	],
	async run(message, cmd, args, hide, services) {
		const recipientId = getMentionedUserId(message, args[0]);
		await sendMessage(services.bot, message.channel, await makeTip(
			message.author.id,
			recipientId,
			args[1],
			services
		));
	},
	async runSlash(interaction, hide, services) {
		await reply(interaction, await makeTip(
			interaction.user.id,
			getOption(interaction, "user"),
			getOption(interaction, "amount"),
			services
		));
	}
};
