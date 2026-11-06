import { getUserAddress } from "../wallet.js";

export default {
	description: "Gets your Morelo tip wallet deposit address",
	private: true,
	cooldown: 10,
	options: [],
	async run(ctx, services) {
		return "Your Morelo tip wallet address: `" + await getUserAddress(services.wallet, ctx.userId) + "`";
	}
};
