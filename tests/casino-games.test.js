import assert from "node:assert/strict";
import test from "node:test";
import {
	resolveCoinflip,
	resolveRoulette,
	resolveDice,
	rollDice,
	spinRoulette,
	tossCoin
} from "../casino/casino-games.js";

test("coin toss uses a bounded random result and pays 2x on a win", () => {
	let bound;
	assert.equal(tossCoin(max => {
		bound = max;
		return 0;
	}), "heads");
	assert.equal(bound, 2);
	assert.deepEqual(resolveCoinflip("heads", "heads", 100n), {
		result: "heads",
		won: true,
		payout: 200n
	});

test("dice uses six outcomes and pays 5.7x on an exact result", () => {
	assert.equal(rollDice(max => max - 1), 6);
	assert.deepEqual(resolveDice("6", 6, 100n), {
		result: 6,
		won: true,
		payout: 570n
	});
	assert.deepEqual(resolveDice("6", 5, 100n), {
		result: 5,
		won: false,
		payout: 0n
	});
});
	assert.deepEqual(resolveCoinflip("heads", "tails", 100n), {
		result: "tails",
		won: false,
		payout: 0n
	});
});

test("European roulette covers zero through 36 with correct colors and payouts", () => {
	assert.deepEqual(spinRoulette(max => max - 1), { number: 36, color: "red" });
	assert.deepEqual(spinRoulette(max => 0), { number: 0, color: "green" });
	assert.deepEqual(resolveRoulette("black", { number: 2 }, 100n), {
		result: { number: 2, color: "black" },
		won: true,
		payout: 200n
	});
	assert.deepEqual(resolveRoulette("17", { number: 17 }, 100n), {
		result: { number: 17, color: "black" },
		won: true,
		payout: 3600n
	});
	assert.deepEqual(resolveRoulette("red", { number: 0 }, 100n), {
		result: { number: 0, color: "green" },
		won: false,
		payout: 0n
	});
});

test("casino game rules reject invalid picks, outcomes, and stakes", () => {
	assert.throws(() => resolveCoinflip("edge", "heads", 1n), /heads|tails/);
	assert.throws(() => resolveCoinflip("heads", "edge", 1n), /result is invalid/);
	assert.throws(() => resolveCoinflip("heads", "heads", 0n), /greater than zero/);
	assert.throws(() => resolveRoulette("37", { number: 0 }, 1n), /0 to 36/);
	assert.throws(() => resolveRoulette("red", { number: 37 }, 1n), /result is invalid/);
});
