// js/app.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// DOM Elements
const loginSection = document.getElementById('login-section');
const signupSection = document.getElementById('signup-section');
const dashboardSection = document.getElementById('dashboard-section');
const userInfo = document.getElementById('user-info');

let currentUser = null;
const THRESHOLD = 10;

// UI Toggles for Login/Signup
document.getElementById('show-signup').addEventListener('click', (e) => {
    e.preventDefault();
    loginSection.classList.add('hidden');
    signupSection.classList.remove('hidden');
});

document.getElementById('show-login').addEventListener('click', (e) => {
    e.preventDefault();
    signupSection.classList.add('hidden');
    loginSection.classList.remove('hidden');
});

// Auth State Observer
onAuthStateChanged(auth, (user) => {
    if (user) {
        // User is signed in
        currentUser = user;
        loginSection.classList.add('hidden');
        signupSection.classList.add('hidden');
        dashboardSection.classList.remove('hidden');
        userInfo.classList.remove('hidden');
        listenToStats();
    } else {
        // User is signed out
        currentUser = null;
        loginSection.classList.remove('hidden');
        dashboardSection.classList.add('hidden');
        userInfo.classList.add('hidden');
    }
});

// Login Logic
document.getElementById('login-btn').addEventListener('click', () => {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    if(!email || !password) return alert("Please fill in both fields.");

    signInWithEmailAndPassword(auth, email, password)
        .catch(error => alert("Login Error: " + error.message));
});

// Sign-Up Logic
document.getElementById('signup-btn').addEventListener('click', () => {
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    if(!email || !password) return alert("Please fill in both fields.");

    createUserWithEmailAndPassword(auth, email, password)
        .catch(error => alert("Sign Up Error: " + error.message));
});

// Logout Logic
document.getElementById('logout-btn').addEventListener('click', () => {
    signOut(auth);
});

// Voting Logic
document.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        const type = e.target.dataset.type;
        const sessionId = "dinner_today"; 
        
        try {
            await setDoc(doc(db, "votes", `${sessionId}_${currentUser.uid}`), {
                uid: currentUser.uid,
                email: currentUser.email,
                selection: type,
                timestamp: new Date()
            });
            alert(`Vote cast successfully for: ${type === 'usual' ? 'Usual Menu' : 'Chicken Biryani'}`);
        } catch (error) {
            alert("Error saving vote. Check console for details.");
            console.error(error);
        }
    });
});

// Live Threshold & Stats Listener
function listenToStats() {
    const sessionId = "dinner_today";
    onSnapshot(doc(db, "stats", sessionId), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const specialVotes = data.specialCount || 0;
            const usualVotes = data.usualCount || 0;

            document.getElementById('stat-usual').textContent = usualVotes;
            document.getElementById('stat-special').textContent = specialVotes;
            document.getElementById('current-votes').textContent = specialVotes;
            
            const progressPercent = Math.min((specialVotes / THRESHOLD) * 100, 100);
            document.getElementById('vote-progress').style.width = `${progressPercent}%`;

            const statusCell = document.getElementById('stat-special-status');
            if (specialVotes >= THRESHOLD) {
                statusCell.textContent = "CONFIRMED";
                statusCell.style.color = "var(--primary-green)";
            } else {
                statusCell.textContent = `Pending (Needs ${THRESHOLD - specialVotes} more)`;
                statusCell.style.color = "#d97706";
            }
        }
    });
}
