import discord, requests, re, asyncio, datetime, random, time, string, os
import Augmentor, shutil
from discord.ext import commands
from discord.utils import get
from PIL import ImageFont, ImageDraw, Image
import json

from modules.logger import *
from modules.pools import *
from modules.globals import *
from modules.captcha import *
from modules.hashrate import *

intents = discord.Intents.all()
client = commands.Bot(intents=intents, command_prefix=config["bot_prefix"])

client.add_command(pools)
client.add_command(hashrate)

@client.event
async def on_message(message):
	#if author is bot return
	if message.author.id == client.user.id:
		return
	await client.process_commands(message)

@client.event
async def on_ready():
	global channel, pools_msg
	Log("Client connected as " + client.user.name + ' (' + str(client.user.id) + ')')
	try:
		channel = client.get_channel(config["stats_channel"])
		Log("Stats channel hooked")
	except:
		Log("Stats channel doesn't exist", ERROR)
		return
	try:
		pools_msg = await channel.fetch_message(channel.last_message_id) #Dawaj kurwa ostatnia wiadomosc
		Log("Stats message fetched")
	except:
		try:
			pools_msg = await channel.send('Init message')
			Log("Channel initilized")
		except:
			Log("Everything fucked up, suicide yourself", ERROR)
			return
		pass
		
	while True:
		await UpdateData()
		await asyncio.sleep(config["update_interval"])
		
@client.event
async def on_member_join(member):
	captcha(member)

async def UpdateData():
	Log("Querying APIs")
	#Updating data from APIs
	try:
		networkQuery = requests.get(config["explorer_address"] + "api/networkinfo")
		if networkQuery.status_code == 200:
			Globals['networkInfo'] = networkQuery.json()
			Log("Network OK")
	except:
		Log("Network fucked up", ERROR)
		return
	try:
		priceQuery = requests.get("https://api.coingecko.com/api/v3/simple/price?ids=morelo&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true")
		if priceQuery.status_code == 200:
			Globals['moreloInfo'][0] = priceQuery.json()
		priceQuery = requests.get("https://api.coingecko.com/api/v3/simple/price?ids=morelo&vs_currencies=btc")
		if priceQuery.status_code == 200:
			Globals['moreloInfo'][1] = priceQuery.json()
		priceQuery = requests.get("https://api.coingecko.com/api/v3/simple/price?ids=morelo&vs_currencies=eth")
		if priceQuery.status_code == 200:
			Globals['moreloInfo'][2] = priceQuery.json()
		Log("Price OK")
	except:
		Log("Price fucked up", ERROR)
		return	
	try:
		emissionQuery = requests.get(config["explorer_address"] + "api/emission")
		if emissionQuery.status_code == 200:
			Globals['emissionInfo'] = emissionQuery.json()
			Log("Emission OK")
	except:
		Log("Emission fucked up", ERROR)
		return
	try:
		#miningpoolstats.stream API hack
		poolsQuery = requests.get("http://miningpoolstats.stream/morelo")
		if poolsQuery.status_code == 200:
			token = re.search('var last_time = "([^"]+)"', poolsQuery.text).group(1)
			poolsQuery = requests.get("http://data.miningpoolstats.stream/data/morelo.js", params={'t': token}, headers={'User-Agent': 'MoreloBOT'})
			if poolsQuery.status_code == 200:
				poolsQuery = poolsQuery.json()
				Globals['poolsInfo'] = sorted(poolsQuery['data'], key = lambda i: i['hashrate'], reverse=True)#Jebana magia sortowania z rewersem
				Log("Pools OK")
	except:
		Log("Pools fucked up", ERROR)
		return
	try:
		blockQuery = requests.get(config["explorer_address"] + "api/rawblock/" + Globals['networkInfo']['data']['top_block_hash'])
		if blockQuery.status_code == 200:
			Globals['blockInfo'] = blockQuery.json()
			Log("Top block OK")
	except:
		Log("Top block fucked up", ERROR)
		return
	#Update messages
	pools = ""
	Log("Embed magic...")
	if Globals['poolsInfo']: #Pojebany parser do pooli
		for pool in Globals['poolsInfo']:
			if pool['hashrate'] >= 0:
				pools = pools + pool['url'] + ' (Hashrate: ' + Suffix(pool['hashrate']) +')\n'
	network = "```Hashrate	 : " + Suffix(Globals['networkInfo']['data']['difficulty'] / 60) + \
	"\nHeight	   : " + str(Globals['networkInfo']['data']['height']) + \
	"\nEmission	 : %.2f MRL" % (Globals['emissionInfo']['data']['coinbase'] / 1000000000) + \
	"\nBlock Reward : %.4f MRL" % (Globals['blockInfo']['data']['miner_tx']['vout'][0]['amount'] / 1000000000) + \
	"\nDifficulty   : " + str(Globals['networkInfo']['data']['difficulty']) + \
	"\nPending Tx's : " + str(Globals['networkInfo']['data']['tx_pool_size']) + \
	"\nBlock Hash   : " + Globals['networkInfo']['data']['top_block_hash'][:10] + "...```"
	prices = "```24H Volume : $%.2f" % (Globals['moreloInfo'][0]['morelo']['usd_24h_vol'] if Globals['moreloInfo'][0]['morelo']['usd_24h_vol'] else 0)+ \
	"\n24H Change : %.2f%%" % (Globals['moreloInfo'][0]['morelo']['usd_24h_change'] if Globals['moreloInfo'][0]['morelo']['usd_24h_change'] else 0) + \
	"\n\nUSD		: $%.10f" % Globals['moreloInfo'][0]['morelo']['usd'] + \
	"\nBTC		: Ƀ%.10f" % Globals['moreloInfo'][1]['morelo']['btc'] + \
	"\nETH		: Ξ%.10f" % Globals['moreloInfo'][2]['morelo']['eth'] + "```"
	embed=discord.Embed(color=0xf78803)
	embed.set_thumbnail(url="https://raw.githubusercontent.com/morelo-network/Morelo-GUI/master/assets/logo128x128.png")
	embed.add_field(name="Network statistics", value=network, inline=False)
	embed.add_field(name="Pools statistics", value=pools, inline=False)
	embed.add_field(name="Morelo prices", value=prices, inline=False)
	#TODO add timezone
	embed.set_footer(text="Last update - " + datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC+2"))
	try:
		await pools_msg.edit(content='', embed=embed)
		Log("Message sent")
	except:
		Log("Message fucked up", ERROR)
		return

client.run(config["access_token"])
