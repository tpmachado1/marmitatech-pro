document.addEventListener('DOMContentLoaded', function(){
  const toggle = document.querySelectorAll('#theme-toggle');
  const root = document.documentElement;
  const stored = localStorage.getItem('marmita-theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  let theme = stored || (prefersDark ? 'dark' : 'light');
  root.setAttribute('data-theme', theme);
  function updateButtons(){
    toggle.forEach(btn=>{ if(btn) btn.textContent = theme === 'dark' ? '🌙' : '☀️'; });
  }
  updateButtons();
  toggle.forEach(btn=>{ if(!btn) return; btn.addEventListener('click', ()=>{
    theme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', theme);
    localStorage.setItem('marmita-theme', theme);
    updateButtons();
  })});
});