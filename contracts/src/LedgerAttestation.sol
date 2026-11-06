// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title Immutable receipts for an off-chain double-entry ledger
/// @notice Records operator attestations, not payments or proof that an operator's ledger is truthful.
/// @dev Non-upgradeable; holds no funds, makes no external calls, and stores no account or memo data.
contract LedgerAttestation is AccessControlDefaultAdminRules, Pausable {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    struct Receipt {
        bytes32 commitment;
        uint64 blockNumber;
    }

    mapping(bytes32 transferKey => Receipt) public receipts;

    event TransferAnchored(bytes32 indexed transferKey, bytes32 indexed commitment);
    error InvalidReceipt();
    error ConflictingReceipt(bytes32 transferKey);
    error InvalidRoleHolder();

    constructor(address admin, address relayer, address pauser, uint48 adminDelay)
        AccessControlDefaultAdminRules(adminDelay, admin)
    {
        if (relayer == address(0) || pauser == address(0)) revert InvalidRoleHolder();
        _grantRole(RELAYER_ROLE, relayer);
        _grantRole(PAUSER_ROLE, pauser);
    }

    /// @notice A retry with identical data succeeds without rewriting history or emitting another event.
    function anchor(bytes32 transferKey, bytes32 commitment) external onlyRole(RELAYER_ROLE) whenNotPaused {
        if (transferKey == bytes32(0) || commitment == bytes32(0)) revert InvalidReceipt();
        Receipt memory previous = receipts[transferKey];
        if (previous.commitment != bytes32(0)) {
            if (previous.commitment != commitment) revert ConflictingReceipt(transferKey);
            return;
        }
        receipts[transferKey] = Receipt(commitment, uint64(block.number));
        emit TransferAnchored(transferKey, commitment);
    }

    /// @notice Incident responders can stop writes; only the delayed-admin authority can resume them.
    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
}
