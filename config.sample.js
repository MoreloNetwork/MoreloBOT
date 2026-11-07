export default {
	prefix: "m!", // Bot prefix
	prefixMention: true, // Should bot mention be a prefix instead of a command?
	token: "", // Discord token
	tokenAddon: "", // Discord additional token used for faster statistics updating
	siteURL: "https://morelo.cc", // Website URL
	repoURL: "https://github.com/MoreloNetwork", // Repository URL
	explorerURL: "https://explorer.morelo.cc", // Explorer URL
	priceURL: "https://xeggex.com/api/v2/market/getbyid/643670143fef5ebc68e82471", // Market API URL
	poolsPageURL: "https://miningpoolstats.stream/morelo", // MiningPoolStats page URL
	poolsDataURL: "https://data.miningpoolstats.stream/data/morelo.js", // MiningPoolStats data URL
	daemonURL: "", // Daemon URL, creates new local instance if empty
	walletURL: "", // Wallet RPC URL, checks local RPC if empty
	walletRpcPort: 38304, // Local wallet RPC port
	binariesPath: "", // Daemon/Wallet binaries directory, uses bot's directory if empty
	walletsPath: "", // Wallets directory, uses bot's wallets directory if empty
	walletName: "tips", // Wallet RPC wallet name to open
	walletPassword: "", // Wallet RPC wallet password
	walletUsersPath: "wallets/users.json", // Discord user to wallet account mapping file
	walletNotificationsPath: "wallets/notifications.json", // Incoming wallet notification state
	legacyAddressesPath: "addresses.json", // Existing Python bot user address database
	statsTextChannel: "", // Optional text channel for network, market, and pool statistics
	statsUpdateInterval: 60000, // Statistics message update interval in milliseconds
	txPoolChannel: "", // Optional channel ID for the live transaction pool message
	txPoolUpdateInterval: 30000, // Transaction pool refresh interval in milliseconds
	statsChannels: { // Channel IDs for displaying statistics
		hashrate: "",
		height: "",
		emission: "",
		lastReward: "",
		difficulty: "",
		xeggexUSDT: "",
		xeggexDOGE: ""
	}
};
