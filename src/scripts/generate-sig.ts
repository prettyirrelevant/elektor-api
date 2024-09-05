import { ethers } from "ethers";

async function signMessage() {
  const privateKey = process.env.PRIVATE_KEY!;
  const wallet = new ethers.Wallet(privateKey);
  const message = "Welcome to Elektor! Please sign this message to continue";

  console.log("Wallet address:", wallet.address);
  console.log("Message to sign:", message);

  try {
    const signature = await wallet.signMessage(message);
    console.log("Signature:", signature);

    const recoveredAddress = ethers.verifyMessage(message, signature);
    console.log("Recovered address:", recoveredAddress);

    if (recoveredAddress === wallet.address) {
      console.log("Signature is valid!");
    } else {
      console.log("Signature is invalid!");
    }
  } catch (error) {
    console.error("Error signing message:", error);
  }
}

signMessage();
