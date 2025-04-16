const axios = require('axios');
const ethers = require('ethers');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

const config = {
  siteKey: '0x4AAAAAABDerdTw43kK5pDL',
  siteUrl: 'https://faucet.testnet.riselabs.xyz/',
  claimUrl: 'https://faucet-api.riselabs.xyz/faucet/multi-request',
  rpcUrls: ['https://testnet.riselabs.xyz/'],
  chainId: 11155931,
  ethAmountToSend: '0.00098'
};

const headers = {
  'accept': '*/*',
  'accept-language': 'en-US,en;q=0.5',
  'content-type': 'application/json',
  'priority': 'u=1, i',
  'sec-ch-ua': '"Brave";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'sec-gpc': '1',
  'Referer': config.siteUrl,
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

const availableTokens = ['ETH', 'MOG', 'PEPE', 'RISE', 'USDC', 'USDT', 'WBTC'];
const walletsPath = path.join(__dirname, 'wallets.json');
const proxiesPath = path.join(__dirname, 'proxies.txt');

const emojis = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: '📝',
  money: '💰',
  key: '🔑',
  wait: '⏳',
  done: '🏁',
  captcha: '🤖',
  wallet: '👛',
  send: '📤',
  receive: '📥',
  loading: '🔄',
  network: '🌐',
  proxy: '🔒'
};

const colors = {
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function printMessage(type, message) {
  const emoji = emojis[type] || emojis.info;
  console.log(`${emoji} ${message}`);
}

function printSeparator() {
  console.log('─'.repeat(50));
}

function printHeader(text) {
  printSeparator();
  console.log(`${colors.cyan}${text.toUpperCase()}${colors.reset}`);
  printSeparator();
}

async function collectUserInputs() {
  const apiKey = await prompt2CaptchaApiKey();
  printMessage('success', 'API key received!');

  const tokens = await promptTokens();
  const recipientAddress = await promptRecipientAddress();
  printMessage('success', `Recipient: ${recipientAddress.slice(0, 8)}...${recipientAddress.slice(-6)}`);

  return new Promise((resolve) => {
    readline.question(`${emojis.wallet} Number of wallets to create and claim: `, (count) => {
      const walletCount = parseInt(count);
      if (isNaN(walletCount) || walletCount <= 0) {
        printMessage('error', 'Invalid number.');
        readline.close();
        return;
      }
      resolve({ apiKey, tokens, recipientAddress, walletCount });
    });
  });
}

async function prompt2CaptchaApiKey() {
  return new Promise((resolve) => {
    readline.question(`\n${emojis.key} 2Captcha API key: `, (apiKey) => {
      if (!apiKey || apiKey.trim() === '') {
        printMessage('error', 'API key cannot be empty!');
        return prompt2CaptchaApiKey().then(resolve);
      }
      resolve(apiKey.trim());
    });
  });
}

async function promptTokens() {
  return new Promise((resolve) => {
    printMessage('info', 'Available tokens: ' + availableTokens.join(', '));
    readline.question(`${emojis.money} Token number(s) to claim (e.g., 1,4): `, (input) => {
      const selectedTokens = input
        .split(',')
        .map(num => num.trim())
        .filter(num => {
          const index = parseInt(num) - 1;
          return !isNaN(index) && index >= 0 && index < availableTokens.length;
        })
        .map(num => availableTokens[parseInt(num) - 1]);

      if (selectedTokens.length === 0) {
        printMessage('warning', 'No valid tokens. Defaulting to RISE.');
        resolve(['RISE']);
      } else {
        printMessage('success', `Tokens: ${selectedTokens.join(', ')}`);
        resolve(selectedTokens);
      }
    });
  });
}

async function promptRecipientAddress() {
  return new Promise((resolve) => {
    readline.question(`${emojis.receive} Recipient address for ETH: `, (address) => {
      if (!ethers.utils.isAddress(address)) {
        printMessage('error', 'Invalid address.');
        return promptRecipientAddress().then(resolve);
      }
      resolve(address);
    });
  });
}

async function generateWallets(count) {
  const wallets = [];
  for (let i = 0; i < count; i++) {
    const wallet = ethers.Wallet.createRandom();
    wallets.push({
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic: wallet.mnemonic.phrase,
      claimStatus: 'pending',
      lastClaimAttempt: null,
      claimHistory: []
    });
    printMessage('wallet', `Generated wallet ${i + 1}/${count}: ${wallet.address.slice(0, 8)}...${wallet.address.slice(-6)}`);
  }
  return wallets;
}

async function saveWallets(wallets) {
  try {
    await fs.writeFile(walletsPath, JSON.stringify(wallets, null, 2));
  } catch (error) {
    printMessage('error', `Failed to save wallets: ${error.message}`);
  }
}

async function setup() {
  try {
    if (!(await fs.access(walletsPath).then(() => true).catch(() => false))) {
      await fs.writeFile(walletsPath, JSON.stringify([], null, 2));
    }
    if (!(await fs.access(proxiesPath).then(() => true).catch(() => false))) {
      await fs.writeFile(proxiesPath, '# Add proxies here\n');
    }
  } catch (error) {
    printMessage('error', `Setup error: ${error.message}`);
  }
}

function createAxiosInstance(proxy) {
  if (!proxy) return axios.create();
  let agent;
  let proxyProtocol = proxy.includes('://') ? proxy.split('://')[0].toLowerCase() : 'http';
  let proxyStr = proxy.includes('://') ? proxy : `http://${proxy}`;
  try {
    if (proxyProtocol === 'http' || proxyProtocol === 'https') {
      agent = new HttpsProxyAgent(proxyStr);
    } else if (proxyProtocol === 'socks4' || proxyProtocol === 'socks5') {
      agent = new SocksProxyAgent(proxyStr);
    } else {
      printMessage('error', `Unsupported proxy: ${proxyProtocol}`);
      return axios.create();
    }
    return axios.create({ httpsAgent: agent, httpAgent: agent, proxy: false });
  } catch (error) {
    printMessage('error', `Proxy error: ${error.message}`);
    return axios.create();
  }
}

async function loadProxies() {
  try {
    const data = await fs.readFile(proxiesPath, 'utf8');
    return data.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  } catch (error) {
    printMessage('warning', 'No proxies found. Proceeding without proxies.');
    return [];
  }
}

function getRandomProxy(proxies) {
  if (!proxies || proxies.length === 0) return null;
  return proxies[Math.floor(Math.random() * proxies.length)];
}

async function solveTurnstileCaptcha(axiosInstance, apiKey) {
  printMessage('captcha', 'Solving CAPTCHA...');
  try {
    const submitResponse = await axiosInstance.get('https://2captcha.com/in.php', {
      params: { key: apiKey, method: 'turnstile', sitekey: config.siteKey, pageurl: config.siteUrl, json: 1 }
    });
    if (submitResponse.data.status !== 1) {
      throw new Error(`CAPTCHA submission failed: ${submitResponse.data.request}`);
    }
    const taskId = submitResponse.data.request;
    let captchaToken = null;
    let attempts = 0;
    const maxAttempts = 30;
    while (attempts < maxAttempts) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 10000));
      const resultResponse = await axiosInstance.get('https://2captcha.com/res.php', {
        params: { key: apiKey, action: 'get', id: taskId, json: 1 }
      });
      if (resultResponse.data.status === 1) {
        captchaToken = resultResponse.data.request;
        printMessage('success', 'CAPTCHA solved!');
        break;
      } else if (resultResponse.data.request !== 'CAPCHA_NOT_READY') {
        throw new Error(`CAPTCHA failed: ${resultResponse.data.request}`);
      }
    }
    if (!captchaToken) throw new Error('CAPTCHA timeout');
    return captchaToken;
  } catch (error) {
    printMessage('error', `CAPTCHA error: ${error.message}`);
    throw error;
  }
}

async function claimFaucet(wallet, captchaToken, axiosInstance, tokens) {
  try {
    const payload = { address: wallet.address, turnstileToken: captchaToken, tokens };
    printMessage('send', `Claiming faucet for ${wallet.address.slice(0, 8)}...`);
    const response = await axiosInstance.post(config.claimUrl, payload, { headers });
    printMessage('success', `Claim successful for ${wallet.address.slice(0, 8)}...`);
    return { success: true, data: response.data, timestamp: new Date().toISOString() };
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
    printMessage('error', `Claim failed for ${wallet.address.slice(0, 8)}...: ${errorMessage}`);
    return { success: false, error: errorMessage, timestamp: new Date().toISOString() };
  }
}

function createProvider(rpcUrl) {
  const network = { name: "Rise Testnet", chainId: config.chainId };
  return new ethers.providers.JsonRpcProvider(rpcUrl, network);
}

async function sendEth(wallet, recipientAddress, maxRetries = 3) {
  let attempt = 0;
  let success = false;
  let result = {};
  while (attempt < maxRetries && !success) {
    attempt++;
    for (const rpcUrl of config.rpcUrls) {
      try {
        const provider = createProvider(rpcUrl);
        const signer = new ethers.Wallet(wallet.privateKey, provider);
        await provider.ready;
        const balance = await provider.getBalance(wallet.address);
        const amountWei = ethers.utils.parseEther(config.ethAmountToSend);
        const gasPrice = await provider.getGasPrice();
        const gasLimit = 21000;
        const gasCost = gasPrice.mul(gasLimit);
        const totalCost = amountWei.add(gasCost);
        if (balance.lt(totalCost)) {
          throw new Error(`Insufficient balance: ${ethers.utils.formatEther(balance)} ETH`);
        }
        const tx = { to: recipientAddress, value: amountWei, gasLimit, gasPrice };
        printMessage('send', `Sending ${config.ethAmountToSend} ETH from ${wallet.address.slice(0, 8)}...`);
        const txResponse = await signer.sendTransaction(tx);
        const receipt = await txResponse.wait();
        printMessage('success', `ETH sent in block ${receipt.blockNumber}`);
        success = true;
        result = { success: true, txHash: txResponse.hash, timestamp: new Date().toISOString() };
        break;
      } catch (error) {
        printMessage('error', `ETH send attempt ${attempt} failed: ${error.message}`);
        result = { success: false, error: `Attempt ${attempt}: ${error.message}`, timestamp: new Date().toISOString() };
      }
    }
    if (!success && attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 5000 + attempt * 2000));
    }
  }
  return result;
}

async function processWallet(wallet, proxy, tokens, recipientAddress, apiKey) {
  try {
    if (proxy) printMessage('proxy', `Using proxy: ${proxy}`);
    const axiosInstance = createAxiosInstance(proxy);
    const captchaToken = await solveTurnstileCaptcha(axiosInstance, apiKey);
    const claimResult = await claimFaucet(wallet, captchaToken, axiosInstance, tokens);
    wallet.lastClaimAttempt = new Date().toISOString();
    wallet.claimHistory.push(claimResult);
    if (claimResult.success) {
      wallet.claimStatus = 'claimed';
      if (tokens.includes('ETH')) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const sendResult = await sendEth(wallet, recipientAddress);
        wallet.claimHistory.push({
          success: sendResult.success,
          action: 'sendETH',
          txHash: sendResult.txHash,
          error: sendResult.error,
          timestamp: sendResult.timestamp
        });
        if (sendResult.success) {
          printMessage('success', `Sent ${config.ethAmountToSend} ETH from ${wallet.address.slice(0, 8)}...`);
        } else {
          printMessage('error', `ETH send failed for ${wallet.address.slice(0, 8)}...`);
          wallet.claimStatus = 'claimed_but_send_failed';
        }
      }
    } else {
      wallet.claimStatus = 'failed';
    }
    return claimResult.success;
  } catch (error) {
    printMessage('error', `Wallet ${wallet.address.slice(0, 8)}... error: ${error.message}`);
    wallet.lastClaimAttempt = new Date().toISOString();
    wallet.claimHistory.push({ success: false, error: error.message, timestamp: new Date().toISOString() });
    wallet.claimStatus = 'failed';
    return false;
  }
}

async function processWalletWithRetry(wallet, proxies, tokens, recipientAddress, apiKey, maxRetries = 3) {
  let attempt = 0;
  let success = false;
  while (attempt < maxRetries && !success) {
    attempt++;
    const proxy = getRandomProxy(proxies);
    printMessage('info', `Attempt ${attempt}/${maxRetries} for ${wallet.address.slice(0, 8)}...`);
    try {
      success = await processWallet(wallet, proxy, tokens, recipientAddress, apiKey);
      if (success) break;
    } catch (error) {
      printMessage('error', `Attempt ${attempt} failed: ${error.message}`);
    }
    if (!success && attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 5000 + attempt * 2000));
    }
  }
  return success;
}

async function main() {
  printHeader('Rise Labs Auto Claim Faucet - Airdrop Insiders');
  await setup();
  const { apiKey, tokens, recipientAddress, walletCount } = await collectUserInputs();
  printHeader('Processing Wallets');
  const wallets = await generateWallets(walletCount);
  const proxies = await loadProxies();
  printMessage('info', `Loaded ${proxies.length} proxies`);
  let successCount = 0;
  for (let i = 0; i < wallets.length; i++) {
    printMessage('info', `Processing wallet ${i + 1}/${wallets.length}`);
    const success = await processWalletWithRetry(wallets[i], proxies, tokens, recipientAddress, apiKey);
    if (success) successCount++;
    await saveWallets(wallets);
    if (i < wallets.length - 1) {
      const delaySeconds = 5 + Math.floor(Math.random() * 10);
      printMessage('wait', `Waiting ${delaySeconds}s...`);
      await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
    }
  }
  printSeparator();
  printMessage('done', `Total: ${wallets.length}, Success: ${successCount}, Failed: ${wallets.length - successCount}`);
  readline.close();
}

main().catch(error => {
  printMessage('error', `Error: ${error.message}`);
  readline.close();
});