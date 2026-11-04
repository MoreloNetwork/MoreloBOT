import fetch from "node-fetch";

const atomicUnits = 1000000000n;

export function formatHashrate(difficulty) {
	let hashrate = Number(difficulty) / 120;
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

function formatMRL(amount, digits = 2) {
	return (Number(amount) / Number(atomicUnits)).toFixed(digits) + " MRL";
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
		.filter(pool => pool && typeof pool.url === "string" && Number.isFinite(Number(pool.hashrate)))
		.sort((left, right) => Number(right.hashrate) - Number(left.hashrate));
}

export async function getNetworkReport(daemon, config) {
	const network = await getNetworkStats(daemon);
	const report = [
		"Network statistics",
		"Hashrate: " + network.hashrate,
		"Height: " + network.height,
		"Difficulty: " + network.difficulty,
		"Emission: " + (await getEmission(config) ?? "unavailable"),
		"Block reward: " + network.blockReward,
		"Pending transactions: " + network.pendingTransactions,
		"Block hash: " + network.blockHash.slice(0, 10) + "..."
	];

	const [ price, pools ] = await Promise.all([
		getPrice(config).catch(ex => {
			throw new Error("Price data: " + ex.message);
		}),
		getPools(config).catch(ex => {
			throw new Error("Pool data: " + ex.message);
		})
	]);
	if(price) {
		report.push("", "Morelo price", ...price);
	}
	if(pools) {
		report.push("", "Mining pools", ...pools.slice(0, 5).map(pool =>
			pool.url + " (Hashrate: " + formatHashrate(pool.hashrate * 120) + ")"
		));
	}
	return report.join("\n").slice(0, 1900);
}

export function formatMRLAmount(amount) {
	return formatMRL(amount);
}
