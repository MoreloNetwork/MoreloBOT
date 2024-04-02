export default {
	prefix: "m!", // Bot prefix
	prefixMention: true, // Should bot mention be a prefix instead of a command?
	token: "", // Discord token
	site_url: "https://morelonetwork.pl", // Website URL
	mysql: { // MySQL connection data
		host: "localhost",
		port: 3306,
		user: "root",
		password: "",
		database: "bot",
		connectionLimit: 100
	}
};
