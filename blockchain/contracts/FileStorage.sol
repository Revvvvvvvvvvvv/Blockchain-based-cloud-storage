// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract FileStorage {
    struct FileMetadata {
        string fileId;
        address owner;
        string originalFilename;
        string salt;
        string uploadcareFileId;
        uint256 numChunks;
        uint256 timestamp;
    }

    mapping(string => FileMetadata) private files;
    mapping(address => string[]) private userFiles;

    event FileAdded(string fileId, address owner, uint256 timestamp);
    event FileAccessed(string fileId, address accessor);

    function addFile(
        string memory fileId,
        string memory originalFilename,
        string memory salt,
        string memory uploadcareFileId,
        uint256 numChunks
    ) public {
        require(files[fileId].owner == address(0), "File ID already exists");

        files[fileId] = FileMetadata({
            fileId: fileId,
            owner: msg.sender,
            originalFilename: originalFilename,
            salt: salt,
            uploadcareFileId: uploadcareFileId,
            numChunks: numChunks,
            timestamp: block.timestamp
        });

        userFiles[msg.sender].push(fileId);
        emit FileAdded(fileId, msg.sender, block.timestamp);
    }

    function getFile(string memory fileId) public returns (FileMetadata memory) {
        require(files[fileId].owner != address(0), "File not found");
        emit FileAccessed(fileId, msg.sender);
        return files[fileId];
    }

    function getUserFiles() public view returns (string[] memory) {
        return userFiles[msg.sender];
    }
}