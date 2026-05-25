/**
 * AR Gesture Canvas - AR Multiverse Portal
 * A high-performance web application using Canvas API, WebRTC, and MediaPipe Hands
 * for real-time hand tracking and portal rendering with multiple visual filters.
 */

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const CONFIG = {
    // Performance settings
    OFFSCREEN_WIDTH: 320,
    OFFSCREEN_HEIGHT: 180,
    TARGET_FPS: 60,
    FRAME_BUFFER_SIZE: 12, // 0.2s delay at 60fps
    
    // Hand tracking thresholds
    PINCH_THRESHOLD: 0.05, // Distance between thumb and index finger
    PINCH_CONFIDENCE: 0.5,
    MIN_HAND_CONFIDENCE: 0.3,
    
    // Portal rendering
    PORTAL_ELASTICITY: 0.15, // Bezier curve bowing effect
    MIN_PORTAL_SIZE: 100,
    
    // Filter settings
    EMOJI_PIXEL_SIZE: 8,
    ASCII_PIXEL_SIZE: 12,
    CRT_SCANLINE_OPACITY: 0.15,
    GLITCH_MAX_OFFSET: 8,
    POINTCLOUD_PARTICLE_SIZE: 2,
};

// ============================================================================
// GLOBAL STATE
// ============================================================================

const state = {
    // Canvas & context
    mainCanvas: null,
    mainCtx: null,
    portalCanvas: null,
    portalCtx: null,
    offscreenCanvas: null,
    offscreenCtx: null,
    
    // Video & camera
    video: null,
    videoStream: null,
    
    // Hand tracking
    hands: null,
    handLandmarks: null,
    
    // Portal state
    portalActive: false,
    portalVertices: [
        { x: 200, y: 150 },
        { x: 400, y: 150 },
        { x: 400, y: 350 },
        { x: 200, y: 350 }
    ],
    
    // Frame buffer (for video delay effect)
    frameBuffer: [],
    frameBufferIndex: 0,
    
    // Performance monitoring
    fps: 0,
    frameCount: 0,
    lastTime: performance.now(),
    
    // UI state
    currentFilter: 'emoji',
    debugMode: false,
    initialized: false,
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate distance between two points
 */
function distance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Linear interpolation
 */
function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Check if user is making a pinch gesture with both hands
 */
function detectPinchGesture(landmarks) {
    if (!landmarks || landmarks.length !== 2) return false;
    
    const leftHand = landmarks[0];
    const rightHand = landmarks[1];
    
    // Check if both hands have sufficient confidence
    if (!leftHand || !rightHand) return false;
    
    // Get thumb and index finger positions
    // Landmark indices: thumb tip = 4, index tip = 8
    const leftThumb = leftHand[4];
    const leftIndex = leftHand[8];
    const rightThumb = rightHand[4];
    const rightIndex = rightHand[8];
    
    // Calculate pinch distances
    const leftPinch = distance(leftThumb, leftIndex);
    const rightPinch = distance(rightThumb, rightIndex);
    
    // Both hands should be pinching
    return leftPinch < CONFIG.PINCH_THRESHOLD && rightPinch < CONFIG.PINCH_THRESHOLD;
}

/**
 * Update portal vertices based on hand positions
 */
function updatePortalVertices(landmarks) {
    if (!landmarks || landmarks.length !== 2) return;
    
    const leftHand = landmarks[0];
    const rightHand = landmarks[1];
    
    if (!leftHand || !rightHand) return;
    
    // Use middle finger positions for portal corners
    // Landmark index 12 = middle finger PIP
    const leftMiddle = leftHand[12];
    const rightMiddle = rightHand[12];
    
    // Use ring finger for vertical offset
    const leftRing = leftHand[16];
    const rightRing = rightHand[16];
    
    // Update portal vertices
    state.portalVertices[0] = { x: leftMiddle.x, y: leftMiddle.y }; // Top-left
    state.portalVertices[1] = { x: rightMiddle.x, y: rightMiddle.y }; // Top-right
    state.portalVertices[2] = { x: rightRing.x, y: rightRing.y }; // Bottom-right
    state.portalVertices[3] = { x: leftRing.x, y: leftRing.y }; // Bottom-left
}

/**
 * Calculate Bezier curve control point for elastic effect
 */
function getElasticControlPoint(p1, p2, strength = CONFIG.PORTAL_ELASTICITY) {
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // Perpendicular offset for inward bowing
    const perpX = -dy / dist;
    const perpY = dx / dist;
    
    return {
        x: midX + perpX * dist * strength,
        y: midY + perpY * dist * strength
    };
}

// ============================================================================
// FILTER IMPLEMENTATIONS
// ============================================================================

/**
 * Apply Emoji Art filter (moon phases)
 */
function applyEmojiFilter(imageData) {
    const pixelSize = CONFIG.EMOJI_PIXEL_SIZE;
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    
    const emojis = ['🌑', '🌒', '🌓', '🌔', '🌕'];
    
    for (let y = 0; y < height; y += pixelSize) {
        for (let x = 0; x < width; x += pixelSize) {
            let brightness = 0;
            let count = 0;
            
            // Sample brightness in block
            for (let dy = 0; dy < pixelSize && y + dy < height; dy++) {
                for (let dx = 0; dx < pixelSize && x + dx < width; dx++) {
                    const idx = ((y + dy) * width + (x + dx)) * 4;
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];
                    brightness += (r + g + b) / 3;
                    count++;
                }
            }
            
            brightness = Math.round((brightness / count / 255) * 4);
            // Draw emoji on offscreen canvas
            state.offscreenCtx.fillStyle = '#fff';
            state.offscreenCtx.font = `${pixelSize * 1.2}px Arial`;
            state.offscreenCtx.textAlign = 'center';
            state.offscreenCtx.textBaseline = 'middle';
            state.offscreenCtx.fillText(emojis[brightness], x + pixelSize / 2, y + pixelSize / 2);
        }
    }
}

/**
 * Apply Heart Vibe filter
 */
function applyHeartFilter(imageData) {
    const pixelSize = CONFIG.EMOJI_PIXEL_SIZE;
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    
    const hearts = ['🖤', '🤎', '💜', '💖', '🤍'];
    
    for (let y = 0; y < height; y += pixelSize) {
        for (let x = 0; x < width; x += pixelSize) {
            let brightness = 0;
            let count = 0;
            
            // Sample brightness in block
            for (let dy = 0; dy < pixelSize && y + dy < height; dy++) {
                for (let dx = 0; dx < pixelSize && x + dx < width; dx++) {
                    const idx = ((y + dy) * width + (x + dx)) * 4;
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];
                    brightness += (r + g + b) / 3;
                    count++;
                }
            }
            
            brightness = Math.round((brightness / count / 255) * 4);
            state.offscreenCtx.fillStyle = '#fff';
            state.offscreenCtx.font = `${pixelSize * 1.2}px Arial`;
            state.offscreenCtx.textAlign = 'center';
            state.offscreenCtx.textBaseline = 'middle';
            state.offscreenCtx.fillText(hearts[brightness], x + pixelSize / 2, y + pixelSize / 2);
        }
    }
}

/**
 * Apply ASCII Art filter (Matrix style)
 */
function applyASCIIFilter(imageData) {
    const pixelSize = CONFIG.ASCII_PIXEL_SIZE;
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    
    const chars = ['@', '#', 'S', '%', '+', '.', ' '];
    
    state.offscreenCtx.fillStyle = '#00ff00';
    state.offscreenCtx.font = `bold ${pixelSize * 0.7}px "Courier New"`;
    state.offscreenCtx.textAlign = 'center';
    state.offscreenCtx.textBaseline = 'middle';
    
    for (let y = 0; y < height; y += pixelSize) {
        for (let x = 0; x < width; x += pixelSize) {
            let brightness = 0;
            let count = 0;
            
            for (let dy = 0; dy < pixelSize && y + dy < height; dy++) {
                for (let dx = 0; dx < pixelSize && x + dx < width; dx++) {
                    const idx = ((y + dy) * width + (x + dx)) * 4;
                    brightness += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
                    count++;
                }
            }
            
            const charIdx = Math.round((brightness / count / 255) * 6);
            state.offscreenCtx.fillText(chars[charIdx], x + pixelSize / 2, y + pixelSize / 2);
        }
    }
}

/**
 * Apply Glitch Art filter (RGB separation + tearing)
 */
function applyGlitchFilter(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const newData = new Uint8ClampedArray(data);
    
    // Random horizontal tearing
    for (let i = 0; i < 10; i++) {
        const startY = Math.floor(Math.random() * height);
        const offsetX = (Math.random() - 0.5) * CONFIG.GLITCH_MAX_OFFSET * 2;
        
        for (let y = startY; y < Math.min(startY + 15, height); y++) {
            for (let x = 0; x < width; x++) {
                const newX = Math.round(x + offsetX) % width;
                if (newX >= 0 && newX < width) {
                    const srcIdx = (y * width + newX) * 4;
                    const dstIdx = (y * width + x) * 4;
                    newData[dstIdx] = data[srcIdx];
                    newData[dstIdx + 1] = data[srcIdx + 1];
                    newData[dstIdx + 2] = data[srcIdx + 2];
                    newData[dstIdx + 3] = data[srcIdx + 3];
                }
            }
        }
    }
    
    // RGB chromatic aberration
    const chromaOffset = 3;
    for (let y = 0; y < height; y++) {
        for (let x = chromaOffset; x < width; x++) {
            const idx = (y * width + x) * 4;
            const srcIdxR = (y * width + (x - chromaOffset)) * 4;
            const srcIdxB = (y * width + (x + chromaOffset)) * 4;
            
            newData[idx] = data[srcIdxR]; // Red from left
            newData[idx + 2] = data[srcIdxB + 2]; // Blue from right
        }
    }
    
    // Copy back to imageData
    for (let i = 0; i < data.length; i++) {
        data[i] = newData[i];
    }
}

/**
 * Apply CRT Monitor filter
 */
function applyCRTFilter(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    
    // Add scanlines
    for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            data[idx] = Math.round(data[idx] * (1 - CONFIG.CRT_SCANLINE_OPACITY));
            data[idx + 1] = Math.round(data[idx + 1] * (1 - CONFIG.CRT_SCANLINE_OPACITY));
            data[idx + 2] = Math.round(data[idx + 2] * (1 - CONFIG.CRT_SCANLINE_OPACITY));
        }
    }
    
    // Simulate RGB pixel arrangement with slight desaturation
    for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        data[i] = Math.round(lerp(data[i], avg, 0.1));
        data[i + 1] = Math.round(lerp(data[i + 1], avg, 0.1));
        data[i + 2] = Math.round(lerp(data[i + 2], avg, 0.1));
    }
}

/**
 * Apply Point Cloud filter (3D perspective)
 */
function applyPointCloudFilter(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const time = performance.now() * 0.001;
    
    state.offscreenCtx.fillStyle = '#000';
    state.offscreenCtx.fillRect(0, 0, width, height);
    
    const step = CONFIG.POINTCLOUD_PARTICLE_SIZE * 3;
    const centerX = width / 2;
    const centerY = height / 2;
    
    for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
            const idx = (y * width + x) * 4;
            const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
            
            // Use brightness as Z-depth
            const depth = brightness / 255;
            const scale = lerp(0.3, 1, depth);
            
            // Apply 3D rotation
            const angle = time + (x + y) * 0.001;
            const rotX = Math.cos(angle) * scale;
            const rotY = Math.sin(angle) * scale;
            
            const screenX = centerX + (x - centerX) * rotX;
            const screenY = centerY + (y - centerY) * rotY;
            
            // Draw point
            state.offscreenCtx.fillStyle = `hsl(200, 100%, ${brightness / 2.55}%)`;
            state.offscreenCtx.fillRect(screenX - CONFIG.POINTCLOUD_PARTICLE_SIZE / 2, 
                                       screenY - CONFIG.POINTCLOUD_PARTICLE_SIZE / 2,
                                       CONFIG.POINTCLOUD_PARTICLE_SIZE,
                                       CONFIG.POINTCLOUD_PARTICLE_SIZE);
        }
    }
}

/**
 * Apply selected filter to offscreen canvas
 */
function applyFilter(imageData, filterType) {
    switch (filterType) {
        case 'emoji':
            applyEmojiFilter(imageData);
            break;
        case 'heart':
            applyHeartFilter(imageData);
            break;
        case 'ascii':
            applyASCIIFilter(imageData);
            break;
        case 'glitch':
            applyGlitchFilter(imageData);
            break;
        case 'crt':
            applyCRTFilter(imageData);
            break;
        case 'pointcloud':
            applyPointCloudFilter(imageData);
            break;
    }
}

// ============================================================================
// FRAME BUFFER (Ring Buffer for Video Delay)
// ============================================================================

/**
 * Initialize frame buffer pool
 */
function initFrameBuffer() {
    state.frameBuffer = [];
    for (let i = 0; i < CONFIG.FRAME_BUFFER_SIZE; i++) {
        state.frameBuffer.push(null);
    }
    state.frameBufferIndex = 0;
}

/**
 * Store frame in delay buffer
 */
function storeFrameInBuffer(canvas) {
    const offscreenBuffer = new OffscreenCanvas(canvas.width, canvas.height);
    const ctx = offscreenBuffer.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    state.frameBuffer[state.frameBufferIndex] = offscreenBuffer;
    state.frameBufferIndex = (state.frameBufferIndex + 1) % CONFIG.FRAME_BUFFER_SIZE;
}

/**
 * Get delayed frame from buffer
 */
function getDelayedFrame() {
    const delayedIndex = (state.frameBufferIndex - 1 + CONFIG.FRAME_BUFFER_SIZE) % CONFIG.FRAME_BUFFER_SIZE;
    return state.frameBuffer[delayedIndex];
}

// ============================================================================
// RENDERING ENGINE
// ============================================================================

/**
 * Render video frame to main canvas
 */
function renderMainCanvas() {
    if (!state.video || state.video.readyState !== HTMLMediaElement.HAVE_ENOUGH_DATA) {
        return;
    }
    
    // Draw mirrored video feed
    state.mainCtx.save();
    state.mainCtx.scale(-1, 1);
    state.mainCtx.drawImage(state.video, -state.mainCanvas.width, 0);
    state.mainCtx.restore();
    
    // Draw hand landmarks if debug mode
    if (state.debugMode && state.handLandmarks) {
        drawHandLandmarks();
    }
}

/**
 * Draw hand landmarks for debug visualization
 */
function drawHandLandmarks() {
    state.mainCtx.fillStyle = 'rgba(0, 255, 0, 0.3)';
    state.mainCtx.strokeStyle = '#00ff00';
    state.mainCtx.lineWidth = 2;
    
    const canvasWidth = state.mainCanvas.width;
    
    state.handLandmarks.forEach(hand => {
        // Draw connections
        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
            [0, 5], [5, 6], [6, 7], [7, 8], // Index
            [0, 9], [9, 10], [10, 11], [11, 12], // Middle
            [0, 13], [13, 14], [14, 15], [15, 16], // Ring
            [0, 17], [17, 18], [18, 19], [19, 20] // Pinky
        ];
        
        connections.forEach(([start, end]) => {
            if (hand[start] && hand[end]) {
                state.mainCtx.beginPath();
                state.mainCtx.moveTo(canvasWidth - hand[start].x * canvasWidth, hand[start].y * state.mainCanvas.height);
                state.mainCtx.lineTo(canvasWidth - hand[end].x * canvasWidth, hand[end].y * state.mainCanvas.height);
                state.mainCtx.stroke();
            }
        });
        
        // Draw landmarks
        hand.forEach(landmark => {
            state.mainCtx.beginPath();
            state.mainCtx.arc(canvasWidth - landmark.x * canvasWidth, landmark.y * state.mainCanvas.height, 4, 0, Math.PI * 2);
            state.mainCtx.fill();
        });
    });
}

/**
 * Process and render portal
 */
function renderPortal() {
    if (!state.portalActive || !state.video) {
        return;
    }
    
    // Draw video frame to offscreen canvas
    state.offscreenCtx.drawImage(state.video, 0, 0, CONFIG.OFFSCREEN_WIDTH, CONFIG.OFFSCREEN_HEIGHT);
    
    // Get image data and apply filter
    const imageData = state.offscreenCtx.getImageData(0, 0, CONFIG.OFFSCREEN_WIDTH, CONFIG.OFFSCREEN_HEIGHT);
    applyFilter(imageData, state.currentFilter);
    state.offscreenCtx.putImageData(imageData, 0, 0);
    
    // Store in frame buffer for delay effect
    storeFrameInBuffer(state.offscreenCanvas);
    
    // Get delayed frame
    const delayedFrame = getDelayedFrame();
    
    // Draw portal on main portal canvas
    state.portalCtx.clearRect(0, 0, state.portalCanvas.width, state.portalCanvas.height);
    
    // Calculate scale factors
    const scaleX = state.portalCanvas.width / CONFIG.OFFSCREEN_WIDTH;
    const scaleY = state.portalCanvas.height / CONFIG.OFFSCREEN_HEIGHT;
    
    // Draw quadrilateral portal with elastic edges using Bezier curves
    state.portalCtx.save();
    state.portalCtx.strokeStyle = 'rgba(100, 255, 200, 0.8)';
    state.portalCtx.lineWidth = 3;
    state.portalCtx.fillStyle = 'rgba(100, 255, 200, 0.1)';
    
    // Create path with elastic edges
    const v = state.portalVertices;
    
    // Top edge (elastic)
    const cp1 = getElasticControlPoint(v[0], v[1]);
    
    // Right edge (elastic)
    const cp2 = getElasticControlPoint(v[1], v[2]);
    
    // Bottom edge (elastic)
    const cp3 = getElasticControlPoint(v[2], v[3]);
    
    // Left edge (elastic)
    const cp4 = getElasticControlPoint(v[3], v[0]);
    
    state.portalCtx.beginPath();
    state.portalCtx.moveTo(v[0].x, v[0].y);
    state.portalCtx.quadraticCurveTo(cp1.x, cp1.y, v[1].x, v[1].y);
    state.portalCtx.quadraticCurveTo(cp2.x, cp2.y, v[2].x, v[2].y);
    state.portalCtx.quadraticCurveTo(cp3.x, cp3.y, v[3].x, v[3].y);
    state.portalCtx.quadraticCurveTo(cp4.x, cp4.y, v[0].x, v[0].y);
    state.portalCtx.closePath();
    
    // Clip region for portal
    state.portalCtx.clip();
    
    // Draw filtered content inside portal
    if (delayedFrame) {
        state.portalCtx.drawImage(delayedFrame, 0, 0, state.portalCanvas.width, state.portalCanvas.height);
    }
    
    state.portalCtx.restore();
    
    // Draw portal border
    state.portalCtx.strokeStyle = 'rgba(100, 255, 200, 0.8)';
    state.portalCtx.lineWidth = 2;
    state.portalCtx.beginPath();
    state.portalCtx.moveTo(v[0].x, v[0].y);
    state.portalCtx.quadraticCurveTo(cp1.x, cp1.y, v[1].x, v[1].y);
    state.portalCtx.quadraticCurveTo(cp2.x, cp2.y, v[2].x, v[2].y);
    state.portalCtx.quadraticCurveTo(cp3.x, cp3.y, v[3].x, v[3].y);
    state.portalCtx.quadraticCurveTo(cp4.x, cp4.y, v[0].x, v[0].y);
    state.portalCtx.closePath();
    state.portalCtx.stroke();
}

/**
 * Update FPS counter
 */
function updateFPS() {
    state.frameCount++;
    const currentTime = performance.now();
    const deltaTime = currentTime - state.lastTime;
    
    if (deltaTime >= 1000) {
        state.fps = Math.round(state.frameCount * 1000 / deltaTime);
        state.frameCount = 0;
        state.lastTime = currentTime;
        
        document.getElementById('fps').textContent = `FPS: ${state.fps}`;
    }
}

/**
 * Main render loop
 */
function render() {
    renderMainCanvas();
    renderPortal();
    updateFPS();
    requestAnimationFrame(render);
}

// ============================================================================
// MEDIAPIPE HANDS SETUP
// ============================================================================

/**
 * Initialize MediaPipe Hands
 */
async function initMediaPipeHands() {
    const Hands = window.Hands;
    
    state.hands = new Hands({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1642516936/${file}`;
        }
    });
    
    state.hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: CONFIG.MIN_HAND_CONFIDENCE,
        minTrackingConfidence: 0.5,
    });
    
    state.hands.onResults(onHandsResults);
}

/**
 * Handle MediaPipe Hands detection results
 */
function onHandsResults(results) {
    state.handLandmarks = results.multiHandLandmarks;
    
    if (state.handLandmarks && state.handLandmarks.length > 0) {
        // Check for pinch gesture
        if (detectPinchGesture(state.handLandmarks)) {
            if (!state.portalActive) {
                state.portalActive = true;
                document.getElementById('status').textContent = 'Portal: OPEN';
            }
            // Update portal vertices
            updatePortalVertices(state.handLandmarks);
        } else {
            if (state.portalActive) {
                state.portalActive = false;
                document.getElementById('status').textContent = 'Portal: closed';
            }
        }
    } else {
        state.portalActive = false;
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize webcam
 */
async function initWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        
        state.video = document.createElement('video');
        state.video.setAttribute('playsinline', true);
        state.video.srcObject = stream;
        state.video.play();
        
        return new Promise((resolve) => {
            state.video.onloadedmetadata = () => {
                resolve();
            };
        });
    } catch (error) {
        console.error('Failed to access webcam:', error);
        alert('Please enable webcam access to use this application.');
        throw error;
    }
}

/**
 * Initialize all canvases
 */
function initCanvases() {
    // Main canvas
    state.mainCanvas = document.getElementById('mainCanvas');
    state.mainCtx = state.mainCanvas.getContext('2d');
    state.mainCanvas.width = window.innerWidth;
    state.mainCanvas.height = window.innerHeight;
    
    // Portal canvas
    state.portalCanvas = document.getElementById('portalCanvas');
    state.portalCtx = state.portalCanvas.getContext('2d');
    state.portalCanvas.width = window.innerWidth;
    state.portalCanvas.height = window.innerHeight;
    
    // Offscreen canvas for processing
    state.offscreenCanvas = new OffscreenCanvas(CONFIG.OFFSCREEN_WIDTH, CONFIG.OFFSCREEN_HEIGHT);
    state.offscreenCtx = state.offscreenCanvas.getContext('2d');
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Filter selector
    document.getElementById('filterSelect').addEventListener('change', (e) => {
        state.currentFilter = e.target.value;
    });
    
    // Debug toggle
    document.getElementById('debugToggle').addEventListener('click', () => {
        state.debugMode = !state.debugMode;
        document.getElementById('debugToggle').style.opacity = state.debugMode ? '1' : '0.6';
    });
    
    // Handle window resize
    window.addEventListener('resize', () => {
        state.mainCanvas.width = window.innerWidth;
        state.mainCanvas.height = window.innerHeight;
        state.portalCanvas.width = window.innerWidth;
        state.portalCanvas.height = window.innerHeight;
    });
}

/**
 * Main initialization
 */
async function initialize() {
    try {
        document.getElementById('status').textContent = 'Loading...';
        
        // Initialize canvases
        initCanvases();
        
        // Initialize frame buffer
        initFrameBuffer();
        
        // Initialize webcam
        await initWebcam();
        document.getElementById('status').textContent = 'Webcam ready...';
        
        // Initialize MediaPipe Hands
        await initMediaPipeHands();
        document.getElementById('status').textContent = 'Ready!';
        
        // Setup event listeners
        setupEventListeners();
        
        // Send frames to MediaPipe
        const onFrame = async () => {
            await state.hands.send({ image: state.video });
            requestAnimationFrame(onFrame);
        };
        
        onFrame();
        
        // Start render loop
        state.initialized = true;
        render();
        
    } catch (error) {
        console.error('Initialization failed:', error);
        document.getElementById('status').textContent = 'Error initializing';
    }
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
