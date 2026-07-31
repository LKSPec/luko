// SPDX-License-Identifier: MIT
//
// LUKO — Genesis deployment
// Initial supply: 1,000,000 LUKO, fixed forever
// Network: Base
//
// Created as the genesis of the LUKO ecosystem.
// No further minting. No owner privileges.
//
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract LUKO is ERC20 {
    uint256 public constant INITIAL_SUPPLY = 1_000_000 ether;

    constructor() ERC20("LUKO", "LUKO") {
        _mint(msg.sender, INITIAL_SUPPLY);
    }
}
