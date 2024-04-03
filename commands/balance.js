/*
 * Copyright (c) 2024 dmkng
 *
 * This file is part of MoreloBOT.
 *
 * MoreloBOT is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * MoreloBOT is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with MoreloBOT.  If not, see <https://www.gnu.org/licenses/>.
 */

import monero from "monero-ts";

export default {
	args_min: 0, args_max: 0, hide_msg: false,
	admin_only: false, where: 0, cooldown: 5,
	options: [],
	usage: "",
	notes: "",
	description: "Shows user's wallet balance",
	async run(msg, cmd, args, hide) {
		let user = false;
		if(author?? == mentioned_author??) {
			user = ??get author discord id //TODO
		} else if (author == message author) {
			user = author //TODO
		}
		
		let user_address = get_wallet(user);
		let balance = get_balance(user_address);
		/* oryginalny embed rob pani co chcesz z tym
	embed=discord.Embed(title="Your wallet's balance", color=0xf78803)
	embed.set_thumbnail(url="https://raw.githubusercontent.com/morelo-network/Morelo-GUI/master/assets/logo128x128.png")
	embed.add_field(name="Unlocked", value = "%.9f MRL" % (balance['unlocked_balance']), inline=False)
	embed.add_field(name="Locked", value = "%.9f MRL" % ((balance['balance'] - balance['unlocked_balance'])), inline=False)
	await ctx.send(embed=embed)
	*/
	// No i tu trzeba wyslac
	},
	async runSlash(interaction, hide) {
		//
	}
	
	async get_balance(address):
		let address_index = //api.wallet.get_address_index(address)
		// https://woodser.github.io/monero-ts/typedocs/classes/MoneroWalletRpc.html#getAddressIndex to je tu
		let balance = //api.wallet.get_balance(address_index)
		// https://woodser.github.io/monero-ts/typedocs/classes/MoneroWalletRpc.html#getBalance a to je tu
		// to juz dalej parsuj jak chcesz
		return {"balance": int(balance['result']['balance']) / 1000000000, "unlocked_balance": int(balance['result']['unlocked_balance'] / 1000000000)}
		
	
	async get_wallet(user_id):
		user_address = false;
		/* ni chuja nie wiem jak to zrobic nie bede sie uczyc node
		for user in db.getAll():
			if user['user_id'] == user_id:
				user_address = user['address']
				break
		if not user_address:
			user_address = api.wallet.create_account()
			to bedzie to https://woodser.github.io/monero-ts/typedocs/classes/MoneroWalletRpc.html#createAccount zadnych argumentow tu nie bierzem
			db.add({"user_id": int(user_id), "address": user_address})
		return user_address
		*/
};
