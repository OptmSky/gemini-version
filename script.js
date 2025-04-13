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
    const TERRAIN_SEGMENT_WIDTH = 20; // Width of each terrain segment
    const TERRAIN_BASE_SPEED = 2; // Pixels per frame base speed
    const TERRAIN_SMOOTHNESS = 0.1; // How much adjacent points influence each other
    const TERRAIN_ROUGHNESS = 50; // Max vertical change between segments
    const TERRAIN_INITIAL_SAFE_FACTOR = 0.6// Start terrain ~1.8x screen height down
    const CONTROL_SENSITIVITY = 1.5; // How much keys/tilt affect terrain bias
    const TILT_SENSITIVITY_MULTIPLIER = 0.15; // Adjusts tilt responsiveness
    const WARNING_TIME_SECONDS = 10; // When to show time warning

    // --- Game State Variables ---
    let score = 0;
    let timeLeft = TIME_LIMIT_SECONDS;
    let distanceToTerrain = Infinity;
    let closestTerrainPoint = { x: 0, y: 0 }; // For visual indicator line

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

    // --- Utility Functions ---
    const resizeCanvas = () => {
        const containerWidth = gameContainer.clientWidth;
        const containerHeight = gameContainer.clientHeight;

        // Maintain aspect ratio (e.g., 16:9)
        const aspectRatio = 16 / 9;
        let newWidth, newHeight;

        if (containerWidth / containerHeight > aspectRatio) {
            // Container is wider than aspect ratio, height is the limiting factor
            newHeight = containerHeight;
            newWidth = newHeight * aspectRatio;
        } else {
            // Container is taller or equal, width is the limiting factor
            newWidth = containerWidth;
            newHeight = newWidth / aspectRatio;
        }

        canvas.width = newWidth;
        canvas.height = newHeight;

        // Recalculate fixed player position based on new canvas size
        player.x = canvas.width * PLAYER_FIXED_X_PERCENT;
        player.y = canvas.height * PLAYER_FIXED_Y_PERCENT;

        // Adjust terrain generation if needed based on resize
        // (e.g., ensure enough points cover the new width)
        initializeTerrain(); // Re-init terrain on resize might be simplest
        verticalBias = canvas.height * TERRAIN_INITIAL_SAFE_FACTOR; // Reset bias safely
        verticalBiasTarget = verticalBias;

        console.log(`Resized canvas to: ${canvas.width}x${canvas.height}`);
        updateDebugInfo(); // Update debug info after resize
    };

    const lerp = (a, b, t) => a + (b - a) * t; // Linear interpolation

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

        // Determine primary tilt axis based on orientation (simple check)
        const isLandscape = window.innerWidth > window.innerHeight;
        let tiltValue = isLandscape ? event.gamma : event.beta; // Use roll in landscape, pitch in portrait

        if (tiltValue === null || tiltValue === undefined) {
            console.warn("Received null/undefined tilt value.");
            return;
        }

        // Normalize tilt value (e.g., map -30 to 30 degrees to -1 to 1)
        const maxTilt = 30; // degrees
        const normalizedTilt = Math.max(-1, Math.min(1, tiltValue / maxTilt));

        // === TILT CONTROL INVERSION ===
        // Map normalized tilt to vertical bias change
        // Tilting phone UP (positive normalizedTilt) should make terrain move DOWN (increase bias)
        // Tilting phone DOWN (negative normalizedTilt) should make terrain move UP (decrease bias)

        // Previous logic: verticalBiasTarget = canvas.height / 2 - normalizedTilt * ...
        // New logic: We adjust the *current* bias target based on tilt.
        // Let's calculate a target offset based on tilt and apply it relative to the neutral position (mid-screen baseline).
        const tiltInfluence = normalizedTilt * (canvas.height * 0.4) * TILT_SENSITIVITY_MULTIPLIER;

        // The target bias should be around the initial bias + the tilt influence.
        // Or more simply, calculate the target relative to the current bias?
        // Let's directly set the target based on the neutral baseline + tilt effect.
        // We need to consider the *initial* bias established in initializeTerrain. Let the baseline be the desired center for generated points (0 relative Y).
        const neutralBaselineBias = 0; // This might need adjustment if the initial bias wasn't centered. Let's assume 0 is the 'neutral' desired bias offset.

        // Target bias = neutral + influence. Tilting UP (positive normTilt) increases target bias -> terrain DOWN.
        // verticalBiasTarget = neutralBaselineBias + tiltInfluence; // This might cause sudden jumps if neutralBaselineBias is far from current bias.

        // Better approach: Adjust the *current* target based on tilt smoothly.
        // Let's try mapping tilt directly to the target bias relative to the screen center.
        // If tilt up (positive normTilt), we want higher bias target.
        verticalBiasTarget = 0 + tiltInfluence; // Target bias centers around 0 + tilt effect. Adjust '0' if neutral isn't center screen.

        // *** SIMPLER INVERSION ***: Just flip the sign in the original calculation line
        // verticalBiasTarget = canvas.height / 2 + normalizedTilt * (canvas.height * 0.4) * TILT_SENSITIVITY_MULTIPLIER; // WAS: minus normalizedTilt
        // Let's use this simpler one. It ties the bias target directly to the screen center plus tilt offset.
        // NOTE: This assumes canvas.height/2 is the absolute Y where bias = 0 corresponds to. Our relative system means bias=0 puts terrain points around canvas.height/2. This should work.

        verticalBiasTarget = canvas.height / 2 + normalizedTilt * (canvas.height * 0.4) * TILT_SENSITIVITY_MULTIPLIER;


        // === END TILT CONTROL INVERSION ===


        // Clamp the target? Maybe do it in processInput or after lerp. Let's skip clamping here for now.

        lastBeta = event.beta; // Store for debugging/potential future use
        updateDebugInfo();
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
        // Get the last Y *relative* to the baseline
        let lastRelativeY = terrainPoints.length > 0 ? terrainPoints[terrainPoints.length - 1].y : 0; // Default to 0 relative Y

        // Move existing points left
        for (let i = 0; i < terrainPoints.length; i++) {
            terrainPoints[i].x -= terrainSpeed * (deltaTime / (1000 / 60)); // Adjust speed based on deltaTime
            if (terrainPoints[i].x < -TERRAIN_SEGMENT_WIDTH * 2) { // Remove points well off-screen
                pointsToRemove++;
            }
        }

        // Remove points from the beginning of the array
        if (pointsToRemove > 0) {
            terrainPoints.splice(0, pointsToRemove);
        }

        // Add new points on the right edge
        while (lastX < canvas.width + TERRAIN_SEGMENT_WIDTH * 2) { // Generate points beyond the right edge
             lastX += TERRAIN_SEGMENT_WIDTH;

             // Generate Y relative to 0 (which represents the canvas.height / 2 baseline)
             let randomComponent = (Math.random() - 0.5) * TERRAIN_ROUGHNESS;
             // Smooth component uses the *relative* last Y, tending towards 0 (the baseline)
             let smoothComponent = lastRelativeY * (1 - TERRAIN_SMOOTHNESS);

             let nextRelativeY = smoothComponent + randomComponent; // Store this RELATIVE value

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
    
        // Add the corrected console log here:
        // Check if terrainYAtPlayerX was updated from its default; log only if relevant calculation happened.
        if (terrainYAtPlayerX !== canvas.height || distanceToTerrain !== canvas.height) {
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
    const drawPlayer = () => {
        ctx.fillStyle = 'red';
        ctx.fillRect(player.x - player.width / 2, player.y - player.height / 2, player.width, player.height);
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

        ctx.fillStyle = '#654321';
        ctx.strokeStyle = '#3a240d';
        ctx.lineWidth = 2;
        ctx.beginPath();

        if (terrainPoints.length > 0) {
            ctx.moveTo(-TERRAIN_SEGMENT_WIDTH * 2, canvas.height + 50); // Start below screen bottom left

            // Calculate the effective Y for the first point by applying baseline and current bias
            let firstEffectiveY = baseLineY + terrainPoints[0].y + verticalBias;
            ctx.lineTo(terrainPoints[0].x, Math.min(canvas.height + 50, firstEffectiveY)); // Clamp drawing below screen bottom

            // Draw line segments connecting terrain points, applying baseline and current bias to each
            for (let i = 0; i < terrainPoints.length; i++) {
                let effectiveY = baseLineY + terrainPoints[i].y + verticalBias;
                ctx.lineTo(terrainPoints[i].x, Math.min(canvas.height + 50, effectiveY));
            }

            // Go to the bottom right corner to close the shape for filling
            if (terrainPoints.length > 0) {
                 // Use the X of the last point, but ensure Y goes way down
                ctx.lineTo(terrainPoints[terrainPoints.length - 1].x, canvas.height + 50);
            }
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
    const updateDebugInfo = () => {
        if (debugPanel.style.display !== 'none') {
            let sensorData = 'N/A';
            if (sensorsActive) {
                 sensorData = `Permission: ${sensorPermissionGranted}\nActive: ${sensorsActive}\nBeta (Pitch): ${lastBeta !== null ? lastBeta.toFixed(2) : 'N/A'}\nGamma (Roll): ${window.orientationEventData ? window.orientationEventData.gamma.toFixed(2) : 'N/A'}`;
            } else {
                 sensorData = `Permission: ${sensorPermissionGranted}\nActive: ${sensorsActive}\nStatus: ${sensorStatusDisplay.textContent}`;
            }

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

        if (!isRunning) {
             console.log("Game loop stopped (not running).");
             return; // Stop loop if game ended
        }
        if (isPaused) {
            console.log("Game loop skipped (paused).");
             animationFrameId = requestAnimationFrame(gameLoop); // Still request frame to keep checking pause state
             return; // Skip updates and drawing if paused
        }

        // --- Update ---
        processInput(); // Read input and update verticalBiasTarget
        updateTerrain(deltaTime); // Move terrain, generate new points
        const collisionDetected = calculateDistanceAndCollision(); // Find distance, check collision
        if (collisionDetected) {
            gameOver("Collision!");
            return; // Stop processing this frame
        }
        updateScore(deltaTime); // Update score based on distance

        // --- Draw ---
        ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas
        drawTerrain();
        drawPlayer();
        drawDistanceIndicator();

        // --- Debug --- (Update after drawing calculations)
        updateDebugInfo();


        // Request next frame
        animationFrameId = requestAnimationFrame(gameLoop);
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
        startButton.addEventListener('click', startGame);
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

        // Set initial state
        resizeCanvas(); // Initial sizing
        // initializeTerrain(); // Called within startGame now
        startScreen.style.display = 'flex'; // Show start screen initially
         debugPanel.style.display = 'none'; // Hide debug initially
         updateDebugInfo(); // Initial debug state

        console.log("Initialization Complete. Ready to Start.");
    };

    // --- Start Everything ---
    init();

}); // End DOMContentLoaded