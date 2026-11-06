import { formatWalletBalance, getUserBalance } from "../wallet-users.js";
import { getMentionedUserId, getOption, reply, sendMessage } from "../command-utils.js";

async function getBalance(userId, services) {
	const balance = await getUserBalance(
		services.wallet,
		services.config.walletUsersPath,
		userId,
		services.config.legacyAddressesPath
	);
	return "Balance for user " + userId + ":\n"
		+ "Unlocked: " + formatWalletBalance(balance.unlockedBalance) + "\n"
		+ "Locked: " + formatWalletBalance(balance.balance - balance.unlockedBalance);
}

export default {
	args_min: 0, args_max: 1, hide_msg: false,
	admin_only: false, where: 0, cooldown: 10,
	description: "Shows your or another user's Morelo tip wallet balance",
	options: [ {
		name: "user",
		description: "The user whose balance to show",
		type: 6,
		required: false
	} ],
	async run(message, cmd, args, hide, services) {
		const userId = getMentionedUserId(message, args[0]) ?? message.author.id;
		await sendMessage(services.bot, message.channel, await getBalance(userId, services));
	},
	async runSlash(interaction, hide, services) {
		await reply(interaction, await getBalance(getOption(interaction, "user") ?? interaction.user.id, services));
	}
};
