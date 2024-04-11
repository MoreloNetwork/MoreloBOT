export default {
	prefix: "m!", // Bot prefix
	prefixMention: true, // Should bot mention be a prefix instead of a command?
	token: "", // Discord token
	tokenAddon: "", // Discord additional token used for faster statistics updating
	siteURL: "https://morelonetwork.pl", // Website URL
	explorerURL: "", // Explorer URL
	daemonURL: "", // Daemon URL, creates new local instance if empty
	walletURL: "", // Wallet URL, creates new local instance if empty
	binariesDir: "", // Daemon/Wallet binaries directory, uses bot's directory if empty
	walletsPath: "", // Wallets directory, uses bot's wallets directory if empty
	statsChannels: { // Channel IDs for displaying statistics
		hashrate: "",
		height: "",
		emission: "",
		lastReward: "",
		difficulty: ""
	},
	mysql: { // MySQL connection data
		host: "localhost",
		port: 3306,
		user: "root",
		password: "",
		database: "bot",
		connectionLimit: 100 // Pool size
	}
};
