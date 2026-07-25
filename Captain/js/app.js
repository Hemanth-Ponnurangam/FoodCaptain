import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
const THRESHOLD = 10;

// Protect the route: Kick to login page if not authenticated
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        listenToStats(); 
    } else {
        window.location.href = "login.html";
    }
});

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
            alert("Error saving vote.");
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