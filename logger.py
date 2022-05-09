import datetime

#Logging
def Log(text):
	print("LOG", datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), text)