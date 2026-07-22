import { 
  generateMnemonic, 
  validateMnemonic, 
  createWalletFromMnemonic, 
  createWalletFromPath, 
  seedFromMnemonic,
  createHDWallet,
  hdWallet as createHDWalletAlias,
  newMnemonic,
  isValidMnemonic,
  fromMnemonic,
  fromPath,
  sikkaToChillar,
  chillarToSikka,
  toSikka,
  toChillar,
  SikkaClient 
} from './src/index.js';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("========================================");
  console.log("Sikka SDK Wallet & Integration Tests");
  console.log("========================================");

  // ----------------------------------------------------
  // 1. Mnemonic Generation & Validation Tests
  // ----------------------------------------------------
  console.log("\n1. Testing 24-Word BIP-39 Mnemonic Generation & Aliases...");
  const generatedMnemonic = newMnemonic(256);
  console.log("   Generated 24-Word Mnemonic:", generatedMnemonic);
  
  const isValid = isValidMnemonic(generatedMnemonic);
  console.log("   Validation Result:", isValid ? "PASSED (Valid)" : "FAILED (Invalid)");
  if (!isValid) throw new Error("Generated mnemonic failed validation!");

  // ----------------------------------------------------
  // 2. Unit Conversion Tests (Sikka <-> Chillar)
  // ----------------------------------------------------
  console.log("\n2. Testing Unit Conversions & Aliases (Sikka <-> Chillar)...");
  if (toChillar("1") !== 10_000_000_000n) throw new Error("toChillar('1') failed");
  if (toChillar("1.5") !== 15_000_000_000n) throw new Error("toChillar('1.5') failed");
  if (toChillar("0.0000000001") !== 1n) throw new Error("toChillar('0.0000000001') failed");
  
  if (toSikka(10_000_000_000n) !== "1") throw new Error("toSikka(10000000000n) failed");
  if (toSikka(15_000_000_000n) !== "1.5") throw new Error("toSikka(15000000000n) failed");
  if (toSikka(1n) !== "0.0000000001") throw new Error("toSikka(1n) failed");
  if (toSikka(0n) !== "0") throw new Error("toSikka(0n) failed");

  console.log("   1 Sikka        = ", toChillar("1").toString(), "chillar");
  console.log("   1.5 Sikka      = ", toChillar("1.5").toString(), "chillar");
  console.log("   1 chillar      = ", toSikka(1n), "Sikka");
  console.log("   Unit Conversions: PASSED ✓");

  // ----------------------------------------------------
  // 3. Golden Vector Verification (Sikka Go Node Spec)
  // ----------------------------------------------------
  console.log("\n3. Testing Golden Vector Derivation (Matching Go Node)...");
  
  const vector1 = {
    mnemonic: "gloom ice air over evolve predict bicycle column route minor donor welcome elephant produce lounge boss skirt often snap neutral sick sauce kangaroo poet",
    passphrase: "",
    expectedAddress: "sikka1p4ktc4mcwzekfauhw2eeqfx5edeffaqtmcv3qaautjkrh55slgrmswvkjvf"
  };

  const wallet1 = await fromMnemonic(vector1.mnemonic, vector1.passphrase);
  console.log("   Vector 1 Address Derived:", wallet1.address);
  console.log("   Vector 1 Expected Address:", vector1.expectedAddress);
  if (wallet1.address !== vector1.expectedAddress) {
    throw new Error(`Vector 1 Address Mismatch! Got ${wallet1.address}, expected ${vector1.expectedAddress}`);
  }
  console.log("   Vector 1: PASSED ✓");

  const vector2 = {
    mnemonic: "spike flush torch clown execute purpose valid online prevent melody once exchange token uncover enhance step clog cross smooth split dinosaur funny enemy follow",
    passphrase: "test-passphrase-123",
    expectedAddress: "sikka1par3yv7w5fqjyx897ucud97yhc5aalgtanjrpsg68rltqtnxhplls5w47fw"
  };

  const wallet2 = await fromMnemonic(vector2.mnemonic, vector2.passphrase);
  console.log("   Vector 2 Address Derived:", wallet2.address);
  console.log("   Vector 2 Expected Address:", vector2.expectedAddress);
  if (wallet2.address !== vector2.expectedAddress) {
    throw new Error(`Vector 2 Address Mismatch! Got ${wallet2.address}, expected ${vector2.expectedAddress}`);
  }
  console.log("   Vector 2: PASSED ✓");

  // ----------------------------------------------------
  // 4. HD Child Path Derivation Tests
  // ----------------------------------------------------
  console.log("\n4. Testing HD Child Path Derivation...");
  const masterSeed = seedFromMnemonic(vector1.mnemonic, "");
  
  // External branch (0), Index 0
  const receive0 = await fromPath(masterSeed, 0, 0, 0);
  console.log("   HD Receive [0/0/0]:", receive0.address);

  // External branch (0), Index 1
  const receive1 = await fromPath(masterSeed, 0, 0, 1);
  console.log("   HD Receive [0/0/1]:", receive1.address);

  // Internal branch (1), Index 0
  const change0 = await fromPath(masterSeed, 0, 1, 0);
  console.log("   HD Change  [0/1/0]:", change0.address);

  if (receive0.address === receive1.address || receive0.address === change0.address) {
    throw new Error("HD Path derivation generated duplicate addresses for different paths!");
  }
  console.log("   HD Path Derivation: PASSED ✓");

  // ----------------------------------------------------
  // 5. SikkaHDWallet Manager Tests & Shorthands
  // ----------------------------------------------------
  console.log("\n5. Testing SikkaHDWallet Smart Manager & Shorthands...");
  const hdWallet = await createHDWalletAlias({ mnemonic: vector1.mnemonic, gapLimit: 2 });
  
  const hdReceive0 = await hdWallet.receiveAddress(0);
  const hdChange0  = await hdWallet.changeAddress(0);
  const nextUnused = await hdWallet.newAddress();
  const totalBal   = await hdWallet.balance();

  console.log("   HD Wallet Primary Receive Address:", hdReceive0);
  console.log("   HD Wallet Primary Change Address: ", hdChange0);
  console.log("   HD Wallet Next Unused Address:   ", nextUnused);
  console.log("   HD Wallet Total Balance:         ", toSikka(totalBal), "Sikka (", totalBal.toString(), "chillar)");

  if (hdReceive0 !== receive0.address) {
    throw new Error(`SikkaHDWallet Receive Address mismatch! Expected ${receive0.address}, got ${hdReceive0}`);
  }
  if (hdChange0 !== change0.address) {
    throw new Error(`SikkaHDWallet Change Address mismatch! Expected ${change0.address}, got ${hdChange0}`);
  }
  console.log("   SikkaHDWallet Manager & Shorthands: PASSED ✓");

  // ----------------------------------------------------
  // 6. Live Network Integration Test (Optional)
  // ----------------------------------------------------
  console.log("\n6. Initializing Network Integration Wallet...");
  const wallet = await fromMnemonic(generatedMnemonic);
  console.log("   Active Wallet Address:", wallet.address);
  console.log("   Active Public Key:    ", wallet.pubKeyHex);

  const client = new SikkaClient({ wallet });

  console.log("\n7. Checking balance...");
  let balance = 0;
  try {
    balance = await client.balance(wallet.address);
    console.log(`   Current balance: ${toSikka(balance)} Sikka (${balance} chillar)`);
  } catch (err) {
    console.log("   Balance check notice:", err.message);
  }

  if (balance > 0) {
    console.log("\n8. Funds detected! Sending funds back to self...");
    try {
      console.log(`   Sending ${toSikka(balance)} Sikka (${balance} chillar) to ${wallet.address}...`);
      const result = await client.send(balance, wallet.address);
      console.log("   Transaction ID:", result.txID);
      console.log("   Sent Amount:   ", result.sentAmount.toString());
    } catch (err) {
      console.error("   Failed to send transaction:", err.message);
    }
  } else {
    console.log("   (No funds present on active test wallet; ready for receiving Sikka)");
  }

  console.log("\n========================================");
  console.log("All Local & Cryptographic Tests PASSED!");
  console.log("========================================");
}

runTests().catch(console.error);
