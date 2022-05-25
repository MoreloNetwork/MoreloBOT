from discord.ext import commands
from modules.globals import *
import discord

#Captcha function
async def captcha(member):
	Log("Member joined " + str(member.id))
	if (member.bot):
		Log("Member is BOT", ERROR)
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

	password = text.upper().split(" ")
	password = "".join(password)
	for tries in range(config["captcha_tries"]):
		try:
			msg = await client.wait_for('message', timeout=config["captcha_timeout"], check=check)
			# Check the captcha
			if msg.content.upper() == password:
				Log("User pass captcha")
				# Give and remove roles
				try:
					verified_role = get(member.guild.roles, id = config["verified_role"]) #verified
					if getrole is not False:
						await member.add_roles(getrole)
					getrole = get(member.guild.roles, id = config["unverified_role"]) #vice versa
					if getrole is not False:
						await member.remove_roles(getrole)
					await captchaChannel.send(f"**CAPTCHA VERIFICATION SUCESSFUL :**\nNow you are able to access server") #captcha passed
				except Exception as error:
					Log("Give or remove role failed: " + error, ERROR)
				return
			else:
				#When member fails captcha
				Log("User fails captcha", WARN)
				embed = discord.Embed(description=f"{member.mention} please try again.", color=0xca1616) # Red
				await captchaChannel.send(embed = embed)
		except (asyncio.TimeoutError):
			try:
				#when member waits too long
				Log("Captcha timeout", WARN)
				embed = discord.Embed(title = f"**YOU HAVE BEEN KICKED FROM {member.guild.name}**", description = "Reason : You exceeded the captcha response time (" + str(config["captcha_timeout"]) + "s).", color = 0xff0000)
				await captchaChannel.send(embed = embed)
				await member.kick() # Wypierdalaj 
				return
			except:
				pass
	#When member failed captcha 3 times
	Log("User kicked", WARN)
	embed = discord.Embed(title = f"**YOU HAVE BEEN KICKED FROM {member.guild.name}**", description = "Reason : You failed the captcha " + str(config["captcha_tries"]) + " times.", color = 0xff0000)
	await captchaChannel.send(embed = embed)
	await member.kick() # Wypierdalaj