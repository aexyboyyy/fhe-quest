// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {FHE, euint32, ebool, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title TreasureHuntGame
 * @dev FHE ile şifrelenmiş koordinatlar kullanarak hazine avı oyunu
 * @notice Bu kontrat tamamen FHE gizliliğine uygun olarak tasarlanmıştır
 */
contract TreasureHuntGame is SepoliaConfig {
    // Owner (kontratı deploy eden kişi)
    address public immutable owner;
    
    // Oyun yapısı
    struct Game {
        uint256 id;
        address creator; // Oyunu oluşturan kişi (owner değil)
        uint256 treasureAmount; // ETH cinsinden ödül miktarı
        uint256 duration; // Oyun süresi (saniye)
        uint256 startTime;
        bool isActive;
        bool isCompleted;
        address winner;
        euint32 encryptedTreasureX; // FHE ile şifrelenmiş hazine X koordinatı
        euint32 encryptedTreasureY; // FHE ile şifrelenmiş hazine Y koordinatı
        uint256 totalAttempts; // Toplam deneme sayısı
        uint256 totalRevenue; // Toplam gelir
    }

    // Oyuncu yapısı - sadece yanlış deneme sayısı tutulur
    struct PlayerStats {
        uint256 wrongAttempts; // Sadece yanlış deneme sayısı
    }

    // State variables
    Game public currentGame;
    mapping(address => PlayerStats) public players;
    
    uint256 public gameCounter = 0;
    uint256 public constant GRID_SIZE = 10; // 10x10 grid
    uint256 public constant ATTEMPT_FEE_PERCENTAGE = 2; // %2 maliyet
    
    // Oracle decryption state
    mapping(uint256 => address) public pendingDecryptions; // requestId => player
    bool public isDecryptionPending = false;
    uint256 public latestRequestId;
    
    // Events
    event GameCreated(uint256 indexed gameId, address indexed creator, uint256 treasureAmount, uint256 duration);
    event TreasureFound(uint256 indexed gameId, address indexed winner, uint256 x, uint256 y, uint256 amount);
    event GameCompleted(uint256 indexed gameId, address indexed winner, uint256 totalRevenue);
    event AttemptMade(uint256 indexed gameId, address indexed player, bool isCorrect);
    event WrongAttemptRecorded(address indexed player, uint256 wrongAttempts);
    event DecryptionRequested(uint256 indexed requestId, address indexed player, uint256 coordHash);
    event DecryptionCompleted(uint256 indexed requestId, address indexed player, bool isCorrect);

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can perform this action");
        _;
    }
    
    modifier onlyCreator() {
        require(msg.sender == currentGame.creator, "Only creator can perform this action");
        _;
    }

    modifier onlyActiveGame() {
        require(currentGame.isActive && !currentGame.isCompleted, "No active game");
        _;
    }


    modifier noPendingDecryption() {
        require(!isDecryptionPending, "Decryption is in progress");
        _;
    }

    // Constructor
    constructor() {
        owner = msg.sender;
        // İlk oyunu oluştur (boş oyun)
        _createInitialGame();
    }

    // İlk oyunu oluştur (boş oyun)
    function _createInitialGame() internal {
        currentGame = Game({
            id: 0,
            creator: address(0),
            treasureAmount: 0,
            duration: 0,
            startTime: 0,
            isActive: false,
            isCompleted: false,
            winner: address(0),
            encryptedTreasureX: FHE.asEuint32(0),
            encryptedTreasureY: FHE.asEuint32(0),
            totalAttempts: 0,
            totalRevenue: 0
        });
    }

    /**
     * @dev Creator oyun oluşturur ve FHE ile koordinatları şifreler
     * @param _treasureAmount Ödül miktarı (ETH)
     * @param _duration Oyun süresi (saniye)
     * @param _encryptedX FHE ile şifrelenmiş hazine X koordinatı
     * @param _encryptedY FHE ile şifrelenmiş hazine Y koordinatı
     * @param _inputProofX X koordinatı için input proof
     * @param _inputProofY Y koordinatı için input proof
     */
    function createGame(
        uint256 _treasureAmount,
        uint256 _duration,
        externalEuint32 _encryptedX,
        externalEuint32 _encryptedY,
        bytes calldata _inputProofX,
        bytes calldata _inputProofY
    ) external payable {
        require(msg.value >= _treasureAmount, "Insufficient ETH for treasure");
        require(_treasureAmount > 0, "Treasure amount must be positive");
        require(_duration > 0, "Duration must be positive");
        require(!currentGame.isActive || currentGame.isCompleted, "Previous game still active");
        require(!isDecryptionPending, "Decryption is in progress");

        gameCounter++;
        
        // FHE ile şifreli koordinatları çöz
        euint32 encryptedX = FHE.fromExternal(_encryptedX, _inputProofX);
        euint32 encryptedY = FHE.fromExternal(_encryptedY, _inputProofY);

        // Yeni oyun oluştur
        currentGame = Game({
            id: gameCounter,
            creator: msg.sender, // Oyunu oluşturan kişi creator olur
            treasureAmount: _treasureAmount,
            duration: _duration,
            startTime: block.timestamp,
            isActive: true,
            isCompleted: false,
            winner: address(0),
            encryptedTreasureX: encryptedX,
            encryptedTreasureY: encryptedY,
            totalAttempts: 0,
            totalRevenue: 0
        });

        // FHE ACL ayarla - sadece creator ve kontrat erişebilir
        FHE.allowThis(currentGame.encryptedTreasureX);
        FHE.allowThis(currentGame.encryptedTreasureY);
        FHE.allow(currentGame.encryptedTreasureX, msg.sender);
        FHE.allow(currentGame.encryptedTreasureY, msg.sender);

        emit GameCreated(gameCounter, msg.sender, _treasureAmount, _duration);
    }

    /**
     * @dev Oyuncu FHE ile şifrelenmiş koordinatlarla hazine arar
     * @param _encryptedX Oyuncunun seçtiği FHE ile şifrelenmiş X koordinatı
     * @param _encryptedY Oyuncunun seçtiği FHE ile şifrelenmiş Y koordinatı
     * @param _inputProofX X koordinatı için input proof
     * @param _inputProofY Y koordinatı için input proof
     */
    function searchTreasure(
        externalEuint32 _encryptedX,
        externalEuint32 _encryptedY,
        bytes calldata _inputProofX,
        bytes calldata _inputProofY
    ) external payable onlyActiveGame noPendingDecryption {
        require(block.timestamp < currentGame.startTime + currentGame.duration, "Game time expired");
        
        // FHE ile şifreli koordinatları çöz
        euint32 searchX = FHE.fromExternal(_encryptedX, _inputProofX);
        euint32 searchY = FHE.fromExternal(_encryptedY, _inputProofY);

        // Deneme ücretini hesapla
        uint256 attemptFee = (currentGame.treasureAmount * ATTEMPT_FEE_PERCENTAGE) / 100;
        require(msg.value >= attemptFee, "Insufficient ETH for attempt");

        // Oyuncu bilgilerini güncelle
        if (players[msg.sender].wrongAttempts == 0) {
            players[msg.sender] = PlayerStats({wrongAttempts: 0});
        }

        // Deneme sayısını artır
        currentGame.totalAttempts++;
        currentGame.totalRevenue += attemptFee;

        // FHE ile hazine koordinatlarını karşılaştır
        ebool isCorrectX = FHE.eq(searchX, currentGame.encryptedTreasureX);
        ebool isCorrectY = FHE.eq(searchY, currentGame.encryptedTreasureY);
        ebool isCorrect = FHE.and(isCorrectX, isCorrectY);

        // Oracle ile decryption isteği gönder
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(isCorrect);
        
        uint256 requestId = FHE.requestDecryption(cts, this.decryptionCallback.selector);
        
        // Pending state'i güncelle
        isDecryptionPending = true;
        latestRequestId = requestId;
        pendingDecryptions[requestId] = msg.sender;
        
        emit DecryptionRequested(requestId, msg.sender, 0);
    }

    /**
     * @dev Oracle decryption callback - Zama FHEVM dokümantasyonuna uygun
     * @param requestId Decryption request ID
     * @param cleartexts Decrypted values
     * @param decryptionProof Decryption proof
     * @return success Decryption başarılı mı
     */
    function decryptionCallback(
        uint256 requestId, 
        bytes memory cleartexts, 
        bytes memory decryptionProof
    ) external returns (bool) {
        // Request ID kontrolü
        require(requestId == latestRequestId, "Invalid requestId");
        
        // Signature verification
        FHE.checkSignatures(requestId, cleartexts, decryptionProof);
        
        // Decrypted value'yu al
        (bool isCorrect) = abi.decode(cleartexts, (bool));
        
        // Pending state'i temizle
        isDecryptionPending = false;
        
        address player = pendingDecryptions[requestId];
        
        if (isCorrect) {
            // Hazine bulundu!
            currentGame.isActive = false;
            currentGame.isCompleted = true;
            currentGame.winner = player;

            // Ödülü gönder
            payable(player).transfer(currentGame.treasureAmount);

            emit TreasureFound(currentGame.id, player, 0, 0, currentGame.treasureAmount);
            emit GameCompleted(currentGame.id, player, currentGame.totalRevenue);
        } else {
            // Yanlış koordinat - oyuncunun yanlış deneme sayısını artır
            players[player].wrongAttempts++;
            
            emit WrongAttemptRecorded(player, players[player].wrongAttempts);
        }
        
        emit DecryptionCompleted(requestId, player, isCorrect);
        emit AttemptMade(currentGame.id, player, isCorrect);
        
        // Pending mappings'i temizle
        delete pendingDecryptions[requestId];
        
        return isCorrect;
    }

    /**
     * @dev Creator oyunu sonlandırabilir
     */
    function endGame() external onlyCreator onlyActiveGame {
        currentGame.isActive = false;
        currentGame.isCompleted = true;
        
        // Kalan ETH'i creator'a geri gönder
        if (address(this).balance > 0) {
            payable(currentGame.creator).transfer(address(this).balance);
        }
    }

    /**
     * @dev Emergency function - sadece owner
     */
    function emergencyWithdraw() external onlyOwner {
        require(currentGame.isCompleted, "Game must be completed");
        payable(owner).transfer(address(this).balance);
    }

    // View functions

    /**
     * @dev Oyuncu istatistiklerini getir - sadece yanlış deneme sayısı
     * @param player Oyuncu adresi
     * @return wrongAttempts Yanlış deneme sayısı
     */
    function getPlayerStats(address player) external view returns (uint256 wrongAttempts) {
        return players[player].wrongAttempts;
    }

    /**
     * @dev Oyun istatistiklerini getir
     */
    function getGameStats() external view returns (
        uint256 id,
        address creator,
        uint256 treasureAmount,
        uint256 duration,
        uint256 startTime,
        bool isActive,
        bool isCompleted,
        address winner,
        uint256 totalAttempts,
        uint256 totalRevenue
    ) {
        return (
            currentGame.id,
            currentGame.creator,
            currentGame.treasureAmount,
            currentGame.duration,
            currentGame.startTime,
            currentGame.isActive,
            currentGame.isCompleted,
            currentGame.winner,
            currentGame.totalAttempts,
            currentGame.totalRevenue
        );
    }

    /**
     * @dev Oyunun kalan süresini getir
     */
    function getRemainingTime() external view returns (uint256) {
        if (!currentGame.isActive || currentGame.isCompleted) {
            return 0;
        }
        
        uint256 endTime = currentGame.startTime + currentGame.duration;
        if (block.timestamp >= endTime) {
            return 0;
        }
        
        return endTime - block.timestamp;
    }

    /**
     * @dev Deneme ücreti hesapla
     */
    function getAttemptFee() external view returns (uint256) {
        return (currentGame.treasureAmount * ATTEMPT_FEE_PERCENTAGE) / 100;
    }

    /**
     * @dev Decryption pending mi kontrol et
     */
    function getDecryptionPending() external view returns (bool) {
        return isDecryptionPending;
    }

    /**
     * @dev Grid boyutunu getir
     */
    function getGridSize() external pure returns (uint256) {
        return GRID_SIZE;
    }

    /**
     * @dev Attempt fee yüzdesini getir
     */
    function getAttemptFeePercentage() external pure returns (uint256) {
        return ATTEMPT_FEE_PERCENTAGE;
    }
}
