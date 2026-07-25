// --- SPA Navigation Logic ---
window.switchTab = function(tabName) {
  // 1. Grab all views and navigation buttons
  const loginView = document.getElementById('login-view');
  const signupView = document.getElementById('signup-view');
  const statsView = document.getElementById('stats-view');
  
  const navLogin = document.getElementById('nav-login');
  const navStats = document.getElementById('nav-stats');

  // 2. Reset everything (hide views, remove active state from buttons)
  loginView.classList.add('hidden');
  signupView.classList.add('hidden');
  statsView.classList.add('hidden');
  
  navLogin.classList.remove('active');
  navStats.classList.remove('active');

  // 3. Show the selected view and highlight the active button
  if (tabName === 'login') {
    loginView.classList.remove('hidden');
    navLogin.classList.add('active'); // Highlight Auth tab
  } else if (tabName === 'signup') {
    signupView.classList.remove('hidden');
    navLogin.classList.add('active'); // Highlight Auth tab
  } else if (tabName === 'stats') {
    statsView.classList.remove('hidden');
    navStats.classList.add('active'); // Highlight Stats tab
  }
};

// --- Form Handling ---

// Login Form Submit Placeholder
document.getElementById('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  console.log('Login attempt with:', email);
  
  // Simulated login success -> Switch to stats tab automatically
  switchTab('stats');
});

// Sign Up Form Submit Placeholder
document.getElementById('signup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const email = document.getElementById('signup-email').value;
  console.log('Signup attempt with:', email);
  
  // Simulated signup success -> Switch to stats tab automatically
  switchTab('stats');
});
