# MoreloBOT

Morelo Network Discord bot.

Source modules are grouped under `api/` (wallet and network integrations),
`casino/` (casino games and state stores), `core/` (shared bot utilities),
and `commands/`. Application logs are written to `logs/`.

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

All tip balances live in one wallet. Discord user accounts are mapped through
`walletUsersPath`; existing mappings can be imported from `legacyAddressesPath`.
Back up both the wallet files and the configured mapping file.

The wallet RPC must be private and trusted: the bot uses it to create accounts
and send real MRL transactions. Never expose an unauthenticated wallet RPC to
the internet. When `walletURL` is empty, the bot uses a wallet RPC already
listening on `127.0.0.1:walletRpcPort`, or starts one and stops it on shutdown.
If the wallet RPC already has a wallet open, the bot uses that wallet;
`walletName` and `walletPassword` are used only when it needs to open one.

Users can receive DMs for incoming transfers and control tip/transfer alerts
with the `notifications` command. The notification store tracks transaction
pool message IDs and transfer history, and backfills existing transfers once.

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
- `casino balance|history|block|guess|coinflip|roulette|dice`: inspect your wallet balance, current block round, history, or place a wager. Game commands also have direct forms such as `m!dice <1-6> <amount>`, `m!coinflip <heads|tails> <amount>`, `m!roulette <pick> <amount>`, and `m!blackjack start <amount>`. Use each game only in its configured game channel; the bot points to that channel if a command is sent elsewhere. Operators can use `blockpending` and `blockresolve` for unresolved block predictions.
- `usage` (aliases `help`, `commands`), `ping`, `uptime`.

Amounts accept up to 9 decimal places. Group tips are sent in a single transfer,
so either every recipient is paid or none is; atomic units that can't be split
evenly stay with the sender. Received MRL is locked for a few blocks before it
can be sent again.

## MRL Casino

Casino wagers use real MRL from the existing tip wallet; there are no free
starting tokens or daily grants. The initial games are `coinflip` (`heads` or
`tails`) and European `roulette` (`red`, `black`, or a number from 0 to 36).
Coinflip and color bets pay 2x the stake on a win; a winning roulette number
pays 36x. The stake is transferred to the house account before any payout.

Dice accepts a number from 1 to 6 and pays 5.7x the stake on an exact result.
Blackjack is available in sandbox mode with `blackjack start <amount>`, followed
by `blackjack hit` or `blackjack stand`; a natural blackjack pays 2.5x and a
regular win pays 2x. The casino is disabled by default. Configure `casinoHouseAccountIndex`
as a dedicated wallet account that is not mapped to a Discord user. Set
`casinoEnabled` to `true` only after funding that account and checking that it
can cover the largest configured payout plus `casinoFeeReserve`. Configure
`casinoMinBet`, `casinoMaxBet`, and `casinoFeeReserve` conservatively; the
sample values are only starting points, not a recommended bankroll.

The wager ledger is stored at `casinoWagersPath`. If a wallet call or disk write
leaves a wager in `needs_review`, the bot will not retry the transfer
automatically. Do not replay the bet; an operator listed in
`casinoAdminUserIds` must verify the wallet transaction and reconcile the wager.
Operators can inspect open entries with `m!casino pending` or select "Review pending wagers"
in the `/casino` slash command, then use `m!casino resolve <full-id> settled <verified-tx-hash>`
or `m!casino resolve <full-id> void <refund-tx-hash|no-transfer-confirmed>`.
Resolve only records the operator's decision; it never sends a transfer. Keep
the wallet RPC private and back up the wager ledger with the wallet data.

For the block game, use `m!guess <1-6 hex characters> <amount>` to predict the
next top block's hash suffix. Use it in the configured guess channel. A
prediction is checked as soon as the daemon reports that block as the new top.
At that round transition the bot settles all predictions, clears non-pinned
messages from the game channel while keeping the pinned instructions, and posts
the previous round's guesses/results together with the new round's target height.
Only the guess channel is cleared; its pinned instructions and shared wins channel
are preserved.
You may place multiple predictions in the same round, including
multiple predictions as one user. Winners are posted in the shared wins channel
after the target block hash is available and payouts have been processed. The
provisional gross payout is `15 × 16^(n-1)` times the stake for
`n` correctly guessed trailing hexadecimal characters (up to six); house funds
must cover the full possible payout before a prediction is accepted. Configure
`casinoWinsChannel` to announce wins in the shared casino wins channel; rounds
without winners are not posted.
Each guess is a wager in the amount chosen by the user; the stake is transferred
from that user's tip-wallet account to the casino house before the round settles.
Block wagers and settlement state are stored at
`casinoBlockBetsPath`, and the daemon is checked every `casinoBlockPollInterval`
milliseconds. These payout rules are initial defaults and should be reviewed
before enabling real-MRL casino wagers.

When `casinoLeaderboardChannel` is configured, the bot maintains a leaderboard
with the top 10 users by total gross payouts, largest single payout, and total
lost stakes. Only settled real-MRL wagers are included; sandbox results are not
mixed into the real-currency ranking.

## Statistics

Set `statsTextChannel` to post and periodically update a combined statistics
message, and `statsChannels` to show single values as channel names.

Prices come from the provider named by `priceProvider`, a module in
`price-providers/` (empty disables prices). To add a provider, create
`price-providers/<name>.js` exporting `{ name, async getPrice(config) }`, where
`getPrice` resolves to `{ usd, volume24hUSD?, change24h? }` (numbers) and
throws on failure.
