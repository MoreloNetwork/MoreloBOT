import { sendUserTip } from "../wallet-users.js";
import { getOption, reply, sendMessage } from "../command-utils.js";

async function makeTip(senderId, recipientId, amount, services) {
	if(!recipientId || amount == null) {
		return "Usage: `" + (services.config.prefix || "m!") + "tip @user amount`.";
	}
	try {
		const hash = await sendUserTip(
			services.wallet,
			services.config.walletUsersPath,
			senderId,
			recipientId,
			amount,
			services.config.legacyAddressesPath
		);
		return "Tip sent. Transaction: " + hash;
	} catch(ex) {
		if(ex.code === "INSUFFICIENT_FUNDS" || Number(ex.code) === -37) {
			return "Not enough unlocked MRL to cover the tip and transaction fee. Reduce the amount or wait for funds to unlock.";
		}
		throw ex;
	}
}

function getMessageTipArgs(message, args) {
	const mentionIndex = args.findIndex(argument => /^<@!?(\d+)>$/.test(argument));
	const match = mentionIndex === -1 ? null : args[mentionIndex].match(/^<@!?(\d+)>$/);
	return {
		recipientId: match?.[1] ?? message.mentions?.[0]?.id,
		amount: args.find((_, index) => index !== mentionIndex)
	};
}

export default {
	args_min: 0, args_max: 2,
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
		const { recipientId, amount } = getMessageTipArgs(message, args);
		await sendMessage(services.bot, message.channel, await makeTip(
			message.author.id,
			recipientId,
			amount,
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
