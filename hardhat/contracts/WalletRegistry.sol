// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract WalletRegistry {
    mapping(address => bytes32) public hashedUserIds;
    mapping(address => bool)     public isRegistered;

    event WalletRegistered(
        address indexed wallet,
        bytes32 indexed hashedUserId,
        uint256 timestamp
    );

    /// @notice Register a wallet with a hashed user identifier.
    /// @param hashedUserId A hash (e.g. keccak256 of the user ID) that ties the wallet to an off-chain user.
    function registerWallet(bytes32 hashedUserId) external {
        require(hashedUserId != bytes32(0), "Invalid hashed user ID");
        require(!isRegistered[msg.sender], "Wallet already registered");

        isRegistered[msg.sender]      = true;
        hashedUserIds[msg.sender]     = hashedUserId;

        emit WalletRegistered(
            msg.sender,
            hashedUserId,
            block.timestamp
        );
    }
}
