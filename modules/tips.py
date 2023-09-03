from discord.ext import commands
from modules.globals import *
import discord
import pysondb
from modules.api import *

db = pysondb.getDb("addresses.json")
api = API()

def get_wallet(user_id):
	user_address = None
	for user in db.getAll():
		if user['user_id'] == user_id:
			user_address = user['address']
			break
	if not user_address:
		user_address = api.wallet.create_account()
		db.add({"user_id": int(user_id), "address": user_address})
	return user_address
	
def get_balance(address):
	address_index = api.wallet.get_address_index(address)
	balance = api.wallet.get_balance(address_index)
	return {"balance": int(balance['result']['balance']) / 1000000000, "unlocked_balance": int(balance['result']['unlocked_balance'] / 1000000000)}
	
@commands.command()
async def address(ctx):
	user_id = ctx.author.id
	user_address = get_wallet(user_id)
	user_dm = await ctx.author.create_dm()
	await user_dm.send("Your tip's wallet address: " + user_address)
	
@commands.command()
async def balance(ctx, who = None):
	if who:
		user_id = int(who[2:20])
	else:
		user_id = ctx.author.id
	user_address = get_wallet(user_id)
	balance = get_balance(user_address)
	embed=discord.Embed(title="Your wallet's balance", color=0xf78803)
	embed.set_thumbnail(url="https://raw.githubusercontent.com/morelo-network/Morelo-GUI/master/assets/logo128x128.png")
	embed.add_field(name="Unlocked", value = "%.9f MRL" % (balance['unlocked_balance']), inline=False)
	embed.add_field(name="Locked", value = "%.9f MRL" % ((balance['balance'] - balance['unlocked_balance'])), inline=False)
	await ctx.send(embed=embed)
	
@commands.command()
async def tip(ctx, receipent = None, amount : float = None):
	user_id = ctx.author.id
	receipent_id = receipent[2:20]
	sender_wallet = get_wallet(user_id)
	address_index = api.wallet.get_address_index(sender_wallet)
	balance = get_balance(sender_wallet)
	receipent_wallet = get_wallet(receipent_id)
	print(sender_wallet, balance, receipent_wallet, address_index)
	if receipent == None:
		await ctx.send("You need to specify receipent using mention")
		return
	if amount == None:
		await ctx.send("You need to specify amount of tip")
		return
	if amount > balance['unlocked_balance']:
		await ctx.send("You have not enough MRL to make this tip")
	else:
		response = api.wallet.transfer(receipent_wallet, amount, index = address_index)
		await ctx.send(response)