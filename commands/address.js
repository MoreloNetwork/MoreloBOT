import { getUserAccount } from "../wallet-users.js";
import { reply } from "../command-utils.js";

async function getAddress(userId, services) {
	const account = await getUserAccount(
		services.wallet,
		services.config.walletUsersPath,
		userId,
		services.config.legacyAddressesPath
	);
	return services.wallet.getAddress(account, 0);
}

export default {
	args_min: 0, args_max: 0, hide_msg: false,
	admin_only: false, where: 0, cooldown: 10,
	description: "Gets your Morelo tip wallet address",
	options: [],
	async run(message, cmd, args, hide, services) {
		const address = await getAddress(message.author.id, services);
		const channel = await services.bot.getDMChannel(message.author.id);
		await channel.createMessage("Your Morelo tip wallet address: " + address);
		await message.channel.createMessage("I sent your tip wallet address in a direct message.");
	},
	async runSlash(interaction, hide, services) {
		await reply(interaction, "Your Morelo tip wallet address: " + await getAddress(interaction.user.id, services));
	}
};
