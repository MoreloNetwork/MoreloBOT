import { getOption, reply, sendMessage } from "../command-utils.js";

const categories = {
	tips: "tip notifications",
	transfers: "other incoming transfer notifications"
};

function renderPreferences(preferences) {
	return "Notification preferences:\n"
		+ "Tips: " + (preferences.tips ? "on" : "off") + "\n"
		+ "Other incoming transfers: " + (preferences.transfers ? "on" : "off")
		+ "\nUse `m!notifications <tips|transfers> <on|off>` to change a setting.";
}

async function handlePreferences(userId, category, enabled, store) {
	if(!category) {
		return renderPreferences(await store.getNotificationPreferences(userId));
	}
	if(!Object.hasOwn(categories, category) || ![ "on", "off" ].includes(enabled)) {
		return "Usage: `m!notifications <tips|transfers> <on|off>`.";
	}
	const preferences = await store.setNotificationPreferences(userId, {
		[category]: enabled === "on"
	});
	return "Updated " + categories[category] + ": " + enabled + ".\n" + renderPreferences(preferences);
}

export default {
	args_min: 0, args_max: 2, where: 0, cooldown: 5,
	description: "Shows or changes your bot notification preferences",
	options: [
		{
			name: "category",
			description: "Notification category to change",
			type: 3,
			required: false,
			choices: [
				{ name: "Tips", value: "tips" },
				{ name: "Other transfers", value: "transfers" }
			]
		},
		{
			name: "state",
			description: "Turn this notification category on or off",
			type: 3,
			required: false,
			choices: [
				{ name: "On", value: "on" },
				{ name: "Off", value: "off" }
			]
		}
	],
	async run(message, cmd, args, hide, services) {
		await sendMessage(services.bot, message.channel, await handlePreferences(
			message.author.id,
			args[0]?.toLowerCase(),
			args[1]?.toLowerCase(),
			services.walletNotificationStore
		));
	},
	async runSlash(interaction, hide, services) {
		await reply(interaction, await handlePreferences(
			interaction.user.id,
			getOption(interaction, "category"),
			getOption(interaction, "state"),
			services.walletNotificationStore
		));
	}
};
