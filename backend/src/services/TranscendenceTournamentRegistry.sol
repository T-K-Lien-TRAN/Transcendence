// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title TranscendenceTournamentRegistry
 * Tournoi créé dans le cadre du projet Transcendence de thitran, cldias et ayarmaya
 * utilise uniquement les Events comme journal.
 */
contract TranscendenceTournamentRegistry {

    address public authorizedBackend;
    address public owner;

    event TournamentRegistered(
        uint256 indexed timestamp,
        string name,
        string winnerName,
        uint256 participants
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Owner required");
        _;
    }

    modifier onlyAuthorizedBackend() {
        require(msg.sender == authorizedBackend, "Backend required");
        _;
    }

    constructor(address _authorizedBackend) {
        require(_authorizedBackend != address(0), "Invalid address");
        owner = msg.sender;
        authorizedBackend = _authorizedBackend;
    }

    /**
     * @dev Enregistre un tournoi via un Event.
     */
    function registerTournament(
        uint256 _timestamp,
        string calldata _name,
        string calldata _winnerName,
        uint256 _participants
    ) external onlyAuthorizedBackend {
        // Validation
        require(_timestamp > 0, "Invalid timestamp");
        require(_participants > 0, "Invalid participants");

        // On émet l'événement. 
        emit TournamentRegistered(_timestamp, _name, _winnerName, _participants);
    }

    function updateAuthorizedBackend(address _newBackend) external onlyOwner {
        require(_newBackend != address(0), "Invalid address");
        authorizedBackend = _newBackend;
    }
}