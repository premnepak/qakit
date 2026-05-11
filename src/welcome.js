// welcome.js — QAKit v1.0.4 welcome / permission-request page

const enableBtn = document.getElementById('enableBtn');
const skipBtn   = document.getElementById('skipBtn');
const status    = document.getElementById('status');

chrome.permissions.contains({ permissions: ['downloads'] }, (has) => {
  if (has) {
    enableBtn.textContent = '✓ Screenshot saving already enabled';
    enableBtn.disabled = true;
    status.textContent = 'You\'re all set — screenshots will always prompt for a save location.';
  }
});

function closeTab() {
  chrome.tabs.getCurrent((tab) => {
    if (tab) chrome.tabs.remove(tab.id);
  });
}

enableBtn.addEventListener('click', () => {
  chrome.permissions.request({ permissions: ['downloads'] }, (granted) => {
    if (granted) {
      enableBtn.textContent = '✓ Enabled — thank you!';
      enableBtn.disabled = true;
      status.textContent = 'Screenshot saving is now enabled. This tab will close shortly.';
      setTimeout(closeTab, 1500);
    } else {
      status.textContent = 'Permission not granted. You can enable it any time from the QAKit popup.';
    }
  });
});

skipBtn.addEventListener('click', closeTab);
