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

process.env.TZ = "UTC";

process.title = "MoreloBOT";

process.on("unhandledRejection", (ex, promise) => {
	helper.err("Unhandled Rejection:", ex);
});

import fs from "node:fs/promises";
import monero from "monero-ts";
import fetch from "node-fetch";
import * as Eris from "eris";
import config from "./config.js";
import helper from "./helper.js";

helper.log(!config.daemonURL ? "Running daemon..." : "Connecting to daemon...");

let daemon;
try {
	daemon = await monero.connectToDaemonRpc(!config.daemonURL ? [
		"morelod"
	] : config.daemonURL);
	helper.log(await daemon.isTrusted() ? "Daemon trusted" : "Daemon not trusted");
} catch(ex) {
	helper.err("Daemon:", ex.toString());
	process.exit(1);
}

helper.log(!config.walletURL ? "Running wallet..." : "Connecting to wallet...");

let wallet;
try {
	wallet = await monero.connectToWalletRpc(!config.walletURL ? [
		"morelo-wallet-rpc",
		"--daemon-address", "http://localhost:38302",
		"--rpc-bind-port", "38304",
		"--disable-rpc-login",
		"--wallet-dir", "wallets"
	] : config.walletURL);
} catch(ex) {
	helper.err("Wallet:", ex.toString());
	process.exit(1);
}

helper.log("Connecting to Discord...");

const bot = new Eris.Client("Bot " + config.token, {
	//getAllUsers: true,
	//restMode: true,
	disableEvents: {
		"CHANNEL_DELETE": true,
		"CHANNEL_BAN_ADD": true,
		"CHANNEL_BAN_REMOVE": true,
		"GUILD_DELETE": true,
		"GUILD_MEMBER_UPDATE": true,
		"GUILD_ROLE_CREATE": true,
		"GUILD_ROLE_DELETE": true,
		"GUILD_ROLE_UPDATE": true,
		"PRESENCE_UPDATE": true,
		"TYPING_START": true,
		"USER_UPDATE": true,
		"VOICE_STATE_UPDATE": true
	},
	intents: [
		"guilds",
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

// Load commands and construct registration data
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
		let j = (cmd.aliases != null && cmd.aliases.length != null ? cmd.aliases.length : 0);
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
	helper.log("Discord ready!");

	// Register commands
	//bot.bulkEditCommands(cmdsReg);

	if(config.statsChannels != null) {
		// Resolve channels
		const channels = {
			hashrate: null,
			height: null,
			emission: null,
			lastReward: null,
			difficulty: null
		};
		for(const id in channels) {
			if(channels.hasOwnProperty(id) && config.statsChannels[id]) {
				const channel = bot.getChannel(config.statsChannels[id]);
				if(channel != null &&
					channel.permissionsOf(bot.user.id).has(Eris.Constants.Permissions.manageChannels)
				) {
					channels[id] = channel;
				}
			}
		}

		// Update channel names every 2 minutes
		const updateStats = async () => {
			const info = await daemon.getInfo();

			if(channels.hashrate != null) {
				// The numbers below are shifted by 2 decimal places
				// so that there is no need for multiplication when rounding
				let type, num = Number(info.getDifficulty()) / 1.2;
				if(num < 100000) {
					type = " H/s";
				} else if(num < 100000000) {
					num /= 1000;
					type = " kH/s";
				} else if(num < 100000000000) {
					num /= 1000000;
					type = " MH/s";
				} else if(num < 100000000000000) {
					num /= 1000000000;
					type = " GH/s";
				}
				channels.hashrate.edit({
					name: "Hashrate: " + (Math.round(num) / 100) + type
				});
			}

			if(channels.height != null) {
				setTimeout(() => {
					channels.height.edit({
						name: "Height: " + info.getHeight()
					});
				}, 1000);
			}

			if(config.explorerURL) {
				if(channels.emission != null) {
					setTimeout(async () => {
						try {
							const resp = await fetch(config.explorerURL + "/api/emission");
							const body = await resp.json();
							if(body.data != null && body.data.coinbase != null) {
								// The numbers below are shifted by 2 decimal places
								// so that there is no need for multiplication when rounding
								let type, num = body.data.coinbase / 10000000;
								if(num < 100000) {
									type = " MRL";
								} else if(num < 100000000) {
									num /= 1000;
									type = "k MRL";
								} else if(num < 100000000000) {
									num /= 1000000;
									type = "M MRL";
								}
								channels.emission.edit({
									name: "Emission: " + (Math.round(num) / 100) + type
								});
							}
						} catch {}
					}, 2000);
				}

				if(channels.lastReward != null) {
					setTimeout(async () => {
						try {
							const resp = await fetch(config.explorerURL + "/api/rawblock/" + info.getHeight());
							const body = await resp.json();
							if(body.data != null && body.data.miner_tx != null) {
								channels.lastReward.edit({
									name: "Last reward: " + (Math.round(body.data.miner_tx.vout[0].amount / 10000000) / 100) + " MRL"
								});
							}
						} catch(ex) {
							helper.err(ex);
						}
					}, 3000);
				}
			}

			if(channels.difficulty != null) {
				setTimeout(() => {
					channels.difficulty.edit({
						name: "Difficulty: " + info.getDifficulty()
					});
				}, 4000);
			}
		};
		setInterval(updateStats, 120000);
		updateStats();
	}
}).on("error", ex => {
	helper.err("Discord:", ex);
}).on("warn", msg => {
	helper.warn("Discord:", msg);
}).on("unknown", obj => {
	helper.warn("Discord Unknown:", obj);
}).on("messageCreate", msg => {
	// TODO parsing
}).on("interactionCreate", async interaction => {
	if(interaction instanceof Eris.CommandInteraction) {
		let cmdName = interaction.data.name;
		let cmd = cmds[cmdName];
		let hide = false;
		if(cmd == null) {
			cmd = cmdAliases[cmdName];
			if(cmd != null) {
				cmd = cmds[cmd];
			} else if(cmdName.endsWith("d")) {
				cmdName = cmdName.slice(0, -1);
				cmd = cmds[cmdName];
				if(cmd != null) {
					hide = true;
				} else {
					cmd = cmdAliases[cmdName];
					if(cmd != null) {
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
			if(cmd.runUser != null) {
				await cmd.runUser(interaction, hide);
			}
		} else if(interaction.data.type === Eris.Constants.ApplicationCommandTypes.MESSAGE) {
			if(cmd.runMessage != null) {
				await cmd.runMessage(interaction, hide);
			}
		} else if(cmd.runSlash != null) {
			await cmd.runSlash(interaction, hide);
		}
	} else if(interaction instanceof Eris.AutocompleteInteraction) {
		// TODO responding
	} else if(interaction instanceof Eris.ComponentInteraction) {
		// TODO
	}
}).connect();
