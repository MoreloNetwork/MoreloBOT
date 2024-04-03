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
		//
	},
	
	async address(message_context?):
		let user_id = message author id??;
		//to to jest w balance.js juz, do api to trzeba dodać czy cuś ale to nie api tylko mechanizm do tipow wiec w klasie to powinno wylądować
		let user_address = //get_wallet(user_id);
		let user_dm = //await ctx.author.create_dm() tu trza DM zrobic do usera zebyt wyslal mu wiadomosc albo niech wysyla na kanale. ale nie wiemy czy  ludzie chca zeby ta informacja byla prywatna czy publiczna wiec moze lepiej dm albo odpowiedz bota ktora widzi tylko autor tak sie chyba da?
		// wysyłanko wiadomosci z adresemawait user_dm.send("Your tip's wallet address: " + user_address)
	
	async runSlash(interaction, hide) {
		//
	}
};
