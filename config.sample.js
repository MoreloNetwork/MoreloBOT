export default {
	prefix: "m!", // Bot prefix
	prefixMention: true, // Should bot mention be a prefix instead of a command?
	token: "", // Discord token
	tokenAddon: "", // Discord additional token used for faster statistics updating
	siteURL: "https://morelonetwork.pl", // Website URL
	repoURL: "https://github.com/MoreloNetwork", // Repository URL
	explorerURL: "https://explorer.morelonetwork.pl", // Explorer URL
	priceProvider: "coingecko", // File name from price-providers, empty to disable prices
	poolsPageURL: "https://miningpoolstats.stream/morelo", // MiningPoolStats page URL
	poolsDataURL: "https://data.miningpoolstats.stream/data/morelo.js", // MiningPoolStats data URL
	daemonURL: "", // Daemon URL, creates new local instance if empty
	walletURL: "", // Wallet RPC URL, uses or starts local wallet RPC on walletRpcPort if empty
	walletRpcPort: 38304, // Local wallet RPC port
	binariesPath: "", // Daemon/Wallet binaries directory, uses bot's directory if empty
	walletsPath: "", // Wallets directory, uses bot's wallets directory if empty
	walletName: "tips", // Wallet to open when the wallet RPC has none open
	walletPassword: "", // Wallet password
	statsTextChannel: "", // Optional text channel for network, market, and pool statistics
	statsUpdateInterval: 60000, // Statistics message update interval in milliseconds
	statsChannels: { // Channel IDs for displaying statistics
		hashrate: "",
		height: "",
		emission: "",
		lastReward: "",
		difficulty: "",
		price: ""
	}
};
