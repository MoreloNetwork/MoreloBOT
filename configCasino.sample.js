export default {
	casinoEnabled: false, // Keep real-MRL casino disabled until the house wallet is configured
	casinoTestMode: false, // Use isolated virtual test balances without MRL transfers
	casinoAdminUserIds: [], // Discord IDs allowed to manage casino wagers
	casinoSandboxPath: "wallets/casino-sandbox.json",
	casinoSandboxBlockBetsPath: "wallets/casino-sandbox-block-bets.json",
	casinoSandboxInitialBalance: "1000",
	casinoSandboxHouseBalance: "1000000",
	casinoHouseAccountIndex: -1,
	casinoWagersPath: "wallets/casino-wagers.json",
	casinoBlockBetsPath: "wallets/casino-block-bets.json",
	casinoBlockPollInterval: 5000,
	casinoWinsChannel: "",
	casinoGameChannels: {
		coinflip: "",
		guessNextHash: "",
		roulette: "",
		blackjack: "",
		dice: ""
	},
	casinoMinBet: "0.001",
	casinoMaxBet: "0.1",
	casinoFeeReserve: "0.01"
};
