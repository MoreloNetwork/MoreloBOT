import { formatWalletBalance, getUserBalance } from "../wallet-users.js";
import { getMentionedUserId, getOption, reply } from "./command-utils.js";

async function getBalance(userId, services) {
	const balance = await getUserBalance(services.wallet, services.config.walletUsersPath, userId);
	return "Balance for <@" + userId + ">:\n"
		+ "Unlocked: " + formatWalletBalance(balance.unlockedBalance) + "\n"
		+ "Locked: " + formatWalletBalance(balance.balance - balance.unlockedBalance);
}

export default {
	description: "Shows your or another user's Morelo tip wallet balance",
	options: [ {
		name: "user",
		description: "The user whose balance to show",
		type: 6,
		required: false
	} ],
	async run(message, cmd, args, hide, services) {
		const userId = getMentionedUserId(message, args[0]) ?? message.author.id;
		await message.channel.createMessage(await getBalance(userId, services));
	},
	async runSlash(interaction, hide, services) {
		await reply(interaction, await getBalance(getOption(interaction, "user") ?? interaction.user.id, services));
	}
};
