const express = require('express');
const { OpenAI } = require('openai');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize OpenAI client for OpenRouter
const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
});

// Use Gemma 2 27B on OpenRouter
const AI_MODEL = "google/gemma-2-27b-it";

// Initial Game State
let gameState = {
  timeInMinutes: 6 * 60, // Start at 6:00 AM
  day: 1,
  farmer: {
    energy: 100,
    hunger: 100,
    currentTask: "Waking up",
    location: "cabin" // Locations: cabin, farm, yard
  },
  weather: "sunny",
  schedule: [] // Array of upcoming tasks
};

// Long-term Memory - loaded from file for persistence
const MEMORY_FILE = path.join(__dirname, 'memory.json');
let farmerMemory = [];
try {
    if (fs.existsSync(MEMORY_FILE)) {
        farmerMemory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
        console.log(`Loaded ${farmerMemory.length} memories from disk.`);
    }
} catch (e) {
    console.error('Could not load memory file:', e.message);
}

function saveMemory() {
    try {
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(farmerMemory, null, 2));
    } catch (e) {
        console.error('Could not save memory:', e.message);
    }
}

let isThinking = false;

// Helper to format time (e.g., 6:30)
function formatTime(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

async function askAIForSchedule() {
    isThinking = true;
    console.log(`Asking AI (${AI_MODEL}) for next tasks...`);
    
    const prompt = `
    You are the brain of an autonomous farmer in a simulation. 
    Current State:
    - Time: Day ${gameState.day}, ${formatTime(gameState.timeInMinutes)}
    - Weather: ${gameState.weather}
    - Energy: ${Math.round(gameState.farmer.energy)}/100
    - Hunger: ${Math.round(gameState.farmer.hunger)}/100
    - Current Location: ${gameState.farmer.location}
    
    ${farmerMemory.length > 0 ? "CRITICAL INSTRUCTIONS FROM THE CREATOR (MUST OBEY):\n" + farmerMemory.map((m, i) => `${i+1}. ${m}`).join('\n') + "\n" : ""}
    
    Decide the next 3 tasks for the farmer. Each task should take between 15 and 60 minutes.
    Locations available EXACTLY as these strings: "cabin" (for resting/eating), "farm" (for working crops), "yard" (for wandering/fixing things).
    If Energy is low (< 30), prioritize resting in cabin.
    If Hunger is low (< 30), prioritize eating in cabin.
    Otherwise, do farm work or yard work depending on the time of day, ALWAYS honoring the CREATOR's instructions.
    
    Respond STRICTLY with a JSON array of objects, and nothing else. Do not use markdown blocks. Example:
    [
      { "durationMinutes": 30, "task": "eating breakfast", "location": "cabin" },
      { "durationMinutes": 60, "task": "watering the crops", "location": "farm" }
    ]
    `;

    try {
        const completion = await openai.chat.completions.create({
            model: AI_MODEL,
            messages: [{ role: "user", content: prompt }],
        });
        
        let text = completion.choices[0].message.content;
        
        // Clean up text if it contains markdown code blocks
        text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
        
        let parsed = [];
        try {
            parsed = JSON.parse(text);
        } catch (parseError) {
            console.error("Failed to parse JSON, falling back.", text);
            parsed = [{ durationMinutes: 30, task: "resting due to confusion", location: "cabin" }];
        }
        
        // Add start and end times to the schedule items
        let currentTime = gameState.timeInMinutes;
        gameState.schedule = parsed.map(item => {
            const start = currentTime;
            const end = start + item.durationMinutes;
            currentTime = end;
            return { ...item, start, end };
        });
        
        console.log("New Schedule received:");
        gameState.schedule.forEach(s => console.log(`- [${formatTime(s.start)} to ${formatTime(s.end)}] ${s.task} at ${s.location}`));
    } catch (e) {
        console.error("Error asking AI:", e.message);
        gameState.schedule = [{
            durationMinutes: 30,
            task: "resting and thinking about what to do",
            location: "cabin",
            start: gameState.timeInMinutes,
            end: gameState.timeInMinutes + 30
        }];
    } finally {
        isThinking = false;
    }
}

// --- GAME LOOP ---
// 1 real second = 1 game minute
setInterval(() => {
    gameState.timeInMinutes += 1; // Advance time by 1 minute
    gameState.day = Math.floor(gameState.timeInMinutes / (24 * 60)) + 1;

    // Process current schedule
    if (gameState.schedule.length > 0) {
        const currentScheduleItem = gameState.schedule[0];
        
        if (gameState.timeInMinutes >= currentScheduleItem.end) {
            // Task finished
            console.log(`Finished task: ${currentScheduleItem.task}`);
            gameState.schedule.shift();
        } else {
            // Task ongoing
            gameState.farmer.currentTask = currentScheduleItem.task;
            gameState.farmer.location = (currentScheduleItem.location || "yard").toLowerCase().trim();
            
            // Adjust stats continuously
            if (currentScheduleItem.location === "cabin") {
                gameState.farmer.energy = Math.min(100, gameState.farmer.energy + 0.5); // Regain energy
                if (currentScheduleItem.task.toLowerCase().includes("eat") || currentScheduleItem.task.toLowerCase().includes("breakfast") || currentScheduleItem.task.toLowerCase().includes("dinner")) {
                    gameState.farmer.hunger = Math.min(100, gameState.farmer.hunger + 3); // Gain food
                } else {
                    gameState.farmer.hunger = Math.max(0, gameState.farmer.hunger - 0.1);
                }
            } else {
                // Working or outside
                gameState.farmer.energy = Math.max(0, gameState.farmer.energy - 0.3); // Lose energy
                gameState.farmer.hunger = Math.max(0, gameState.farmer.hunger - 0.2); // Lose food
            }
        }
    } else {
        gameState.farmer.currentTask = "Waiting for new ideas...";
        if (!isThinking) {
            askAIForSchedule();
        }
    }

}, 1000); // Run loop every 1000ms (1 second)

// API Endpoint for frontend
app.get('/api/state', (req, res) => {
    res.json({
        ...gameState,
        formattedTime: formatTime(gameState.timeInMinutes),
        isThinking
    });
});

// API Endpoint for Chat
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });

    // Save user's instruction to long-term memory (persisted to disk)
    farmerMemory.push(message);
    saveMemory();

    try {
        const response = await openai.chat.completions.create({
            model: AI_MODEL,
            messages: [
                {
                    role: "system",
                    content: `You are Arash, a farmer living in an AI simulation. The user talking to you is the Creator/God of your world.
They have just given you a new rule or instruction.
Acknowledge their instruction in character, keeping your response under 2 sentences.
Current time is: ${formatTime(gameState.timeInMinutes)}. Day: ${gameState.day}.`
                },
                {
                    role: "user",
                    content: message
                }
            ]
        });
        
        const reply = response.choices[0].message.content.trim();
        res.json({ reply });
    } catch (e) {
        console.error("Chat Error:", e.message);
        res.status(500).json({ reply: "I am too tired to speak right now." });
    }
});

app.listen(port, "0.0.0.0", () => {
    console.log(`Game Server running on port ${port}`);
    console.log(`Simulated Time: 1 real second = 1 game minute`);
    askAIForSchedule(); // Get initial schedule
});
