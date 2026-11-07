import { formatWalletBalance, parseMRLAmount, sendUserTips } from "./wallet-users.js";

function getGuildMembers(services, guildId) {
	const guild = services.bot.guilds.get(guildId);
	if(!guild) {
		throw new Error("This server's members are not available.");
	}
	return guild.members.values();
}

export function getRoleRecipientIds(services, guildId, roleId) {
	const guild = services.bot.guilds.get(guildId);
	if(!guild || !guild.roles.has(roleId)) {
		throw new Error("Select a role from this server.");
	}
	return Array.from(getGuildMembers(services, guildId))
		.filter(member => member.roles.includes(roleId) && !member.user?.bot)
		.map(member => member.id);
}

export function getOnlineRecipientIds(services, guildId) {
	return Array.from(getGuildMembers(services, guildId))
		.filter(member => {
			const status = member.status ?? member.presence?.status;
			return status && status !== "offline" && !member.user?.bot;
		})
		.map(member => member.id);
}

export async function distributeTip(services, senderId, recipientIds, amount) {
	const recipients = [ ...new Set(recipientIds.map(String)) ]
		.filter(recipientId => recipientId !== String(senderId));
	if(recipients.length === 0) {
		return "There are no eligible recipients for this tip.";
	}

	const total = parseMRLAmount(amount);
	if(total < BigInt(recipients.length)) {
		return "The amount is too small to give every recipient at least one atomic unit (0.000000001 MRL).";
	}
	const share = total / BigInt(recipients.length);
	const remainder = total % BigInt(recipients.length);
	const payouts = recipients.map((recipientId, index) => ({
		recipientId,
		amount: share + (BigInt(index) < remainder ? 1n : 0n)
	}));
	try {
		await sendUserTips(
			services.wallet,
			services.config.walletUsersPath,
			senderId,
			payouts,
			services.config.legacyAddressesPath,
			services.walletNotificationStore
		);
	} catch(ex) {
		return ex.code === "INSUFFICIENT_FUNDS" || Number(ex.code) === -37
			? "Not enough unlocked MRL to cover the tip and transaction fee."
			: "Tip was not sent: " + ex.message;
	}
	return "Tip distributed in one transaction: " + formatWalletBalance(total) + " among " + recipients.length + " recipients.";
}
