import { formatMRL } from "./wallet.js";

const priceProviders = new Map();

export function formatHashrate(hashrate) {
	hashrate = Number(hashrate);
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

// Morelo targets a 120 second block time
export function difficultyToHashrate(difficulty) {
	return formatHashrate(Number(difficulty) / 120);
}

async function getJson(url, source) {
	const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
	if(!response.ok) {
		throw new Error(source + " returned HTTP " + response.status);
	}
	return response.json();
}

export async function getNetworkStats(daemon) {
	const info = await daemon.getInfo();
	const [ block, txPool ] = await Promise.all([
		daemon.getBlockByHash(info.getTopBlockHash()),
		daemon.getTxPoolStats()
	]);
	return {
		hashrate: difficultyToHashrate(info.getDifficulty()),
		height: info.getHeight(),
		difficulty: String(info.getDifficulty()),
		pendingTransactions: txPool.getNumTxs() ?? 0,
		blockHash: info.getTopBlockHash(),
		blockReward: formatMRL(block.getMinerTx().getOutputs()[0].getAmount(), 4)
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
	return formatMRL(body.data.coinbase, 2);
}

/**
 * Returns the configured price provider's quote, or null when none is configured.
 * A provider is price-providers/<name>.js exporting { name, async getPrice(config) },
 * where getPrice resolves to { usd, volume24hUSD?, change24h? } (numbers) and throws on failure.
 */
export async function getPrice(config) {
	const name = config.priceProvider;
	if(!name) {
		return null;
	}
	if(!/^[\w-]+$/.test(name)) {
		throw new Error("Invalid price provider name: " + name);
	}
	if(!priceProviders.has(name)) {
		priceProviders.set(name, import("./price-providers/" + name + ".js").then(module => module.default));
	}
	const provider = await priceProviders.get(name);
	return { source: provider.name || name, ...await provider.getPrice(config) };
}

export function formatPrice(price) {
	const lines = [ "Price: $" + price.usd ];
	if(price.volume24hUSD != null) {
		lines.push("24h volume: $" + price.volume24hUSD.toFixed(2));
	}
	if(price.change24h != null) {
		lines.push("24h change: " + price.change24h.toFixed(2) + "%");
	}
	lines.push("Source: " + price.source);
	return lines;
}

export async function getPools(config) {
	if(!config.poolsPageURL || !config.poolsDataURL) {
		return null;
	}

	const page = await fetch(config.poolsPageURL, { signal: AbortSignal.timeout(10000) });
	if(!page.ok) {
		throw new Error("MiningPoolStats returned HTTP " + page.status);
	}
	const token = (await page.text()).match(/var last_time\s*=\s*["']([^"']+)["']/)?.[1];
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
		.filter(pool => typeof pool?.url === "string" && Number(pool.hashrate) >= 0)
		.sort((left, right) => Number(right.hashrate) - Number(left.hashrate));
}

export function formatPool(pool) {
	return "<" + pool.url + "> (" + formatHashrate(pool.hashrate) + ")";
}

export async function getNetworkReport(daemon, config) {
	const network = await getNetworkStats(daemon);
	const [ emission, price, pools ] = await Promise.all([
		getEmission(config).catch(ex => "unavailable (" + ex.message + ")"),
		getPrice(config).catch(ex => ({ error: ex.message })),
		getPools(config).catch(ex => ({ error: ex.message }))
	]);
	const report = [
		"**Network statistics**",
		"Hashrate: " + network.hashrate,
		"Height: " + network.height,
		"Difficulty: " + network.difficulty,
		"Emission: " + (emission ?? "unavailable"),
		"Block reward: " + network.blockReward,
		"Pending transactions: " + network.pendingTransactions,
		"Block hash: " + network.blockHash.slice(0, 10) + "..."
	];
	if(price) {
		report.push("", "**Morelo price**", ...(price.error ? [ "Price data unavailable (" + price.error + ")" ] : formatPrice(price)));
	}
	if(pools) {
		report.push("", "**Mining pools**", ...(pools.error ? [ "Pool data unavailable (" + pools.error + ")" ] : pools.slice(0, 5).map(formatPool)));
	}
	return report.join("\n").slice(0, 1900);
}
