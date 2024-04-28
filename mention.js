/**
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

import config from "./config.js";
import helper from "./helper.js";

export default {
	argsMin: 0, argsMax: 0, hideMsg: false,
	adminOnly: false, where: 0, cooldown: 5,
	usage: "",
	notes: "",
	description: "Shows bot's help message",
	aliases: [ "help" ],
	options: [],
	async run(msg, cmd, args, hide, daemon, wallet, statsInfo) {
		helper.reply(hide, msg, "Hello! I'm MoreloBOT, made by Morelo Network. Type `" + config.prefix + "usage`, `@" + msg.channel.client.user.username + " usage` or `/usage` to get the command list.");
	},
	async runSlash(bot, interaction, hide, daemon, wallet, statsInfo) {
		helper.reply(true, interaction, "Hello! I'm MoreloBOT, made by Morelo Network. Type `" + config.prefix + "usage`, `@" + bot.user.username + " usage` or `/usage` to get the command list.");
	}
};
