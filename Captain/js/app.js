// --- SPA Navigation Logic ---
window.switchTab = function(tabName) {
  // 1. Grab all views and navigation buttons
  const loginView = document.getElementById('login-view');
  const statsView = document.getElementById('stats-view');
  const navLogin = document.getElementById('nav-login');
  const navStats = document.getElementById('nav-stats');

  // 2. Reset everything (hide views, remove active state from buttons)
  loginView.classList.add('hidden');
  statsView.classList.add('hidden');
  navLogin.classList.remove('active');
  navStats.classList.remove('active');

  // 3. Show the selected view and highlight the active button
  if (tabName === 'login') {
    loginView.classList.remove('hidden');
    navLogin.classList.add('active');
  } else if (tabName === 'stats') {
    statsView.classList.remove('hidden');
    navStats.classList.add('active');
  }
};

// --- Form Handling ---
document.getElementById('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  
  // TODO: Add Firebase Auth signInWithEmailAndPassword here later
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  
  console.log('Login attempt with:', email);
  
  // Simulated login success -> Switch to stats tab automatically
  switchTab('stats');
});
