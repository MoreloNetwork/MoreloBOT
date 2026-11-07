import { UserError, parseRoleId, parseUserId } from "../command-utils.js";
import { formatMRL, tipUsers } from "../wallet.js";

function getRoleMemberIds(services, guildId, roleId) {
	const guild = services.bot.guilds.get(guildId);
	if(!guild?.roles.has(roleId)) {
		throw new UserError("Select a role from this server.");
	}
	return guild.members.filter(member => member.roles.includes(roleId) && !member.bot).map(member => member.id);
}

export default {
	description: "Tips a user or splits MRL among members of a server role",
	usage: "<@user|@role> <amount>",
	cooldown: 5,
	options: [
		{
			name: "amount",
			description: "Amount of MRL to send (split evenly for a role)",
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
			description: "Split the tip among members of this server role",
			type: 8,
			required: false
		}
	],
	parseArgs(args) {
		if(args.length !== 2) {
			return null;
		}
		const [ target, amount ] = args;
		const user = parseUserId(target);
		const role = parseRoleId(target);
		return user || role ? { amount, user, role } : null;
	},
	async run(ctx, services) {
		const { user, role, amount } = ctx.options;
		if(Boolean(user) === Boolean(role)) {
			throw new UserError("Choose either a user or a role to tip.");
		}
		if(role) {
			if(!ctx.guildId) {
				throw new UserError("Role tips can only be used in a server.");
			}
			const tip = await tipUsers(services.wallet, ctx.userId, getRoleMemberIds(services, ctx.guildId, role), amount);
			return "Sent " + formatMRL(tip.share) + " to each of " + tip.recipients.length + " members of <@&" + role + ">.\n"
				+ "Transaction: " + tip.hashes.join(", ");
		}
		if(user === ctx.userId) {
			throw new UserError("You cannot tip yourself.");
		}
		if(services.bot.users.get(user)?.bot) {
			throw new UserError("Bots cannot receive tips.");
		}
		const tip = await tipUsers(services.wallet, ctx.userId, [ user ], amount);
		return {
			content: "Sent " + formatMRL(tip.share) + " to <@" + user + ">.\nTransaction: " + tip.hashes.join(", "),
			allowedMentions: { users: [ user ] }
		};
	}
};
