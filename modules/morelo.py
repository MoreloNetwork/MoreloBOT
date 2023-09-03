import subprocess
from modules.timer import *
from modules.api import *
import time
import os

class Morelo():
	def __init__(self, workdir, local = True, d_url = 'http://127.0.0.1:38302', w_port = 38340):
		self.api = API()
		self.daemon = self.Daemon(local, d_url, workdir, self.api)
		self.wallet = self.Wallet(workdir, w_port, self.api, d_url)
		
		
	class Daemon():
		def __init__(self, local, d_url, workdir, api):
			self.api = api
			if local:
				self.process = self.run(workdir)
			
		def run(self, workdir):
			return subprocess.Popen(os.getcwd() + '/morelod --add-exclusive-node 80.60.19.222 --data-dir "' + workdir, stdout=subprocess.PIPE, shell=True)
			
		def wait(self):
			timeout = Timer()
			while timeout.get() < 15000:
				try:
					nodeInfo = self.api.daemon.get_info()
					if nodeInfo and 'result' in nodeInfo:
						return True
				except:
					pass
				time.sleep(1)
			return False
		
		def get_info(self):
			req1 = self.api.daemon.sync_info()
			req2 = self.api.daemon.get_connections()
			req3 = self.api.daemon.get_info()
			#some shitty mixing responses json
			req1['result']['difficulty'] = 0
			target_height = 0
			if 'connections' in req2['result']:
				for conn in req2['result']['connections']:
					if conn['height'] > target_height:
						target_height = conn['height']
			req1['result']['target_height'] = target_height
			if req3:
				req1['result']['difficulty'] = req3['result']['difficulty']
			return req1
			
	class Wallet():
		def __init__(self, workdir, w_port, api, d_url):
			self.api = api
			self.proc = self.run(workdir, w_port, d_url)
			
		def stop(self):
			return self.api.wallet.stop()
			
		def create(slef, filename, password = ""):
			return self.api.wallet.create(filename, password)
			
		def run(self, workdir, w_port, d_url):
			return subprocess.Popen(os.getcwd() + '/morelo-wallet-rpc --daemon-addres ' + d_url + ' --wallet-dir "' + workdir + '" --rpc-bind-port ' + str(w_port) + ' --disable-rpc-login', stdout=subprocess.DEVNULL,  shell=True)#, creationflags = CREATE_NO_WINDOW)
		
		def open(self, file, password = ""):
			return self.api.wallet.open(file, password)
			
		def get_balance(self):
			return self.api.wallet.get_balance()
			
		def get_address(self):
			data = self.api.wallet.get_address()
			return data['result']['address']
			
		def get_transfers(self, start, count):
			transactions = []
			data = self.api.wallet.get_transfers(start, count)
			if 'in' in data['result']:
				for block in data['result']['in']:
					transactions.append(block['txid'])
			if 'out' in data['result']:
				for block in data['result']['out']:
					transactions.append(block['txid'])
			return transactions
			
		def get_transfer(self, tx_hash):
			return self.api.wallet.get_transfer(tx_hash)
			
		def transfer(self, receipent, amount, txid = ""):
			return self.api.wallet.transfer(receipent, amount, txid)
		
		def get_keys(self):
			return self.api.wallet.get_keys()
			
		def get_height(self):
			return self.api.wallet.get_height()
			
		