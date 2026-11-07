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
import * as Eris from "eris";
import fs from "node:fs/promises";
import config from "./config.js";
import helper from "./core/helper.js";
import { UserError } from "./core/command-utils.js";
import { getEmission, getMempool, getNetworkReport, getNetworkStats, formatHashrateValue, formatMempool } from "./api/features.js";
import mentionCommand from "./core/mention.js";
import { connectWalletRpc, stopOwnedWalletRpc } from "./api/wallet-rpc.js";
import WalletNotificationStore from "./api/wallet-notification-store.js";
import { startWalletNotifications } from "./api/wallet-notifications.js";
import CasinoService from "./casino/casino-service.js";
import CasinoStore from "./casino/casino-store.js";
import CasinoBlockGame from "./casino/casino-block-game.js";
import CasinoBlockStore from "./casino/casino-block-store.js";
import CasinoSandbox from "./casino/casino-sandbox.js";
import CasinoSandboxStore from "./casino/casino-sandbox-store.js";
import CasinoSandboxBlockStore from "./casino/casino-sandbox-block-store.js";
import { formatMRL, parseMRL } from "./api/wallet.js";

const fetch = globalThis.fetch;

let daemon, wallet, bot, botAddon;
let ownsWalletRpcProcess = false;
let walletRpcProcess;
let shutdownPromise;
let walletNotificationService;
let casinoBlockMonitor;
const walletNotificationStore = new WalletNotificationStore(config.walletNotificationsPath);

async function shutdown(reason, exitCode = 0) {
	if(shutdownPromise) {
		return shutdownPromise;
	}
	shutdownPromise = (async () => {
		helper.log("Shutting down (%s)", reason);
		if(casinoBlockMonitor) {
			clearInterval(casinoBlockMonitor);
		}
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
async function publishCasinoWin(content, userIds) {
	const channel = config.casinoWinsChannel && bot.getChannel(config.casinoWinsChannel);
	if(!channel) {
		return false;
	}
	await bot.createMessage(channel.id, {
		content,
		allowedMentions: { users: userIds }
	});
	return true;
}
const casinoStore = new CasinoStore(config.casinoWagersPath);
const casino = new CasinoService({
	wallet,
	config,
	store: casinoStore,
	dependencies: {
		onWin: async wager => {
			const outcome = wager.game === "coinflip"
				? wager.outcome
				: wager.game === "roulette"
					? wager.outcome.number + " " + wager.outcome.color
					: wager.outcome;
			await publishCasinoWin(
				"<@" + wager.userId + "> won " + formatMRL(BigInt(wager.payout)) + " MRL in "
					+ wager.game + " (" + outcome + "); wager `" + wager.id.slice(0, 8) + "`.",
				[ wager.userId ]
			);
		}
	}
});
const casinoBlockStore = new CasinoBlockStore(config.casinoBlockBetsPath);
const casinoBlockGame = new CasinoBlockGame({
	wallet,
	daemon,
	config,
	store: casinoBlockStore,
	dependencies: { serialize: operation => casino.serialize(operation) }
});
casino.blockGame = casinoBlockGame;
const casinoSandboxStore = new CasinoSandboxStore(config.casinoSandboxPath, parseMRL(config.casinoSandboxInitialBalance || "1000").toString());
const casinoSandboxBlockStore = new CasinoSandboxBlockStore(config.casinoSandboxBlockBetsPath);
const casinoSandbox = new CasinoSandbox({
	store: casinoSandboxStore,
	blockStore: casinoSandboxBlockStore,
	config,
	daemon,
	dependencies: {
		onWin: async bet => {
			await publishCasinoWin(
				"[TEST] <@" + bet.userId + "> won " + formatMRL(BigInt(bet.payout)) + " test MRL in " + bet.game + ". No MRL transferred.",
				[ bet.userId ]
			);
		}
	}
});
const blockGame = config.casinoTestMode === true ? casinoSandbox : casinoBlockGame;
const blockStore = config.casinoTestMode === true ? casinoSandboxBlockStore : casinoBlockStore;
const commandServices = { daemon, wallet, bot, config, commands: cmds, walletNotificationStore, casino, casinoSandbox, logger: helper };

async function checkCasinoBlocks() {
	try {
		const result = await blockGame.checkForNewBlocks();
		for(const block of result.settledBlocks) {
			const winners = block.bets.filter(bet => bet.won);
			if(!winners.length) {
				await blockStore.markBlockAnnounced(block.height);
				continue;
			}
			const testPrefix = config.casinoTestMode === true ? "[TEST] " : "";
			const content = testPrefix + "New Morelo block " + block.height + " (`" + block.hash + "`). "
				+ "Winner(s): " + winners.map(bet => "<@" + bet.userId + "> guessed `" + bet.guess
					+ "` and received " + formatMRL(BigInt(bet.payout)) + (config.casinoTestMode === true ? " test MRL" : " MRL")
					+ (bet.payoutTxHash ? " (`" + bet.payoutTxHash + "`)" : "")).join("; ");
			if(await publishCasinoWin(content, winners.map(bet => bet.userId))) {
				await blockStore.markBlockAnnounced(block.height);
			}
		}
	} catch(ex) {
		helper.err("Casino block game:", ex);
	}
}

const casinoGameGuides = {
	coinflip: "🎲 Coinflip\nHow to play: `m!casino coinflip <heads|tails> <amount>`\nExample: `m!casino coinflip heads 0.01`\nWin pays 2x your stake.",
	roulette: "🎰 Roulette\nHow to play: `m!casino roulette <red|black|0-36> <amount>`\nExamples: `m!casino roulette red 0.01`, `m!casino roulette 17 0.01`\nRed/black pays 2x; a number pays 36x.",
	dice: "🎯 Dice\nHow to play: `m!casino dice <1-6> <amount>`\nExample: `m!casino dice 6 0.01`\nExact match pays 5.7x your stake.",
	guessNextHash: "🧩 Guess the next hash\nHow to play: `m!casino guess <1-6 hex chars> <amount>`\nExample: `m!casino guess cdef 0.01`\nThe guess must match the end of the next block hash.",
	blackjack: "🃏 Blackjack\nHow to play: `m!casino blackjack start <amount>`, then `blackjack hit` or `blackjack stand`\nExample: `m!casino blackjack start 0.01`\nNatural blackjack pays 2.5x; standard win pays 2x."
};

async function ensureCasinoGameInstructions() {
	for(const [ game, channelId ] of Object.entries(config.casinoGameChannels || {})) {
		if(!channelId || !casinoGameGuides[game]) {
			continue;
		}
		const channel = bot.getChannel(channelId);
		if(!channel) {
			helper.warn("Casino game channel not found for %s: %s", game, channelId);
			continue;
		}
		try {
			const messages = await channel.getMessages(20).catch(() => []);
			const existing = messages.find(message => typeof message.content === "string" && message.content.includes("Casino guide") && message.content.includes(game));
			if(existing) {
				if(!existing.pinned) {
					await channel.pinMessage(existing.id);
					helper.log("Pinned casino guide for %s in channel %s", game, channel.id);
				} else {
					helper.log("Casino guide for %s is already pinned in channel %s", game, channel.id);
				}
				continue;
			}
			const message = await channel.createMessage({ content: "**Casino guide: " + game + "**\n" + casinoGameGuides[game] + "\n\nTip: use the `m!casino` commands in this channel." });
			await channel.pinMessage(message.id);
			helper.log("Published and pinned casino guide for %s in channel %s", game, channel.id);
		} catch(ex) {
			helper.err("Casino channel instructions (%s):", game, ex);
		}
	}
}
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
				await helper.reply(hide || command.hide_msg || command.hideMsg, message, result, undefined, bot);
		}
	} catch(ex) {
		helper.err("Command " + found.name + ":", ex);
		await helper.reply(hide, message, ex instanceof UserError ? ex.message : "Command failed; please try again.", undefined, bot).catch(replyError => {
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
	try {
		await ensureCasinoGameInstructions();
	} catch(ex) {
		helper.err("Casino guides:", ex);
	}
	await checkCasinoBlocks();
	casinoBlockMonitor = setInterval(checkCasinoBlocks, Math.max(1000, Number(config.casinoBlockPollInterval) || 5000));

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
			let txPoolUpdateInProgress = false;
			const updateTxPoolMessage = async () => {
				if(txPoolUpdateInProgress) {
					return;
				}
				txPoolUpdateInProgress = true;
				try {
					const mempool = await getMempool(config);
					if(!mempool) {
						return;
					}
					const content = formatMempool(mempool, new Date(), 4000, config.explorerURL);
					const txPoolMessage = {
						content,
						flags: Eris.Constants.MessageFlags.SUPPRESS_EMBEDS
					};
					const saved = await walletNotificationStore.getMessage("txpool");
					let message;
					if(saved?.channelId === channel.id && saved.messageId) {
						try {
							message = await bot.editMessage(channel.id, saved.messageId, txPoolMessage);
						} catch(ex) {
							if(ex && (ex.code === 10008 || ex.code === 10003 || ex.message?.includes("Unknown Message") || ex.message?.includes("Unknown Channel"))) {
								await walletNotificationStore.setMessage("txpool", {});
								message = undefined;
							} else {
								helper.warn("Tx-pool message edit failed, creating a replacement:", ex);
								message = undefined;
							}
						}
					}
					if(!message) {
						message = await bot.createMessage(channel.id, txPoolMessage);
						await walletNotificationStore.setMessage("txpool", {
							channelId: channel.id,
							messageId: message.id
						});
					}
				} catch(ex) {
					helper.err("Transaction pool message:", ex);
				} finally {
					txPoolUpdateInProgress = false;
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
				content: ex instanceof UserError ? ex.message : "Command failed; please try again.",
				flags: 64
			}).catch(replyError => helper.err("Interaction response:", replyError));
		}
	}
}).connect();
