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

process.env.TZ = "UTC";

process.title = "MoreloBOT";

process.chdir(import.meta.dirname);

import fs from "node:fs/promises";
import * as Eris from "eris";
import monero from "monero-ts";
import config from "./config.js";

console.log("Running daemon RPC...");

const daemon = await monero.connectToDaemonRpc({ cmd: [
	"morelod"
]});
try {
	console.log("Height:", await daemon.getHeight());
	console.log("TxPool:", await daemon.getTxPool());
} catch(e) {
	console.error("Daemon RPC:", e.toString());
	process.exit(1);
}

console.log("Running wallet RPC...");

const wallet = await monero.connectToWalletRpc({ cmd: [
	"morelo-wallet-rpc",
	"--daemon-address", "http://localhost:38302",
	"--rpc-bind-port", "38304",
	"--disable-rpc-login",
	"--wallet-dir", "wallets"
]});

console.log("Connecting to Discord...");

const bot = new Eris.Client("Bot " + config.token, {
	//getAllUsers: true,
	//restMode: true,
	disableEvents: {
		"CHANNEL_CREATE": true,
		"CHANNEL_DELETE": true,
		"CHANNEL_UPDATE": true,
		"CHANNEL_BAN_ADD": true,
		"CHANNEL_BAN_REMOVE": true,
		"GUILD_CREATE": true,
		"GUILD_DELETE": true,
		"GUILD_MEMBER_UPDATE": true,
		"GUILD_ROLE_CREATE": true,
		"GUILD_ROLE_DELETE": true,
		"GUILD_ROLE_UPDATE": true,
		"GUILD_UPDATE": true,
		"PRESENCE_UPDATE": true,
		"TYPING_START": true,
		"USER_UPDATE": true,
		"VOICE_STATE_UPDATE": true
	},
	intents: [
		"guildMessages",
		"guildMessageReactions",
		"directMessages",
		"directMessageReactions"
	]
});

bot.editStatus("online", [ {
	name: "Hello!",
	type: Eris.Constants.ActivityTypes.WATCHING
} ]);

// Loading commands and constructing registration data
const cmds = {};
const cmdsReg = [];
const cmdAliases = {};
const cmdList = await fs.readdir("commands");
for(let i = cmdList.length - 1; i !== -1; --i) {
	const cmdFile = cmdList[i];
	if(cmdFile.endsWith(".js")) {
		const cmdName = cmdFile.slice(0, -3);
		const cmd = (await import("./commands/" + cmdFile)).default;
		cmds[cmdName] = cmd;

		let alias = cmdName;
		let j = (cmd.aliases !== undefined ? cmd.aliases.length : 0);
		do {
			if(cmd.runSlash) {
				cmdsReg.push({
					name: alias,
					description: cmd.description,
					options: cmd.options
				});
			}
			if(cmd.runUser) {
				cmdsReg.push({
					name: alias,
					description: cmd.description,
					type: Eris.Constants.ApplicationCommandTypes.USER
				});
			}
			if(cmd.runMessage) {
				cmdsReg.push({
					name: alias,
					description: cmd.description,
					type: Eris.Constants.ApplicationCommandTypes.MESSAGE
				});
			}

			if(--j === -1) {
				break;
			}

			alias = cmd.aliases[j];
			cmdAliases[alias] = cmdName;
		} while(true);
	}
}

bot.on("ready", () => {
	console.log("Ready!");

	// Registering commands
	//bot.bulkEditCommands(cmdsReg);

	// TODO stats
}).on("error", err => {
	console.error("[err]", err);
}).on("warn", msg => {
	console.warn("[warn]", msg);
}).on("unknown", pkg => {
	console.warn("[unknown]", pkg);
}).on("messageCreate", msg => {
	// TODO parsing
}).on("interactionCreate", interaction => {
	if(interaction instanceof Eris.CommandInteraction) {
		let cmdName = interaction.data.name;
		let cmd = cmds[cmdName];
		let hide = false;
		if(cmd === undefined) {
			cmd = cmdAliases[cmdName];
			if(cmd !== undefined) {
				cmd = cmds[cmd];
			} else if(cmdName.endsWith("d")) {
				cmdName = cmdName.slice(0, -1);
				cmd = cmds[cmdName];
				if(cmd !== undefined) {
					hide = true;
				} else {
					cmd = cmdAliases[cmdName];
					if(cmd !== undefined) {
						cmd = cmds[cmd];
						hide = true;
					} else {
						return;
					}
				}
			} else {
				return;
			}
		}

		if(interaction.data.type === Eris.Constants.ApplicationCommandTypes.USER) {
			if(cmd.runUser !== undefined) {
				cmd.runUser(interaction, hide);
			}
		} else if(interaction.data.type === Eris.Constants.ApplicationCommandTypes.MESSAGE) {
			if(cmd.runMessage !== undefined) {
				cmd.runMessage(interaction, hide);
			}
		} else if(cmd.runSlash !== undefined) {
			cmd.runSlash(interaction, hide);
		}
	} else if(interaction instanceof Eris.AutocompleteInteraction) {
		// TODO responding
	} else if(interaction instanceof Eris.ComponentInteraction) {
		// TODO
	}
}).connect();
