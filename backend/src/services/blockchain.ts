import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const CONTRACT_ABI = [
  {
    "inputs": [
      { "internalType": "uint256", "name": "_timestamp", "type": "uint256" },
      { "internalType": "string", "name": "_name", "type": "string" },
      { "internalType": "string", "name": "_winnerName", "type": "string" },
      { "internalType": "uint256", "name": "_participants", "type": "uint256" }
    ],
    "name": "registerTournament",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "timestamp", "type": "uint256" },
      { "indexed": false, "internalType": "string", "name": "name", "type": "string" },
      { "indexed": false, "internalType": "string", "name": "winnerName", "type": "string" },
      { "indexed": false, "internalType": "uint256", "name": "participants", "type": "uint256" }
    ],
    "name": "TournamentRegistered",
    "type": "event"
  }
];

export class BlockchainService {
  private provider?: ethers.JsonRpcProvider;
  private wallet?: ethers.Wallet;
  private contract?: ethers.Contract;

  constructor() {
    const rpcUrl = process.env.BLOCKCHAIN_RPC_URL;
    const privateKey = process.env.BACKEND_WALLET_PRIVATE_KEY;
    const contractAddress = process.env.TOURNAMENT_CONTRACT_ADDRESS;

    if (!rpcUrl || !privateKey || !contractAddress) {
      console.error("❌ Blockchain config missing in .env");
      return;
    }

    const isPlaceholder = /private_key/i.test(privateKey);
    if (isPlaceholder) {
      console.warn("⚠️ BACKEND_WALLET_PRIVATE_KEY is a placeholder; blockchain disabled.");
      return;
    }

    try {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      this.wallet = new ethers.Wallet(privateKey, this.provider);
      this.contract = new ethers.Contract(contractAddress, CONTRACT_ABI, this.wallet);
      console.log(`✅ Blockchain initialization successful. Connected to contract at ${contractAddress}`);
    } catch (error) {
      console.error("❌ Blockchain initialization failed:", error);
    }
  }

  async recordTournament(name: string, winnerName: string, participantsCount: number) {
    try {
        if (!this.contract) throw new Error("Contract not initialized");

        console.log(`🔗 Blockchain: Recording tournament '${name}'...`);

        const timestamp = Math.floor(Date.now() / 1000);

        const tx = await this.contract.registerTournament(
            timestamp,
            name,
            winnerName,
            participantsCount
        );

        console.log(`⏳ Transaction sent: ${tx.hash}. Waiting for confirmation...\n`);
        
        const receipt = await tx.wait();

        console.log(`✅ Tournament recorded on blockchain! Block: ${receipt.blockNumber}\n`);

        const explorerUrl = `https://testnet.snowtrace.io/tx/${receipt.hash}?chainid=43113\n`;
        console.log(`🌍 View Transaction: ${explorerUrl}`);

        const contractAddr = process.env.TOURNAMENT_CONTRACT_ADDRESS;
        const contractUrl = `https://testnet.snowtrace.io/address/${contractAddr}/contract/43113/code\n`;
        console.log(`📜 View Contract:    ${contractUrl}`);
        
        return {
        success: true,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        explorerUrl: `https://testnet.snowtrace.io/tx/${receipt.hash}?chainid=43113`,
        contractUrl: `https://testnet.snowtrace.io/address/${contractAddr}/contract/43113/code`
        };

    } catch (error) {
        console.error("❌ Blockchain Error:", error);
    }
  }
}

export const blockchainService = new BlockchainService();
