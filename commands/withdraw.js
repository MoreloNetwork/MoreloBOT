import { withdraw } from "../wallet.js";

export default {
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
	async run(ctx, services) {
		const hashes = await withdraw(services.wallet, ctx.userId, ctx.options.address.trim(), ctx.options.amount);
		return "Withdrawal sent. Transaction: " + hashes.join(", ");
	}
};
