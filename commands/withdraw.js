import { withdraw } from "../wallet.js";
import { getOption, reply, sendMessage } from "../command-utils.js";

async function sendWithdrawal(userId, services, address, amount) {
	const hashes = await withdraw(services.wallet, userId, address.trim(), amount, services.config);
	return "Withdrawal sent. Transaction: " + hashes.join(", ");
}

export default {
	args_min: 2, args_max: 2, hide_msg: true,
	description: "Withdraws MRL from your tip wallet to a Morelo address",
	aliases: [ "transfer" ],
	private: true,
	cooldown: 10,
	options: [
		{
			name: "address",
			description: "Destination Morelo address",
			type: 3,
			required: true
		},
		{
			name: "amount",
			description: "Amount of MRL to withdraw, or \"all\" for the whole unlocked balance minus fee",
			type: 3,
			required: true
		}
	],
	async run(message, cmd, args, hide, services) {
		const result = await sendWithdrawal(message.author.id, services, args[0], args[1]);
		const channel = await services.bot.getDMChannel(message.author.id);
		await sendMessage(services.bot, channel, result);
		await sendMessage(services.bot, message.channel, "I sent the withdrawal details in a direct message.");
	},
	async runSlash(interaction, hide, services) {
		await reply(interaction, await sendWithdrawal(
			interaction.user.id,
			services,
			getOption(interaction, "address"),
			getOption(interaction, "amount")
		));
	}
};
