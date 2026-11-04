import { sendUserTip } from "../wallet-users.js";
import { getMentionedUserId, getOption, reply } from "./command-utils.js";

async function makeTip(senderId, recipientId, amount, services) {
	if(!recipientId) {
		throw new Error("Select a recipient to tip.");
	}
	const hash = await sendUserTip(
		services.wallet,
		services.config.walletUsersPath,
		senderId,
		recipientId,
		amount
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
			type: 10,
			required: true,
			min_value: 0.000000001
		}
	],
	async run(message, cmd, args, hide, services) {
		try {
			const recipientId = getMentionedUserId(message, args[0]);
			await message.channel.createMessage(await makeTip(
				message.author.id,
				recipientId,
				args[1],
				services
			));
		} catch(ex) {
			await message.channel.createMessage(ex.message);
		}
	},
	async runSlash(interaction, hide, services) {
		try {
			await reply(interaction, await makeTip(
				interaction.user.id,
				getOption(interaction, "user"),
				getOption(interaction, "amount"),
				services
			));
		} catch(ex) {
			await reply(interaction, ex.message);
		}
	}
};
