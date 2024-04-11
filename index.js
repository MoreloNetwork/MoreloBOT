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
	helper.err("Unhandled rejection:", ex);
});

import fs from "node:fs/promises";
import monero from "monero-ts";
import fetch from "node-fetch";
import * as Eris from "eris";
import config from "./config.js";
import helper from "./helper.js";

if(!config.token || !config.tokenAddon) {
	helper.err("Invalid Discord tokens");
	process.exit(1);
}

let daemon, wallet;
{
	let pathSep, execExt;
	if(process.platform === "win32") {
		pathSep = "\\";
		execExt = ".exe";
	} else {
		pathSep = "/";
		execExt = "";
	}

	let binPath = "";
	if(config.binariesPath) {
		binPath = config.binariesPath;

		// Add a trailing slash if there isn't one
		const sep = binPath.slice(-1);
		if(sep !== "/" && sep !== "\\") {
			binPath += pathSep;
		}
	}

	helper.log(config.daemonURL ? "Connecting to daemon..." : "Running daemon...");

	try {
		daemon = await monero.connectToDaemonRpc(!config.daemonURL ? [
			binPath + "morelod" + execExt
		] : config.daemonURL);
		helper.log(await daemon.isTrusted() ? "Daemon trusted" : "Daemon not trusted");
	} catch(ex) {
		helper.err("Daemon:", ex);
		process.exit(1);
	}

	helper.log(config.walletURL ? "Connecting to wallet..." : "Running wallet...");

	try {
		wallet = await monero.connectToWalletRpc(!config.walletURL ? [
			binPath + "morelo-wallet-rpc" + execExt,
			"--daemon-address", config.daemonURL ? config.daemonURL : "http://localhost:38302",
			"--rpc-bind-port", "38304",
			"--disable-rpc-login",
			"--wallet-dir", config.walletsPath ? config.walletsPath : "wallets"
		] : config.walletURL);
	} catch(ex) {
		helper.err("Wallet:", ex);
		process.exit(1);
	}
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

// It's not meant to be connected to the gateway so no options provided
const botAddon = new Eris.Client("Bot " + config.tokenAddon);
botAddon.on("error", ex => {
	helper.err("Discord Addon:", ex);
}).on("warn", msg => {
	helper.warn("Discord Addon:", msg);
});

bot.editStatus("online", [ {
	name: "Hello!",
	type: Eris.Constants.ActivityTypes.WATCHING
} ]);

// Load commands and construct their registration data
const cmds = {};
const cmdsReg = [];
const cmdAliases = {};
try {
	const cmdList = await fs.readdir("commands");
	for(let i = cmdList.length - 1; i !== -1; --i) {
		const cmdFile = cmdList[i];
		if(cmdFile.endsWith(".js")) {
			const cmdName = cmdFile.slice(0, -3);
			try {
				const cmd = (await import("./commands/" + cmdFile)).default;
				cmds[cmdName] = cmd;

				// Register the command and then its aliases
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
			} catch(ex) {
				helper.err("Command:", ex);
			}
		}
	}
} catch(ex) {
	helper.err("Commands:", ex);
}

let statsInfo;
bot.once("ready", async () => {
	helper.log("Discord ready!");

	// Register commands
	//bot.bulkEditCommands(cmdsReg);

	// Update statistics info every 1 minute
	const updateInfo = async () => {
		try {
			statsInfo = await daemon.getInfo();
		} catch(ex) {
			helper.err("Daemon:", ex);
		}
	};
	await updateInfo();
	setInterval(updateInfo, 60000);

	if(config.statsChannels != null) {
		// Update statistics channel names every 2,5 minutes
		const updateStat = (id, updateFunc) => {
			if(!config.statsChannels[id]) {
				helper.err("Invalid channel ID for " + id);
				return;
			}
			const channel = bot.getChannel(config.statsChannels[id]);
			if(channel == null) {
				helper.err("No channel found with ID " + config.statsChannels[id]);
				return;
			}

			let useAddon = false;
			const timer = async () => {
				if(statsInfo != null) {
					try {
						const name = await updateFunc();
						if(name) {
							if(useAddon) {
								useAddon = false;
								await botAddon.editChannel(channel.id, { name });
							} else {
								useAddon = true;
								await channel.edit({ name });
							}
						}
					} catch(ex) {
						helper.err("Statistics:", ex);
					}
				}
				setTimeout(timer, 150000);
			};
			timer();
		};

		updateStat("hashrate", async () => {
			// Some of the numbers below are shifted by 2 decimal places
			// so that there is no need for multiplication when rounding
			let type, num = Number(statsInfo.getDifficulty()) / 1.2;
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
			return "Hashrate: " + (Math.round(num) / 100) + type;
		});
		updateStat("height", async () => {
			return "Height: " + statsInfo.getHeight();
		});
		updateStat("emission", async () => {
			if(config.explorerURL) {
				const resp = await fetch(config.explorerURL + "/api/emission");
				if(resp.ok) {
					const body = await resp.json();
					if(body.status === "success") {
						// Some of the numbers below are shifted by 2 decimal places
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
						return "Emission: " + (Math.round(num) / 100) + type;
					} else {
						throw body;
					}
				} else {
					throw resp.status;
				}
			}
		});
		updateStat("lastReward", async () => {
			const block = await daemon.getBlockByHash(statsInfo.topBlockHash);
			// Divide before but also after converting from BigInt to not lose precision when rounding
			return "Last reward: " + (Math.round(Number(block.minerTx.outputs[0].amount / 1000000n) / 10) / 100) + " MRL";
		});
		updateStat("difficulty", async () => {
			return "Difficulty: " + statsInfo.getDifficulty();
		});
	}
}).on("error", ex => {
	helper.err("Discord:", ex);
}).on("warn", msg => {
	helper.warn("Discord:", msg);
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
