// js/app.js

// 1. Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 2. Import your keys from the separate config file
import { firebaseConfig } from "./firebase-config.js";

// 3. Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// DOM Elements
const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const ticketSection = document.getElementById('ticket-section');
const userInfo = document.getElementById('user-info');
const userEmailSpan = document.getElementById('user-email');

let currentUser = null;
const THRESHOLD = 10;

// Auth State Observer (Keeps users logged in automatically)
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        authSection.classList.add('hidden');
        dashboardSection.classList.remove('hidden');
        userInfo.classList.remove('hidden');
        userEmailSpan.textContent = user.email;
        listenToStats(); // Start real-time listeners for the Canteen stats
    } else {
        currentUser = null;
        authSection.classList.remove('hidden');
        dashboardSection.classList.add('hidden');
        ticketSection.classList.add('hidden');
        userInfo.classList.add('hidden');
    }
});

// Login Logic
document.getElementById('login-btn').addEventListener('click', () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    signInWithEmailAndPassword(auth, email, password)
        .catch(error => alert("Login failed: " + error.message));
});

// Logout Logic
document.getElementById('logout-btn').addEventListener('click', () => {
    signOut(auth);
});

// Voting Logic
document.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        const type = e.target.dataset.type;
        const sessionId = "dinner_today"; // In a real app, this changes based on the date/meal

        try {
            // Save vote to Firestore
            await setDoc(doc(db, "votes", `${sessionId}_${currentUser.uid}`), {
                uid: currentUser.uid,
                email: currentUser.email,
                selection: type,
                timestamp: new Date()
            });
            
            generateTicket(type);
        } catch (error) {
            alert("Error saving vote. Please try again.");
            console.error(error);
        }
    });
});

// Generate UI Ticket
function generateTicket(type) {
    ticketSection.classList.remove('hidden');
    document.getElementById('ticket-date').textContent = new Date().toLocaleDateString();
    
    // Extract name from email (e.g., john.doe@email.com -> john.doe)
    document.getElementById('ticket-name').textContent = currentUser.email.split('@')[0];
    
    if (type === 'usual') {
        document.getElementById('ticket-item').textContent = "Usual Menu (Chappati/Rajma)";
        document.getElementById('ticket-price').textContent = "65.00";
    } else {
        document.getElementById('ticket-item').textContent = "Special: Chicken Biryani";
        document.getElementById('ticket-price').textContent = "125.00";
    }
}

// Live Threshold & Stats Listener
function listenToStats() {
    const sessionId = "dinner_today";
    
    // Listen to the aggregate stats document
    onSnapshot(doc(db, "stats", sessionId), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const specialVotes = data.specialCount || 0;
            const usualVotes = data.usualCount || 0;

            // Update Canteen Dashboard Table
            document.getElementById('stat-usual').textContent = usualVotes;
            document.getElementById('stat-special').textContent = specialVotes;

            // Update Live Threshold Progress Bar on the voting card
            document.getElementById('current-votes').textContent = specialVotes;
            const progressPercent = Math.min((specialVotes / THRESHOLD) * 100, 100);
            document.getElementById('vote-progress').style.width = `${progressPercent}%`;

            // Threshold indicator text and colors
            const statusCell = document.getElementById('stat-special-status');
            if (specialVotes >= THRESHOLD) {
                statusCell.textContent = "CONFIRMED";
                statusCell.style.color = "green";
                document.getElementById('vote-progress').style.backgroundColor = "green";
            } else {
                statusCell.textContent = `Pending (Needs ${THRESHOLD - specialVotes} more)`;
                statusCell.style.color = "orange";
                document.getElementById('vote-progress').style.backgroundColor = "#ff9800";
            }
        }
    });
}