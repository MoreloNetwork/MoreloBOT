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

import fs from "node:fs/promises";
import monero from "monero-ts";
import fetch from "node-fetch";
import * as Eris from "eris";
import config from "./config.js";
import helper from "./helper.js";

process.on("unhandledRejection", (ex, promise) => {
	helper.err("Unhandled rejection:", ex);
});

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

		const info = await daemon.getInfo();
		if(info.getHeight() >= info.getTargetHeight()) {
			helper.log("Daemon synced");
		} else {
			helper.log("Daemon not synced, height: %i, target: %i", info.getHeight(), info.getTargetHeight());
		}
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

// Load commands and construct their registration data
const cmds = {};
const cmdsReg = [];
const cmdAliases = {};
try {
	const registerCmd = (cmd, name) => {
		if(cmd.runSlash) {
			cmdsReg.push({
				name,
				description: cmd.description,
				options: cmd.options
			});
			cmdsReg.push({
				name: name + "d",
				description: cmd.description + " (response hidden)",
				options: cmd.options
			});
		}
		if(cmd.runUser) {
			cmdsReg.push({
				name,
				description: cmd.description,
				type: Eris.Constants.ApplicationCommandTypes.USER
			});
			cmdsReg.push({
				name: name + "d",
				description: cmd.description + " (response hidden)",
				type: Eris.Constants.ApplicationCommandTypes.USER
			});
		}
		if(cmd.runMessage) {
			cmdsReg.push({
				name,
				description: cmd.description,
				type: Eris.Constants.ApplicationCommandTypes.MESSAGE
			});
			cmdsReg.push({
				name: name + "d",
				description: cmd.description + " (response hidden)",
				type: Eris.Constants.ApplicationCommandTypes.MESSAGE
			});
		}
	};
	const loadCmd = async (cmdFile, name) => {
		const cmd = (await import(cmdFile)).default;

		// Register the command
		cmds[name] = cmd;
		if(typeof name === "string") {
			registerCmd(cmd, name);
		}

		// Register the command's aliases
		if(cmd.aliases != null && cmd.aliases.length != null) {
			for(let j = cmd.aliases.length - 1; j !== -1; --j) {
				const alias = cmd.aliases[j];
				cmdAliases[alias] = name;
				if(typeof alias === "string") {
					registerCmd(cmd, alias);
				}
			}
		}
	};

	// Load the commands from the directory
	const cmdList = await fs.readdir("commands");
	for(let i = cmdList.length - 1; i !== -1; --i) {
		const cmdFile = cmdList[i];
		try {
			if(cmdFile.endsWith(".js")) {
				await loadCmd("./commands/" + cmdFile, cmdFile.slice(0, -3));
			} else {
				await loadCmd("./commands/" + cmdFile + "/index.js", cmdFile);
			}
		} catch(ex) {
			helper.err("Can't load command %s:", cmdFile, ex);
		}
	}

	// Load the bot mention command
	await loadCmd("./mention.js", global.botMention = Symbol("botMention"));
} catch(ex) {
	helper.err("Can't load commands:", ex);
}
global.botCommands = cmds;

helper.log("Connecting to Discord...");

const bot = new Eris.Client("Bot " + config.token, {
	//getAllUsers: true,
	//restMode: true,
	disableEvents: {
		"CHANNEL_BAN_ADD": true,
		"CHANNEL_BAN_REMOVE": true,
		"PRESENCE_UPDATE": true,
		"TYPING_START": true,
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

// It's not meant to be connected to the gateway so no options provided
const botAddon = new Eris.Client("Bot " + config.tokenAddon);
botAddon.on("error", ex => {
	helper.err("Discord Addon:", ex);
}).on("warn", msg => {
	helper.warn("Discord Addon:", msg);
});

const cooldown = {};
let mention, statsTimer, statsInfo;
bot.once("ready", async () => {
	helper.log("Discord connected!");

	// Cache the bot mention regexp
	mention = new RegExp("^<@!?" + bot.user.id + ">( |$)");

	// Register the commands
	bot.bulkEditCommands(cmdsReg);

	// Update statistics info every 1 minute
	const updateStats = async () => {
		try {
			const info = await daemon.getInfo();
			if(info.getHeight() >= info.getTargetHeight()) {
				statsInfo = info;
			}
		} catch(ex) {
			helper.err("Daemon:", ex);
		}
	};
	await updateStats();
	statsTimer = setInterval(updateStats, 60000);

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
						const err = new Error("Response not OK");
						err.body = body;
						throw err;
					}
				} else {
					const err = new Error("Status not OK");
					err.status = resp.status;
					err.body = resp.body;
					throw err;
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

	helper.log("Discord ready!");
}).on("error", ex => {
	helper.err("Discord:", ex);
}).on("warn", msg => {
	helper.warn("Discord:", msg);
}).on("messageCreate", async msg => {
	// Ignore the message when the author is a bot
	if(msg.author.bot) {
		return;
	}

	// Check if the message contains the command prefix or the bot mention
	let isMention = false;
	if(mention.test(msg.content)) {
		isMention = true;
	} else if(msg.content.length <= config.prefix.length || msg.content.slice(0, config.prefix.length).toLowerCase() !== config.prefix) {
		return;
	}

	// Split the message
	const args = msg.content.split(/\s+/g);
	let cmdName;
	if(isMention) {
		args.shift();
		cmdName = (config.prefixMention && args.length != 0 ? args.shift() : global.botMention);
	} else {
		cmdName = args.shift().slice(config.prefix.length).toLowerCase();
	}

	// Find the command and check if the message has to be deleted
	let cmd = cmds[cmdName];
	let hide = false;
	if(cmd == null) {
		cmd = cmdAliases[cmdName];
		if(cmd != null) {
			cmd = cmds[cmd];
		} else if(!isMention && cmdName.endsWith("d")) {
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

	try {
		// TODO Check if the command is admin only

		// Check if command can be executed
		// 0 = Command can be executed in both the guilds and the DMs
		// 1 = Command can be executed in the guilds only
		// 2 = Command can be executed in the DMs only
		if(cmd.where === 1 && !msg.guildID) {
			helper.reply(hide, msg, "This command can be executed in the guilds only");
			return;
		} else if(cmd.where === 2 && msg.guildID) {
			helper.reply(hide, msg, "This command can be executed in the DMs only");
			return;
		}

		// Construct the syntax message
		let syntax = "Usage: `" + (isMention ? "@" + bot.user.username : config.prefix + (hide ? cmdName + "d" : cmdName));
		if(typeof cmd.usage === "function") {
			syntax += " " + cmd.usage(msg, cmdName, hide);
		} else if(cmd.usage != null) {
			syntax += " " + cmd.usage;
		}
		if(typeof cmd.notes === "function") {
			syntax += "`\n\n" + cmd.notes(msg, cmdName, hide);
		} else if(cmd.notes != null) {
			syntax += "`\n\n" + cmd.notes;
		} else {
			syntax += "`";
		}

		// Delete the message if it has to be deleted and can be deleted
		if((cmd.hideMsg || hide) && helper.isDeletable(msg)) {
			msg.delete().catch(ex => {
				helper.err("Can't delete message:", ex);
			});
		}

		// Check the arguments count, show usage if incorrect
		if(args.length < cmd.argsMin || (cmd.argsMax !== -1 && args.length > cmd.argsMax)) {
			helper.reply(hide, msg, syntax);
			return;
		}

		// Check if the command is on cooldown
		// TODO Check for the admin cooldown bypass
		const cooldownKey = (isMention ? msg.author.id : msg.author.id  + cmdName);
		const time = Date.now();
		if(cooldown[cooldownKey] != null && cooldown[cooldownKey] > time) {
			helper.reply(hide, msg, "**Cool down!** (" + helper.formatTime(cooldown[cooldownKey] - time) + " left)").then(m => {
				setTimeout(() => {
					m.delete().catch(ex => {
						helper.err("Can't delete message:", ex);
					});
				}, Math.min(10000, cooldown[cooldownKey] - time));
			});
		} else {
			// Run the command
			try {
				const res = await cmd.run(msg, cmdName, args, hide, daemon, wallet, statsInfo);
				if(res === true) {
					helper.reply(hide, msg, "Invalid arguments.\n" + syntax);
				} else if(typeof res === "string") {
					helper.reply(hide, msg, res + "\n" + syntax);
				}
			} catch(ex) {
				if(ex === true) {
					helper.reply(hide, msg, ":warning: **Error!** Something went wrong");
				} else if(typeof ex === "string") {
					helper.reply(hide, msg, ":warning: **Error!** " + ex);
				} else {
					helper.err("Command", cmdName, ex);
					helper.reply(hide, msg, ":warning: **Error** Report this to the administration:\n```\n" + ex + "\n```");
				}
			}

			// Set cooldown
			cooldown[cooldownKey] = Date.now() + cmd.cooldown * 1000;
		}
	} catch(ex) {
		// Got error probably from MySQL
		helper.err("Global", ex);
		helper.reply(hide, msg, ":warning: **Error** Report this to the administration:\n```\n" + ex + "\n```");
	}
}).on("interactionCreate", async interaction => {
	if(interaction instanceof Eris.CommandInteraction) {
		// Find the command and check if the message has to be deleted
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

		try {
			// TODO Check if the command is admin only

			// Check if command can be executed
			// 0 = Command can be executed in both the guilds and the DMs
			// 1 = Command can be executed in the guilds only
			// 2 = Command can be executed in the DMs only
			if(cmd.where === 1 && !interaction.guildID) {
				helper.reply(hide, interaction, "This command can be executed in the guilds only");
				return;
			} else if(cmd.where === 2 && interaction.guildID) {
				helper.reply(hide, interaction, "This command can be executed in the DMs only");
				return;
			}

			// Construct the syntax message
			let syntax = "Usage: `/" + (hide ? cmdName + "d" : cmdName);
			if(typeof cmd.usage === "function") {
				syntax += " " + cmd.usage(msg, cmdName, hide);
			} else if(cmd.usage != null) {
				syntax += " " + cmd.usage;
			}
			if(typeof cmd.notes === "function") {
				syntax += "`\n\n" + cmd.notes(msg, cmdName, hide);
			} else if(cmd.notes != null) {
				syntax += "`\n\n" + cmd.notes;
			} else {
				syntax += "`";
			}

			// Run the command
			try {
				let res;
				if(interaction.data.type === Eris.Constants.ApplicationCommandTypes.USER) {
					if(cmd.runUser != null) {
						res = await cmd.runUser(bot, interaction, hide, daemon, wallet, statsInfo);
					}
				} else if(interaction.data.type === Eris.Constants.ApplicationCommandTypes.MESSAGE) {
					if(cmd.runMessage != null) {
						res = await cmd.runMessage(bot, interaction, hide, daemon, wallet, statsInfo);
					}
				} else if(cmd.runSlash != null) {
					res = await cmd.runSlash(bot, interaction, hide, daemon, wallet, statsInfo);
				}
				if(res === true) {
					helper.reply(hide, interaction, "Invalid arguments.\n" + syntax);
				} else if(typeof res === "string") {
					helper.reply(hide, interaction, res + "\n" + syntax);
				}
			} catch(ex) {
				if(ex === true) {
					helper.reply(hide, interaction, ":warning: **Error!** Something went wrong");
				} else if(typeof ex === "string") {
					helper.reply(hide, interaction, ":warning: **Error!** " + ex);
				} else {
					helper.err("Command", cmdName, ex);
					helper.reply(hide, interaction, ":warning: **Error** Report this to the administration:\n```\n" + ex + "\n```");
				}
			}
		} catch(ex) {
			// Got error probably from MySQL
			helper.err("Global", ex);
			helper.reply(hide, msg, ":warning: **Error** Report this to the administration:\n```\n" + ex + "\n```");
		}
	} else if(interaction instanceof Eris.AutocompleteInteraction) {
		// TODO responding
	} else if(interaction instanceof Eris.ComponentInteraction) {
		// TODO
	}
}).connect();
