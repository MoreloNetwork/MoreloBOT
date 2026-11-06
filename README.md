# MoreloBOT

Morelo Network Discord bot.

## Setup

1. Install Node.js 20 or later and run `npm install`.
2. Copy `config.sample.js` to `config.js`.
3. Configure both Discord bot tokens, the daemon and wallet RPC endpoints (or
   local binaries), and the wallet directory/name/password. For a local wallet
   RPC, set `walletRpcPort` as needed.
4. Start the bot with `npm start`.

The wallet RPC must be private and trusted: the bot uses it to create tip accounts
and send real MRL transactions. Keep the wallet files and `wallets/users.json`
backed up, and do not expose an unauthenticated wallet RPC endpoint to the internet.
When using local RPC, the bot reuses a valid wallet RPC already listening on
`127.0.0.1` and `walletRpcPort`; otherwise it starts one. The bot stops only the
RPC process it started on normal shutdown, termination signals, or uncaught
errors, leaving pre-existing wallet RPC processes running.
If that server already has a wallet open, the bot reuses it; `walletName` and
`walletPassword` are used only when it needs to open a wallet.
If the Python bot's `addresses.json` is present, its user-to-wallet account
mappings are imported into `walletUsersPath` on first use when those addresses
belong to the configured wallet.

## Features

- Network height, hashrate, difficulty, block reward, and pending transaction statistics.
- Optional explorer emission, Xeggex price, and MiningPoolStats pool data.
- Slash commands and message commands for `network`, `hashrate`, `difficulty`,
  `pools`, `address`, `balance`, and `tip`.
- `help`, `ping`, and `uptime` utility commands.

Slash commands are registered at startup. Message commands accept the configured
`prefix` and can also be invoked by mentioning the bot. Set `prefixMention` to
`false` to make mentions show the command-list greeting instead of running the
following command.
Enable Discord's Message Content intent for message commands in the Developer Portal.
Configure `statsTextChannel` to post and periodically update a combined statistics
message. Individual network statistics channels can be configured through
`statsChannels`.

`address` returns the user's tip address privately. `balance` accepts an optional
user, and `tip` sends MRL from the sender's unlocked balance to another user's
bot-managed wallet account. Amounts support up to nine decimal places.
