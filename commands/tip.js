import { formatWalletBalance, parseMRLAmount, sendUserTip } from "../wallet-users.js";
import { getOption, reply, sendMessage } from "../command-utils.js";
import { distributeTip, formatTipResult, getRoleRecipientIds } from "../tip-utils.js";

async function makeTip(senderId, recipientId, roleId, amount, services, guildId) {
	if((Boolean(recipientId) === Boolean(roleId)) || amount == null) {
		return "Usage: `" + (services.config.prefix || "m!") + "tip @user|@role amount`.";
	}
	if(roleId) {
		if(!guildId) {
			return "Role tips can only be used in a server.";
		}
		return distributeTip(
			services,
			senderId,
			getRoleRecipientIds(services, guildId, roleId),
			amount
		);
	}
	try {
		const hash = await sendUserTip(
			services.wallet,
			services.config.walletUsersPath,
			senderId,
			recipientId,
			amount,
			services.config.legacyAddressesPath,
			services.walletNotificationStore
		);
		return formatTipResult("Tip sent", {
			txHash: hash,
			totalAmount: parseMRLAmount(amount),
			recipients: [ { recipientId: String(recipientId), amount: parseMRLAmount(amount) } ]
		});
	} catch(ex) {
		if(ex.code === "INSUFFICIENT_FUNDS" || Number(ex.code) === -37) {
			return "Not enough unlocked MRL to cover the tip and transaction fee. Reduce the amount or wait for funds to unlock.";
		}
		throw ex;
	}
}

function getMessageTipArgs(args) {
	const targetIndex = args.findIndex(argument => /^<@!?&?\d+>$/.test(argument));
	const match = targetIndex === -1 ? null : args[targetIndex].match(/^<@(!?&?)(\d+)>$/);
	return {
		recipientId: match && !match[1].includes("&") ? match[2] : undefined,
		roleId: match && match[1].includes("&") ? match[2] : undefined,
		amount: args.find((_, index) => index !== targetIndex)
	};
}

export default {
	args_min: 1, args_max: 2, where: 0,
	description: "Tips a user or distributes MRL among a server role",
	options: [
		{
			name: "amount",
			description: "Amount of MRL to send or distribute",
			type: 3,
			required: true
		},
		{
			name: "user",
			description: "The user to tip",
			type: 6,
			required: false
		},
		{
			name: "role",
			description: "Distribute the tip among members of this server role",
			type: 8,
			required: false
		}
	],
	async run(message, cmd, args, hide, services) {
		const { recipientId, roleId, amount } = getMessageTipArgs(args);
		await sendMessage(services.bot, message.channel, await makeTip(
			message.author.id,
			recipientId,
			roleId,
			amount,
			services,
			message.guildID
		));
	},
	async runSlash(interaction, hide, services) {
		await reply(interaction, await makeTip(
			interaction.user.id,
			getOption(interaction, "user"),
			getOption(interaction, "role"),
			getOption(interaction, "amount"),
			services,
			interaction.guildID
		));
	}
};
