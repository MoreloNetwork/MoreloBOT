import discord, threading, requests, re, asyncio, datetime, random, asyncio, time, string, os
import numpy as np
import Augmentor, shutil
from discord.ext import commands
from discord.utils import get
from PIL import ImageFont, ImageDraw, Image
from captcha.image import ImageCaptcha
from logger import Log
import json

#Loading config
try:
	f = open('config.json')
	config = json.load(f)
	Log("Config file loaded")
except:
	Log("Config file fucked up, bye!")
	exit()

#Data from APIs variables
Globals = {
	'networkInfo': None,
	'moreloInfo': [None, None, None],
	'blockInfo': None,
	'coingeckoInfo': None,
	'emissionInfo': None,
	'poolsInfo': None
}

intents = discord.Intents.all()
client = discord.Client(intents=intents, command_prefix=config["bot_prefix"])

@client.event
async def on_message(message):
	if "pools" in message.content.lower() and message.author.id != client.user.id: 
	#id = bot id so it wont infitely loop the command
		pools = ""
		for pool in Globals['poolsInfo']:
			hashrate = pool['hashrate']
			pools = pools + pool['url'] + ' (Hashrate: ' + Suffix(hashrate) +')\n'
		channel = message.channel
		embed=discord.Embed(title="Pools statistics", description=pools, color=0xf78803)
		embed.set_thumbnail(url="https://raw.githubusercontent.com/morelo-network/Morelo-GUI/master/assets/logo128x128.png")
		await channel.send(embed=embed)
	#await client.process_commands(message)

@client.event
async def on_ready():
	global channel, pools_msg
	Log("Client connected as " + client.user.name + ' (' + str(client.user.id) + ')')
	try:
		channel = client.get_channel(config["stats_channel"])
		Log("Stats channel hooked")
	except:
		Log("Stats channel doesn't exist")
		return
	try:
		pools_msg = await channel.fetch_message(channel.last_message_id) #Dawaj kurwa ostatnia wiadomosc
		Log("Stats message fetched")
	except:
		try:
			pools_msg = await channel.send('Init message')
			Log("Channel initilized")
		except:
			Log("Everything fucked up, suicide yourself")
			return
		pass
		
	while True:
		await UpdateData()
		await asyncio.sleep(config["update_interval"])
		
@client.event
async def on_member_join(member):
	Log("Member joined " + str(member.id))
	if (member.bot):
		Log("Member is BOT")
		return
	captchaChannel = await member.create_dm()
	# Give temporary role
	getrole = get(member.guild.roles, id = config["unverified_role"]) #Unverified role id
	await member.add_roles(getrole)
	
	# Create captcha
	image = ImageCaptcha(width = 350, height = 100)
	text = ' '.join(random.choice(string.ascii_uppercase) for _ in range(6)) # + string.ascii_lowercase + string.digits
	data = image.generate(text) 

	# Save
	ID = member.id
	folderPath = config["captcha_workdir"]
	captchaFile = folderPath + f"/captcha_{ID}.png"
	try:
		os.mkdir(folderPath)
	except:
		if os.path.isdir(folderPath) is False:
			os.mkdir(folderPath)
		if os.path.isdir(folderPath) is True:
			shutil.rmtree(folderPath) # co to kurwa jest?
		os.mkdir(folderPath)
	image.write(text, captchaFile)

	# Send captcha
	captchaFile = discord.File(captchaFile)
	# Check if it is the right user
	def check(message):
		if message.author == member and  message.content != "":
			return message.content
	await captchaChannel.send(f"**YOU MUST PASS THE CAPTCHA TO ENTER IN THE SERVER :**\nPlease {member.mention}, enter the captcha to get access to the whole server", file= captchaFile)
	# Remove captcha folder
	# COŚ TU POJEBANE JEST CHUJU
	#try:
	#	shutil.rmtree(folderPath) 
	#except Exception as error:
	#	print(f"Delete captcha file failed {error}")
	password = text.upper().split(" ")
	password = "".join(password)
	for tries in range(3):
		try:
			msg = await client.wait_for('message', timeout=config["captcha_timeout"], check=check)
			# Check the captcha
			if msg.content.upper() == password:
				#embed = discord.Embed(description=f"{member.mention} passed the captcha.", color=0x2fa737) # Green
				#await captchaChannel.send(embed = embed, delete_after = 5)
				# Give and remove roles
				try:
					getrole = get(member.guild.roles, id = config["verified_role"]) #verified
					if getrole is not False:
						await member.add_roles(getrole)
					getrole = get(member.guild.roles, id = config["unverified_role"]) #vice versa
					if getrole is not False:
						await member.remove_roles(getrole)
				except Exception as error:
					print(f"Give and remove roles failed : {error}")
				await captchaChannel.send(f"**CAPTCHA VERIFICATION SUCESSFUL :**\nNow you are able to access server") #spierdalaj z mojej ziemii
				return
			else:
				#When member fails captcha
				embed = discord.Embed(description=f"{member.mention} please try again.", color=0xca1616) # Red
				await captchaChannel.send(embed = embed)
		except (asyncio.TimeoutError):
			try:
				#when member waits too long
				embed = discord.Embed(title = f"**YOU HAVE BEEN KICKED FROM {member.guild.name}**", description = "Reason : You exceeded the captcha response time (" + str(config["captcha_timeout"]) + "s).", color = 0xff0000)
				await captchaChannel.send(embed = embed)
				await member.kick() # Wypierdalaj 
				return
			except:
				pass
	#When member failed captcha 3 times
	embed = discord.Embed(title = f"**YOU HAVE BEEN KICKED FROM {member.guild.name}**", description = f"Reason : You failed the captcha 3 times.", color = 0xff0000)
	await captchaChannel.send(embed = embed)
	await member.kick() # Wypierdalaj

def Suffix(num):
	if num < 1000:
		num = "%.2f" % num + " H/s"
	elif num < 1000000:
		num = "%.2f" % (num / 1000) + " kH/s"
	elif num < 1000000000:
		num = "%.2f" % (num / 1000000) + " MH/s"
	elif num < 1000000000000: #Po po po power! 
		num = "%.2f" % (num / 1000000000) + " GH/s"
	return num 

async def UpdateData():
	Log("Querying APIs")
	#Updating data from APIs
	try:
		networkQuery = requests.get(config["explorer_address"] + "api/networkinfo")
		if networkQuery.status_code == 200:
			Globals['networkInfo'] = networkQuery.json()
			Log("Network OK")
	except:
		Log("Network fucked up")
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
		Log("Price fucked up")
		return	
	try:
		emissionQuery = requests.get(config["explorer_address"] + "api/emission")
		if emissionQuery.status_code == 200:
			Globals['emissionInfo'] = emissionQuery.json()
			Log("Emission OK")
	except:
		Log("Emission fucked up")
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
		Log("Pools fucked up")
		return
	try:
		blockQuery = requests.get(config["explorer_address"] + "api/rawblock/" + Globals['networkInfo']['data']['top_block_hash'])
		if blockQuery.status_code == 200:
			Globals['blockInfo'] = blockQuery.json()
			Log("Top block OK")
	except:
		Log("Top block fucked up")
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
		Log("Message fucked up")
		return

client.run(config["access_token"])
