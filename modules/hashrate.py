from discord.ext import commands
from modules.globals import *

#Hashrate commands
@commands.command()
async def hashrate(ctx):
	await ctx.send("Network hashrate: " + Suffix(Globals['networkInfo']['data']['difficulty'] / 60))