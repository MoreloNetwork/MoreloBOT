export class UserError extends Error {}

export function getOption(interaction, name) {
	return interaction.data.options?.find(option => option.name === name)?.value;
}

export function getMentionedUserId(message, value) {
	const mention = String(value ?? "").match(/^<@!?(\d+)>$/);
	if(mention) {
		return mention[1];
	}
	return message.mentions?.[0]?.id;
}

export async function reply(target, content) {
	if(target.createMessage) {
		return target.createMessage({ content, flags: 64, allowedMentions: { parse: [] } });
	}
	return target.bot.createMessage(target.channel.id, content);
}

export async function sendMessage(bot, channel, content) {
	return bot.createMessage(typeof channel === "string" ? channel : channel.id, content);
}
