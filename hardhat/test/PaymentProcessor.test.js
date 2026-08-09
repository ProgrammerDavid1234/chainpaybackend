const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PaymentProcessor", function () {
  let PaymentProcessor, payment;
  let owner, addr1, addr2, addr3;

  beforeEach(async function () {
    [owner, addr1, addr2, addr3] = await ethers.getSigners();
    PaymentProcessor = await ethers.getContractFactory("PaymentProcessor");
    payment = await PaymentProcessor.deploy();
    await payment.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should deploy and set initial txIndex to 0", async function () {
      expect(await payment.getTxIndex()).to.equal(0);
    });
  });

  describe("sendPayment", function () {
    it("Should send ETH to recipient and emit PaymentSent", async function () {
      const amount = ethers.parseEther("1.0");

      const receipt = await (await payment.connect(addr1).sendPayment(addr2.address, { value: amount })).wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      const filter = payment.filters.PaymentSent();
      const events = await payment.queryFilter(filter, receipt.blockNumber, receipt.blockNumber);
      const event = events[0];

      expect(event.args.from).to.equal(addr1.address);
      expect(event.args.to).to.equal(addr2.address);
      expect(event.args.amount).to.equal(amount);
      expect(event.args.txIndex).to.equal(1);
      expect(event.args.timestamp).to.equal(block.timestamp);

      // Verify balance changes
      expect(await ethers.provider.getBalance(addr1.address)).to.be.below(
        ethers.MaxUint256
      );
    });

    it("Should increment txIndex on each payment", async function () {
      const amount = ethers.parseEther("0.5");

      await payment.connect(addr1).sendPayment(addr2.address, { value: amount });
      expect(await payment.getTxIndex()).to.equal(1);

      await payment.connect(addr1).sendPayment(addr3.address, { value: amount });
      expect(await payment.getTxIndex()).to.equal(2);
    });

    it("Should prevent sending to address(0)", async function () {
      const amount = ethers.parseEther("1.0");
      await expect(
        payment.connect(addr1).sendPayment(ethers.ZeroAddress, { value: amount })
      ).to.be.revertedWith("Invalid recipient");
    });

    it("Should prevent sending with 0 ETH", async function () {
      await expect(
        payment.connect(addr1).sendPayment(addr2.address, { value: 0 })
      ).to.be.revertedWith("Must send ETH with payment");
    });

    it("Should handle multiple sequential payments without reentrancy issues", async function () {
      const amount = ethers.parseEther("0.1");
      for (let i = 0; i < 5; i++) {
        const txIndexBefore = await payment.getTxIndex();
        await payment.connect(addr1).sendPayment(addr2.address, { value: amount });
        const txIndexAfter = await payment.getTxIndex();
        expect(txIndexAfter).to.equal(txIndexBefore + 1n);
      }
    });

    it("Should handle multiple recipients correctly", async function () {
      const amount = ethers.parseEther("1.0");

      await payment.connect(addr1).sendPayment(addr2.address, { value: amount });
      await payment.connect(addr1).sendPayment(addr3.address, { value: amount });

      expect(await payment.getTxIndex()).to.equal(2);
    });

    it("Should preserve exact amount value in emitted event", async function () {
      const amount = ethers.parseEther("0.123456789");
      const tx = await payment.connect(addr1).sendPayment(addr2.address, { value: amount });
      const receipt = await tx.wait();

      const filter = payment.filters.PaymentSent();
      const events = await payment.queryFilter(filter, receipt.blockNumber, receipt.blockNumber);
      const event = events[0];

      expect(event.args.from).to.equal(addr1.address);
      expect(event.args.to).to.equal(addr2.address);
      expect(event.args.amount).to.equal(amount);
      expect(event.args.txIndex).to.equal(1);
    });

    it("Should accept payments from any address, not just owner", async function () {
      const amount = ethers.parseEther("1.0");
      await expect(
        payment.connect(addr3).sendPayment(owner.address, { value: amount })
      ).to.not.be.reverted;
    });
  });
});
