import datetime
from rich import print

#Log color defs
INFO = "[white on cyan]INFO[/]"
ERROR = "[white on red]ERR [/]"
WARN = "[white on yellow]WARN[/]"

#Logging
def Log(text, type = INFO):
	print(type + "[white on black]", datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), text)