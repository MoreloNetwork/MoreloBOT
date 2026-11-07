# MoreloBOT

Morelo Network Discord bot.

## Setup

1. Install Node.js 20 or later and run `pnpm install`.
2. Copy `config.sample.js` to `config.js`.
3. Configure both Discord bot tokens, the daemon and wallet RPC endpoints (or
   local binaries), and the wallet directory/name/password. For a local wallet
   RPC, set `walletRpcPort` as needed.
4. In the Discord Developer Portal, enable the privileged Message Content,
   Server Members and Presence intents.
5. Start the bot with `pnpm start`.

## Wallet

All tip balances live in one wallet. Every Discord user gets their own wallet
account, labelled `discord-<user id>`; the labels are the only user mapping, so
backing up the wallet files (keys and cache) is enough to restore the bot.

The wallet RPC must be private and trusted: the bot uses it to create accounts
and send real MRL transactions. Never expose an unauthenticated wallet RPC to
the internet. When `walletURL` is empty, the bot uses a wallet RPC already
listening on `127.0.0.1:walletRpcPort`, or starts one and stops it on shutdown.
If the wallet RPC already has a wallet open, the bot uses that wallet;
`walletName` and `walletPassword` are used only when it needs to open one.

Users get a DM for every incoming transfer to their account, both tips and
deposits. `notifications.json` in the wallets directory records which
transfers were announced; on the first start existing transfers are skipped.

## Commands

Slash commands are registered at startup. Message commands use the configured
`prefix` or a bot mention (set `prefixMention` to `false` to make a mention only
show the greeting). Every slash command also has a variant ending with `d`, for
example `/balanced`, whose response is visible only to you; for message
commands the hidden response is sent as a direct message.

- `network`, `hashrate`, `difficulty`, `pools`: network, price and mining pool statistics.
- `address`: your deposit address (always hidden).
- `balance [@user]`: unlocked and locked balance.
- `tip <@user|@role> <amount>`: send MRL to a user, or split it evenly among
  the human members of a role.
- `tipall <amount>`: split MRL evenly among online human members of the server.
- `withdraw <address> <amount|all>` (alias `transfer`): send MRL to an external
  address (always hidden). `all` sends the whole unlocked balance minus the fee.
- `usage` (aliases `help`, `commands`), `ping`, `uptime`.

Amounts accept up to 9 decimal places. Group tips are sent in a single transfer,
so either every recipient is paid or none is; atomic units that can't be split
evenly stay with the sender. Received MRL is locked for a few blocks before it
can be sent again.

## Statistics

Set `statsTextChannel` to post and periodically update a combined statistics
message, and `statsChannels` to show single values as channel names.

Prices come from the provider named by `priceProvider`, a module in
`price-providers/` (empty disables prices). To add a provider, create
`price-providers/<name>.js` exporting `{ name, async getPrice(config) }`, where
`getPrice` resolves to `{ usd, volume24hUSD?, change24h? }` (numbers) and
throws on failure.
