from discord.ext import commands
from modules.globals import *
import discord

#Pools command
@commands.command()
async def pools(ctx):
	pools = ""
	for pool in Globals['poolsInfo']:
		hashrate = pool['hashrate']
		if hashrate >= 0:
			pools = pools + pool['url'] + ' (Hashrate: ' + Suffix(hashrate) +')\n'
	embed=discord.Embed(title="Pools statistics", description=pools, color=0xf78803)
	embed.set_thumbnail(url="https://raw.githubusercontent.com/morelo-network/Morelo-GUI/master/assets/logo128x128.png")
	await ctx.send(embed=embed)
	