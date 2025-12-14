document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const gameContainer = document.getElementById('game-container');

    const scoreDisplay = document.getElementById('score');
    const targetScoreDisplay = document.getElementById('targetScore');
    const timerDisplay = document.getElementById('timer');
    const distanceDisplay = document.getElementById('distance');
    const progressBar = document.getElementById('progress-bar');
    const timeWarning = document.getElementById('time-warning');

    const startScreen = document.getElementById('start-screen');
    const pauseScreen = document.getElementById('pause-screen');
    const gameOverScreen = document.getElementById('game-over-screen');
    const gameOverMessage = document.getElementById('game-over-message');
    const finalScoreDisplay = document.getElementById('final-score');

    const startButton = document.getElementById('start-button');
    const permissionButton = document.getElementById('permission-button');
    const sensorStatusDisplay = document.getElementById('sensor-status');
    const resumeButton = document.getElementById('resume-button');
    const restartButton = document.getElementById('restart-button');

    const touchControls = document.getElementById('touch-controls');
    const touchUpButton = document.getElementById('touch-up');
    const touchDownButton = document.getElementById('touch-down');

    const debugPanel = document.getElementById('debug-panel');
    const debugOutput = document.getElementById('debug-output');
    const toggleDebugButton = document.getElementById('toggle-debug');
    const showDebugButton = document.getElementById('show-debug-button');

    // --- Game Constants ---
    const TARGET_SCORE = 1000;
    const TIME_LIMIT_SECONDS = 60;
    const PLAYER_FIXED_X_PERCENT = 0.30; // 30% from left
    const PLAYER_FIXED_Y_PERCENT = 0.50; // 50% from top
    const MAX_SCORING_DISTANCE = 100; // Max distance in pixels to score points
    const POINTS_PER_SECOND_AT_MIN_DIST = 50; // Score rate when extremely close
    let TERRAIN_SEGMENT_WIDTH = 20; // Width of each terrain segment
    let TERRAIN_BASE_SPEED = 2; // Pixels per frame base speed
    let TERRAIN_SMOOTHNESS = 0.1; // How much adjacent points influence each other
    let TERRAIN_ROUGHNESS = 100; // Max vertical change between segments
    let TERRAIN_INITIAL_SAFE_FACTOR = 0.6// Start terrain ~1.8x screen height down
    let CONTROL_SENSITIVITY = 1.5; // How much keys/tilt affect terrain bias
    let TILT_SENSITIVITY_MULTIPLIER = 0.25; // Adjusts tilt responsiveness
    let NEUTRAL_TILT_ANGLE_PORTRAIT = 30.0; // Neutral angle (degrees) when phone held vertically (uses pitch/beta)
    let NEUTRAL_TILT_ANGLE_LANDSCAPE = 30.0;  // Neutral angle (degrees) when phone held horizontally (uses roll/gamma) - Usually 0 is fine for roll.
    let MAX_TILT_DEVIATION = 45.0; // Max degrees deviation FROM NEUTRAL angle to reach full effect (-1 to 1 normalized)
    const WARNING_TIME_SECONDS = 10; // When to show time warning
    const INITIAL_SAFE_DURATION_SECONDS = 3.0; // How many seconds of smooth terrain at start

    // --- Game State Variables ---
    let score = 0;
    let timeLeft = TIME_LIMIT_SECONDS;
    let distanceToTerrain = Infinity;
    let closestTerrainPoint = { x: 0, y: 0 }; // For visual indicator line
    let gameTimeElapsed = 0; // <<< ADD THIS LINE

    let isRunning = false;
    let isPaused = false;
    let isGameOver = false;
    let hasWon = false;
    let animationFrameId = null;
    let lastTimestamp = 0;
    let timerIntervalId = null;

    let player = { x: 0, y: 0, width: 15, height: 10 };
    let terrainPoints = []; // Array of {x, y} points
    let terrainSpeed = TERRAIN_BASE_SPEED;
    let verticalBias = 0; // Controlled by player input, shifts terrain baseline
    let verticalBiasTarget = 0; // Target bias for smooth transition

    let keysPressed = {}; // Keep track of pressed keys

    // Sensor state
    let sensorsActive = false;
    let sensorPermissionGranted = false;
    let isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    let lastBeta = null; // For tilt smoothing/axis detection

    // Color Modes
    let currentColorMode = 'aviation'; // 'aviation', 'zen', 'proximity'
    const colorModes = {
        aviation: { sky: '#345678', ground: '#654321', groundStroke: '#3a240d', player: 'red' },
        zen: { sky: '#F8F5F1', ground: '#EEE7DD', groundStroke: '#E4D7C3', player: '#E4D7C3' },
        proximity: { sky: '#4682b4', groundNear: '#ff6347', groundFar: '#3cb371', groundStroke: '#2e8b57', player: '#ffffff' } // Ground color calculated dynamically
    };

    // --- Utility Functions ---
    const resizeCanvas = () => {
        const containerWidth = gameContainer.clientWidth;
        const containerHeight = gameContainer.clientHeight;

        // Maintain aspect ratio (e.g., 16:9)
        // const aspectRatio = 16 / 9;
        // let newWidth, newHeight;

        // if (containerWidth / containerHeight > aspectRatio) {
        //     // Container is wider than aspect ratio, height is the limiting factor
        //     newHeight = containerHeight;
        //     newWidth = newHeight * aspectRatio;
        // } else {
        //     // Container is taller or equal, width is the limiting factor
        //     newWidth = containerWidth;
        //     newHeight = newWidth / aspectRatio;
        // }

        // canvas.width = newWidth;
        // canvas.height = newHeight;

        // --- NEW LOGIC: Fill the container ---
        canvas.width = containerWidth;
        canvas.height = containerHeight;
        // --- END NEW LOGIC ---

        // Recalculate fixed player position based on new canvas size
        player.x = canvas.width * PLAYER_FIXED_X_PERCENT;
        player.y = canvas.height * PLAYER_FIXED_Y_PERCENT;

        // Re-initialize terrain to adapt to potentially very different dimensions
        initializeTerrain();
        // Recalculate initial bias based on new height
        const baseLineY = canvas.height / 2;
        const targetAbsoluteStartY = canvas.height * TERRAIN_INITIAL_SAFE_FACTOR;
        const initialRelativeY = 0;
        verticalBias = targetAbsoluteStartY - baseLineY - initialRelativeY;
        verticalBiasTarget = verticalBias;

        console.log(`Resized canvas to: ${canvas.width}x${canvas.height}`);
        updateDebugInfo(); // Update debug info after resize
    };

    const lerp = (a, b, t) => a + (b - a) * t; // Linear interpolation

    // Helper function for proximity color interpolation
    const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    };

    const isSecureContext = () => window.isSecureContext; // Check for HTTPS

    // --- Sensor Handling ---
    const requestSensorPermission = async () => {
        if (!isSecureContext()) {
            sensorStatusDisplay.textContent = "Sensor Status: Requires HTTPS connection.";
            gameContainer.classList.add('sensors-unavailable');
            showFallbackControls();
            return;
        }

        // iOS requires specific permission request triggered by user gesture
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permissionState = await DeviceOrientationEvent.requestPermission();
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', handleDeviceOrientation);
                    sensorPermissionGranted = true;
                    sensorsActive = true;
                    sensorStatusDisplay.textContent = "Sensor Status: Tilt Active (iOS)";
                    gameContainer.classList.add('sensors-active');
                    gameContainer.classList.remove('sensors-denied', 'sensors-unavailable');
                    hideFallbackControls();
                    permissionButton.style.display = 'none'; // Hide button after grant
                } else {
                    sensorPermissionGranted = false;
                    sensorsActive = false;
                    sensorStatusDisplay.textContent = "Sensor Status: Tilt Permission Denied.";
                    gameContainer.classList.add('sensors-denied');
                    showFallbackControls();
                }
            } catch (error) {
                console.error("Error requesting sensor permission:", error);
                sensorPermissionGranted = false;
                sensorsActive = false;
                sensorStatusDisplay.textContent = `Sensor Status: Error (${error.name})`;
                gameContainer.classList.add('sensors-unavailable');
                showFallbackControls();
            }
        } else {
            // Android/Other browsers (permission usually granted via browser settings)
            // We can try adding the listener and see if events fire.
            // Add a flag to check if we received any events after a short delay.
            let receivedSensorEvent = false;
            const sensorCheckTimeout = 2000; // ms

            const orientationHandler = (event) => {
                receivedSensorEvent = true;
                handleDeviceOrientation(event); // Process the event immediately
                // We can potentially remove the listener after first successful event
                // or keep it if continuous check is desired
            };

            window.addEventListener('deviceorientation', orientationHandler, { once: false }); // Listen continuously for now

            setTimeout(() => {
                if (receivedSensorEvent) {
                    sensorPermissionGranted = true; // Assume granted if events fire
                    sensorsActive = true;
                    sensorStatusDisplay.textContent = "Sensor Status: Tilt Active";
                    gameContainer.classList.add('sensors-active');
                    gameContainer.classList.remove('sensors-denied', 'sensors-unavailable');
                     hideFallbackControls();
                     permissionButton.style.display = 'none';
                } else {
                    // No events received, likely disabled or unavailable
                    window.removeEventListener('deviceorientation', orientationHandler); // Clean up listener
                    sensorPermissionGranted = false;
                    sensorsActive = false;
                    sensorStatusDisplay.textContent = "Sensor Status: Tilt Unavailable/Disabled in Settings.";
                    gameContainer.classList.add('sensors-unavailable');
                    showFallbackControls();
                    // Optionally hide the permission button if it's clear sensors won't work
                     permissionButton.style.display = 'none';
                }
            }, sensorCheckTimeout);

             sensorStatusDisplay.textContent = "Sensor Status: Checking for tilt...";
        }
    };

    const handleDeviceOrientation = (event) => {
        if (!isRunning || isPaused || isGameOver || !sensorsActive) return;

        // beta: front/back tilt (usually -180 to 180 or 0 to 360)
        // gamma: left/right tilt (usually -90 to 90)
        // alpha: compass direction (0 to 360)

        // Determine orientation based on canvas aspect ratio
        const isLandscape = canvas.width > canvas.height;
        let tiltValue = isLandscape ? event.gamma : event.beta; // Get raw tilt value
        // Select the appropriate neutral angle based on orientation
        let neutralAngle = isLandscape ? NEUTRAL_TILT_ANGLE_LANDSCAPE : NEUTRAL_TILT_ANGLE_PORTRAIT;

        if (tiltValue === null || tiltValue === undefined) {
            console.warn("Received null/undefined tilt value.");
            return;
        }

        // --- NEW: Calculate tilt relative to the desired neutral angle ---
        let adjustedTiltValue = tiltValue - neutralAngle;
        // --- END NEW ---

        // Normalize the *adjusted* tilt value based on max deviation from neutral
        // e.g., map (-MAX_TILT_DEVIATION to +MAX_TILT_DEVIATION) -> (-1 to 1)
        const normalizedTilt = Math.max(-1, Math.min(1, adjustedTiltValue / MAX_TILT_DEVIATION));

        // Calculate the desired bias offset based on the normalized deviation from neutral
        // Positive normalizedTilt (tilted "up" from neutral) should increase bias (terrain moves down).
        const tiltInfluence = normalizedTilt * (canvas.height * 0.4) * TILT_SENSITIVITY_MULTIPLIER;

        // Set the target bias directly based on the calculated influence.
        // When tilt is neutral, adjusted=0, normalized=0, influence=0, so target bias becomes 0.
        verticalBiasTarget = tiltInfluence;

        // Update debug info if needed (passing the new values)
        updateDebugInfo(adjustedTiltValue, normalizedTilt);
    };

    const enterFullscreen = () => {
        const element = gameContainer; // Or document.documentElement for whole page
    
        if (element.requestFullscreen) {
            element.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
            });
        } else if (element.webkitRequestFullscreen) { /* Safari */
            element.webkitRequestFullscreen().catch(err => {
                 console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
            });
        } else if (element.msRequestFullscreen) { /* IE11 */
            element.msRequestFullscreen().catch(err => {
                 console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
            });
        }
         // Note: You might want to add a button/mechanism to exit fullscreen later
         // using document.exitFullscreen() etc.
    };

    const showFallbackControls = () => {
        if (isMobile) {
            touchControls.style.display = 'flex';
            gameContainer.classList.add('mobile'); // Ensure class is set
            gameContainer.classList.remove('sensors-active');
        }
         // No else needed, keyboard is default for desktop
    };
     const hideFallbackControls = () => {
        touchControls.style.display = 'none';
    };


    // --- Input Handling ---
    const handleKeyDown = (e) => {
        keysPressed[e.code] = true;
        // Allow pause toggle even if game isn't "running" in the traditional sense
        if (e.code === 'KeyP' || e.code === 'Escape') {
            togglePause();
        }
    };

    const handleKeyUp = (e) => {
        keysPressed[e.code] = false;
    };

    const handleTouchStart = (e) => {
        // Prevent default touch behavior like scrolling/zooming
        // e.preventDefault(); Commented out: Allow clicks on overlays

        if (!isRunning || isPaused || isGameOver || sensorsActive) return; // Ignore touch if sensors active

        const target = e.target;
        if (target === touchUpButton) {
            keysPressed['TouchUp'] = true; // Simulate key press
            keysPressed['TouchDown'] = false;
        } else if (target === touchDownButton) {
            keysPressed['TouchDown'] = true; // Simulate key press
            keysPressed['TouchUp'] = false;
        }
    };

    const handleTouchEnd = (e) => {
         // e.preventDefault(); // Might be needed

        keysPressed['TouchUp'] = false;
        keysPressed['TouchDown'] = false;
    };

    const processInput = () => {
        if (sensorsActive) {
            // Sensor input handled by handleDeviceOrientation directly setting verticalBiasTarget
             // Smoothly move actual bias towards target bias
            verticalBias = lerp(verticalBias, verticalBiasTarget, 0.1); // Adjust 0.1 for smoothing speed
            return; // Don't process keys/touch if sensors are active
        }

        let biasChange = 0;
        if (keysPressed['ArrowUp'] || keysPressed['KeyW'] || keysPressed['TouchUp']) {
            // UP command should make terrain go DOWN (higher Y value -> increase bias)
            biasChange = CONTROL_SENSITIVITY; // WAS: -CONTROL_SENSITIVITY
        }
        if (keysPressed['ArrowDown'] || keysPressed['KeyS'] || keysPressed['TouchDown']) {
            // DOWN command should make terrain go UP (lower Y value -> decrease bias)
            biasChange = -CONTROL_SENSITIVITY; // WAS: CONTROL_SENSITIVITY
        }

        // Apply bias change and clamp to screen bounds (adjust clamping as needed)
        verticalBiasTarget += biasChange;

        // Clamp the target bias. Since bias relates to the offset from the center,
        // the clamping range might need adjustment depending on TERRAIN_ROUGHNESS
        // Let's keep the previous clamping for now, it prevents extreme runaway.
        verticalBiasTarget = Math.max(-canvas.height * 0.8, Math.min(canvas.height * 1.2, verticalBiasTarget)); // Adjusted clamping range slightly

        // Smoothly move actual bias towards target bias
        verticalBias = lerp(verticalBias, verticalBiasTarget, 0.1); // Adjust 0.1 for smoothing speed
    };


    // --- Terrain Generation ---
    const initializeTerrain = () => {
        terrainPoints = [];
        const baseLineY = canvas.height / 2; // Reference baseline is screen center

        // Calculate the initial bias needed to place the terrain correctly
        // We want the initial absolute Y = canvas.height * TERRAIN_INITIAL_SAFE_FACTOR
        // Absolute Y = baseLineY + relativeY + bias
        // Since we start with flat terrain, initial relativeY = 0
        const targetAbsoluteStartY = canvas.height * TERRAIN_INITIAL_SAFE_FACTOR;
        const initialRelativeY = 0; // Start flat relative to baseline
        const initialBias = targetAbsoluteStartY - baseLineY - initialRelativeY;

        console.log(`Initializing Terrain: TargetAbsY=${targetAbsoluteStartY.toFixed(1)}, BaseY=${baseLineY.toFixed(1)}, InitialBias=${initialBias.toFixed(1)}`);

        // Generate initial points with relative Y = 0
        for (let x = -TERRAIN_SEGMENT_WIDTH * 5; x < canvas.width + TERRAIN_SEGMENT_WIDTH * 5; x += TERRAIN_SEGMENT_WIDTH) {
            terrainPoints.push({ x: x, y: initialRelativeY }); // Store relative Y
        }

        verticalBias = initialBias; // Set the calculated initial bias
        verticalBiasTarget = verticalBias; // Target matches initial bias
    };

    const updateTerrain = (deltaTime) => {
        let pointsToRemove = 0;
        let lastX = terrainPoints.length > 0 ? terrainPoints[terrainPoints.length - 1].x : -TERRAIN_SEGMENT_WIDTH;
        let lastRelativeY = terrainPoints.length > 0 ? terrainPoints[terrainPoints.length - 1].y : 0;
    
        // Move existing points left (using deltaTime for consistent speed)
        const speedAdjustment = deltaTime / (1000 / 60); // Adjust speed based on 60fps baseline
        for (let i = 0; i < terrainPoints.length; i++) {
            terrainPoints[i].x -= terrainSpeed * speedAdjustment; // Apply adjusted speed
            if (terrainPoints[i].x < -TERRAIN_SEGMENT_WIDTH * 2) {
                pointsToRemove++;
            }
        }
        if (pointsToRemove > 0) {
            terrainPoints.splice(0, pointsToRemove);
        }
    
        // --- Determine terrain roughness based on time ---
        let effectiveRoughness = TERRAIN_ROUGHNESS;
        if (gameTimeElapsed < INITIAL_SAFE_DURATION_SECONDS) {
            // Option 1: Completely flat during safe period
            effectiveRoughness = 0;
            // Option 2: Very low roughness during safe period ( uncomment if preferred)
            // effectiveRoughness = TERRAIN_ROUGHNESS * 0.1;
            // Option 3: Gradually increase roughness (uncomment if preferred)
            // effectiveRoughness = TERRAIN_ROUGHNESS * (gameTimeElapsed / INITIAL_SAFE_DURATION_SECONDS);
    
            // Optional: Log during safe phase for debugging
            // console.log(`Safe Phase: Time=${gameTimeElapsed.toFixed(1)}, Roughness=${effectiveRoughness.toFixed(1)}`);
        }
        // --- End roughness determination ---
    
        // Add new points on the right edge
        while (lastX < canvas.width + TERRAIN_SEGMENT_WIDTH * 2) {
             lastX += TERRAIN_SEGMENT_WIDTH;
    
             // Calculate Y components using EFFECTIVE roughness
             let randomComponent = (Math.random() - 0.5) * effectiveRoughness; // <<< USE effectiveRoughness
             let smoothComponent = lastRelativeY * (1 - TERRAIN_SMOOTHNESS);
             let nextRelativeY = smoothComponent + randomComponent;
    
             terrainPoints.push({ x: lastX, y: nextRelativeY });
             lastRelativeY = nextRelativeY;
        }
    };

    // --- Collision & Distance ---
    const calculateDistanceAndCollision = () => {
        distanceToTerrain = Infinity; // Start fresh each frame, assume worst case
        let collision = false;
        let terrainYAtPlayerX = canvas.height; // Default if no terrain found below player X
        const baseLineY = canvas.height / 2; // Reference baseline
    
        // Find terrain segment(s) under the player
        for (let i = 1; i < terrainPoints.length; i++) {
            const p1 = terrainPoints[i - 1];
            const p2 = terrainPoints[i];
    
            // Check if player's X is between the X coords of the segment points
            if ((p1.x <= player.x && p2.x >= player.x) || (p2.x <= player.x && p1.x >= player.x)) {
                // Interpolate terrain *relative* Y at player's exact X
                const segmentWidth = p2.x - p1.x;
                let relativeTerrainYAtPlayerX = p1.y; // Default to p1 if segmentWidth is 0
                if (Math.abs(segmentWidth) > 1e-6) {
                    const t = (player.x - p1.x) / segmentWidth;
                    relativeTerrainYAtPlayerX = lerp(p1.y, p2.y, t); // Interpolate relative Y
                }
    
                // Calculate the absolute terrain Y by adding baseline and current bias
                terrainYAtPlayerX = baseLineY + relativeTerrainYAtPlayerX + verticalBias;
    
                // Calculate the vertical gap. Positive if terrain is below player's center.
                const gap = terrainYAtPlayerX - player.y;
    
                // --- Logic to update distanceToTerrain ---
                // Store the smallest *positive* gap found so far.
                if (gap >= 0) { // Terrain is below or at player center Y.
                    if (distanceToTerrain === Infinity || gap < distanceToTerrain) {
                        // If this is the first valid point below player, or it's closer than the last.
                        distanceToTerrain = gap; // Store the positive gap.
                        closestTerrainPoint = { x: player.x, y: terrainYAtPlayerX };
                    }
                } else { // Terrain is above player center Y (gap is negative).
                    if (distanceToTerrain === Infinity) {
                        // If we haven't found *any* terrain point below the player yet,
                        // store this negative gap as a fallback / closest point above.
                        distanceToTerrain = gap;
                        closestTerrainPoint = { x: player.x, y: terrainYAtPlayerX };
                    }
                    // Do NOT overwrite a valid positive distanceToTerrain with a negative one.
                }
    
                // --- Collision Check --- (Uses the same terrainYAtPlayerX)
                const playerBottom = player.y + player.height / 2;
                const collisionTolerance = 1; // Small tolerance
                if (playerBottom >= terrainYAtPlayerX - collisionTolerance) {
                    collision = true;
                    // On actual collision, force distance to 0 for scoring/display.
                    distanceToTerrain = 0;
                    // Exit loop once collision detected on this frame
                    break;
                }
                // Note: Loop continues if no collision on this segment, might find closer point later
            }
        } // End loop through segments
    
        // If distance is still Infinity, it means no terrain segment was found under the player's X coord
        if (distanceToTerrain === Infinity){
             distanceToTerrain = canvas.height; // Assign a large distance (effectively no score)
             closestTerrainPoint = {x: player.x, y: canvas.height + 10};
        }
    
        if (terrainYAtPlayerX !== canvas.height || distanceToTerrain !== canvas.height) {
            // Correct format:
            console.log(`Dist Calc: PlayerY=<span class="math-inline">\{player\.y\.toFixed\(1\)\}, TerrainY\=</span>{terrainYAtPlayerX.toFixed(1)}, VertDist=<span class="math-inline">\{\(player\.y \- terrainYAtPlayerX\)\.toFixed\(1\)\}, StoredDist\=</span>{distanceToTerrain.toFixed(1)}`);
        }
    
        // Update UI display - always show non-negative distance
        distanceDisplay.textContent = distanceToTerrain === Infinity ? '---' : Math.max(0, distanceToTerrain).toFixed(1);
    
        // Return only the collision status
        return collision;
    };

    // --- Scoring ---
    const updateScore = (deltaTime) => {
        if (distanceToTerrain >= 0 && distanceToTerrain <= MAX_SCORING_DISTANCE) {
            // Score more the closer the player is
            const proximityFactor = (MAX_SCORING_DISTANCE - distanceToTerrain) / MAX_SCORING_DISTANCE; // 0 to 1
            const scoreRate = POINTS_PER_SECOND_AT_MIN_DIST * proximityFactor * proximityFactor; // Exponential scoring increase closer
            score += scoreRate * (deltaTime / 1000); // Score based on time spent close
            score = Math.max(0, score); // Ensure score doesn't go negative
        }
        scoreDisplay.textContent = Math.floor(score);

        // Update progress bar
        const progress = Math.min(1, score / TARGET_SCORE);
        progressBar.style.width = `${progress * 100}%`;

        // Check win condition
        if (score >= TARGET_SCORE) {
            winGame();
        }
    };

    // --- Game State Changes ---
    const startGame = () => {
        if (isRunning) return; // Prevent multiple starts if already running somehow

        console.log("Starting Game...");
        resizeCanvas(); // Ensure canvas is sized correctly before starting
        initializeTerrain(); // Set up initial safe terrain

        gameTimeElapsed = 0; // Reset elapsed time counter
        score = 0;
        timeLeft = TIME_LIMIT_SECONDS;
        isGameOver = false;
        hasWon = false;
        isRunning = true;
        isPaused = false;
        lastTimestamp = performance.now(); // Reset timestamp for accurate deltaTime

        // Reset UI elements
        scoreDisplay.textContent = '0';
        timerDisplay.textContent = timeLeft;
        distanceDisplay.textContent = '---';
        progressBar.style.width = '0%';
        timeWarning.style.display = 'none';
        startScreen.style.display = 'none';
        pauseScreen.style.display = 'none';
        gameOverScreen.style.display = 'none';

        // Show controls based on sensor status determined earlier
        if (!sensorsActive && isMobile) {
             showFallbackControls();
        } else if (!sensorsActive && !isMobile){
             hideFallbackControls(); // Hide touch if desktop
        } else {
            hideFallbackControls(); // Hide touch if sensors are active
        }

        // Start timer interval
        clearInterval(timerIntervalId); // Clear any previous interval
        timerIntervalId = setInterval(() => {
            if (isRunning && !isPaused) {
                timeLeft--;
                timerDisplay.textContent = timeLeft;
                if (timeLeft <= WARNING_TIME_SECONDS && timeLeft > 0) {
                    timeWarning.style.display = 'block';
                } else {
                    timeWarning.style.display = 'none';
                }
                if (timeLeft <= 0) {
                    gameOver("Time's Up!");
                    clearInterval(timerIntervalId);
                }
            }
        }, 1000);

        // Start game loop
        cancelAnimationFrame(animationFrameId); // Cancel previous loop if any
        gameLoop(lastTimestamp); // Pass initial timestamp
    };

    const togglePause = () => {
        if (isGameOver) return; // Can't pause if game over

        isPaused = !isPaused;
        if (isPaused) {
            pauseScreen.style.display = 'flex';
            // Stop timer interval while paused
            clearInterval(timerIntervalId);
             // Optionally stop sensor listeners during pause?
             // if (sensorsActive) window.removeEventListener('deviceorientation', handleDeviceOrientation);
        } else {
            pauseScreen.style.display = 'none';
            // Restart timer interval
            clearInterval(timerIntervalId); // Clear just in case
             timerIntervalId = setInterval(() => {
                 if (isRunning && !isPaused) { // Check again inside interval
                     timeLeft--;
                     timerDisplay.textContent = timeLeft;
                     if (timeLeft <= WARNING_TIME_SECONDS && timeLeft > 0) {
                         timeWarning.style.display = 'block';
                     } else {
                          timeWarning.style.display = 'none';
                     }
                     if (timeLeft <= 0) {
                         gameOver("Time's Up!");
                         clearInterval(timerIntervalId);
                     }
                 }
             }, 1000);

             // Re-attach sensor listener if removed
             // if (sensorsActive && sensorPermissionGranted) window.addEventListener('deviceorientation', handleDeviceOrientation);

            // Restart game loop by setting lastTimestamp to now
            lastTimestamp = performance.now();
            gameLoop(lastTimestamp);
        }
    };

    const gameOver = (message = "Collision!") => {
        if (isGameOver) return; // Prevent multiple game overs

        console.log("Game Over:", message);
        isRunning = false;
        isGameOver = true;
        hasWon = false; // Explicitly set won state if needed elsewhere
        clearInterval(timerIntervalId); // Stop timer
        cancelAnimationFrame(animationFrameId); // Stop game loop

        finalScoreDisplay.textContent = Math.floor(score);
        gameOverMessage.textContent = message;
        gameOverScreen.style.display = 'flex';
        timeWarning.style.display = 'none';

        // Clean up listeners? Optional but good practice
        // window.removeEventListener('deviceorientation', handleDeviceOrientation); // Example
    };

     const winGame = () => {
        if (isGameOver) return; // Prevent triggering win if already game over

        console.log("You Win!");
        isRunning = false;
        isGameOver = true;
        hasWon = true;
        clearInterval(timerIntervalId);
        cancelAnimationFrame(animationFrameId);

        finalScoreDisplay.textContent = Math.floor(score);
        gameOverMessage.textContent = "Target Reached! You Win!";
        gameOverScreen.style.display = 'flex';
        timeWarning.style.display = 'none';
    };


    // --- Drawing ---
    const drawBackground = () => {
        const colors = colorModes[currentColorMode];
        // Draw Sky
        ctx.fillStyle = colors.sky;
        ctx.fillRect(0, 0, canvas.width, canvas.height); // Fill entire canvas first
    };

    const drawPlayer = () => {
        const colors = colorModes[currentColorMode];
        ctx.fillStyle = colors.player;
        // Draw a circle instead of a rectangle
        ctx.beginPath();
        // Use player.width as the diameter, so radius is width / 2
        ctx.arc(player.x, player.y, player.width / 2, 0, Math.PI * 2);
        ctx.fill();

        // Old rectangle code:
        // ctx.fillRect(player.x - player.width / 2, player.y - player.height / 2, player.width, player.height);
        // Simple triangle shape instead:
        // ctx.fillStyle = 'yellow';
        // ctx.beginPath();
        // ctx.moveTo(player.x - player.width / 2, player.y + player.height / 2); // Bottom left
        // ctx.lineTo(player.x + player.width / 2, player.y + player.height / 2); // Bottom right
        // ctx.lineTo(player.x, player.y - player.height / 2); // Top point
        // ctx.closePath();
        // ctx.fill();
    };

    const drawTerrain = () => {
        const baseLineY = canvas.height / 2; // The baseline used for generation
        const colors = colorModes[currentColorMode];

        // Determine ground fill style based on mode
        let groundFillStyle;
        if (currentColorMode === 'proximity') {
            // Calculate color based on distance (0 to MAX_SCORING_DISTANCE)
            // Clamp distance for color calculation
            const clampedDistance = Math.max(0, Math.min(MAX_SCORING_DISTANCE, distanceToTerrain));
            const proximityFactor = clampedDistance / MAX_SCORING_DISTANCE; // 0 (close) to 1 (far)

            // Interpolate between 'near' and 'far' colors
            const nearColor = hexToRgb(colors.groundNear);
            const farColor = hexToRgb(colors.groundFar);
            if (nearColor && farColor) { // Check if hexToRgb was successful
                const r = Math.round(lerp(nearColor.r, farColor.r, proximityFactor));
                const g = Math.round(lerp(nearColor.g, farColor.g, proximityFactor));
                const b = Math.round(lerp(nearColor.b, farColor.b, proximityFactor));
                groundFillStyle = `rgb(${r}, ${g}, ${b})`;
            } else {
                groundFillStyle = colors.groundFar; // Fallback if color conversion fails
            }

        } else {
            groundFillStyle = colors.ground;
        }

        ctx.fillStyle = groundFillStyle;
        ctx.strokeStyle = colors.groundStroke;
        ctx.lineWidth = 2;
        ctx.beginPath();

        if (terrainPoints.length > 0) {
            ctx.moveTo(-TERRAIN_SEGMENT_WIDTH * 2, canvas.height + 50); // Start below screen bottom left

            // Calculate the effective Y for the first point by applying baseline and current bias
            let firstEffectiveY = baseLineY + terrainPoints[0].y + verticalBias;
            // --- SMOOTHER CURVE DRAWING ---
            let p0x = terrainPoints[0].x;
            let p0y = baseLineY + terrainPoints[0].y + verticalBias;
            ctx.lineTo(p0x, Math.min(canvas.height + 50, p0y)); // Line to the first actual point's vertical position

            // Iterate through points to draw quadratic curves
            for (let i = 0; i < terrainPoints.length - 1; i++) {
                const p1x = terrainPoints[i].x;
                const p1y = baseLineY + terrainPoints[i].y + verticalBias;
                const p2x = terrainPoints[i + 1].x;
                const p2y = baseLineY + terrainPoints[i + 1].y + verticalBias;

                // Calculate midpoint for the curve endpoint
                const midX = (p1x + p2x) / 2;
                const midY = (p1y + p2y) / 2;

                // Use p1 as the control point, draw curve to the midpoint
                // Clamp Y values to prevent drawing above the bottom edge visually
                ctx.quadraticCurveTo(p1x, Math.min(canvas.height + 50, p1y), midX, Math.min(canvas.height + 50, midY));
            }

            // Draw the last segment as a line to the final point to ensure it reaches the edge
            if (terrainPoints.length > 1) {
                 const lastPointX = terrainPoints[terrainPoints.length - 1].x;
                 const lastPointY = baseLineY + terrainPoints[terrainPoints.length - 1].y + verticalBias;
                 ctx.lineTo(lastPointX, Math.min(canvas.height + 50, lastPointY));
                 // Line to bottom right corner for fill
                 ctx.lineTo(lastPointX, canvas.height + 50);
            } else if (terrainPoints.length === 1) {
                 // If only one point, line to bottom right from that point
                 ctx.lineTo(p0x, canvas.height + 50);
            }
            // --- END SMOOTHER CURVE DRAWING ---

            // Go to the bottom right corner to close the shape for filling (handled slightly differently above)
            // if (terrainPoints.length > 0) { // This specific line is now redundant
            //      // Use the X of the last point, but ensure Y goes way down
            //     ctx.lineTo(terrainPoints[terrainPoints.length - 1].x, canvas.height + 50);
            // }
            ctx.lineTo(-TERRAIN_SEGMENT_WIDTH * 2, canvas.height + 50); // Back to bottom left
            ctx.closePath();
            ctx.fill();
            ctx.stroke(); // Draw outline on top
        }
    };

     const drawDistanceIndicator = () => {
         if (distanceToTerrain !== Infinity && distanceToTerrain <= MAX_SCORING_DISTANCE * 1.5) { // Show slightly beyond max score dist
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.7)'; // Yellow indicator line
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(player.x, player.y);
            ctx.lineTo(closestTerrainPoint.x, closestTerrainPoint.y);
            ctx.stroke();
         }
     };

    // --- Debugging ---
    const updateDebugInfo = (adjustedTilt = null, normalizedTilt = null) => {
        if (debugPanel.style.display !== 'none') {
            let sensorData = 'N/A';
            if (sensorsActive) {
                // Keep existing beta display or add gamma if needed
                sensorData = `Permission: ${sensorPermissionGranted}\nActive: ${sensorsActive}\nBeta (Pitch): ${event?.beta?.toFixed(2) ?? 'N/A'}\nGamma (Roll): ${event?.gamma?.toFixed(2) ?? 'N/A'}`; // Use optional chaining safely

                // Add the new debug info
                if (adjustedTilt !== null) {
                    sensorData += `\nAdjusted Tilt: ${adjustedTilt.toFixed(2)}`;
                }
                if (normalizedTilt !== null) {
                    sensorData += `\nNormalized Tilt: ${normalizedTilt.toFixed(2)}`;
                }
            } else {
                sensorData = `Permission: ${sensorPermissionGranted}\nActive: ${sensorsActive}\nStatus: ${sensorStatusDisplay.textContent}`;
            }

            // The rest of the text content assignment remains the same...
            debugOutput.textContent = `
    Timestamp: ${performance.now().toFixed(0)}
    Player X: ${player.x.toFixed(1)}, Y: ${player.y.toFixed(1)}
    Terrain Points: ${terrainPoints.length}
    Vertical Bias: ${verticalBias.toFixed(1)}
    Bias Target: ${verticalBiasTarget.toFixed(1)}
    Distance: ${distanceToTerrain.toFixed(1)}
    Closest Terrain Pt: (${closestTerrainPoint.x.toFixed(1)}, ${closestTerrainPoint.y.toFixed(1)})
    Score: ${score.toFixed(1)}
    Time Left: ${timeLeft}
    State: Running=${isRunning}, Paused=${isPaused}, GameOver=${isGameOver}, Won=${hasWon}
    Keys: ${JSON.stringify(keysPressed)}
    Screen: ${canvas.width}x${canvas.height}
    Mobile: ${isMobile}
    Sensors:\n ${sensorData}
    `;
        }
    };

    // Modify the update function signature to accept deltaTime
    const update = (deltaTime) => { // <<< ACCEPT deltaTime HERE
        if (!isRunning || !isPaused) { // Make sure time doesn't advance unless running and not paused
            // Accumulate elapsed time in seconds
            gameTimeElapsed += deltaTime / 1000;

            // Process input, update terrain (pass deltaTime if needed for speed), etc.
            processInput();
            updateTerrain(deltaTime); // Pass deltaTime for consistent movement speed
            const collisionDetected = calculateDistanceAndCollision();
            if (collisionDetected) {
                gameOver("Collision!");
                return;
            }
            updateScore(deltaTime);

            // Update UI timer (still uses interval, but could be moved here too)
        }
        // NOTE: The original timer logic uses setInterval. Keep it for simplicity,
        // but be aware gameTimeElapsed is a more precise measure of active play time.
    };

    const toggleDebugPanel = () => {
        if (debugPanel.style.display === 'none') {
            debugPanel.style.display = 'block';
            showDebugButton.textContent = "Debug"; // Keep main button text consistent
             updateDebugInfo(); // Update immediately when shown
        } else {
            debugPanel.style.display = 'none';
        }
    };


    // --- Game Loop ---
    const gameLoop = (timestamp) => {
        const deltaTime = timestamp - lastTimestamp;
        lastTimestamp = timestamp;

        if (!isRunning) { console.log("Game loop stopped."); return; } // Simplified exit condition log
        if (isPaused) { console.log("Game loop paused."); animationFrameId = requestAnimationFrame(gameLoop); return; } // Simplified pause log

        // --- Update ---
        update(deltaTime); // <<< CALL UPDATE ONCE HERE

        // --- DELETE THE FOLLOWING DUPLICATED LINES ---
        // processInput(); // DELETE
        // updateTerrain(deltaTime); // DELETE
        // const collisionDetected = calculateDistanceAndCollision(); // DELETE
        // if (collisionDetected) { // DELETE
        //     gameOver("Collision!"); // DELETE
        //     return; // DELETE
        // } // DELETE
        // updateScore(deltaTime); // DELETE
        // --- END DELETION ---

        // --- Draw ---
        // ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas (No longer needed as background fills)
        drawBackground(); // Draw sky first
        drawTerrain();
        drawPlayer();
        drawDistanceIndicator();

        // --- Debug --- (Update after drawing calculations)
        // Make sure updateDebugInfo doesn't rely on variables only set in the duplicated logic block
        // It should be okay as update() sets the necessary state variables like distanceToTerrain etc.
        updateDebugInfo(); // Pass necessary args if you kept that modification

        // Request next frame
        animationFrameId = requestAnimationFrame(gameLoop);
    };

    const setupDevControls = () => {
        const neutralAngleSlider = document.getElementById('dev-neutral-angle');
        const neutralAngleValue = document.getElementById('dev-neutral-angle-value');
        const maxDeviationSlider = document.getElementById('dev-max-deviation');
        const maxDeviationValue = document.getElementById('dev-max-deviation-value');
        const sensitivitySlider = document.getElementById('dev-sensitivity');
        const sensitivityValue = document.getElementById('dev-sensitivity-value');

        // Check if elements exist before adding listeners
        if (!neutralAngleSlider || !maxDeviationSlider || !sensitivitySlider) {
            console.warn("Dev control elements not found in HTML. Skipping setup.");
            // Make sure you added the HTML inside the #debug-panel div in index.html
            return;
        }

        // Set initial values from the 'let' variables
        neutralAngleSlider.value = NEUTRAL_TILT_ANGLE_PORTRAIT;
        neutralAngleValue.textContent = NEUTRAL_TILT_ANGLE_PORTRAIT.toFixed(1);
        maxDeviationSlider.value = MAX_TILT_DEVIATION;
        maxDeviationValue.textContent = MAX_TILT_DEVIATION.toFixed(1);
        sensitivitySlider.value = TILT_SENSITIVITY_MULTIPLIER;
        sensitivityValue.textContent = TILT_SENSITIVITY_MULTIPLIER.toFixed(2);

        // Add 'input' listeners to update variables when sliders change
        neutralAngleSlider.addEventListener('input', (e) => {
            NEUTRAL_TILT_ANGLE_PORTRAIT = parseFloat(e.target.value);
            neutralAngleValue.textContent = NEUTRAL_TILT_ANGLE_PORTRAIT.toFixed(1);
            // Also update the landscape one? Or add a separate slider? For now, just portrait.
            // NEUTRAL_TILT_ANGLE_LANDSCAPE might need separate handling if tuned differently.
        });

        maxDeviationSlider.addEventListener('input', (e) => {
            MAX_TILT_DEVIATION = parseFloat(e.target.value);
            maxDeviationValue.textContent = MAX_TILT_DEVIATION.toFixed(1);
        });

        sensitivitySlider.addEventListener('input', (e) => {
            TILT_SENSITIVITY_MULTIPLIER = parseFloat(e.target.value);
            sensitivityValue.textContent = TILT_SENSITIVITY_MULTIPLIER.toFixed(2);
        });

        console.log("Dev controls set up."); // Confirmation log
    };

    // --- Initialization ---
    const init = () => {
        console.log("Initializing Game...");
        targetScoreDisplay.textContent = TARGET_SCORE; // Set target display

         if(isMobile){
             gameContainer.classList.add('mobile');
             // Don't show touch controls immediately, wait for sensor check/failure
              hideFallbackControls();
              permissionButton.style.display = 'inline-block'; // Show button on mobile
         } else {
             gameContainer.classList.remove('mobile');
             permissionButton.style.display = 'none'; // Hide on desktop
              hideFallbackControls();
         }

        // Add event listeners
        // Modify the startButton listener to also request fullscreen
        startButton.addEventListener('click', () => {
            // Request fullscreen first (optional, but often good UX)
            enterFullscreen();
            // Then start the game
            startGame();
        });
        permissionButton.addEventListener('click', requestSensorPermission);
        resumeButton.addEventListener('click', togglePause); // Resume is just toggling pause off
        restartButton.addEventListener('click', () => {
             // Reset state completely before starting
             gameOverScreen.style.display = 'none'; // Hide game over screen
             startScreen.style.display = 'flex'; // Show start screen again
             // Reset sensor status UI potentially if needed, or let it persist
             // sensorStatusDisplay.textContent = "Sensor Status: Inactive";
             // gameContainer.className = isMobile ? 'mobile' : ''; // Reset container classes
             // resetGame(); // Maybe a function to fully reset all vars if needed
             // Then call startGame() or let user click start again
             startGame(); // Direct restart for now
        });

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        // Touch controls listeners
        touchControls.addEventListener('touchstart', handleTouchStart, { passive: false });
        touchControls.addEventListener('touchend', handleTouchEnd, { passive: false });
        touchControls.addEventListener('touchcancel', handleTouchEnd, { passive: false }); // Handle cancelled touches

        // Debug panel listeners
         showDebugButton.addEventListener('click', toggleDebugPanel);
         toggleDebugButton.addEventListener('click', toggleDebugPanel); // Button inside panel


        // Handle window resize
        window.addEventListener('resize', resizeCanvas);

        setupDevControls();
        setupColorModeControls(); // Add this line

        // Set initial state
        resizeCanvas(); // Initial sizing
        startScreen.style.display = 'flex'; // Show start screen initially
         debugPanel.style.display = 'none'; // Hide debug initially
         updateDebugInfo(); // Initial debug state

        console.log("Initialization Complete. Ready to Start.");
    };

    const setupColorModeControls = () => {
        const colorModeButtons = document.querySelectorAll('#color-mode-controls button');
        if (!colorModeButtons || colorModeButtons.length === 0) {
            console.warn("Color mode control buttons not found in HTML. Skipping setup.");
            return;
        }

        colorModeButtons.forEach(button => {
            button.addEventListener('click', () => {
                const selectedMode = button.getAttribute('data-mode');
                if (colorModes[selectedMode]) {
                    currentColorMode = selectedMode;
                    console.log(`Color mode changed to: ${currentColorMode}`);
                    // Optional: Add visual feedback (e.g., highlight active button)
                    colorModeButtons.forEach(btn => btn.style.border = 'none');
                    button.style.border = '2px solid #0f0'; // Highlight selected
                } else {
                    console.warn(`Invalid color mode selected: ${selectedMode}`);
                }
            });
            // Set initial highlight for the default mode
            if (button.getAttribute('data-mode') === currentColorMode) {
                 button.style.border = '2px solid #0f0';
            }
        });

        console.log("Color mode controls set up.");
    };

    // --- Start Everything ---
    init();

}); // End DOMContentLoaded
