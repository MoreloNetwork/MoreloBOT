import { formatMRL, getUserBalance } from "../wallet.js";

export default {
	description: "Shows your or another user's Morelo tip wallet balance",
	cooldown: 10,
	options: [ {
		name: "user",
		description: "The user whose balance to show",
		type: 6,
		required: false
	} ],
	async run(ctx, services) {
		const userId = ctx.options.user ?? ctx.userId;
		const balance = await getUserBalance(services.wallet, userId);
		const locked = balance.balance - balance.unlockedBalance;
		const unlockInfo = locked > 0n && balance.numBlocksToUnlock > 0
			? " (" + balance.numBlocksToUnlock + " " + (balance.numBlocksToUnlock === 1 ? "block" : "blocks") + " until unlock)"
			: "";
		return "Balance for <@" + userId + ">:\n"
			+ "Unlocked: " + formatMRL(balance.unlockedBalance) + "\n"
			+ "Locked: " + formatMRL(locked) + unlockInfo;
	}
};
