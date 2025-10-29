import './polyfills';
import React, { useState, useEffect } from "react";
import { BrowserProvider, Contract, parseEther, JsonRpcProvider, ethers } from "ethers";
import './App.css';
import { contractABI, CONTRACT_ADDRESS as CONTRACT_ADDRESS_IMPORT } from "./contract.js";

// CDN'den yüklenen relayer SDK'yı kullan
const getRelayerSDK = () => {
  if (typeof window !== 'undefined' && window.relayerSDK) {
    return window.relayerSDK;
  }
  throw new Error('Relayer SDK not loaded from CDN');
}; 


// Contract ABI - Treasure Hunt için güncellenecek
const CONTRACT_ABI = contractABI;

const CONTRACT_ADDRESS = CONTRACT_ADDRESS_IMPORT; // Imported from contract.js
const SEPOLIA_CHAIN_ID = "0xaa36a7"; // 11155111 hex
const SEPOLIA_CONFIG = {
  chainId: SEPOLIA_CHAIN_ID,
  chainName: "Sepolia Test Network",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: [
    "https://rpc.sepolia.org",
    "https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
    "https://ethereum-sepolia.publicnode.com",
    "https://sepolia.gateway.tenderly.co"
  ],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

function App() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [relayerInstance, setRelayerInstance] = useState(null);
  const [account, setAccount] = useState(null);
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(false);
  const [status, setStatus] = useState("");
  // Yeni oyun mantığı state'leri
  const [selectedX, setSelectedX] = useState(null);
  const [selectedY, setSelectedY] = useState(null);
  const [gameGrid, setGameGrid] = useState(Array(10).fill().map(() => Array(10).fill(false)));
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isGameActive, setIsGameActive] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [encryptionStep, setEncryptionStep] = useState('');
  const [searchStep, setSearchStep] = useState('');
  const [isProcessingResult, setIsProcessingResult] = useState(false);
  const [resultStep, setResultStep] = useState('');
  const [showResultAnimation, setShowResultAnimation] = useState(false);
  const [resultType, setResultType] = useState(''); // 'success' or 'error'
  const [resultMessage, setResultMessage] = useState('');
  
  
  // Oyun bilgileri
  const [gameStats, setGameStats] = useState(null);
  const [playerStats, setPlayerStats] = useState({ attempts: 0, wrongAttempts: 0 });
  const [attemptFee, setAttemptFee] = useState(0);
  
  // Creator için
  const [treasureAmount, setTreasureAmount] = useState("0.01");
  const [gameDuration, setGameDuration] = useState(3600); // 1 saat
  const [encryptedX, setEncryptedX] = useState(null);
  const [encryptedY, setEncryptedY] = useState(null);

  // Oyun bilgilerini çek
  const fetchGameStats = async () => {
    if (!contract) return;
    
    try {
      const stats = await contract.getGameStats();
      setGameStats({
        id: stats[0].toString(),
        creator: stats[1],
        treasureAmount: stats[2].toString(),
        duration: stats[3].toString(),
        startTime: stats[4].toString(),
        isActive: stats[5],
        isCompleted: stats[6],
        winner: stats[7],
        totalAttempts: stats[8].toString(),
        totalRevenue: stats[9].toString()
      });
      
      setIsGameActive(stats[5] && !stats[6]);
      // isCreator kontrolünü owner ile yap
      await checkIsCreator();
      
      // Kalan süreyi hesapla
      if (stats[5] && !stats[6]) {
        const now = Math.floor(Date.now() / 1000);
        const endTime = parseInt(stats[4]) + parseInt(stats[3]);
        const remaining = Math.max(0, endTime - now);
        setTimeRemaining(remaining);
      }
    } catch (error) {
      console.error('Error fetching game stats:', error);
    }
  };

  // Oyuncu istatistiklerini çek
  const fetchPlayerStats = async () => {
    if (!contract || !account) return;
    
    try {
      const wrongAttempts = await contract.getPlayerStats(account);
      setPlayerStats({
        attempts: "0", // Bu bilgi artık kontratta yok
        wrongAttempts: wrongAttempts.toString()
      });
    } catch (error) {
      console.error('Error fetching player stats:', error);
    }
  };

  // Deneme ücretini çek
  const fetchAttemptFee = async () => {
    if (!contract) return;
    
    try {
      const fee = await contract.getAttemptFee();
      setAttemptFee(fee.toString());
    } catch (error) {
      console.error('Error fetching attempt fee:', error);
    }
  };

  // Yanlış koordinat kontrolü - Bu fonksiyon artık kontratta yok
  // Frontend'de kendi tracking'imizi yapacağız

  // Owner kontrolü
  const checkIsCreator = async () => {
    if (!contract || !account) return;
    
    try {
      const owner = await contract.owner();
      setIsCreator(account.toLowerCase() === owner.toLowerCase());
      console.log('Owner check:', { account, owner, isCreator: account.toLowerCase() === owner.toLowerCase() });
    } catch (error) {
      console.error('Error checking owner:', error);
      setIsCreator(false);
    }
  };

  const checkAndSwitchNetwork = async () => {
    try {
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (chainId !== SEPOLIA_CHAIN_ID) {
        try {
          await window.ethereum.request({ 
            method: 'wallet_switchEthereumChain', 
            params: [{ chainId: SEPOLIA_CHAIN_ID }] 
          });
        } catch (switchError) {
          if (switchError.code === 4902) {
            await window.ethereum.request({ 
              method: 'wallet_addEthereumChain', 
              params: [SEPOLIA_CONFIG] 
            });
          } else {
            throw switchError;
          }
        }
      }
      setIsCorrectNetwork(true);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  const connectWallet = async () => {
    if (!window.ethereum) return;
    
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const userAccount = accounts[0];
      setAccount(userAccount);

      const _provider = new BrowserProvider(window.ethereum);
      setProvider(_provider);
      const _signer = await _provider.getSigner();
      setSigner(_signer);

      const _contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, _signer);
      setContract(_contract);

      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      setIsCorrectNetwork(chainId === SEPOLIA_CHAIN_ID);
      
      // Fetch initial data
      await fetchGameStats();
      await fetchPlayerStats();
      await fetchAttemptFee();
      await checkIsCreator();
    } catch (err) {
      console.error(err);
    }
  };


  const initRelayer = async () => {
    if (!signer) {
      return;
    }
    
    try {
      // CDN'den SDK'yı al
      const relayerSDK = getRelayerSDK();
      
      // InitSDK fonksiyonunu kontrol et
      if (relayerSDK.initSDK && typeof relayerSDK.initSDK === 'function') {
        try {
          await relayerSDK.initSDK();
        } catch (initError) {
          console.log("Init SDK error:", initError);
        }
      }
      
      const config = {
        ...(relayerSDK.SepoliaConfig || {}),
        network: window.ethereum,
        signer
      };
      
      console.log("Creating instance with config:", config);
      const instance = await relayerSDK.createInstance(config);
      
      setRelayerInstance(instance);
      setStatus('Relayer initialized successfully');
      
      // 5 saniye sonra status mesajını kaldır
      setTimeout(() => {
        setStatus('');
      }, 5000);
    } catch (err) {
      console.error("Relayer init error:", err);
    }
  };

  const createEncryptedCoords = async (x, y) => {
    if (!relayerInstance || !signer) {
      throw new Error('Relayer instance and signer are required');
    }
    
    try {
      const userAddress = await signer.getAddress();
      
      const buffer = relayerInstance.createEncryptedInput(CONTRACT_ADDRESS, userAddress);
      
      buffer.add32(BigInt(x));
      buffer.add32(BigInt(y));
      
      const encryptedResult = await buffer.encrypt();
      
      const inputProof = encryptedResult.inputProof;
      
      let handle = encryptedResult.handles?.[0] || encryptedResult.data || encryptedResult;
      if (handle instanceof Uint8Array) {
        handle = '0x' + Array.from(handle)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      }
      
      return {
        handle,
        inputProof
      };
    } catch (err) {
      console.error("Encryption error:", err);
      throw new Error(`Encryption failed: ${err.message}`);
    }
  };

  // Oyuncu hazine arar
  const searchTreasure = async () => {
    if (!relayerInstance || !contract || !signer) {
      return;
    }
    
    if (!isGameActive) {
      return;
    }
    
    if (isSearching) {
      return;
    }
    
    // Decryption pending kontrolü
    try {
      const isPending = await contract.isDecryptionPending();
      if (isPending) {
        return;
      }
    } catch (error) {
      console.error('Error checking decryption status:', error);
    }
    
    try {
      setIsSearching(true);
      setSearchStep('Preparing search...');
      
      // Koordinatları şifrele (progress göster)
      setSearchStep('Encrypting coordinates...');
      const encryptedData = await encryptCoordinates(selectedX, selectedY, true);
      
      if (!encryptedData.handleX || !encryptedData.handleY || !encryptedData.inputProofX || !encryptedData.inputProofY) {
        throw new Error("Invalid encrypted data format");
      }
      
      // Deneme ücretini hesapla (attemptFee zaten wei cinsinden)
      const fee = attemptFee;
      
      // Debug: Oyun durumunu kontrol et
      console.log("Game Stats:", gameStats);
      console.log("Attempt Fee:", attemptFee);
      console.log("Encrypted Data:", encryptedData);
      console.log("Selected Coordinates:", { selectedX, selectedY });
      console.log("Is Decryption Pending:", await contract.isDecryptionPending());
      
      setSearchStep('Sending transaction to blockchain...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const tx = await contract.searchTreasure(
        encryptedData.handleX,
        encryptedData.handleY,
        encryptedData.inputProofX,
        encryptedData.inputProofY,
        {
          value: fee,
          gasLimit: 500000
        }
      );
      
      setSearchStep('Transaction confirmed, waiting for result...');
      const receipt = await tx.wait();
      
      if (receipt.status === 0) {
        throw new Error("Transaction failed - check contract requirements");
      }
      
      // Transaction onaylandıktan sonra callback aşamasına geç
      setIsSearching(false);
      setIsProcessingResult(true);
      setResultStep('Transaction confirmed! Waiting for oracle callback...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setResultStep('Oracle is processing encrypted coordinates...');
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      setResultStep('Decrypting and comparing coordinates...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
          setResultStep('Finalizing result...');
          await new Promise(resolve => setTimeout(resolve, 1000));

          
          // Fallback: Eğer event listener çalışmazsa 10 saniye sonra overlay'i kapat
          setTimeout(() => {
            if (isProcessingResult) {
              console.log('Fallback: Closing processing overlay after timeout');
              setIsProcessingResult(false);
              setResultStep('');
              
              // Fallback: Manuel olarak yanlış sonuç animasyonu göster
              console.log('Fallback: Showing error animation');
              setResultType('error');
              setResultMessage(`❌ No treasure at (${selectedX}, ${selectedY}). Try again!`);
              setShowResultAnimation(true);
              
              // Grid'i güncelle
              const newGrid = [...gameGrid];
              newGrid[selectedY][selectedX] = true;
              setGameGrid(newGrid);
              
              // 3 saniye sonra animasyonu kapat
              setTimeout(() => {
                setShowResultAnimation(false);
                setResultType('');
                setResultMessage('');
              }, 3000);
              
            }
          }, 10000);
      
      // Oyun bilgilerini yenile
      await fetchGameStats();
      await fetchPlayerStats();
      
      // Event listener'ları dinle - AttemptMade event'ini bekleyelim
      // Bu event yanlış deneme olduğunda tetiklenir
      
    } catch (err) {
      console.error("Search treasure error:", err);
      
      let errorMessage = err.reason || err.message;
      
      if (err.code === 'CALL_EXCEPTION') {
        errorMessage = "Contract call failed - check encrypted data format and contract compatibility";
      } else if (err.code === 'INSUFFICIENT_FUNDS') {
        errorMessage = "Insufficient ETH balance";
      } else if (err.message.includes('user rejected')) {
        errorMessage = "Transaction rejected by user";
      }
      
    } finally {
      setIsSearching(false);
      // isProcessingResult'i event listener'larda kapatacağız
      setSearchStep('');
      // resultStep'i event listener'larda kapatacağız
    }
  };

  // Creator oyun oluşturur
  const createGame = async () => {
    if (!relayerInstance || !contract || !signer) {
      return;
    }
    
    if (!encryptedX || !encryptedY) {
      return;
    }
    
    try {
      const tx = await contract.createGame(
        parseEther(treasureAmount),
        gameDuration,
        encryptedX.handle,
        encryptedY.handle,
        encryptedX.inputProof,
        encryptedY.inputProof,
        {
          value: parseEther(treasureAmount),
          gasLimit: 1000000
        }
      );
      
      const receipt = await tx.wait();
      
      if (receipt.status === 0) {
        throw new Error("Transaction failed - check contract requirements");
      }
      
      // Oyun bilgilerini yenile
      await fetchGameStats();
      
    } catch (err) {
      console.error("Create game error:", err);
      
      let errorMessage = err.reason || err.message;
      
      if (err.code === 'CALL_EXCEPTION') {
        errorMessage = "Contract call failed - check contract compatibility";
      } else if (err.code === 'INSUFFICIENT_FUNDS') {
        errorMessage = "Insufficient ETH balance";
      } else if (err.message.includes('user rejected')) {
        errorMessage = "Transaction rejected by user";
      }
      
    }
  };

  // Koordinatları şifrele (Creator için) - X ve Y ayrı ayrı
  const encryptCoordinates = async (x, y, showProgress = false) => {
    if (!relayerInstance) {
      throw new Error("Relayer not initialized");
    }
    
    try {
      if (showProgress) {
        setIsEncrypting(true);
        setEncryptionStep('Preparing encryption...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // X koordinatını şifrele
      if (showProgress) {
        setEncryptionStep(`Encrypting X coordinate (${x})...`);
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      const bufferX = relayerInstance.createEncryptedInput(CONTRACT_ADDRESS, account);
      bufferX.add32(BigInt(x));
      const encryptedX = await bufferX.encrypt();
      
      // Y koordinatını şifrele
      if (showProgress) {
        setEncryptionStep(`Encrypting Y coordinate (${y})...`);
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      const bufferY = relayerInstance.createEncryptedInput(CONTRACT_ADDRESS, account);
      bufferY.add32(BigInt(y));
      const encryptedY = await bufferY.encrypt();
      
      // Convert Uint8Array handles and proofs to hex strings
      let handleX = encryptedX.handles[0];
      let handleY = encryptedY.handles[0];
      let inputProofX = encryptedX.inputProof;
      let inputProofY = encryptedY.inputProof;
      
      if (handleX instanceof Uint8Array) {
        handleX = '0x' + Array.from(handleX)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      }
      
      if (handleY instanceof Uint8Array) {
        handleY = '0x' + Array.from(handleY)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      }
      
      if (inputProofX instanceof Uint8Array) {
        inputProofX = '0x' + Array.from(inputProofX)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      }
      
      if (inputProofY instanceof Uint8Array) {
        inputProofY = '0x' + Array.from(inputProofY)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      }
      
      if (showProgress) {
        setEncryptionStep('Finalizing encryption...');
        await new Promise(resolve => setTimeout(resolve, 200));
        setIsEncrypting(false);
        setEncryptionStep('');
      }
      
      return {
        handleX: handleX,
        inputProofX: inputProofX,
        handleY: handleY,
        inputProofY: inputProofY
      };
    } catch (error) {
      if (showProgress) {
        setIsEncrypting(false);
        setEncryptionStep('');
      }
      console.error('Coordinate encryption failed:', error);
      throw error;
    }
  };

  // User Decryption - Zama dokümantasyonuna göre
  const userDecrypt = async (ciphertextHandle) => {
    if (!relayerInstance || !signer) {
      throw new Error("Relayer or signer not initialized");
    }
    
    try {
      const keypair = relayerInstance.generateKeypair();
      const handleContractPairs = [
        {
          handle: ciphertextHandle,
          contractAddress: CONTRACT_ADDRESS,
        },
      ];
      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '10';
      const contractAddresses = [CONTRACT_ADDRESS];

      const eip712 = relayerInstance.createEIP712(
        keypair.publicKey,
        contractAddresses,
        startTimeStamp,
        durationDays,
      );

      const signature = await signer.signTypedData(
        eip712.domain,
        {
          UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
        },
        eip712.message,
      );

      const result = await relayerInstance.userDecrypt(
        handleContractPairs,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        signer.address,
        startTimeStamp,
        durationDays,
      );

      return result[ciphertextHandle];
    } catch (error) {
      console.error('User decryption failed:', error);
      throw error;
    }
  };

  // Public Decryption - Zama dokümantasyonuna göre
  const publicDecrypt = async (handles) => {
    if (!relayerInstance) {
      throw new Error("Relayer not initialized");
    }
    
    try {
      return await relayerInstance.publicDecrypt(handles);
    } catch (error) {
      console.error('Public decryption failed:', error);
      throw error;
    }
  };

  // joinGame fonksiyonu kaldırıldı - yeni kontratta bu fonksiyon yok

  useEffect(() => {
    if (!window.ethereum) return;
    
    const handleAccounts = (accounts) => {
      if (accounts.length > 0) {
        setAccount(accounts[0]);
      } else {
        setAccount(null);
        setProvider(null);
        setSigner(null);
        setContract(null);
        setRelayerInstance(null);
      }
    };
    
    const handleChain = (chainId) => {
      setIsCorrectNetwork(chainId === SEPOLIA_CHAIN_ID);
    };
    
    window.ethereum.on('accountsChanged', handleAccounts);
    window.ethereum.on('chainChanged', handleChain);
    
    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccounts);
      window.ethereum.removeListener('chainChanged', handleChain);
    };
  }, []);

  // Zamanlayıcı effect'i
  useEffect(() => {
    let timer;
    if (isGameActive && timeRemaining > 0) {
      timer = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            setIsGameActive(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isGameActive, timeRemaining]);

  // Oyun bilgilerini periyodik olarak güncelle ve event'leri dinle
  useEffect(() => {
    if (contract && account) {
      fetchGameStats();
      fetchPlayerStats();
      fetchAttemptFee();
      
      // Event listener'ları ekle
      const handleAttemptMade = (gameId, player, isCorrect) => {
        console.log('AttemptMade event received:', { gameId, player, isCorrect, account });
        console.log('Selected coordinates:', { selectedX, selectedY });
        
        if (player.toLowerCase() === account.toLowerCase() && selectedX !== null && selectedY !== null) {
          console.log('Processing result for current player');
          // Callback sonucu geldi, overlay'i kapat
          setIsProcessingResult(false);
          setResultStep('');
          
          // Hemen sonuç animasyonunu göster (gecikme kaldırıldı)
          if (!isCorrect) {
            console.log('Showing error animation');
            // Yanlış deneme - animasyon göster
            setResultType('error');
            setResultMessage(`❌ No treasure at (${selectedX}, ${selectedY}). Try again!`);
            setShowResultAnimation(true);
            
            // Grid'i güncelle
            const newGrid = [...gameGrid];
            newGrid[selectedY][selectedX] = true;
            setGameGrid(newGrid);
            
            // 3 saniye sonra animasyonu kapat
            setTimeout(() => {
              setShowResultAnimation(false);
              setResultType('');
              setResultMessage('');
            }, 3000);
          } else {
            console.log('Showing success animation');
            // Doğru deneme - animasyon göster
            setResultType('success');
            setResultMessage(`🎉 Congratulations! You found the treasure at (${selectedX}, ${selectedY})!`);
            setShowResultAnimation(true);
            setIsGameActive(false);
            
            // 4 saniye sonra animasyonu kapat
            setTimeout(() => {
              setShowResultAnimation(false);
              setResultType('');
              setResultMessage('');
            }, 4000);
          }
          
          // İstatistikleri yenile
          fetchPlayerStats();
        } else {
          console.log('Event not for current player or no coordinates selected, ignoring');
        }
      };

      const handleTreasureFound = (gameId, winner, x, y, amount) => {
        if (winner.toLowerCase() === account.toLowerCase()) {
          // Callback sonucu geldi, overlay'i kapat
          setIsProcessingResult(false);
          setResultStep('');
          
          // Hemen kazanma animasyonunu göster
          setResultType('success');
          setResultMessage(`🏆 You won! Treasure found at (${x}, ${y}) - Prize: ${ethers.formatEther(amount)} ETH`);
          setShowResultAnimation(true);
          setIsGameActive(false);
          
          // 5 saniye sonra animasyonu kapat
          setTimeout(() => {
            setShowResultAnimation(false);
            setResultType('');
            setResultMessage('');
          }, 5000);
        }
        fetchGameStats();
      };

      const handleGameCompleted = (gameId, winner, totalRevenue) => {
        // Callback sonucu geldi, overlay'i kapat
        setIsProcessingResult(false);
        setResultStep('');
        
        // Hemen oyun tamamlandı animasyonunu göster
        setResultType('success');
        setResultMessage(`🎮 Game completed! Winner: ${formatAddress(winner)} - Total Revenue: ${ethers.formatEther(totalRevenue)} ETH`);
        setShowResultAnimation(true);
        setIsGameActive(false);
        
        // 4 saniye sonra animasyonu kapat
        setTimeout(() => {
          setShowResultAnimation(false);
          setResultType('');
          setResultMessage('');
        }, 4000);
        
        fetchGameStats();
      };

      const handleDecryptionCompleted = (gameId, player, isCorrect) => {
        console.log('DecryptionCompleted event received:', { gameId, player, isCorrect, account });
        console.log('Player comparison:', player.toLowerCase(), '===', account.toLowerCase());
        console.log('Is current player?', player.toLowerCase() === account.toLowerCase());
        console.log('Selected coordinates:', { selectedX, selectedY });
        
        if (player.toLowerCase() === account.toLowerCase() && selectedX !== null && selectedY !== null) {
          console.log('Processing decryption result for current player');
          // Callback sonucu geldi, overlay'i kapat
          setIsProcessingResult(false);
          setResultStep('');
          
          // Hemen sonuç animasyonunu göster
          if (!isCorrect) {
            console.log('Showing error animation');
            // Yanlış deneme - animasyon göster
            setResultType('error');
            setResultMessage(`❌ No treasure at (${selectedX}, ${selectedY}). Try again!`);
            setShowResultAnimation(true);
            
            // Grid'i güncelle
            const newGrid = [...gameGrid];
            newGrid[selectedY][selectedX] = true;
            setGameGrid(newGrid);
            
            // 3 saniye sonra animasyonu kapat
            setTimeout(() => {
              setShowResultAnimation(false);
              setResultType('');
              setResultMessage('');
            }, 3000);
          } else {
            console.log('Showing success animation');
            // Doğru deneme - animasyon göster
            setResultType('success');
            setResultMessage(`🎉 Congratulations! You found the treasure at (${selectedX}, ${selectedY})!`);
            setShowResultAnimation(true);
            setIsGameActive(false);
            
            // 4 saniye sonra animasyonu kapat
            setTimeout(() => {
              setShowResultAnimation(false);
              setResultType('');
              setResultMessage('');
            }, 4000);
          }
          
          // İstatistikleri yenile
          fetchPlayerStats();
        } else {
          console.log('Event not for current player or no coordinates selected, ignoring');
        }
      };

      const handleWrongAttemptRecorded = (player, gameId) => {
        console.log('WrongAttemptRecorded event received:', { player, gameId, account });
        console.log('Player comparison:', player.toLowerCase(), '===', account.toLowerCase());
        console.log('Is current player?', player.toLowerCase() === account.toLowerCase());
        console.log('Selected coordinates:', { selectedX, selectedY });
        
        if (player.toLowerCase() === account.toLowerCase() && selectedX !== null && selectedY !== null) {
          console.log('Processing wrong attempt for current player');
          // Callback sonucu geldi, overlay'i kapat
          setIsProcessingResult(false);
          setResultStep('');
          
          // Yanlış deneme animasyonu göster
          console.log('Showing error animation from WrongAttemptRecorded');
          setResultType('error');
          setResultMessage(`❌ No treasure at (${selectedX}, ${selectedY}). Try again!`);
          setShowResultAnimation(true);
          
          // Grid'i güncelle
          const newGrid = [...gameGrid];
          newGrid[selectedY][selectedX] = true;
          setGameGrid(newGrid);
          
          // 3 saniye sonra animasyonu kapat
          setTimeout(() => {
            setShowResultAnimation(false);
            setResultType('');
            setResultMessage('');
          }, 3000);
          
          // İstatistikleri yenile
          fetchPlayerStats();
        } else {
          console.log('WrongAttemptRecorded event not for current player or no coordinates selected, ignoring');
        }
      };

      // Event listener'ları kaydet
      console.log('Registering event listeners...', { contract: !!contract, account });
      
      // Tüm event'leri dinle
      contract.on('*', (event) => {
        console.log('Any event received:', event);
        console.log('Event name:', event.eventName);
        console.log('Event args:', event.args);
        console.log('Event fragment:', event.fragment);
        
        // Event'e göre manuel olarak handler'ları çağır (event listener'lar çalışmıyor)
        if (event.eventName === 'WrongAttemptRecorded') {
          console.log('Manually calling handleWrongAttemptRecorded from * listener');
          const args = event.args;
          handleWrongAttemptRecorded(args[0], args[1]);
        } else if (event.eventName === 'DecryptionCompleted') {
          console.log('Manually calling handleDecryptionCompleted from * listener');
          const args = event.args;
          handleDecryptionCompleted(args[0], args[1], args[2]);
        } else if (event.eventName === 'AttemptMade') {
          console.log('Manually calling handleAttemptMade from * listener');
          const args = event.args;
          handleAttemptMade(args[0], args[1], args[2]);
        }
      });
      
      // Event listener'ları kaldırdık - sadece * listener kullanıyoruz
      // contract.on('AttemptMade', handleAttemptMade);
      // contract.on('TreasureFound', handleTreasureFound);
      // contract.on('GameCompleted', handleGameCompleted);
      // contract.on('DecryptionCompleted', handleDecryptionCompleted);
      // contract.on('WrongAttemptRecorded', handleWrongAttemptRecorded);
      
      // Event listener'ların kaydedildiğini doğrula
      console.log('Contract object:', contract);
      console.log('Contract listeners method:', typeof contract.listeners);
      
      try {
        const attemptListener = contract.listeners('AttemptMade');
        const decryptionListener = contract.listeners('DecryptionCompleted');
        const wrongAttemptListener = contract.listeners('WrongAttemptRecorded');
        
        console.log('AttemptMade listeners:', attemptListener ? attemptListener.length : 'undefined');
        console.log('DecryptionCompleted listeners:', decryptionListener ? decryptionListener.length : 'undefined');
        console.log('WrongAttemptRecorded listeners:', wrongAttemptListener ? wrongAttemptListener.length : 'undefined');
      } catch (error) {
        console.log('Error checking listeners:', error);
      }
      
      // Event listener'ları manuel olarak test et (sadece bir kez)
      console.log('Testing event listeners manually...');
      // Manuel test'i kaldırdık - sürekli tetikleniyordu
      
      console.log('Event listeners registered');
      
      const interval = setInterval(() => {
        fetchGameStats();
        fetchPlayerStats();
      }, 10000); // Her 10 saniyede bir güncelle
      
      return () => {
        clearInterval(interval);
        // Event listener'ları kaldırdık - sadece * listener kullanıyoruz
        // contract.off('AttemptMade', handleAttemptMade);
        // contract.off('TreasureFound', handleTreasureFound);
        // contract.off('GameCompleted', handleGameCompleted);
        // contract.off('DecryptionCompleted', handleDecryptionCompleted);
        // contract.off('WrongAttemptRecorded', handleWrongAttemptRecorded);
      };
    }
  }, [contract, account, gameGrid, selectedX, selectedY]);

  useEffect(() => {
    const checkConnection = async () => {
      if (window.ethereum) {
        try {
          const accounts = await window.ethereum.request({ method: 'eth_accounts' });
          if (accounts.length > 0) {
            connectWallet();
          }
        } catch (err) {
          console.error("Auto connect failed:", err);
        }
      }
    };
    
    checkConnection();
  }, []);

  const formatAddress = (address) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Grid hücresine tıklama
  const handleCellClick = (x, y) => {
    if (isGameActive && !isSearching && !isEncrypting) {
      setSelectedX(x);
      setSelectedY(y);
    }
  };

  // Zaman formatı
  const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="App">
      {/* Fixed Wallet Button - Top Right */}
      <div className="wallet-fixed">
        {!account ? (
          <button onClick={connectWallet} className="btn-primary btn-sm">
            Connect Wallet
          </button>
        ) : !isCorrectNetwork ? (
          <button onClick={checkAndSwitchNetwork} className="btn-warning btn-sm">
            Switch to Sepolia
          </button>
        ) : !relayerInstance ? (
          <button onClick={initRelayer} className="btn-primary btn-sm">
            Initialize
          </button>
        ) : (
          <div className="wallet-connected">
            <div className="wallet-status">
              <div className="status-indicator connected"></div>
              <span>Ready</span>
            </div>
            <div className="wallet-address">
              {formatAddress(account)}
            </div>
          </div>
        )}
      </div>

      {/* Header */}
      <div className="header">
        <h1>🔐 FHE Quest</h1>
        <p>FHE-powered treasure hunting on Sepolia</p>
      </div>

      {/* Initialize FHEVM Section - Only show when wallet connected but FHEVM not initialized */}
      {account && isCorrectNetwork && !relayerInstance && (
        <div className="init-section">
          <button onClick={initRelayer} className="btn-primary btn-lg">
            🔐 Initialize FHEVM
          </button>
          <div className="init-description">
            <p>🔒 <strong>Privacy First:</strong> Initialize FHEVM to enable fully homomorphic encryption for your coordinates.</p>
            <p>🎯 <strong>Secure Gaming:</strong> Your treasure hunt coordinates are encrypted and never revealed on the blockchain.</p>
            <p>⚡ <strong>Required Step:</strong> You must initialize FHEVM before you can create or join games.</p>
          </div>
        </div>
      )}

      {relayerInstance && (
        <>
          {/* Game Status */}
          {gameStats && (
            <div className="game-section">
              <div className="game-card card">
                <div className="card-header">
                  🎮 Current Game Status
                </div>
                <div className="card-body">
                  <div className="game-info">
                    <div className="info-item">
                      <span className="info-label">Game ID:</span>
                      <span className="info-value">{gameStats.id}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Status:</span>
                      <span className={`info-value ${isGameActive ? 'active' : 'inactive'}`}>
                        {isGameActive ? '🟢 Active' : '🔴 Ended'}
                      </span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Time Remaining:</span>
                      <span className="info-value">{formatTime(timeRemaining)}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Treasure Amount:</span>
                      <span className="info-value">{ethers.formatEther(gameStats.treasureAmount)} ETH</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Attempt Fee:</span>
                      <span className="info-value">{ethers.formatEther(attemptFee)} ETH</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Total Attempts:</span>
                      <span className="info-value">{gameStats.totalAttempts}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Creator Controls - Sadece owner için */}
          
          {relayerInstance && isCreator && (
            <div className="game-section">
              <div className="game-card card">
                <div className="card-header">
                  👑 Creator Controls
                </div>
                <div className="card-body">
                  <div className="game-form">
                    <div className="form-group">
                      <label className="form-label">Treasure Amount (ETH)</label>
                      <input
                        type="number"
                        step="0.001"
                        value={treasureAmount}
                        onChange={(e) => setTreasureAmount(e.target.value)}
                        placeholder="0.01"
                        className="form-input"
                        disabled={isGameActive}
                      />
                    </div>
                    
                    <div className="form-group">
                      <label className="form-label">Game Duration (seconds)</label>
                      <input
                        type="number"
                        value={gameDuration}
                        onChange={(e) => setGameDuration(parseInt(e.target.value) || 3600)}
                        placeholder="3600"
                        className="form-input"
                        disabled={isGameActive}
                      />
                    </div>
                    
                    <div className="form-group">
                      <label className="form-label">Treasure Coordinates</label>
                      <div className="coords-input">
                        <input
                          type="number"
                          value={selectedX}
                          onChange={(e) => setSelectedX(parseInt(e.target.value) || 0)}
                          placeholder="X"
                          className="form-input"
                          min="0"
                          max="9"
                          disabled={isGameActive}
                        />
                        <input
                          type="number"
                          value={selectedY}
                          onChange={(e) => setSelectedY(parseInt(e.target.value) || 0)}
                          placeholder="Y"
                          className="form-input"
                          min="0"
                          max="9"
                          disabled={isGameActive}
                        />
                      </div>
                      <p className="coords-info">
                        Selected: ({selectedX}, {selectedY})
                      </p>
                    </div>
                    
                    <div className="game-actions">
                      <button 
                        onClick={async () => {
                          try {
                            const encrypted = await encryptCoordinates(selectedX, selectedY, true);
                            setEncryptedX({
                              handle: encrypted.handleX,
                              inputProof: encrypted.inputProofX
                            });
                            setEncryptedY({
                              handle: encrypted.handleY,
                              inputProof: encrypted.inputProofY
                            });
                          } catch (error) {
                          }
                        }}
                        className="btn-primary"
                        disabled={isGameActive || isEncrypting}
                      >
                        {isEncrypting ? (
                          <div className="encryption-loading">
                            <div className="encryption-spinner"></div>
                            <span>{encryptionStep}</span>
                          </div>
                        ) : (
                          '🔐 Encrypt Coordinates'
                        )}
                      </button>
                      <button 
                        onClick={createGame} 
                        className="btn-success" 
                        disabled={isGameActive || !encryptedX || !encryptedY}
                      >
                        ✨ Create Game ({treasureAmount} ETH)
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Game Grid + Player Controls - Kompakt */}
          <div className="game-section">
            <div className="game-card card">
              <div className="card-header">
                🎮 Treasure Hunt Game
              </div>
              <div className="card-body">
                {/* Game Grid */}
                <div className="game-grid-container">
                  <div className="game-grid-wrapper">
                    <div className="game-grid">
                      {Array.from({ length: 10 }, (_, y) => (
                        <div key={y} className="grid-row">
                          {Array.from({ length: 10 }, (_, x) => (
                            <div
                              key={`${x}-${y}`}
                              className={`grid-cell ${
                                selectedX === x && selectedY === y ? 'selected' : ''
                              } ${
                                gameGrid[y][x] ? 'wrong-attempt' : ''
                              } ${
                                !isGameActive ? 'disabled' : ''
                              } ${
                                isEncrypting && selectedX === x && selectedY === y ? 'encrypting' : ''
                              }`}
                              onClick={() => isGameActive && handleCellClick(x, y)}
                            >
                              {gameGrid[y][x] ? '❌' : ''}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    
                    {/* Search Overlay */}
                    {isSearching && (
                      <div className="search-overlay">
                        <div className="search-panel">
                          <div className="search-icon">
                            <div className="search-spinner"></div>
                          </div>
                          <h3 className="search-title">🔍 Searching for Treasure</h3>
                          <p className="search-coords">Coordinates: ({selectedX}, {selectedY})</p>
                          <div className="search-step">{searchStep}</div>
                          <div className="search-progress">
                            <div className="search-progress-bar"></div>
                          </div>
                          <div className="search-dots">
                            <div className="search-dot"></div>
                            <div className="search-dot"></div>
                            <div className="search-dot"></div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Result Processing Overlay */}
                    {isProcessingResult && (
                      <div className="search-overlay">
                        <div className="search-panel result-panel">
                          <div className="search-icon">
                            <div className="result-spinner"></div>
                          </div>
                          <h3 className="search-title">⚡ Processing Result</h3>
                          <p className="search-coords">Coordinates: ({selectedX}, {selectedY})</p>
                          <div className="search-step">{resultStep}</div>
                          <div className="search-progress">
                            <div className="result-progress-bar"></div>
                          </div>
                          <div className="search-dots">
                            <div className="search-dot"></div>
                            <div className="search-dot"></div>
                            <div className="search-dot"></div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Result Animation Overlay */}
                    {showResultAnimation && (
                      <div className="result-animation-overlay">
                        <div className={`result-animation-panel ${resultType}`}>
                          <div className="result-animation-icon">
                            {resultType === 'success' ? (
                              <div className="success-icon">✓</div>
                            ) : (
                              <div className="error-icon">✗</div>
                            )}
                          </div>
                          <h3 className="result-animation-title">
                            {resultType === 'success' ? '🎉 Success!' : '❌ Try Again!'}
                          </h3>
                          <p className="result-animation-message">{resultMessage}</p>
                          <div className="result-animation-particles">
                            {[...Array(8)].map((_, i) => (
                              <div key={i} className={`particle particle-${i + 1}`}></div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Grid Legend */}
                  <div className="grid-legend">
                    <div className="legend-item">
                      <div className="legend-color selected"></div>
                      <span>Selected</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-color wrong-attempt"></div>
                      <span>Wrong Attempt</span>
                    </div>
                  </div>
                </div>
                
                {/* Player Controls - Kompakt */}
                <div className="player-controls-compact">
                  <div className="selected-coords">
                    <span className="coords-label">Selected:</span>
                    <span className="coords-value">({selectedX}, {selectedY})</span>
                  </div>
                  
                  <div className="game-actions">
                    <button 
                      onClick={searchTreasure} 
                      className="btn-warning btn-search"
                      disabled={!isGameActive || isSearching || isEncrypting}
                    >
                      {isEncrypting ? (
                        <div className="encryption-loading">
                          <div className="encryption-spinner"></div>
                          <span>{encryptionStep}</span>
                        </div>
                      ) : isSearching ? (
                        '🔍 Searching...'
                      ) : (
                        `🔍 Search Treasure (${ethers.formatEther(attemptFee)} ETH)`
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Status Section */}
      {status && (
        <div className="status-section">
          <div className={`status-message ${status.includes('failed') || status.includes('❌') || status.includes('error') ? 'error' : 
                                          status.includes('✅') || status.includes('success') || status.includes('successful') || status.includes('completed') ? 'success' : 
                                          status.includes('warning') || status.includes('⚠️') ? 'warning' : 
                                          isEncrypting ? 'encrypting' : 'info'}`}>
            {status}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;