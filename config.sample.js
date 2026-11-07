export default {
	trybie 	prefix: "m!", // Bot prefix
	prefixMention: true, // Should bot mention be a prefix instead of a command?
	token: "", // Discord token
	tokenAddon: "", // Discord additional token used for faster statistics updating
	siteURL: "https://morelo.cc", // Website URL
	repoURL: "https://github.com/MoreloNetwork", // Repository URL
	explorerURL: "https://explorer.morelo.cc", // Explorer URL
	priceURL: "https://xeggex.com/api/v2/market/getbyid/643670143fef5ebc68e82471", // Market API URL
	priceProvider: "", // File name from price-providers, empty to disable provider-based prices
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
	casinoEnabled: false, // Real-MRL casino disabled
	casinoTestMode: false, // Isolated virtual test balances; no MRL transfers
	casinoSandboxPath: "wallets/casino-sandbox.json", // Virtual balances and game history
	casinoSandboxBlockBetsPath: "wallets/casino-sandbox-block-bets.json", // Virtual hash-game rounds
	casinoSandboxInitialBalance: "1000", // Virtual TEST MRL per configured administrator
	casinoSandboxHouseBalance: "1000000", // Sandbox-only house liability capacity in TEST MRL
	casinoHouseAccountIndex: -1, // Dedicated wallet account index not assigned to a Discord user
	casinoWagersPath: "wallets/casino-wagers.json", // Casino wager and reconciliation history
	casinoBlockBetsPath: "wallets/casino-block-bets.json", // Block hash prediction bets and settlement history
	casinoBlockPollInterval: 5000, // Block monitor interval in milliseconds
	casinoWinsChannel: "", // Shared channel ID for wins from all casino games
	casinoGameChannels: {
		coinflip: "", // Channel ID for coinflip
		guessNextHash: "", // Channel ID for guess-the-next-hash game
		roulette: "", // Channel ID for roulette
		blackjack: "", // Channel ID for blackjack
		dice: "" // Channel ID for dice
	},
	casinoMinBet: "0.001", // Minimum casino bet in MRL
	casinoMaxBet: "0.1", // Maximum casino bet in MRL
	casinoFeeReserve: "0.01", // Extra unlocked MRL required to cover transaction fees
	casinoAdminUserIds: [], // Discord user IDs allowed to review unresolved casino wagers
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
