from discord.ext import commands
from modules.globals import *

#Difficulty command
@commands.command()
async def difficulty(ctx):
	await ctx.send("Network difficulty: " + str(Globals['networkInfo']['data']['difficulty']))