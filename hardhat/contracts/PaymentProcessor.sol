// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PaymentProcessor is ReentrancyGuard {
    uint256 private _txIndex;

    event PaymentSent(
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 timestamp,
        uint256 txIndex
    );

    /// @notice Send ETH to a recipient.
    /// @param to The recipient address.
    function sendPayment(address to) external payable nonReentrant {
        require(to != address(0), "Invalid recipient");
        require(msg.value > 0,     "Must send ETH with payment");

        uint256 amount = msg.value;
        _txIndex += 1;
        uint256 timestamp = block.timestamp;
        uint256 txIdx     = _txIndex;

        (bool sent, ) = to.call{value: amount}("");
        require(sent, "ETH transfer failed");

        emit PaymentSent(
            msg.sender,
            to,
            amount,
            timestamp,
            txIdx
        );
    }

    /// @notice Returns the total number of payment events emitted.
    function getTxIndex() external view returns (uint256) {
        return _txIndex;
    }
}
