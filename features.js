import fetch from "node-fetch";

const atomicUnits = 1000000000n;

export function formatHashrate(difficulty) {
	return formatHashrateValue(Number(difficulty) / 120);
}

export function formatHashrateValue(value) {
	let hashrate = Number(value);
	let unit = "H/s";
	for(const nextUnit of [ "kH/s", "MH/s", "GH/s", "TH/s" ]) {
		if(hashrate < 1000) {
			break;
		}
		hashrate /= 1000;
		unit = nextUnit;
	}
	return hashrate.toFixed(2) + " " + unit;
}

function preventMentions(text) {
	return text.replace(/@(everyone|here)/gi, "@\u200b$1");
}

function formatMRL(amount, digits = 2) {
	let value = BigInt(amount);
	const negative = value < 0n;
	if(negative) {
		value = -value;
	}
	const scale = 10n ** BigInt(digits);
	const rounded = (value * scale + atomicUnits / 2n) / atomicUnits;
	const whole = rounded / scale;
	const fraction = String(rounded % scale).padStart(digits, "0");
	return (negative ? "-" : "") + whole + (digits ? "." + fraction : "") + " MRL";
}

async function getJson(url, source) {
	const response = await fetch(url);
	if(!response.ok) {
		throw new Error(source + " returned HTTP " + response.status);
	}
	return response.json();
}

export async function getNetworkStats(daemon) {
	const info = await daemon.getInfo();
	const [ block, txPool ] = await Promise.all([
		daemon.getBlockByHash(info.topBlockHash),
		daemon.getTxPool()
	]);
	const output = block.minerTx.outputs[0];

	return {
		hashrate: formatHashrate(info.getDifficulty()),
		height: info.getHeight(),
		difficulty: String(info.getDifficulty()),
		pendingTransactions: txPool.length,
		blockHash: info.topBlockHash,
		blockReward: formatMRL(output.amount, 4)
	};
}

export async function getEmission(config) {
	if(!config.explorerURL) {
		return null;
	}
	const body = await getJson(config.explorerURL.replace(/\/$/, "") + "/api/emission", "Explorer");
	if(body.status !== "success" || body.data?.coinbase == null) {
		throw new Error("Explorer returned an invalid emission response");
	}
	return formatMRL(body.data.coinbase);
}

export async function getPrice(config) {
	if(!config.priceURL) {
		return null;
	}
	const body = await getJson(config.priceURL, "Price API");
	for(const field of [ "volume", "volumeSecondary", "changePercent", "primaryUsdValue" ]) {
		if(body[field] == null) {
			throw new Error("Price API response is missing " + field);
		}
	}
	return [
		"24h volume: " + body.volume + " MRL (" + body.volumeSecondary + " USD)",
		"24h change: " + body.changePercent + "%",
		"Price: $" + body.primaryUsdValue
	];
}

export async function getPools(config) {
	if(!config.poolsPageURL || !config.poolsDataURL) {
		return null;
	}

	const page = await fetch(config.poolsPageURL);
	if(!page.ok) {
		throw new Error("MiningPoolStats returned HTTP " + page.status);
	}
	const html = await page.text();
	const token = html.match(/var last_time\s*=\s*["']([^"']+)["']/)?.[1];
	if(!token) {
		throw new Error("MiningPoolStats page did not contain its data token");
	}

	const dataURL = new URL(config.poolsDataURL);
	dataURL.searchParams.set("t", token);
	const body = await getJson(dataURL, "MiningPoolStats data API");
	if(!Array.isArray(body.data)) {
		throw new Error("MiningPoolStats returned an invalid pool list");
	}
	return body.data
		.filter(pool => pool && typeof pool.url === "string" && Number.isFinite(Number(pool.hashrate)) && Number(pool.hashrate) >= 0)
		.sort((left, right) => Number(right.hashrate) - Number(left.hashrate));
}

export async function getNetworkReport(daemon, config) {
	const network = await getNetworkStats(daemon);
	const [ emission, price, pools ] = await Promise.all([
		getEmission(config).catch(ex => "unavailable (" + ex.message + ")"),
		getPrice(config).catch(ex => [ "Price data unavailable (" + ex.message + ")" ]),
		getPools(config).catch(ex => ({ error: ex.message }))
	]);
	const report = [
		"Network statistics",
		"Hashrate: " + network.hashrate,
		"Height: " + network.height,
		"Difficulty: " + network.difficulty,
		"Emission: " + (emission ?? "unavailable"),
		"Block reward: " + network.blockReward,
		"Pending transactions: " + network.pendingTransactions,
		"Block hash: " + network.blockHash.slice(0, 10) + "..."
	];

	if(price) {
		report.push("", "Morelo price", ...price);
	}
	if(pools) {
		report.push("", "Mining pools");
		if(Array.isArray(pools)) {
			report.push(...pools.slice(0, 5).map(pool =>
				pool.url + " (Hashrate: " + formatHashrateValue(pool.hashrate) + ")"
			));
		} else {
			report.push("Pool data unavailable (" + pools.error + ")");
		}
	}
	return preventMentions(report.join("\n")).slice(0, 1900);
}

export function formatMRLAmount(amount) {
	return formatMRL(amount);
}
