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
import * as Eris from "eris";
import config from "./config.js";
import helper from "./helper.js";
import { UserError, parseRoleId, parseUserId } from "./command-utils.js";
import { difficultyToHashrate, getEmission, getNetworkReport, getNetworkStats, getPrice } from "./features.js";
import mentionResponse from "./mention.js";
import { closeWallet, connectWallet } from "./wallet.js";

const EPHEMERAL = Eris.Constants.MessageFlags.EPHEMERAL;

let daemon, wallet, bot;
let shutdownPromise;

function shutdown(reason, exitCode = 0) {
	shutdownPromise ??= (async () => {
		helper.log("Shutting down (%s)", reason);
		bot?.disconnect({ reconnect: false });
		await closeWallet(wallet).catch(ex => {
			helper.err("Can't stop wallet RPC:", ex);
			exitCode ||= 1;
		});
		if(daemon?.getProcess()) {
			await daemon.stopProcess().catch(ex => {
				helper.err("Can't stop daemon:", ex);
				exitCode ||= 1;
			});
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

if(!config.token || !config.tokenAddon) {
	helper.err("Invalid Discord tokens");
	process.exit(1);
}

{
	const execExt = process.platform === "win32" ? ".exe" : "";
	let binPath = config.binariesPath || "";
	if(binPath && !binPath.endsWith("/") && !binPath.endsWith("\\")) {
		binPath += process.platform === "win32" ? "\\" : "/";
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
		await shutdown("daemon startup failed", 1);
	}

	helper.log(config.walletURL ? "Connecting to wallet..." : "Checking local wallet RPC...");
	try {
		wallet = await connectWallet(monero, config, binPath, execExt);
	} catch(ex) {
		helper.err("Wallet:", ex);
		await shutdown("wallet startup failed", 1);
	}
}

// Load the commands
const commands = {};
const commandAliases = {};
const commandsRegistration = [];
for(const file of await fs.readdir(new URL("./commands", import.meta.url))) {
	if(!file.endsWith(".js")) {
		continue;
	}
	const name = file.slice(0, -3);
	try {
		const command = (await import("./commands/" + file)).default;
		commands[name] = command;
		for(const alias of [ name, ...(command.aliases || []) ]) {
			commandAliases[alias] = name;
			// Every slash command also has a variant ending with "d" that hides the response
			for(const hidden of [ false, true ]) {
				commandsRegistration.push({
					name: alias + (hidden ? "d" : ""),
					description: command.description + (hidden ? " (response hidden)" : ""),
					options: command.options || []
				});
			}
		}
	} catch(ex) {
		helper.err("Can't load command %s:", file, ex);
	}
}

bot = new Eris.Client("Bot " + config.token, {
	getAllUsers: true, // Role tips and tipall need the full member list
	allowedMentions: { everyone: false, roles: false, users: false, repliedUser: false },
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
		1 << 15, // Message content, not named in Eris 0.17
		"directMessages"
	]
});
bot.editStatus("online", [ {
	name: "Hello!",
	type: Eris.Constants.ActivityTypes.WATCHING
} ]);

// The addon bot is used only through REST, to spread channel renames across two rate limits
const botAddon = new Eris.Client("Bot " + config.tokenAddon, { restMode: true });

const services = { daemon, wallet, bot, config, commands };
const cooldowns = new Map();
let mention, statsInfo;

function findCommand(name) {
	let hide = false;
	if(!commandAliases[name] && name.endsWith("d")) {
		hide = true;
		name = name.slice(0, -1);
	}
	const command = commands[commandAliases[name]];
	return command ? { name: commandAliases[name], command, hide: hide || Boolean(command.private) } : null;
}

// Returns the remaining cooldown in milliseconds, or starts the cooldown and returns 0
function checkCooldown(userId, name, command) {
	const key = userId + ":" + name;
	const now = Date.now();
	const expiry = cooldowns.get(key) || 0;
	if(expiry > now) {
		return expiry - now;
	}
	cooldowns.set(key, now + (command.cooldown || 0) * 1000);
	return 0;
}

// Returns an error message when the command can't be run here or now, otherwise null
function checkCommand(found, userId, guildId) {
	if(found.command.where === 1 && !guildId) {
		return "This command can only be used in a server.";
	}
	if(found.command.where === 2 && guildId) {
		return "This command can only be used in direct messages.";
	}
	const remaining = checkCooldown(userId, found.name, found.command);
	return remaining ? "Please wait " + helper.formatTime(remaining) + " before using this command again." : null;
}

// Runs the command and returns the message to send back
async function runCommand(found, ctx) {
	try {
		const result = await found.command.run(ctx, services);
		return typeof result === "string" ? { content: result } : result;
	} catch(ex) {
		if(ex instanceof UserError) {
			return { content: ex.message };
		}
		helper.err("Command %s:", found.name, ex);
		return { content: "Command failed, please try again later." };
	}
}

function usage(name, command) {
	const args = command.usage ? " " + command.usage : command.options.map(option =>
		option.required ? " <" + option.name + ">" : " [" + option.name + "]"
	).join("");
	return "Usage: `" + (config.prefix || "") + name + args + "`";
}

// Maps positional message arguments to the command's options, returns null when they don't fit
function parseMessageArgs(command, args) {
	if(command.parseArgs) {
		return command.parseArgs(args);
	}
	const options = command.options;
	if(args.length > options.length || args.length < options.filter(option => option.required).length) {
		return null;
	}
	const values = {};
	for(const [ index, arg ] of args.entries()) {
		const option = options[index];
		const value = option.type === 6 ? parseUserId(arg) : option.type === 8 ? parseRoleId(arg) : arg;
		if(value === undefined) {
			return null;
		}
		values[option.name] = value;
	}
	return values;
}

function replyToMessage(message, content) {
	content = typeof content === "string" ? { content } : content;
	const canReply = !message.guildID || message.channel.permissionsOf?.(bot.user.id)
		?.has(Eris.Constants.Permissions.readMessageHistory);
	return bot.createMessage(message.channel.id, canReply
		? { ...content, messageReference: { messageID: message.id, failIfNotExists: false } }
		: { ...content, content: "<@" + message.author.id + "> " + content.content });
}

async function handleMessageCommand(message, name, args) {
	const found = findCommand(name);
	if(!found) {
		return;
	}
	const error = checkCommand(found, message.author.id, message.guildID);
	if(error) {
		return replyToMessage(message, error);
	}
	const options = parseMessageArgs(found.command, args);
	if(!options) {
		return replyToMessage(message, usage(name, found.command));
	}
	const response = await runCommand(found, { userId: message.author.id, guildId: message.guildID, options });
	if(!found.hide || !message.guildID) {
		return replyToMessage(message, response);
	}

	// Hidden responses to server messages go to direct messages
	if(message.channel.permissionsOf?.(bot.user.id)?.has(Eris.Constants.Permissions.manageMessages)) {
		message.delete().catch(ex => helper.warn("Can't delete command message:", ex));
	}
	try {
		const channel = await bot.getDMChannel(message.author.id);
		await bot.createMessage(channel.id, response);
	} catch {
		await replyToMessage(message, "I can't send you a direct message. Allow direct messages from server members or use the slash command.");
	}
}

async function handleInteraction(interaction) {
	const found = findCommand(interaction.data.name);
	if(!found) {
		return;
	}
	// interaction.user is only set in direct messages, interaction.member only in servers
	const userId = (interaction.member || interaction.user).id;
	const error = checkCommand(found, userId, interaction.guildID);
	if(error) {
		return interaction.createMessage({ content: error, flags: EPHEMERAL });
	}
	// Wallet and network requests may take longer than the 3 seconds Discord waits for a response
	await interaction.defer(found.hide ? EPHEMERAL : 0);
	const options = Object.fromEntries((interaction.data.options || []).map(option => [ option.name, option.value ]));
	await interaction.createMessage(await runCommand(found, { userId, guildId: interaction.guildID, options }));
}

function startStatistics() {
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
	updateInfo();
	setInterval(updateInfo, 60000);

	if(config.statsTextChannel) {
		let statsMessage;
		const updateTextStats = async () => {
			if(!statsInfo) {
				return;
			}
			try {
				const report = await getNetworkReport(daemon, config);
				statsMessage ??= (await bot.getMessages(config.statsTextChannel, { limit: 50 })).find(message =>
					message.author.id === bot.user.id && message.content.startsWith("**Network statistics**")
				);
				statsMessage = statsMessage
					? await bot.editMessage(config.statsTextChannel, statsMessage.id, report)
					: await bot.createMessage(config.statsTextChannel, report);
			} catch(ex) {
				statsMessage = undefined;
				helper.err("Statistics message:", ex);
			}
		};
		setInterval(updateTextStats, Math.max(60000, Number(config.statsUpdateInterval) || 60000));
	}

	// Discord allows 2 renames per channel every 10 minutes, so both bots take turns every 2.5 minutes
	const updateStat = (id, getName) => {
		const channelId = config.statsChannels?.[id];
		if(!channelId) {
			return;
		}
		let useAddon = false;
		const timer = async () => {
			if(statsInfo) {
				try {
					const name = await getName();
					if(name) {
						await (useAddon ? botAddon : bot).editChannel(channelId, { name });
						useAddon = !useAddon;
					}
				} catch(ex) {
					helper.err("Statistics %s:", id, ex);
				}
			}
			setTimeout(timer, 150000);
		};
		setTimeout(timer, 5000);
	};
	updateStat("hashrate", async () => "Hashrate: " + difficultyToHashrate(statsInfo.getDifficulty()));
	updateStat("height", async () => "Height: " + statsInfo.getHeight());
	updateStat("difficulty", async () => "Difficulty: " + statsInfo.getDifficulty());
	updateStat("emission", async () => {
		const emission = await getEmission(config);
		return emission && "Emission: " + emission;
	});
	updateStat("lastReward", async () => "Last reward: " + (await getNetworkStats(daemon)).blockReward);
	updateStat("price", async () => {
		const price = await getPrice(config);
		return price && "MRL/USD: $" + price.usd;
	});
}

bot.once("ready", async () => {
	helper.log("Discord ready!");
	mention = new RegExp("^<@!?" + bot.user.id + ">(?:\\s|$)");
	try {
		await bot.bulkEditCommands(commandsRegistration);
	} catch(ex) {
		helper.err("Can't register slash commands:", ex);
	}
	startStatistics();
}).on("error", ex => {
	helper.err("Discord:", ex);
}).on("warn", msg => {
	helper.warn("Discord:", msg);
}).on("messageCreate", async message => {
	if(message.author.bot || !mention) {
		return;
	}
	let text;
	const matchedMention = mention.exec(message.content);
	if(matchedMention) {
		text = message.content.slice(matchedMention[0].length).trim();
		if(!text || !config.prefixMention) {
			return replyToMessage(message, mentionResponse(config)).catch(ex => helper.err("Mention:", ex));
		}
	} else if(config.prefix && message.content.toLowerCase().startsWith(config.prefix.toLowerCase())) {
		text = message.content.slice(config.prefix.length).trim();
	} else {
		return;
	}
	const [ name, ...args ] = text.split(/\s+/);
	if(name) {
		await handleMessageCommand(message, name.toLowerCase(), args).catch(ex => helper.err("Message command:", ex));
	}
}).on("interactionCreate", async interaction => {
	if(interaction instanceof Eris.CommandInteraction) {
		await handleInteraction(interaction).catch(ex => helper.err("Interaction:", ex));
	}
});

helper.log("Connecting to Discord...");
bot.connect();
