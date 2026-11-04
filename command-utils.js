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
	return target.channel.createMessage(content);
}
