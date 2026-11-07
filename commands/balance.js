import { formatWalletBalance, getUserBalance } from "../wallet-users.js";
import { getMentionedUserId, getOption, reply, sendMessage } from "../command-utils.js";

async function getBalance(userId, services, displayUser = userId) {
	const balance = await getUserBalance(
		services.wallet,
		services.config.walletUsersPath,
		userId,
		services.config.legacyAddressesPath
	);
	const lockedBalance = balance.balance > balance.unlockedBalance
		? balance.balance - balance.unlockedBalance
		: 0n;
	const unlockBlocks = Number.isInteger(balance.numBlocksToUnlock) && balance.numBlocksToUnlock >= 0
		? balance.numBlocksToUnlock
		: null;
	const unlockInfo = lockedBalance > 0n && unlockBlocks !== null
		? " (" + unlockBlocks + " " + (unlockBlocks === 1 ? "block" : "blocks") + " until unlock)"
		: "";
	return "Balance for " + displayUser + ":\n"
		+ "Unlocked: " + formatWalletBalance(balance.unlockedBalance) + "\n"
		+ "Locked: " + formatWalletBalance(lockedBalance) + unlockInfo;
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
		const user = services.bot.users.get(userId) ?? await services.bot.getRESTUser(userId).catch(() => null);
		const displayUser = user ? "<@" + userId + ">" : userId;
		await sendMessage(services.bot, message.channel, await getBalance(userId, services, displayUser));
	},
	async runSlash(interaction, hide, services) {
		const userId = getOption(interaction, "user") ?? interaction.user.id;
		const user = services.bot.users.get(userId) ?? await services.bot.getRESTUser(userId).catch(() => null);
		const displayUser = user ? "<@" + userId + ">" : userId;
		await reply(interaction, await getBalance(userId, services, displayUser));
	}
};
