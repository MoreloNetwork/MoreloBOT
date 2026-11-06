import fetch from "node-fetch";

/**
 * Price provider interface: export default { name, async getPrice(config) }.
 * getPrice resolves to { usd, volume24hUSD?, change24h? } (numbers) and
 * throws on failure. Select a provider with config.priceProvider (file name).
 */
export default {
	name: "CoinGecko",
	async getPrice() {
		const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=morelo&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true");
		if(!response.ok) {
			throw new Error("CoinGecko returned HTTP " + response.status);
		}
		const data = (await response.json()).morelo;
		if(typeof data?.usd !== "number") {
			throw new Error("CoinGecko response has no MRL price");
		}
		return {
			usd: data.usd,
			volume24hUSD: data.usd_24h_vol ?? undefined,
			change24h: data.usd_24h_change ?? undefined
		};
	}
};
