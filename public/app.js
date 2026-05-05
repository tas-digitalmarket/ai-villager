import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- UI Elements ---
const els = {
    day: document.getElementById('day-val'),
    time: document.getElementById('time-val'),
    weather: document.getElementById('weather-val'),
    energy: document.getElementById('energy-val'),
    hunger: document.getElementById('hunger-val'),
    taskText: document.getElementById('task-text'),
    thinkingIndicator: document.getElementById('thinking-indicator'),
    scheduleList: document.getElementById('schedule-list'),
    loadingScreen: document.getElementById('loading-screen')
};

// --- Three.js Setup ---
const container = document.getElementById('scene-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#87CEEB'); 
scene.fog = new THREE.FogExp2('#87CEEB', 0.005); 

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 1000);
camera.position.set(50, 60, 100);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
renderer.toneMapping = THREE.ACESFilmicToneMapping; 
renderer.toneMappingExposure = 1.2;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.05;

// --- Lighting ---
const ambientLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6); 
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
sunLight.position.set(100, 150, 50);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 300;
const d = 100;
sunLight.shadow.camera.left = -d;
sunLight.shadow.camera.right = d;
sunLight.shadow.camera.top = d;
sunLight.shadow.camera.bottom = -d;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);

const groundGeo = new THREE.PlaneGeometry(500, 500);
const groundMat = new THREE.MeshStandardMaterial({ color: '#2e7d32', roughness: 0.8, metalness: 0.1 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.position.y = -2;
scene.add(ground);

// --- Game Logic Variables ---
let farmerModelGroup = null;
let currentTarget = new THREE.Vector3(0, 0, 0);
let currentAction = 'idle'; // Key of the animation to play

const LOCATIONS = {
    cabin: new THREE.Vector3(-40, 0, -20),
    yard: new THREE.Vector3(60, 0, 40),
    farm: new THREE.Vector3(-80, 0, 80)
};

// --- Animation Variables ---
let mixer = null;
let animActions = {}; // Will hold dynamically loaded FBX animations
let activeAnimAction = null;

function playAnim(name) {
    if (!mixer) return;
    
    // Fallback logic if specific animation doesn't exist
    let actionKey = name;
    if (!animActions[actionKey]) {
        if (name !== 'idle' && animActions['idle']) actionKey = 'idle';
        else return; // Animation doesn't exist
    }

    const action = animActions[actionKey];
    if (action === activeAnimAction) return;

    action.reset();
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.play();
    
    if (activeAnimAction) {
        activeAnimAction.crossFadeTo(action, 0.5, true);
    }
    activeAnimAction = action;
}

// --- Model Loading ---
const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();
let modelsLoaded = 0;
const totalModels = 2; // farm, farmer+animations

function checkLoading() {
    modelsLoaded++;
    if (modelsLoaded >= totalModels) {
        els.loadingScreen.style.opacity = '0';
        setTimeout(() => els.loadingScreen.style.display = 'none', 1000);
        setInterval(fetchState, 1000);
        fetchState();
    }
}

// 1. Load Farm
gltfLoader.load('models/farm.glb', (gltf) => {
    const farm = gltf.scene;
    const box = new THREE.Box3().setFromObject(farm);
    const size = box.getSize(new THREE.Vector3());
    const scale = 200 / Math.max(size.x, size.y, size.z);
    farm.scale.set(scale, scale, scale);
    
    box.setFromObject(farm);
    const center = box.getCenter(new THREE.Vector3());
    farm.position.sub(center);
    farm.position.y = 0;

    farm.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
    
    scene.add(farm);
    checkLoading();
}, undefined, (e) => { console.error('Farm load error:', e); checkLoading(); });

// 2. Load Farmer
gltfLoader.load('models/farmer1.glb', (gltf) => {
    const rawModel = gltf.scene;
    
    const box = new THREE.Box3().setFromObject(rawModel);
    const size = box.getSize(new THREE.Vector3());
    const scale = 8 / size.y;
    rawModel.scale.set(scale, scale, scale);
    // Offset feet to Y=0
    const scaledBox = new THREE.Box3().setFromObject(rawModel);
    rawModel.position.y = -scaledBox.min.y;

    // Create a dynamic bone map to solve FBX to GLB naming differences
    const boneMap = {};
    rawModel.traverse((child) => {
        if (child.isBone || child.type === 'Bone') {
            const baseName = child.name.replace(/.*mixamorig[_:]?/i, '').toLowerCase();
            boneMap[baseName] = child.name;
        }
    });

    farmerModelGroup = new THREE.Group();
    farmerModelGroup.add(rawModel);
    
    rawModel.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    farmerModelGroup.position.copy(LOCATIONS.cabin);
    scene.add(farmerModelGroup);

    mixer = new THREE.AnimationMixer(rawModel);

    // 3. Load FBX Animations
    const fbxFiles = ['Idle.fbx', 'Walk.fbx', 'run.fbx', 'sleep.fbx', 'water.fbx', 'weed.fbx'];
    let animsLoadedCount = 0;

    fbxFiles.forEach(file => {
        fbxLoader.load(`models/animations/${file}`, (fbx) => {
            if (fbx.animations.length > 0) {
                const clip = fbx.animations[0];
                const actionName = file.replace('.fbx', '').toLowerCase(); // e.g. "idle", "water"
                
                // Smart track retargeting to fix T-Pose
                clip.tracks.forEach(track => {
                    const parts = track.name.split('.');
                    if (parts.length === 2) {
                        const bonePart = parts[0];
                        const propPart = parts[1];
                        // Extract just the core bone name (e.g. LeftArm)
                        const baseName = bonePart.replace(/.*mixamorig[_:]?/i, '').toLowerCase();
                        if (boneMap[baseName]) {
                            // Map to the exact name in the GLB
                            track.name = boneMap[baseName] + '.' + propPart;
                        }
                    }
                });
                
                animActions[actionName] = mixer.clipAction(clip);
                console.log(`Loaded animation: ${actionName}`);
            }
            
            animsLoadedCount++;
            if (animsLoadedCount === fbxFiles.length) {
                playAnim('idle');
                checkLoading(); // Animations loaded
            }
        }, undefined, (e) => {
            console.error(`Error loading animation ${file}:`, e);
            animsLoadedCount++;
            if (animsLoadedCount === fbxFiles.length) {
                playAnim('idle');
                checkLoading();
            }
        });
    });

}, undefined, (e) => { console.error('Farmer load error:', e); checkLoading(); checkLoading(); });


// --- Server Polling ---
async function fetchState() {
    try {
        const response = await fetch('/api/state');
        const state = await response.json();
        updateUI(state);
        updateFarmerTarget(state.farmer.location);
        
        // Smart Action Mapping directly from the task text
        const task = state.farmer.currentTask.toLowerCase();
        
        // Match specific verbs based on the downloaded FBX files
        if (task.includes('water')) currentAction = 'water';
        else if (task.includes('weed') || task.includes('prune')) currentAction = 'weed';
        else if (task.includes('sleep') || task.includes('rest')) currentAction = 'sleep';
        else if (task.includes('run')) currentAction = 'run';
        // If it's a generic task and he's not resting, default to idle (or we could default to weed/water)
        else currentAction = 'idle'; 
        
        // Sun cycle
        const timeOfDay = (state.timeInMinutes % 1440) / 1440;
        const angle = (timeOfDay - 0.25) * Math.PI * 2;
        sunLight.position.x = Math.cos(angle) * 150;
        sunLight.position.y = Math.max(10, Math.sin(angle) * 150);
        sunLight.position.z = 50;
        
        if (timeOfDay > 0.7 || timeOfDay < 0.3) {
            sunLight.color.setHex(0xffaa55);
            scene.background.setHex(0x1a1a2e);
            ambientLight.intensity = 0.2;
        } else {
            sunLight.color.setHex(0xffffff);
            scene.background.setHex(0x87CEEB);
            ambientLight.intensity = 0.6;
        }

    } catch (e) {
        console.error("Error fetching state:", e);
    }
}

function formatTime(minutes) {
    const h = Math.floor(minutes / 60) % 24;
    const m = Math.floor(minutes % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function updateUI(state) {
    els.day.textContent = state.day;
    els.time.textContent = state.formattedTime;
    els.weather.textContent = state.weather;
    els.energy.textContent = Math.round(state.farmer.energy);
    els.hunger.textContent = Math.round(state.farmer.hunger);
    
    els.energy.style.color = state.farmer.energy < 30 ? '#ff1744' : '#f2a900';
    els.hunger.style.color = state.farmer.hunger < 30 ? '#ff1744' : '#e53935';

    els.taskText.textContent = state.farmer.currentTask;
    els.thinkingIndicator.style.display = state.isThinking ? 'block' : 'none';

    els.scheduleList.innerHTML = '';
    if (state.schedule.length === 0) {
        els.scheduleList.innerHTML = '<li>Waiting for AI...</li>';
    } else {
        state.schedule.forEach((item, i) => {
            const li = document.createElement('li');
            li.textContent = `${formatTime(item.start)} - ${formatTime(item.end)}: ${item.task}`;
            if (i === 0) li.style.color = '#4ecca3';
            els.scheduleList.appendChild(li);
        });
    }
}

function updateFarmerTarget(locationKey) {
    const target = LOCATIONS[locationKey] || LOCATIONS.yard;
    currentTarget.set(target.x, 0, target.z);
}

// --- Animation Loop ---
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (mixer) {
        mixer.update(delta);
    }

    if (farmerModelGroup && farmerModelGroup.children.length > 0) {
        const distance = farmerModelGroup.position.distanceTo(currentTarget);

        if (distance > 0.5) {
            // MOVING
            farmerModelGroup.position.lerp(currentTarget, 2 * delta);
            
            const lookPos = currentTarget.clone();
            lookPos.y = farmerModelGroup.position.y;
            farmerModelGroup.lookAt(lookPos);
            
            playAnim('walk');
        } else {
            // ARRIVED
            playAnim(currentAction);
        }
    }

    controls.update();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();

// --- Chat Logic ---
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const chatMessages = document.getElementById('chat-messages');

function appendMessage(text, isUser) {
    const div = document.createElement('div');
    div.className = `message ${isUser ? 'user' : 'ai'}`;
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    
    appendMessage(text, true);
    chatInput.value = '';
    chatSend.disabled = true;
    chatSend.textContent = '...';
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        });
        const data = await response.json();
        appendMessage(data.reply, false);
    } catch (e) {
        appendMessage("Error communicating with AI.", false);
    } finally {
        chatSend.disabled = false;
        chatSend.textContent = 'Send';
        chatInput.focus();
    }
}

chatSend.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

// --- Camera Toggle Logic ---
const camBtn = document.getElementById('camera-toggle');
let isInsideView = false;

camBtn.addEventListener('click', () => {
    isInsideView = !isInsideView;
    if (isInsideView) {
        // Snap camera to look inside the cabin
        // Cabin is around (-40, 0, -20). Let's put camera at the door looking in.
        camera.position.set(-40, 8, -5); 
        controls.target.set(-40, 4, -20);
        camBtn.textContent = '🌍 View Outside';
    } else {
        // Return to default external isometric view
        camera.position.set(50, 60, 100);
        controls.target.set(0, 0, 0);
        camBtn.textContent = '🏠 View Inside';
    }
    controls.update();
});
