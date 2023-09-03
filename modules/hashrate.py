from discord.ext import commands
from modules.globals import *

#Hashrate command
@commands.command()
async def hashrate(ctx):
	embed=discord.Embed(title="Network hashrate: " + Suffix(Globals['networkInfo']['difficulty'] / 120), description=pools, color=0xf78803)
	embed.set_thumbnail(url="https://raw.githubusercontent.com/morelo-network/Morelo-GUI/master/assets/logo128x128.png")
	await ctx.send(embed=embed)