export default {
	prefix: "m!", // Bot prefix
	prefixMention: true, // Should bot mention be a prefix instead of a command?
	token: "", // Discord token
	siteURL: "https://morelonetwork.pl", // Website URL
	daemonURL: "", // Daemon URL, creates new local instance if empty
	walletURL: "", // Wallet URL, creates new local instance if empty
	explorerURL: "", // Explorer URL
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
		connectionLimit: 100
	}
};
