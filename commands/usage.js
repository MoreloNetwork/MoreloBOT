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

import config from "../config.js";
import helper from "../helper.js";

const generateHelp = (bot) => {
	const help = [ "**Command list**", "" ];

	for(const name in global.botCommands) {
		const { adminOnly, description, aliases } = global.botCommands[name];
		if(adminOnly) {
			continue;
		}
		help.push("`" + (name === global.botMention ? "@" + bot.user.username : config.prefix + name) + "` " + (!description ? "No description" : description));

		const l = aliases.length;
		for(let i = 0; i < l; ++i) {
			const alias = aliases[i];
			help.push("`" + (alias === global.botMention ? "@" + bot.user.username : config.prefix + alias) + "` Alias for `" + (name == global.botMention ? "@" + bot.user.username : config.prefix + name) + "`");
		}
	}

	help.push(
		"", "Tip: Append `d` to the command's name to hide your message", "",
		"**Website:** <" + config.siteURL + ">",
		"**GitHub:** <" + config.repoURL + ">"
	);

	return help.join("\n");
};

export default {
	argsMin: 0, argsMax: 0, hideMsg: false,
	adminOnly: false, where: 0, cooldown: 5,
	usage: "",
	notes: "",
	description: "Shows bot's usage",
	aliases: [ "commands" ],
	options: [],
	async run(msg, cmd, args, hide, daemon, wallet, statsInfo) {
		let channel;
		if(msg.guildID != null) {
			try {
				channel = await msg.author.getDMChannel();
			} catch {}
		}

		if(channel != null) {
			channel.createMessage(generateHelp(msg.channel.client));
			helper.reply(hide, msg, "Command list has been sent! :envelope_with_arrow:");
		} else {
			helper.reply(hide, msg, generateHelp(msg.channel.client));
		}
	},
	async runSlash(bot, interaction, hide, daemon, wallet, statsInfo) {
		helper.reply(true, interaction, generateHelp(bot));
	}/*,
	async runUser(bot, interaction, hide, daemon, wallet, statsInfo) {
		
	},
	async runMessage(bot, interaction, hide, daemon, wallet, statsInfo) {
		
	}*/
};
