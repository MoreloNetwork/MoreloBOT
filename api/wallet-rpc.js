import { spawn } from "node:child_process";
import path from "node:path";
import helper from "../core/helper.js";

async function isWalletRpcAvailable(url) {
	let response;
	try {
		response = await fetch(url + "/json_rpc", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: "morelobot", method: "get_version" }),
			signal: AbortSignal.timeout(2000)
		});
	} catch(ex) {
		if(ex.cause?.code === "ECONNREFUSED") {
			return false;
		}
		throw new Error("Cannot check wallet RPC at " + url + ": " + ex.message);
	}

	let body;
	try {
		body = await response.json();
	} catch {
		throw new Error("Port is occupied, but it is not a Morelo wallet RPC server: " + url);
	}
	if(!response.ok || body?.result?.version == null) {
		throw new Error("Port is occupied, but it is not a usable wallet RPC server: " + url);
	}
	return true;
}

async function ensureWalletOpen(wallet, walletName, walletPassword) {
	try {
		await wallet.getPrimaryAddress();
		return;
	} catch {
		await wallet.openWallet(walletName, walletPassword || "");
	}
}

function walletSettings(config, options = {}) {
	const url = config[options.urlKey || "walletURL"] || "";
	const portKey = options.portKey || "walletRpcPort";
	const defaultPort = options.defaultPort ?? 38304;
	const walletPath = options.walletPathKey ? config[options.walletPathKey] : "";
	const pathName = walletPath ? path.basename(String(walletPath)) : "";
	const pathDir = walletPath ? path.dirname(String(walletPath)) : "";
	const walletName = config[options.walletNameKey || "walletName"] || pathName || "tips";
	const walletPassword = config[options.walletPasswordKey || "walletPassword"] || "";
	const walletDir = config[options.walletDirKey || "walletsPath"] || (pathDir && pathDir !== "." ? pathDir : "wallets");
	const port = Number(config[portKey] ?? defaultPort);
	return { url, port, walletName, walletPassword, walletDir };
}

function startWalletRpcProcess(binary, args, url, onProcess) {
	const child = spawn(binary, args, {
		env: { ...process.env, LANG: "en_US.UTF-8" }
	});
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	let output = "";
	child.stdout.on("data", data => {
		output = (output + data).slice(-8000);
	});
	child.stderr.on("data", data => {
		output = (output + data).slice(-8000);
	});
	onProcess(child);

	return new Promise((resolve, reject) => {
		let settled = false;
		let pollTimer;
		const timeout = setTimeout(() => finish(new Error(
			"Timed out waiting for wallet RPC at " + url + (output ? ":\n" + output.trim() : "")
		)), 30000);
		const finish = (error) => {
			if(settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			clearTimeout(pollTimer);
			child.removeListener("error", onError);
			child.removeListener("exit", onExit);
			if(error) {
				reject(error);
			} else {
				resolve(child);
			}
		};
		const onError = error => finish(error);
		const onExit = (code, signal) => finish(new Error(
			"monero-wallet-rpc exited before becoming ready (" + (signal || code) + ")"
				+ (output ? ":\n" + output.trim() : "")
		));
		const poll = async () => {
			try {
				if(await isWalletRpcAvailable(url)) {
					finish();
					return;
				}
			} catch(ex) {
				if(ex.message.startsWith("Port is occupied")) {
					finish(ex);
					return;
				}
			}
			if(!settled) {
				pollTimer = setTimeout(poll, 250);
			}
		};
		child.once("error", onError);
		child.once("exit", onExit);
		poll();
	});
}

export async function connectWalletRpc(monero, config, binPath, execExt, onOwnedProcess = () => {}, options = {}) {
	let wallet, ownedProcess;
	const ownsProcess = () => ownedProcess !== undefined;
	const settings = walletSettings(config, options);
	try {
		if(settings.url) {
			wallet = await monero.connectToWalletRpc(settings.url);
			await wallet.getVersion();
		} else {
			const host = "127.0.0.1";
			const port = settings.port;
			if(!Number.isInteger(port) || port < 1 || port > 65535) {
				throw new Error((options.portKey || "walletRpcPort") + " must be an integer between 1 and 65535");
			}
			const url = "http://" + host + ":" + port;
			if(await isWalletRpcAvailable(url)) {
				helper.log("Using existing wallet RPC at %s", url);
				wallet = await monero.connectToWalletRpc(url);
				await wallet.getVersion();
			} else {
				helper.log("Starting wallet RPC at %s", url);
				const args = [
					"--daemon-address", config.daemonURL || "http://localhost:38302",
					"--rpc-bind-ip", host,
					"--rpc-bind-port", String(port),
					"--wallet-dir", settings.walletDir
				];
				args.push("--disable-rpc-login");
				ownedProcess = await startWalletRpcProcess(
					binPath + "morelo-wallet-rpc" + execExt,
					args, url, onOwnedProcess
				);
				wallet = await monero.connectToWalletRpc(url);
				await wallet.getVersion();
			}
		}

		await ensureWalletOpen(wallet, settings.walletName, settings.walletPassword);
		return { wallet, ownsProcess: ownsProcess(), process: ownedProcess };
	} catch(ex) {
		if(ownedProcess) {
			await stopOwnedWalletRpc(wallet, true, ownedProcess).catch(stopError => {
				helper.err("Can't stop wallet RPC after startup failure:", stopError);
			});
		}
		throw ex;
	}
}

export async function stopOwnedWalletRpc(wallet, ownsProcess, child = wallet?.getProcess?.()) {
	if(!ownsProcess || !child || !child.pid || child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	await new Promise(resolve => {
		const finish = () => {
			clearTimeout(timeout);
			resolve();
		};
		child.once("exit", finish);
		const timeout = setTimeout(() => {
			if(child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL");
			}
			finish();
		}, 5000);
		child.kill("SIGTERM");
	});
}
