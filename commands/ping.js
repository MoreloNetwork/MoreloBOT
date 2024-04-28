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

import util from "node:util";
import { Base as ErisBase } from "eris";
import helper from "../helper.js";

export default {
	argsMin: 0, argsMax: 0, hideMsg: false,
	adminOnly: false, where: 0, cooldown: 5,
	usage: "",
	notes: "",
	description: "Shows bot's ping",
	aliases: [ "pong" ],
	options: [],
	async run(msg, cmd, args, hide, daemon, wallet, statsInfo) {
		const timeRecv = msg.timestamp;
		const timeNow = Date.now();

		const resp = await helper.reply(hide, msg, "Pong!");
		const timeSent = Date.now();

		const { latency } = msg.channel.guild.shard;
		if(latency === Infinity) {
			resp.edit(util.format("Pong! Latency: %ims (:arrow_up: %ims :arrow_down: %ims)",
				timeSent - timeRecv, timeSent - timeNow, timeNow - timeRecv));
		} else {
			resp.edit(util.format("Pong! Latency: %ims (:arrow_up: %ims :arrow_down: %ims)\nAPI Latency: %ims",
				timeSent - timeRecv, timeSent - timeNow, timeNow - timeRecv, latency));
		}
	},
	async runSlash(bot, interaction, hide, daemon, wallet, statsInfo) {
		const timeRecv = ErisBase.getCreatedAt(interaction.id);
		const timeNow = Date.now();

		await helper.reply(hide, interaction, "Pong!");
		const timeSent = Date.now();

		const { latency } = bot.shards.get(bot.guildShardMap[interaction.guildID] || 0);
		if(latency === Infinity) {
			interaction.editOriginalMessage(util.format("Pong! Latency: %ims (:arrow_up: %ims :arrow_down: %ims)",
				timeSent - timeRecv, timeSent - timeNow, timeNow - timeRecv));
		} else {
			interaction.editOriginalMessage(util.format("Pong! Latency: %ims (:arrow_up: %ims :arrow_down: %ims)\nAPI Latency: %ims",
				timeSent - timeRecv, timeSent - timeNow, timeNow - timeRecv, latency));
		}
	}
};
