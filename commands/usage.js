import { reply } from "../command-utils.js";

function commandList(services) {
	const commands = Object.entries(services.commands)
		.filter(([, command]) => !command.admin_only && !command.adminOnly)
		.map(([name, command]) => "`" + name + "` — " + (command.description || "No description"));
	return "**Command list**\n" + commands.join("\n")
		+ "\n\nWebsite: <" + services.config.siteURL + ">\nGitHub: <" + (services.config.repoURL || "https://github.com/MoreloNetwork") + ">";
}

export default {
	args_min: 0, args_max: 0, hide_msg: false,
	admin_only: false, where: 0, cooldown: 5,
	description: "Shows the bot's available commands",
	aliases: [ "help", "commands" ],
	options: [],
	async run(message, cmd, args, hide, services) {
		await message.channel.createMessage(commandList(services).slice(0, 1900));
	},
	async runSlash(interaction, hide, services) {
		await reply(interaction, commandList(services).slice(0, 1900));
	}
};
