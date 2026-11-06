import { formatMRL, tipUsers } from "../wallet.js";

function getOnlineMemberIds(services, guildId) {
	const guild = services.bot.guilds.get(guildId);
	return guild.members.filter(member => member.status && member.status !== "offline" && !member.bot).map(member => member.id);
}

export default {
	description: "Splits MRL evenly among online server members",
	where: 1,
	cooldown: 30,
	options: [ {
		name: "amount",
		description: "Total amount of MRL to split",
		type: 3,
		required: true
	} ],
	async run(ctx, services) {
		const tip = await tipUsers(services.wallet, ctx.userId, getOnlineMemberIds(services, ctx.guildId), ctx.options.amount);
		return "Sent " + formatMRL(tip.share) + " to each of " + tip.recipients.length + " online members.\n"
			+ "Transaction: " + tip.hashes.join(", ");
	}
};
