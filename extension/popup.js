// Send-to-anything - Command Palette Controller

let allProfiles = [];
let filteredProfiles = [];
let selectedIndex = 0;

document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.sync.get(['profiles']);
  allProfiles = data.profiles || [];
  filteredProfiles = [...allProfiles];

  const filterInput = document.getElementById('filterInput');
  const paletteList = document.getElementById('paletteList');
  const openOptionsLink = document.getElementById('openOptionsLink');

  openOptionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });

  filterInput.addEventListener('input', () => {
    const query = filterInput.value.toLowerCase().trim();
    if (!query) {
      filteredProfiles = [...allProfiles];
    } else {
      filteredProfiles = allProfiles.filter(p => {
        return p.name.toLowerCase().includes(query) ||
               p.command.toLowerCase().includes(query) ||
               (p.args && p.args.some(a => a.toLowerCase().includes(query)));
      });
    }
    selectedIndex = 0;
    renderList();
  });

  filterInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredProfiles.length > 0) {
        selectedIndex = (selectedIndex + 1) % filteredProfiles.length;
        renderList();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredProfiles.length > 0) {
        selectedIndex = (selectedIndex - 1 + filteredProfiles.length) % filteredProfiles.length;
        renderList();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredProfiles.length > 0) {
        runProfile(filteredProfiles[selectedIndex].id);
      }
    } else if (e.key === 'Escape') {
      window.close();
    }
  });

  renderList();
  filterInput.focus();
});

function renderList() {
  const paletteList = document.getElementById('paletteList');
  paletteList.innerHTML = '';

  if (filteredProfiles.length === 0) {
    paletteList.innerHTML = '<div class="empty-state">No matching profiles found.</div>';
    return;
  }

  filteredProfiles.forEach((profile, index) => {
    const item = document.createElement('div');
    item.className = 'palette-item' + (index === selectedIndex ? ' selected' : '');

    const main = document.createElement('div');
    main.className = 'palette-item-main';

    const name = document.createElement('div');
    name.className = 'palette-name';
    name.textContent = profile.name;

    const cmd = document.createElement('div');
    cmd.className = 'palette-cmd';
    if (profile.engine === 'plugin' || profile.backend_type === 'gemini_web') {
      cmd.textContent = '🌐 Plugin: Gemini Web';
      cmd.style.color = '#34d399';
    } else {
      cmd.textContent = `💻 Host: ${profile.command || 'cmd'}`;
    }

    main.appendChild(name);
    main.appendChild(cmd);

    const badges = document.createElement('div');
    badges.className = 'palette-badges';

    if (profile.shortcut) {
      const keyChip = document.createElement('span');
      keyChip.className = 'chip chip-key';
      keyChip.textContent = getShortcutTag(profile.shortcut);
      badges.appendChild(keyChip);
    }

    const modeChip = document.createElement('span');
    modeChip.className = 'chip';
    if (profile.expects_return === false) {
      modeChip.textContent = '➔ One-way';
      modeChip.style.background = '#475569';
    } else {
      modeChip.textContent = profile.output_mode || 'replace';
    }
    badges.appendChild(modeChip);

    item.appendChild(main);
    item.appendChild(badges);

    item.addEventListener('click', () => {
      runProfile(profile.id);
    });

    paletteList.appendChild(item);
  });

  // Ensure active element is scrolled into view
  const selectedEl = paletteList.children[selectedIndex];
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest' });
  }
}

function getShortcutTag(shortcut) {
  switch (shortcut) {
    case 'run-profile-1': return 'Alt+Shift+E';
    case 'run-profile-2': return 'Alt+Shift+S';
    case 'run-profile-3': return 'Alt+Shift+D';
    case 'run-profile-4': return 'Custom Key';
    default: return shortcut;
  }
}

function runProfile(profileId) {
  chrome.runtime.sendMessage({
    action: 'run-profile-by-id',
    profileId
  }, () => {
    window.close();
  });
}
