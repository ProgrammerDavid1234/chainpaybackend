const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("WalletRegistry", function () {
  let WalletRegistry, registry;
  let owner, addr1, addr2, addr3, addr4;

  beforeEach(async function () {
    [owner, addr1, addr2, addr3, addr4] = await ethers.getSigners();
    WalletRegistry = await ethers.getContractFactory("WalletRegistry");
    registry = await WalletRegistry.deploy();
    await registry.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should deploy with empty registrations", async function () {
      expect(await registry.isRegistered(owner.address)).to.equal(false);
    });
  });

  describe("registerWallet", function () {
    it("Should register a wallet and emit WalletRegistered", async function () {
      const hashedUserId = ethers.keccak256(ethers.toUtf8Bytes("user-1"));

      const tx = await registry.connect(addr1).registerWallet(hashedUserId);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(registry, "WalletRegistered")
        .withArgs(addr1.address, hashedUserId, block.timestamp);

      expect(await registry.isRegistered(addr1.address)).to.equal(true);
      expect(await registry.hashedUserIds(addr1.address)).to.equal(hashedUserId);
    });

    it("Should store the hashedUserId correctly", async function () {
      const hashedUserId = ethers.keccak256(ethers.toUtf8Bytes("my-user-id-123"));
      await registry.connect(addr1).registerWallet(hashedUserId);

      expect(await registry.hashedUserIds(addr1.address)).to.equal(hashedUserId);
    });

    it("Should prevent re-registration of the same wallet", async function () {
      const hashedUserId = ethers.keccak256(ethers.toUtf8Bytes("user-1"));
      await registry.connect(addr1).registerWallet(hashedUserId);

      await expect(
        registry.connect(addr1).registerWallet(hashedUserId)
      ).to.be.revertedWith("Wallet already registered");
    });

    it("Should allow different wallets to register", async function () {
      const hashedUserId1 = ethers.keccak256(ethers.toUtf8Bytes("user-1"));
      const hashedUserId2 = ethers.keccak256(ethers.toUtf8Bytes("user-2"));

      await registry.connect(addr1).registerWallet(hashedUserId1);
      await registry.connect(addr2).registerWallet(hashedUserId2);

      expect(await registry.isRegistered(addr1.address)).to.equal(true);
      expect(await registry.isRegistered(addr2.address)).to.equal(true);
    });

    it("Should reject registration with zero hashedUserId", async function () {
      await expect(
        registry.connect(addr1).registerWallet(ethers.ZeroHash)
      ).to.be.revertedWith("Invalid hashed user ID");
    });

    it("Should allow the owner to register as well", async function () {
      const hashedUserId = ethers.keccak256(ethers.toUtf8Bytes("owner-user"));
      await registry.connect(owner).registerWallet(hashedUserId);

      expect(await registry.isRegistered(owner.address)).to.equal(true);
    });

    it("Should keep registrations independent between wallets", async function () {
      const hashedUserId1 = ethers.keccak256(ethers.toUtf8Bytes("user-1"));
      const hashedUserId2 = ethers.keccak256(ethers.toUtf8Bytes("user-2"));
      const hashedUserId3 = ethers.keccak256(ethers.toUtf8Bytes("user-3"));

      await registry.connect(addr1).registerWallet(hashedUserId1);
      await registry.connect(addr2).registerWallet(hashedUserId2);
      await registry.connect(addr3).registerWallet(hashedUserId3);

      expect(await registry.hashedUserIds(addr1.address)).to.equal(hashedUserId1);
      expect(await registry.hashedUserIds(addr2.address)).to.equal(hashedUserId2);
      expect(await registry.hashedUserIds(addr3.address)).to.equal(hashedUserId3);

      // addr4 is unregistered
      expect(await registry.isRegistered(addr4.address)).to.equal(false);
    });
  });
});
