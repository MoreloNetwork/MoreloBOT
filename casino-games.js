import { randomInt } from "node:crypto";
import { UserError } from "./command-utils.js";

const redNumbers = new Set([ 1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36 ]);

function validateStake(stake) {
	if(typeof stake !== "bigint" || stake <= 0n) {
		throw new UserError("The bet must be greater than zero.");
	}
}

export function rollDice(random = randomInt) {
	return random(6) + 1;
}

export function resolveDice(selection, result, stake) {
	validateStake(stake);
	if(!/^[1-6]$/.test(String(selection))) {
		throw new UserError("Choose a number from 1 to 6.");
	}
	if(!Number.isInteger(result) || result < 1 || result > 6) {
		throw new UserError("The dice result is invalid.");
	}
	const won = Number(selection) === result;
	return { result, won, payout: won ? stake * 57n / 10n : 0n };
}

export function tossCoin(random = randomInt) {
	return random(2) === 0 ? "heads" : "tails";
}

export function resolveCoinflip(selection, result, stake) {
	validateStake(stake);
	if(![ "heads", "tails" ].includes(selection)) {
		throw new UserError("Choose `heads` or `tails`.");
	}
	if(![ "heads", "tails" ].includes(result)) {
		throw new UserError("The coin result is invalid.");
	}
	const won = selection === result;
	return { result, won, payout: won ? stake * 2n : 0n };
}

export function spinRoulette(random = randomInt) {
	const number = random(37);
	return {
		number,
		color: number === 0 ? "green" : redNumbers.has(number) ? "red" : "black"
	};
}

export function resolveRoulette(selection, result, stake) {
	validateStake(stake);
	const numberSelection = /^(?:0|[1-9]|[12]\d|3[0-6])$/.test(String(selection));
	if(![ "red", "black" ].includes(selection) && !numberSelection) {
		throw new UserError("Choose `red`, `black`, or a number from 0 to 36.");
	}
	if(!Number.isInteger(result?.number) || result.number < 0 || result.number > 36) {
		throw new UserError("The roulette result is invalid.");
	}
	const color = result.number === 0 ? "green" : redNumbers.has(result.number) ? "red" : "black";
	const won = numberSelection ? Number(selection) === result.number : selection === color;
	return {
		result: { number: result.number, color },
		won,
		payout: won ? stake * (numberSelection ? 36n : 2n) : 0n
	};
}
