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

import monero from "monero-ts";
import fetch from "node-fetch";
import * as Eris from "eris";
import fs from "node:fs/promises";
import config from "./config.js";
import helper from "./helper.js";
import { getEmission, getMempool, getNetworkReport, getNetworkStats, formatHashrateValue, formatMempool } from "./features.js";
import mentionCommand from "./mention.js";
import { connectWalletRpc, stopOwnedWalletRpc } from "./wallet-rpc.js";
import WalletNotificationStore from "./wallet-notification-store.js";
import { startWalletNotifications } from "./wallet-notifications.js";

let daemon, wallet, bot, botAddon;
let ownsWalletRpcProcess = false;
let walletRpcProcess;
let shutdownPromise;
let walletNotificationService;
const walletNotificationStore = new WalletNotificationStore(config.walletNotificationsPath);

async function shutdown(reason, exitCode = 0) {
	if(shutdownPromise) {
		return shutdownPromise;
	}
	shutdownPromise = (async () => {
		helper.log("Shutting down (%s)", reason);
		try {
			await walletNotificationService?.stop();
		} catch(ex) {
			helper.err("Can't stop wallet notifications:", ex);
			exitCode ||= 1;
		}
		try {
			bot?.disconnect({ reconnect: false });
			botAddon?.disconnect({ reconnect: false });
		} catch(ex) {
			helper.err("Can't disconnect Discord clients:", ex);
			exitCode ||= 1;
		}
		try {
			await stopOwnedWalletRpc(wallet, ownsWalletRpcProcess, walletRpcProcess);
		} catch(ex) {
			helper.err("Can't stop wallet RPC:", ex);
			exitCode ||= 1;
		}
		process.exit(exitCode);
	})();
	return shutdownPromise;
}

process.on("SIGINT", () => void shutdown("SIGINT", 130));
process.on("SIGTERM", () => void shutdown("SIGTERM", 143));
process.on("uncaughtException", ex => {
	helper.err("Uncaught exception:", ex);
	void shutdown("uncaught exception", 1);
});
process.on("unhandledRejection", ex => {
	helper.err("Unhandled rejection:", ex);
	void shutdown("unhandled rejection", 1);
});
process.on("exit", () => {
	const child = ownsWalletRpcProcess && walletRpcProcess;
	if(child && !child.killed) {
		child.kill();
	}
});

if(!config.token || !config.tokenAddon) {
	helper.err("Invalid Discord tokens");
	process.exit(1);
}

{
	const pathSep = process.platform === "win32" ? "\\" : "/";
	const execExt = process.platform === "win32" ? ".exe" : "";
	let binPath = config.binariesPath || "";
	if(binPath && !binPath.endsWith("/") && !binPath.endsWith("\\")) {
		binPath += pathSep;
	}

	helper.log(config.daemonURL ? "Connecting to daemon..." : "Running daemon...");
	try {
		daemon = await monero.connectToDaemonRpc(config.daemonURL || [ binPath + "morelod" + execExt ]);
		const info = await daemon.getInfo();
		if(info.getTargetHeight() === 0 || info.getHeight() >= info.getTargetHeight()) {
			helper.log("Daemon synced");
		} else {
			helper.log("Daemon not synced, height: %i, target: %i", info.getHeight(), info.getTargetHeight());
		}
	} catch(ex) {
		helper.err("Daemon:", ex);
		process.exit(1);
	}

	helper.log(config.walletURL ? "Connecting to wallet..." : "Checking local wallet RPC...");
	try {
		const connection = await connectWalletRpc(monero, config, binPath, execExt, child => {
			walletRpcProcess = child;
			ownsWalletRpcProcess = true;
		});
		wallet = connection.wallet;
		ownsWalletRpcProcess = connection.ownsProcess;
		walletRpcProcess = connection.process;
	} catch(ex) {
		helper.err("Wallet:", ex);
		await shutdown("wallet startup failed", 1);
	}
}

bot = new Eris.Client("Bot " + config.token, {
	disableEvents: {
		"CHANNEL_BAN_ADD": true,
		"CHANNEL_BAN_REMOVE": true,
		"TYPING_START": true,
		"VOICE_STATE_UPDATE": true
	},
	intents: [
		"guilds",
		"guildMembers",
		"guildPresences",
		"guildMessages",
		"guildMessageReactions",
		1 << 15,
		"directMessages",
		"directMessageReactions"
	]
});
bot.editStatus("online", [ {
	name: "Hello!",
	type: Eris.Constants.ActivityTypes.WATCHING
} ]);

botAddon = new Eris.Client("Bot " + config.tokenAddon);
botAddon.on("error", ex => {
	helper.err("Discord Addon:", ex);
}).on("warn", msg => {
	helper.warn("Discord Addon:", msg);
});

const cmds = {};
const cmdsReg = [];
const cmdAliases = {};
try {
	const cmdList = await fs.readdir("commands");
	const commandNames = new Set(cmdList.filter(file => file.endsWith(".js")).map(file => file.slice(0, -3)));
	const registeredAliases = new Set();
	for(const cmdFile of cmdList) {
		if(!cmdFile.endsWith(".js")) {
			continue;
		}
		const cmdName = cmdFile.slice(0, -3);
		try {
			const cmd = (await import("./commands/" + cmdFile)).default;
			cmds[cmdName] = cmd;
			const aliases = [ cmdName, ...(cmd.aliases || []) ];
			for(const alias of aliases) {
				if(alias !== cmdName) {
					if(commandNames.has(alias) || registeredAliases.has(alias)) {
						continue;
					}
					cmdAliases[alias] = cmdName;
					registeredAliases.add(alias);
				}
				for(const hidden of [ false, true ]) {
					const commandName = alias + (hidden ? "d" : "");
					if(cmd.runSlash) {
						cmdsReg.push({
							name: commandName,
							description: cmd.description + (hidden ? " (response hidden)" : ""),
							options: cmd.options || []
						});
					}
					if(cmd.runUser) {
						cmdsReg.push({
							name: commandName,
							description: cmd.description + (hidden ? " (response hidden)" : ""),
							type: Eris.Constants.ApplicationCommandTypes.USER
						});
					}
					if(cmd.runMessage) {
						cmdsReg.push({
							name: commandName,
							description: cmd.description + (hidden ? " (response hidden)" : ""),
							type: Eris.Constants.ApplicationCommandTypes.MESSAGE
						});
					}
				}
			}
		} catch(ex) {
			helper.err("Command:", ex);
		}
	}
} catch(ex) {
	helper.err("Commands:", ex);
}
const commandServices = { daemon, wallet, bot, config, commands: cmds, walletNotificationStore };
const cooldowns = new Map();
let mention;
let statsInfo;

function findCommand(name) {
	let hide = false;
	let command = cmds[name];
	if(!command) {
		if(name.endsWith("d")) {
			hide = true;
			name = name.slice(0, -1);
		}
		command = cmds[name] || cmds[cmdAliases[name]];
	}
	return command ? { name, command, hide } : null;
}

function isOnCooldown(userId, commandName, command) {
	const key = userId + ":" + commandName;
	const now = Date.now();
	const expiry = cooldowns.get(key) || 0;
	if(expiry > now) {
		return (expiry - now) / 1000;
	}
	cooldowns.set(key, now + Math.max(0, Number(command.cooldown) || 0) * 1000);
	return 0;
}

async function runMessageCommand(message, commandName, args, hide = false) {
	const found = findCommand(commandName);
	if(!found || typeof found.command.run !== "function") {
		return;
	}
	const command = found.command;
	hide ||= found.hide;
	const argsMin = command.args_min ?? command.argsMin ?? 0;
	const argsMax = command.args_max ?? command.argsMax ?? -1;
	if(args.length < argsMin || (argsMax !== -1 && args.length > argsMax)) {
		await helper.reply(hide, message, "Invalid command arguments.", undefined, bot);
		return;
	}
	if((command.where === 1 && !message.guildID) || (command.where === 2 && message.guildID)) {
		await helper.reply(hide, message, command.where === 1
			? "This command can only be used in a server."
			: "This command can only be used in direct messages.", undefined, bot);
		return;
	}
	if((hide || command.hide_msg || command.hideMsg) && helper.isDeletable(message, bot)) {
		message.delete().catch(ex => helper.err("Can't delete command message:", ex));
	}
	const remaining = isOnCooldown(message.author.id, found.name, command);
	if(remaining) {
		await helper.reply(hide, message, "Please wait " + helper.formatTime(remaining * 1000) + " before using this command again.", undefined, bot);
		return;
	}
	try {
		const result = await command.run(message, found.name, args, hide, commandServices);
		if(typeof result === "string") {
			await helper.reply(hide, message, result, undefined, bot);
		}
	} catch(ex) {
		helper.err("Command " + found.name + ":", ex);
		await helper.reply(hide, message, "Command failed; please try again.", undefined, bot).catch(replyError => {
			helper.err("Command response:", replyError);
		});
	}
}

bot.once("ready", async () => {
	helper.log("Discord ready!");
	mention = new RegExp("^<@!?" + bot.user.id + ">(?:\\s|$)");
	try {
		walletNotificationService = await startWalletNotifications({
			wallet,
			bot,
			config,
			store: walletNotificationStore,
			logger: {
				error: (...args) => helper.err(...args),
				warn: (...args) => helper.warn(...args)
			}
		});
	} catch(ex) {
		helper.err("Wallet notifications:", ex);
	}
	try {
		await bot.bulkEditCommands(cmdsReg);
	} catch(ex) {
		helper.err("Commands:", ex);
	}

	const updateInfo = async () => {
		try {
			const info = await daemon.getInfo();
			if(info.getTargetHeight() === 0 || info.getHeight() >= info.getTargetHeight()) {
				statsInfo = info;
			}
		} catch(ex) {
			helper.err("Daemon getInfo:", ex);
		}
	};
	await updateInfo();
	setInterval(updateInfo, 60000);

	if(config.statsTextChannel) {
		const channel = bot.getChannel(config.statsTextChannel);
		if(!channel) {
			helper.err("No statistics text channel found with ID " + config.statsTextChannel);
		} else {
			let statsMessage;
			const updateTextStats = async () => {
				if(!statsInfo) {
					return;
				}
				try {
					const report = await getNetworkReport(daemon, config);
					if(!statsMessage) {
						try {
							const messages = await bot.getMessages(channel.id, { limit: 50 });
							statsMessage = messages.find(message =>
								message.author.id === bot.user.id && message.content?.startsWith("Network statistics")
							);
						} catch(ex) {
							helper.warn("Statistics history:", ex);
						}
					}
					statsMessage = statsMessage
						? await bot.editMessage(channel.id, statsMessage.id, report)
						: await bot.createMessage(channel.id, report);
				} catch(ex) {
					helper.err("Statistics message:", ex);
				}
			};
			await updateTextStats();
			setInterval(updateTextStats, Math.max(60000, Number(config.statsUpdateInterval) || 60000));
		}
	}

	if(config.txPoolChannel) {
		const channel = bot.getChannel(config.txPoolChannel);
		if(!channel) {
			helper.err("No transaction pool channel found with ID " + config.txPoolChannel);
		} else {
			const updateTxPoolMessage = async () => {
				try {
					const mempool = await getMempool(config);
					if(!mempool) {
						return;
					}
					const content = formatMempool(mempool, new Date(), 4000, config.explorerURL);
					const saved = await walletNotificationStore.getMessage("txpool");
					let message;
					if(saved?.channelId === channel.id) {
						try {
							message = await bot.editMessage(channel.id, saved.messageId, content);
						} catch {
						message = undefined;
					}
					}
					if(!message) {
						message = await bot.createMessage(channel.id, content);
						await walletNotificationStore.setMessage("txpool", {
							channelId: channel.id,
							messageId: message.id
						});
					}
				} catch(ex) {
					helper.err("Transaction pool message:", ex);
				}
			};
			await updateTxPoolMessage();
			setInterval(updateTxPoolMessage, Math.max(15000, Number(config.txPoolUpdateInterval) || 30000));
		}
	}

	if(config.statsChannels) {
		const updateStat = (id, updateFunc) => {
			if(!config.statsChannels[id]) {
				return;
			}
			const channel = bot.getChannel(config.statsChannels[id]);
			if(!channel) {
				helper.err("No channel found with ID " + config.statsChannels[id]);
				return;
			}
			let useAddon = false;
			const timer = async () => {
				if(statsInfo) {
					try {
						const name = await updateFunc();
						if(name) {
							if(useAddon) {
								await botAddon.editChannel(channel.id, { name });
							} else {
								await bot.editChannel(channel.id, { name });
							}
							useAddon = !useAddon;
						}
					} catch(ex) {
						helper.err("Statistics:", ex);
					}
				}
				setTimeout(timer, 150000);
			};
			timer();
		};

		updateStat("hashrate", async () => "Hashrate: " + formatHashrateValue(Number(statsInfo.getDifficulty()) / 120));
		updateStat("height", async () => "Height: " + statsInfo.getHeight());
		updateStat("emission", async () => {
			const emission = await getEmission(config);
			return emission ? "Emission: " + emission : null;
		});
		updateStat("lastReward", async () => "Last reward: " + (await getNetworkStats(daemon)).blockReward);
		updateStat("difficulty", async () => "Difficulty: " + statsInfo.getDifficulty());
		updateStat("xeggexUSDT", async () => {
			const response = await fetch("https://api.xeggex.com/api/v2/market/getbysymbol/MRL_USDT");
			if(!response.ok) {
				throw new Error("Xeggex returned HTTP " + response.status);
			}
			const body = await response.json();
			return body.lastPrice ? "MRL/USDT: " + body.lastPrice : null;
		});
		updateStat("xeggexDOGE", async () => {
			const response = await fetch("https://api.xeggex.com/api/v2/market/getbysymbol/MRL_DOGE");
			if(!response.ok) {
				throw new Error("Xeggex returned HTTP " + response.status);
			}
			const body = await response.json();
			return body.lastPrice ? "MRL/DOGE: " + body.lastPrice : null;
		});
	}
}).on("error", ex => {
	helper.err("Discord:", ex);
}).on("warn", msg => {
	helper.warn("Discord:", msg);
}).on("messageCreate", async message => {
	if(message.author.bot) {
		return;
	}
	const content = message.content || "";
	const matchedMention = mention?.exec(content);
	if(matchedMention) {
		const remainder = content.slice(matchedMention[0].length).trim();
		if(!remainder || !config.prefixMention) {
			await mentionCommand.run(message, null, [], false, commandServices);
			return;
		}
		const [ commandName, ...args ] = remainder.split(/\s+/);
		await runMessageCommand(message, commandName.toLowerCase(), args);
		return;
	}
	const prefix = config.prefix || "";
	if(!prefix || !content.toLowerCase().startsWith(prefix.toLowerCase())) {
		return;
	}
	const [ commandName, ...args ] = content.slice(prefix.length).trim().split(/\s+/);
	if(commandName) {
		await runMessageCommand(message, commandName.toLowerCase(), args);
	}
}).on("interactionCreate", async interaction => {
	if(!(interaction instanceof Eris.CommandInteraction)) {
		return;
	}
	const found = findCommand(interaction.data.name);
	if(!found || typeof found.command.runSlash !== "function") {
		return;
	}
	const command = found.command;
	if((command.where === 1 && !interaction.guildID) || (command.where === 2 && interaction.guildID)) {
		await interaction.createMessage({
			content: command.where === 1
				? "This command can only be used in a server."
				: "This command can only be used in direct messages.",
			flags: 64
		});
		return;
	}
	const userId = interaction.member?.id || interaction.user?.id;
	const remaining = isOnCooldown(userId, found.name, command);
	try {
		if(remaining) {
			await interaction.createMessage({
				content: "Please wait " + helper.formatTime(remaining * 1000) + " before using this command again.",
				flags: 64
			});
			return;
		}
		await command.runSlash(interaction, found.hide, commandServices);
	} catch(ex) {
		helper.err("Interaction:", ex);
		if(!interaction.acknowledged) {
			await interaction.createMessage({
				content: "Command failed; please try again.",
				flags: 64
			}).catch(replyError => helper.err("Interaction response:", replyError));
		}
	}
}).connect();
