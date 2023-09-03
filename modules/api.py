import requests
import json
import random

class API():
	def __init__(self, d_url = 'http://127.0.0.1:38302', w_port = 38340):
		self.daemon = self.Daemon(d_url)
		self.wallet = self.Wallet(w_port)
		
	class Wallet():
		def __init__(self, w_port):
			self.port = w_port
			self.headers = {'Content-Type': 'application/json'}
			
		def post(self, method, params=None):
			if params is not None:
				data = json.dumps({"jsonrpc": "2.0", "id": "0", "method": method, "params": params})
			else:
				data = json.dumps({"jsonrpc": "2.0", "id": "0", "method": method})
			response = requests.post('http://127.0.0.1:' + str(self.port) + '/json_rpc', data=data, headers=self.headers)
			return json.loads(response.text)
			
		def open(self, file, password = ""):
			return self.post("open_wallet", {"filename": file, "password": password})
			
		def create(self, file, password):
			return self.post("create_wallet", {"filename": file, "password": + password, "language": "English"})
			
		def transfer(self, receipent, amount, txid = "", index = 0):
			return self.post("transfer", {"account_index": index, "destinations":[{"amount": str(int(amount * 1000000000)), "address": receipent}], "payment_id": str(txid)})
		
		def get_address(self):
			return self.post("get_address", {"account_index":0})
			
		def get_balance(self, index = 0):
			response = self.post("get_balance", {"account_index": index})
			if index and 'per_subaddress' in response['result']:
				for addr in response['result']['per_subaddress']:
					if addr['account_index'] == index:
						return {"result": addr}
			else:
				return {'result': {'unlocked_balance': 0, 'balance': 0}}
			
		def get_transfers(self, start, count):
			return self.post("get_transfers", {"filter_by_height": True, "pending": False, "in": True, "out": True, "min_height": str(start), "max_height": str(start + count)})
		
		def get_transfer(self, tx_hash):
			return self.post("get_transfer_by_txid", {"txid": tx_hash})
			
		def stop(self):
			return self.post("stop_wallet")
			
		def get_keys(self):
			keys = {}
			response = self.post("query_key", {"key_type":"view_key"})
			keys['view'] = response['result']['key']
			response = self.post("query_key", {"key_type":"spend_key"})
			keys['spend'] = response['result']['key']
			response = self.post("query_key", {"key_type":"mnemonic"})
			keys['seed'] = response['result']['key']
			
			return keys
			
		def get_height(self):
			return self.post("get_height")
			
		def get_address_index(self, address):
			response = self.post("get_address_index", {"address": address})
			if 'index' in response['result']:
				return response['result']['index']['major']
			return False
			
		def create_account(self):
			response = self.post("create_account")
			if 'address' in response['result']:
				return response['result']['address']
			else:
				return False
	
	class Daemon():
		def __init__(self, url):
			self.url = url
			self.headers = {'Content-Type': 'application/json'}

		def post(self, method, params=None):
			if params is not None:
				data = json.dumps({"jsonrpc": "2.0", "id": "0", "method": method, "params": params})
			else:
				data = json.dumps({"jsonrpc": "2.0", "id": "0", "method": method})
			response = requests.post(self.url + '/json_rpc', data=data, headers=self.headers)
			return json.loads(response.text)
			
		def get_info(self):
			return self.post("get_info")
			
		def sync_info(self):
			return self.post("sync_info")
			
		def get_connections(self):
			return self.post("get_connections")
		
'''
    def json_rpc_modify_post(self, replacement_uri: str, to_text:bool, data=None):
        url = self.rpc_url.replace('json_rpc', replacement_uri)
        response = requests.post(
            url,
            headers=self.headers,
            data=data,
            auth=HTTPDigestAuth(self.user, self.password)
        )
        if to_text is False:
            return json.dumps(response.json(), indent=5)
        else:
            return response.text

    def get_block_count(self):
        return self.post_to_monerod_rpc("getblockcount")

    def get_block(self, block):
        if type(block) is str:
            params = {"height": block}
        if type(block) is int:
            params = {"height": block}
        return self.post_to_monerod_rpc("getblock", params)

    def on_getblockhash(self, block: int):
        return self.post_to_monerod_rpc("on_getblockhash", [block])

    def get_block_template(self, address: str, reserve_size: int):
        params = {"wallet_address": address, "reserve_size": reserve_size}
        return self.post_to_monerod_rpc("getblocktemplate", params)

    def get_last_block_header(self):
        return self.post_to_monerod_rpc("getlastblockheader")

    def get_block_header_by_height(self, block_num: int):
        params = {"height": block_num}
        return self.post_to_monerod_rpc("getblockheaderbyheight", params)

    def get_block_header_by_hash(self, hash: str):
        params = {"hash": hash}
        return self.post_to_monerod_rpc("getblockheaderbyhash", params)

    def get_connections(self):
        return self.post_to_monerod_rpc("get_connections")
'''
'''
    def get_hard_fork_info(self):
        return self.post_to_monerod_rpc("hard_fork_info")

    def get_fee_estimate(self):
        return self.post_to_monerod_rpc("get_fee_estimate")

    def submit_block(self, block_blob: str):
        data = r'{"jsonrpc": "2.0","id": "0", "method": "submitblock","params": ' + block_blob + '}'
        response = requests.post(self.rpc_url, headers=self.headers, data=data)
        return json.dumps(response.json())

#TODO look into this more
    def set_bans(self, list_ips, time):
        dict_ips = {}
        for ip in list_ips:
            dict_ips.update({"ip": ip, "ban": "true", "seconds": time})
        params = {"bans": dict_ips}
        return self.post_to_monerod_rpc("set_bans", params)

    def get_bans(self):
        return self.post_to_monerod_rpc("get_bans")

    def stop_daemon(self):
        return self.json_rpc_modify_post("stop_daemon", False)

    def get_transaction_pool(self):
        return self.json_rpc_modify_post("get_transaction_pool", True)

    def get_transactions(self, tx_hash=str):
        data = r'{"txs_hashes":["'+tx_hash+'"]}'
        url = self.rpc_url.replace('json_rpc', 'gettransactions')
        response = requests.post(url, headers=self.headers, data=data)
        return response.text

    def is_key_image_spent(self, key_images: list):
        keys = ""
        for key in key_images[:-1]:
            keys += '"' + key + '",'
        else:
            keys += '"' + key + '"'
        data = '{"key_images":['+keys+']}'
        url = self.rpc_url.replace('json_rpc', 'is_key_image_spent')
        response = requests.post(url, headers=self.headers, data=data)
        return response.text

    def send_draw_transaction(self, tx_hash=str, do_not_relay=bool):
        data = ''
        if do_not_relay is True:
            data = '{"tx_as_hex":'+tx_hash+', "do_not_relay":true}'
        else:
            data = '{"tx_as_hex":'+tx_hash+', "do_not_relay":false}'
        url = self.rpc_url.replace('json_rpc', 'sendrawtransaction')
        response = requests.post(url, headers=self.headers, data=data)
        return response.text

'''
	