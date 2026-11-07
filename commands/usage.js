export default {
	description: "Shows the bot's available commands",
	aliases: [ "help", "commands" ],
	cooldown: 5,
	options: [],
	async run(ctx, services) {
		const prefix = services.config.prefix || "";
		const commands = Object.entries(services.commands).map(([ name, command ]) =>
			"`" + prefix + name + "` — " + command.description
		);
		return ("**Command list**\n" + commands.join("\n")
			+ "\nAdd `d` to a slash command name (e.g. `/balanced`) to hide the response."
			+ "\n\nWebsite: <" + services.config.siteURL + ">\nGitHub: <" + services.config.repoURL + ">").slice(0, 1900);
	}
};
