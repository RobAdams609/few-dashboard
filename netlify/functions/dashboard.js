---

### 📁 `public/dashboard.js`
```js
import { fetchAgentMetrics } from "../netlify/functions/dashboard";

let currentMetricIndex = 0;
const metricTypes = ["av", "calls", "talkTime"];
const rotationInterval = 30000; // 30 seconds
let principleIndex = 0;
let lastPrincipleRotation = Date.now();

async function loadDashboard() {
  try {
    const response = await fetch("/.netlify/functions/dashboard");
    const data = await response.json();

    updatePrinciple(data.principleOfTheDay);
    updateTicker(data.salesTicker);
    updateAgentMetrics(data.agentStats);
  } catch (error) {
    console.error("Error loading dashboard:", error);
  }
}

function updatePrinciple(principle) {
  const banner = document.getElementById("principle-banner");
  if (banner) {
    banner.textContent = `THE FEW – EVERYONE WANTS TO EAT BUT FEW WILL HUNT | ${principle}`;
  }
}

function updateTicker(tickerText) {
  const ticker = document.getElementById("sales-ticker");
  if (ticker) {
    ticker.textContent = tickerText;
    ticker.classList.add("flash");
    setTimeout(() => ticker.classList.remove("flash"), 1500);
  }
}

function updateAgentMetrics(stats) {
  const metric = metricTypes[currentMetricIndex];
  const container = document.getElementById("agent-metrics");
  if (!container) return;

  container.innerHTML = "";

  const sorted = [...stats].sort((a, b) => b[metric] - a[metric]);

  sorted.forEach((agent, index) => {
    const row = document.createElement("div");
    row.className = "agent-row";

    const headshot = document.createElement("img");
    headshot.src = `headshots/${matchImageFile(agent.name)}`;
    headshot.alt = agent.name;
    headshot.className = "agent-img";

    const name = document.createElement("span");
    name.textContent = agent.name;

    const value = document.createElement("span");
    value.textContent =
      metric === "av" ? `$${agent[metric].toLocaleString()}` : agent[metric];

    if (index === 0) row.classList.add("first");
    if (index === 1) row.classList.add("second");
    if (index === 2) row.classList.add("third");
    if (index === sorted.length - 1) row.classList.add("last");

    row.append(headshot, name, value);
    container.appendChild(row);
  });

  currentMetricIndex = (currentMetricIndex + 1) % metricTypes.length;
}

function matchImageFile(name) {
  const mapping = {
    "Ajani": "3.jpg",
    "Anna": "7.jpg",
    "Eli": "11.jpg",
    "Fabricio": "4.jpg",
    "Fraitzline": "6.jpg",
    "Joseph": "10.jpg",
    "Marie Saint Cyr": "5.jpg",
    "Philip Baxter": "1.jpg",
    "Robert Adams": "2.jpg",
    "Michelle Landis": "9.jpg",
  };
  return mapping[name] || "8.jpg"; // fallback image
}

// Load once on init
loadDashboard();

// Rotate every 30s
setInterval(loadDashboard, rotationInterval);

// Rotate principle every 3 hours
setInterval(() => {
  principleIndex = (principleIndex + 1) % 11;
  loadDashboard();
}, 10800000);
```
