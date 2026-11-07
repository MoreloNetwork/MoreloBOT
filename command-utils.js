/**
 * Error whose message is safe to show to the user who ran the command.
 */
export class UserError extends Error {}

export function parseUserId(value) {
	return String(value ?? "").match(/^(?:<@!?)?(\d{17,20})>?$/)?.[1];
}

export function parseRoleId(value) {
	return String(value ?? "").match(/^<@&(\d{17,20})>$/)?.[1];
}
