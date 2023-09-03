from discord.ext import commands
from modules.globals import *

#Difficulty command
@commands.command()
async def difficulty(ctx):
	embed=discord.Embed(title="Network difficulty: " + str(Globals['networkInfo']['difficulty']), description=pools, color=0xf78803)
	embed.set_thumbnail(url="https://raw.githubusercontent.com/morelo-network/Morelo-GUI/master/assets/logo128x128.png")
	await ctx.send(embed=embed)