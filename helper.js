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

import fs from "node:fs/promises";
import { Constants as ErisConstants } from "eris";

export default {
	getDate() {
		const date = new Date();
		return date.getFullYear() + "-"
			+ ("0" + (date.getMonth() + 1)).slice(-2) + "-"
			+ ("0" + date.getDate()).slice(-2) + " "
			+ ("0" + date.getHours()).slice(-2) + ":"
			+ ("0" + date.getMinutes()).slice(-2) + ":"
			+ ("0" + date.getSeconds()).slice(-2) + "."
			+ ("00" + date.getMilliseconds()).slice(-3);
	},
	log(format, ...args) {
		if(typeof format === "string") {
			console.log("\x1B[32m[%s]\x1B[0m " + format, this.getDate(), ...args);
		} else {
			console.log("\x1B[32m[%s]\x1B[0m", this.getDate(), format, ...args);
		}
	},
	err(format, ...args) {
		if(typeof format === "string") {
			console.error("\x1B[31m[%s]\x1B[0m " + format, this.getDate(), ...args);
		} else {
			console.error("\x1B[31m[%s]\x1B[0m", this.getDate(), format, ...args);
		}
	},
	warn(format, ...args) {
		if(typeof format === "string") {
			console.warn("\x1B[33m[%s]\x1B[0m " + format, this.getDate(), ...args);
		} else {
			console.warn("\x1B[33m[%s]\x1B[0m", this.getDate(), format, ...args);
		}
	},
	dbg(format, ...args) {
		if(typeof format === "string") {
			console.debug("\x1B[34m[%s]\x1B[0m " + format, this.getDate(), ...args);
		} else {
			console.debug("\x1B[34m[%s]\x1B[0m", this.getDate(), format, ...args);
		}
	},
	msToTime(ms) {
		// Extract seconds
		let seconds = parseInt(ms / 1000); // 1000 ms in 1 second
		ms = ms % 1000; // Remove extracted seconds

		// Extract days
		const days = parseInt(seconds / 86400); // 86400 seconds in 1 day
		seconds = seconds % 86400; // Remove extracted days

		// Extract hours
		const hours = parseInt(seconds / 3600); // 3600 seconds in 1 hour
		seconds = seconds % 3600; // Remove extracted hours

		// Extract minutes
		const minutes = parseInt(seconds / 60); // 60 seconds in 1 minute
		seconds = seconds % 60; // Remove extracted minutes

		return [ days, hours, minutes, seconds, ms ];
	},
	formatTime(ms, timeDefs = ["day", "hour", "minute", "second", "days", "hours", "minutes", "seconds"]) {
		const time = this.msToTime(ms);
		const days = (time[0] > 0 ? time[0] + " " + (time[0] > 1 ? timeDefs[4] + ", " : (time[0] > 0 ? timeDefs[0] + ", ": "")) : "");
		const hours = (time[1] > 0 ? time[1] + " " + (time[1] > 1 ? timeDefs[5] + ", " : (time[1] > 0 ? timeDefs[1] + ", " : "")) : "");
		const minutes = (time[2] > 0 ? time[2] + " " + (time[2] > 1 ? timeDefs[6] + ", " : (time[2] > 0 ? timeDefs[2] + ", " : "")) : "");
		const seconds = time[3] + " " + (time[3] != 1 ? timeDefs[7] : timeDefs[3]);
		return days + hours + minutes + seconds;
	},

	isDeletable(msg) {
		return (msg.author.id === msg.channel.client.user.id || (msg.guildID && msg.channel.permissionsOf(msg.channel.client.user.id).has(ErisConstants.Permissions.manageMessages)));
	},
	reply(hide, msg, content, file) {
		if(msg.createMessage != null) {
			// Replying to an interaction
			if(hide) {
				if(typeof content !== "object" || content === null) {
					content = { content: String(content) };
				}
				content.flags = ErisConstants.MessageFlags.EPHEMERAL;
			}
			return msg.createMessage(content, file);
		}

		if(!hide) {
			if(typeof content !== "object" || content === null) {
				content = { content: String(content) };
			}
			const perms = msg.channel.permissionsOf(msg.channel.client.user.id);
			if(perms.allow & ErisConstants.Permissions.readMessageHistory) {
				Object.assign(content, { messageReference: { messageID: msg.id, failIfNotExists: false } });
			} else {
				content.content = "<@" + msg.author.id + "> " + content.content;
			}
		}
		return msg.channel.createMessage(content, file);
	},

	async loadCmds(bot) {
		bot.kCmds = {};
		bot.kCmdsReg = [];
		bot.kAliases = {};

		const registerCmd = (cmd, name) => {
			if(cmd.runSlash != null) {
				bot.kCmdsReg.push({
					name,
					description: cmd.description,
					options: cmd.options
				});
				bot.kCmdsReg.push({
					name: name + "d",
					description: cmd.description + " (response hidden)",
					options: cmd.options
				});
			}
			if(cmd.runUser != null) {
				bot.kCmdsReg.push({
					name,
					description: cmd.description,
					type: Eris.Constants.ApplicationCommandTypes.USER
				});
				bot.kCmdsReg.push({
					name: name + "d",
					description: cmd.description + " (response hidden)",
					type: Eris.Constants.ApplicationCommandTypes.USER
				});
			}
			if(cmd.runMessage != null) {
				bot.kCmdsReg.push({
					name,
					description: cmd.description,
					type: Eris.Constants.ApplicationCommandTypes.MESSAGE
				});
				bot.kCmdsReg.push({
					name: name + "d",
					description: cmd.description + " (response hidden)",
					type: Eris.Constants.ApplicationCommandTypes.MESSAGE
				});
			}
		};

		try {
			const loadCmd = async (cmdFile, name) => {
				const cmd = (await import(cmdFile)).default;

				// Register the command
				bot.kCmds[name] = cmd;
				if(name !== bot.kMention) {
					registerCmd(cmd, name);
				}

				// Register the command's aliases
				if(cmd.aliases != null && cmd.aliases.length != null) {
					for(let j = cmd.aliases.length - 1; j !== -1; --j) {
						const alias = cmd.aliases[j];
						bot.kAliases[alias] = name;
						if(alias !== bot.kMention) {
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
					if(cmdFile.charAt(0) !== "-") {
						if(cmdFile.endsWith(".js")) {
							await loadCmd("./commands/" + cmdFile, cmdFile.slice(0, -3));
						} else if(cmdFile.indexOf(".") === -1) {
							await loadCmd("./commands/" + cmdFile + "/index.js", cmdFile);
						}
					}
				} catch(ex) {
					this.err("Can't load command %s:", cmdFile, ex);
				}
			}

			// Load the bot mention command
			await loadCmd("./mention.js", bot.kMention);
		} catch(ex) {
			this.err("Can't load commands:", ex);
		}
	},
	findCmd(bot, name) {
		let obj = bot.kCmds[name];
		let hide = false;
		if(obj == null) {
			obj = bot.kAliases[name];
			if(obj != null) {
				obj = bot.kCmds[obj];
			} else if(name !== bot.kMention && name.endsWith("d")) {
				name = name.slice(0, -1);
				obj = bot.kCmds[name];
				if(obj != null) {
					hide = true;
				} else {
					obj = bot.kAliases[name];
					if(obj != null) {
						obj = bot.kCmds[obj];
						hide = true;
					} else {
						return null;
					}
				}
			} else {
				return null;
			}
		}
		return { name, obj, hide };
	}
};
