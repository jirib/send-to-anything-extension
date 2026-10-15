// Send-to-anything - Options Controller

const NATIVE_HOST = 'com.send.to.anything';

let currentProfiles = [];

const DEFAULT_PROFILES = [
  {
    id: 'profile-1',
    name: 'Gemini Web: Rewrite In-place',
    engine: 'plugin',
    plugin_id: 'gemini_web',
    expects_return: true,
    return_format: 'plain',
    format_template: '{{output}}',
    shortcut: 'run-profile-1',
    input_source: 'editable',
    instruction: 'Rewrite the following text concisely and professionally. Correct spelling and grammar, improve clarity, and preserve all meaning and factual details:\n\n%%actual_text%%\n\nReturn ONLY the rewritten text without greetings, conversational filler, or explanations.',
    command: '',
    args: '',
    input_mode: 'stdin',
    output_mode: 'replace',
    timeout_seconds: 60
  },
  {
    id: 'profile-2',
    name: 'Gemini Web: Summarize to Panel',
    engine: 'plugin',
    plugin_id: 'gemini_web',
    expects_return: true,
    return_format: 'plain',
    format_template: '{{output}}',
    shortcut: 'run-profile-2',
    input_source: 'selection',
    instruction: 'Summarize the following discussion into bullet points, key decisions, and open questions:\n\n%%actual_text%%\n\nReturn ONLY the summary without introductory remarks.',
    command: '',
    args: '',
    input_mode: 'stdin',
    output_mode: 'panel',
    timeout_seconds: 60
  },
  {
    id: 'profile-3',
    name: 'Send to Gemini Web (One-way)',
    engine: 'plugin',
    plugin_id: 'gemini_web',
    expects_return: false,
    return_format: 'plain',
    format_template: '',
    shortcut: '',
    input_source: 'selection',
    instruction: 'Please analyze the following text:\n\n%%actual_text%%',
    command: '',
    args: '',
    input_mode: 'stdin',
    output_mode: 'none',
    timeout_seconds: 30
  },
  {
    id: 'profile-4',
    name: 'CLI: JQ Format (Two-way)',
    engine: 'command',
    plugin_id: '',
    expects_return: true,
    return_format: 'plain',
    format_template: '{{output}}',
    shortcut: 'run-profile-3',
    input_source: 'editable',
    command: 'jq',
    args: '.',
    input_mode: 'both',
    output_mode: 'replace',
    timeout_seconds: 10
  },
  {
    id: 'profile-5',
    name: 'CLI: Gemini Flash Rewrite',
    engine: 'command',
    plugin_id: '',
    expects_return: true,
    return_format: 'plain',
    format_template: '{{output}}',
    shortcut: 'run-profile-4',
    input_source: 'editable',
    command: 'gemini',
    args: '-m gemini-2.5-flash --prompt "Rewrite concisely and professionally: %%actual_text%%"',
    input_mode: 'arg',
    output_mode: 'replace',
    timeout_seconds: 30
  }
];

document.addEventListener('DOMContentLoaded', async () => {
  await setupHostInfo();
  await loadProfiles();
  setupEventListeners();
});

async function detectBrowser() {
  // 1. Brave detection
  if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
    try {
      if (await navigator.brave.isBrave()) {
        return 'brave';
      }
    } catch (e) {}
  }

  // 2. UserAgentData brand detection
  if (navigator.userAgentData && Array.isArray(navigator.userAgentData.brands)) {
    const brands = navigator.userAgentData.brands.map(b => (b.brand || '').toLowerCase());
    if (brands.some(b => b.includes('microsoft edge') || b.includes('edge'))) {
      return 'edge';
    }
    if (brands.some(b => b.includes('brave'))) {
      return 'brave';
    }
    if (brands.some(b => b.includes('google chrome'))) {
      return 'chrome';
    }
    if (brands.some(b => b.includes('chromium'))) {
      return 'chromium';
    }
  }

  // 3. UserAgent fallback parsing
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('edg/')) {
    return 'edge';
  }
  if (ua.includes('brave')) {
    return 'brave';
  }
  if (ua.includes('chrome')) {
    if (navigator.vendor && navigator.vendor.includes('Google') && !ua.includes('chromium')) {
      return 'chrome';
    }
    return 'chromium';
  }

  return 'chromium';
}

async function setupHostInfo() {
  const extId = chrome.runtime.id || 'YOUR_EXTENSION_ID';
  document.getElementById('extensionIdText').textContent = extId;

  const detectedBrowser = await detectBrowser();
  const browserSelect = document.getElementById('browserSelect');
  if (browserSelect) {
    browserSelect.value = detectedBrowser;
  }

  function updateInstallCommand() {
    const targetBrowser = browserSelect ? browserSelect.value : detectedBrowser;
    const installCmd = `send-to-anything-host-bridge -install -browser ${targetBrowser} -extension-id ${extId}`;
    document.getElementById('installCmdText').textContent = installCmd;
  }

  updateInstallCommand();

  if (browserSelect) {
    browserSelect.addEventListener('change', updateInstallCommand);
  }

  document.getElementById('copyExtIdBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(extId);
    flashButton(document.getElementById('copyExtIdBtn'), 'Copied!');
  });

  document.getElementById('copyInstallCmdBtn').addEventListener('click', () => {
    const cmdText = document.getElementById('installCmdText').textContent;
    navigator.clipboard.writeText(cmdText);
    flashButton(document.getElementById('copyInstallCmdBtn'), 'Copied!');
  });
}

function flashButton(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = original; }, 1500);
}

function getArgsString(args) {
  if (!args) return '';
  if (typeof args === 'string') return args;
  if (Array.isArray(args)) {
    return args.map(arg => {
      if (typeof arg !== 'string') arg = String(arg);
      if (arg.includes(' ') || arg.includes('\t') || arg.includes('"')) {
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    }).join(' ');
  }
  return String(args);
}

function parseArgs(rawArgs) {
  if (!rawArgs) return [];
  if (Array.isArray(rawArgs)) return rawArgs;
  const args = [];
  const matches = rawArgs.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (matches) {
    for (const m of matches) {
      if ((m.startsWith('"') && m.endsWith('"')) || (m.startsWith("'") && m.endsWith("'"))) {
        args.push(m.slice(1, -1));
      } else {
        args.push(m);
      }
    }
  }
  return args;
}

function normalizeStoredProfile(profile) {
  // Normalize engine
  if (!profile.engine) {
    if (profile.backend_type === 'gemini_web') {
      profile.engine = 'plugin';
      profile.plugin_id = 'gemini_web';
    } else {
      profile.engine = profile.command ? 'command' : 'plugin';
      profile.plugin_id = profile.engine === 'plugin' ? 'gemini_web' : '';
    }
  }

  // Normalize return expectation
  if (typeof profile.expects_return !== 'boolean') {
    profile.expects_return = profile.output_mode !== 'none';
  }

  // Normalize return format
  if (!profile.return_format) {
    profile.return_format = 'plain';
  }
  if (!profile.format_template) {
    profile.format_template = '{{output}}';
  }

  // Normalize args
  if (Array.isArray(profile.args)) {
    profile.args = getArgsString(profile.args);
  } else if (typeof profile.args !== 'string') {
    profile.args = '';
  }

  return profile;
}

async function loadProfiles() {
  const data = await chrome.storage.sync.get(['profiles']);
  let raw = data.profiles && data.profiles.length > 0 ? data.profiles : DEFAULT_PROFILES;
  currentProfiles = raw.map(normalizeStoredProfile);
  await chrome.storage.sync.set({ profiles: currentProfiles });
  renderProfileList();
  renderTestProfileDropdown();
}

function renderProfileList() {
  const listEl = document.getElementById('profileList');
  listEl.innerHTML = '';

  currentProfiles.forEach((profile) => {
    const item = document.createElement('div');
    item.className = 'profile-item';

    const info = document.createElement('div');
    info.className = 'profile-info';

    const headerLine = document.createElement('div');
    headerLine.className = 'profile-header-line';

    const name = document.createElement('span');
    name.className = 'profile-name';
    name.textContent = profile.name;

    const badge = document.createElement('span');
    badge.className = 'profile-command';
    if (profile.engine === 'plugin') {
      badge.textContent = `🌐 Plugin: ${profile.plugin_id === 'gemini_web' ? 'Gemini Web' : profile.plugin_id}`;
      badge.style.color = '#a7f3d0';
      badge.style.background = '#064e3b';
    } else {
      badge.textContent = `💻 Host: ${profile.command} ${profile.args || ''}`.trim();
    }

    headerLine.appendChild(name);
    headerLine.appendChild(badge);

    const meta = document.createElement('div');
    meta.className = 'profile-meta';

    const shortcutText = getShortcutLabel(profile.shortcut);
    const sourceText = getInputSourceLabel(profile.input_source);
    const modeText = profile.expects_return ? getModeLabel(profile.output_mode) : '➔ One-way (Send only)';
    const formatText = profile.expects_return && profile.return_format === 'custom' ? '✨ Custom Format' : '📄 Plain Text';

    meta.innerHTML = `
      <span>⌨️ <strong>${shortcutText}</strong></span>
      <span>📥 <strong>${sourceText}</strong></span>
      <span>${profile.expects_return ? '⇄ <strong>Two-way</strong>' : '➔ <strong>One-way</strong>'}</span>
      <span>🎯 <strong>${modeText}</strong></span>
      ${profile.expects_return ? `<span>📐 <strong>${formatText}</strong></span>` : ''}
      <span>⏱️ <strong>${profile.timeout_seconds || 60}s</strong></span>
    `;

    info.appendChild(headerLine);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'profile-actions';

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => openEditModal(profile);

    const dupBtn = document.createElement('button');
    dupBtn.textContent = 'Duplicate';
    dupBtn.onclick = () => duplicateProfile(profile);

    const delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.textContent = 'Delete';
    delBtn.onclick = () => deleteProfile(profile.id);

    actions.appendChild(editBtn);
    actions.appendChild(dupBtn);
    actions.appendChild(delBtn);

    item.appendChild(info);
    item.appendChild(actions);
    listEl.appendChild(item);
  });
}

function getInputSourceLabel(source) {
  switch (source) {
    case 'editable': return 'Form Field';
    case 'selection': return 'Selection';
    case 'page': return 'Entire Page';
    default: return 'Form Field';
  }
}

function getShortcutLabel(shortcut) {
  switch (shortcut) {
    case 'run-profile-1': return 'Shortcut 1 (Alt+Shift+E)';
    case 'run-profile-2': return 'Shortcut 2 (Alt+Shift+S)';
    case 'run-profile-3': return 'Shortcut 3 (Alt+Shift+D)';
    case 'run-profile-4': return 'Shortcut 4 (Custom)';
    default: return 'No hotkey (Menu/Palette)';
  }
}

function getModeLabel(mode) {
  switch (mode) {
    case 'replace': return 'Replace Form';
    case 'panel': return 'Floating Panel';
    case 'clipboard': return 'Clipboard';
    case 'none': return 'Fire & Forget';
    default: return mode || 'Replace';
  }
}

function renderTestProfileDropdown() {
  const select = document.getElementById('testProfileSelect');
  select.innerHTML = '';
  currentProfiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    const typeLabel = p.engine === 'plugin' ? `Plugin: ${p.plugin_id}` : `Host: ${p.command}`;
    const flowLabel = p.expects_return ? 'Two-way' : 'One-way';
    opt.textContent = `${p.name} [${typeLabel} • ${flowLabel}]`;
    select.appendChild(opt);
  });
}

function toggleModalFields() {
  const backendType = document.getElementById('fieldBackendType').value;
  const expectsReturn = document.getElementById('fieldExpectsReturn').value === 'true';
  const returnFormat = document.getElementById('fieldReturnFormat').value;

  const webFields = document.getElementById('geminiWebFields');
  const cliFields = document.getElementById('cliFields');
  const twoWayGroup = document.getElementById('twoWayGroup');
  const formatTemplateGroup = document.getElementById('formatTemplateGroup');

  if (backendType.startsWith('plugin')) {
    webFields.style.display = 'block';
    cliFields.style.display = 'none';
  } else {
    webFields.style.display = 'none';
    cliFields.style.display = 'block';

    const inputMode = document.getElementById('fieldInputMode').value;
    const cliArgsGroup = document.getElementById('cliArgsGroup');
    if (cliArgsGroup) {
      cliArgsGroup.style.display = (inputMode === 'stdin') ? 'none' : 'block';
    }
  }

  if (expectsReturn) {
    twoWayGroup.style.display = 'block';
    formatTemplateGroup.style.display = (returnFormat === 'custom') ? 'block' : 'none';
  } else {
    twoWayGroup.style.display = 'none';
  }
}

function setupEventListeners() {
  document.getElementById('addProfileBtn').addEventListener('click', () => openEditModal(null));
  document.getElementById('cancelModalBtn').addEventListener('click', closeEditModal);
  document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);

  document.getElementById('fieldBackendType').addEventListener('change', toggleModalFields);
  document.getElementById('fieldExpectsReturn').addEventListener('change', toggleModalFields);
  document.getElementById('fieldReturnFormat').addEventListener('change', toggleModalFields);
  document.getElementById('fieldInputMode').addEventListener('change', toggleModalFields);

  // Test buttons
  document.getElementById('testHostBtn').addEventListener('click', testHostConnection);
  document.getElementById('testGeminiWebBtn').addEventListener('click', testGeminiWebConnection);
  document.getElementById('runTestBtn').addEventListener('click', runTestProfile);
}

function openEditModal(profile) {
  const modal = document.getElementById('profileModal');
  const modalTitle = document.getElementById('modalTitle');

  if (profile) {
    modalTitle.textContent = 'Edit Profile: ' + profile.name;
    document.getElementById('editProfileId').value = profile.id;
    document.getElementById('fieldName').value = profile.name;
    document.getElementById('fieldBackendType').value = profile.engine === 'plugin' ? 'plugin_gemini_web' : 'command';
    document.getElementById('fieldExpectsReturn').value = profile.expects_return ? 'true' : 'false';
    document.getElementById('fieldReturnFormat').value = profile.return_format || 'plain';
    document.getElementById('fieldFormatTemplate').value = profile.format_template || '{{output}}';
    document.getElementById('fieldShortcut').value = profile.shortcut || '';
    document.getElementById('fieldOutputMode').value = profile.output_mode || 'replace';
    document.getElementById('fieldInstruction').value = profile.instruction || '';
    document.getElementById('fieldCommand').value = profile.command || '';
    document.getElementById('fieldArgs').value = getArgsString(profile.args);
    document.getElementById('fieldInputMode').value = profile.input_mode || 'stdin';
    document.getElementById('fieldTimeout').value = profile.timeout_seconds || 60;
    document.getElementById('fieldInputSource').value = profile.input_source || 'editable';
  } else {
    modalTitle.textContent = 'Add New Profile';
    document.getElementById('editProfileId').value = '';
    document.getElementById('fieldName').value = '';
    document.getElementById('fieldBackendType').value = 'plugin_gemini_web';
    document.getElementById('fieldExpectsReturn').value = 'true';
    document.getElementById('fieldReturnFormat').value = 'plain';
    document.getElementById('fieldFormatTemplate').value = '{{output}}';
    document.getElementById('fieldShortcut').value = '';
    document.getElementById('fieldOutputMode').value = 'replace';
    document.getElementById('fieldInstruction').value = 'Rewrite the following text concisely and professionally. Correct spelling and grammar, improve clarity, and preserve all meaning and factual details:\n\n%%actual_text%%\n\nReturn ONLY the rewritten text without greetings, conversational filler, or explanations.';
    document.getElementById('fieldCommand').value = '';
    document.getElementById('fieldArgs').value = '';
    document.getElementById('fieldInputMode').value = 'stdin';
    document.getElementById('fieldTimeout').value = 60;
    document.getElementById('fieldInputSource').value = 'editable';
  }

  toggleModalFields();
  modal.classList.add('active');
}

function closeEditModal() {
  document.getElementById('profileModal').classList.remove('active');
}

async function saveProfile() {
  const id = document.getElementById('editProfileId').value || ('profile-' + Date.now());
  const name = document.getElementById('fieldName').value.trim();
  const backendSelection = document.getElementById('fieldBackendType').value;
  const expectsReturn = document.getElementById('fieldExpectsReturn').value === 'true';

  if (!name) {
    alert('Please enter a profile name.');
    return;
  }

  const isPlugin = backendSelection.startsWith('plugin');
  const engine = isPlugin ? 'plugin' : 'command';
  const pluginId = isPlugin ? 'gemini_web' : '';

  const instruction = document.getElementById('fieldInstruction').value.trim();
  const command = document.getElementById('fieldCommand').value.trim();
  const args = document.getElementById('fieldArgs').value.trim();

  if (engine === 'command' && !command) {
    alert('Please enter a command or executable binary name for Host Bridge.');
    return;
  }

  const returnFormat = document.getElementById('fieldReturnFormat').value;
  const formatTemplate = document.getElementById('fieldFormatTemplate').value.trim() || '{{output}}';
  const outputMode = expectsReturn ? document.getElementById('fieldOutputMode').value : 'none';
  const inputSource = document.getElementById('fieldInputSource').value;

  const updatedProfile = {
    id,
    name,
    engine,
    plugin_id: pluginId,
    backend_type: isPlugin ? 'gemini_web' : 'cli', // backwards compatibility
    expects_return: expectsReturn,
    return_format: returnFormat,
    format_template: formatTemplate,
    shortcut: document.getElementById('fieldShortcut').value,
    output_mode: outputMode,
    instruction: instruction,
    command: command,
    args: args,
    input_mode: document.getElementById('fieldInputMode').value,
    timeout_seconds: parseInt(document.getElementById('fieldTimeout').value, 10) || 60,
    input_source: inputSource
  };

  const existingIndex = currentProfiles.findIndex(p => p.id === id);
  if (existingIndex >= 0) {
    currentProfiles[existingIndex] = updatedProfile;
  } else {
    currentProfiles.push(updatedProfile);
  }

  await chrome.storage.sync.set({ profiles: currentProfiles });
  closeEditModal();
  renderProfileList();
  renderTestProfileDropdown();
}

async function duplicateProfile(profile) {
  const newProfile = JSON.parse(JSON.stringify(profile));
  newProfile.id = 'profile-' + Date.now();
  newProfile.name = profile.name + ' (Copy)';
  newProfile.shortcut = '';
  currentProfiles.push(newProfile);
  await chrome.storage.sync.set({ profiles: currentProfiles });
  renderProfileList();
  renderTestProfileDropdown();
}

async function deleteProfile(id) {
  if (!confirm('Are you sure you want to delete this profile?')) return;
  currentProfiles = currentProfiles.filter(p => p.id !== id);
  await chrome.storage.sync.set({ profiles: currentProfiles });
  renderProfileList();
  renderTestProfileDropdown();
}

// Test Native Host Bridge Connection
function testHostConnection() {
  const resultEl = document.getElementById('hostStatusResult');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<span class="status-pill" style="background:#334155;color:#f8fafc">⏳ Testing Host Bridge...</span>';

  chrome.runtime.sendMessage({ action: 'ping-native-host' }, (resp) => {
    if (chrome.runtime.lastError) {
      resultEl.innerHTML = `
        <span class="status-pill status-err">✕ Host Bridge Failed</span>
        <div style="margin-top: 6px; font-size: 12px; color: #fecaca;">
          ${chrome.runtime.lastError.message}<br>
          Run <code>send-to-anything-host-bridge -install</code> in your terminal if you want to use local CLI commands.
        </div>`;
      return;
    }

    if (resp && resp.ok) {
      resultEl.innerHTML = `
        <span class="status-pill status-ok">✓ Host Bridge Connected</span>
        <div style="font-size:12px;margin-top:6px;color:#a7f3d0;">
          Successfully communicated with Go binary (Response: "${(resp.output || '').trim()}").
        </div>`;
    } else {
      resultEl.innerHTML = `
        <span class="status-pill status-err">✕ Host Error</span>
        <div style="font-size:12px;margin-top:6px;color:#fca5a5;">
          ${resp ? resp.error : 'Unknown host response'}
        </div>`;
    }
  });
}

async function findGeminiTabs() {
  try {
    const allTabs = await chrome.tabs.query({});
    const matched = allTabs.filter(t => {
      const u = (t.url || t.pendingUrl || '').toLowerCase();
      const title = (t.title || '').toLowerCase();
      return u.includes('gemini.google.com') || u.includes('bard.google.com') ||
             title.includes('gemini') || title.includes('bard');
    });
    console.log('[Send-to-anything] Total open tabs:', allTabs.length, 'Matched candidates:', matched.map(t => ({ id: t.id, title: t.title, url: t.url })));
    return matched;
  } catch (err) {
    console.warn('[Send-to-anything] Failed to query tabs:', err);
    return [];
  }
}

// Test Gemini Web Session
async function testGeminiWebConnection() {
  const resultEl = document.getElementById('geminiWebStatusResult');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<span class="status-pill" style="background:#334155;color:#f8fafc">⏳ Checking Gemini Web session...</span>';

  try {
    const tabs = await findGeminiTabs();
    if (!tabs || tabs.length === 0) {
      await chrome.tabs.create({ url: 'https://gemini.google.com/app', active: true });
      resultEl.innerHTML = `
        <span class="status-pill" style="background:#451a03;color:#fef3c7;">⚠️ Opened Gemini Web Tab</span>
        <div style="font-size:12px;margin-top:6px;color:#fde68a;">
          No active Gemini tab was found. Opened <a href="https://gemini.google.com/app" target="_blank" style="color:#93c5fd;">gemini.google.com/app</a> for you—please make sure you are signed into your Google account, then click Test again.
        </div>`;
      return;
    }

    const tab = tabs.find(t => (t.url || '').includes('/app')) || tabs[0];
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['gemini_bridge.js']
      });
    } catch (e) {
      console.debug('[Send-to-anything] Script injection check:', e);
    }

    await new Promise(r => setTimeout(r, 200));

    let resp;
    try {
      resp = await chrome.tabs.sendMessage(tab.id, { action: 'gemini-web-ping' });
    } catch (sendErr) {
      resultEl.innerHTML = `
        <span class="status-pill status-err">✕ Could Not Reach Tab</span>
        <div style="font-size:12px;margin-top:6px;color:#fca5a5;">
          ${sendErr.message}<br>
          Please refresh the <a href="${tab.url || 'https://gemini.google.com'}" target="_blank" style="color:#93c5fd;">Gemini tab</a> and click Test again.
        </div>`;
      return;
    }

    if (resp && resp.ok && resp.authenticated) {
      resultEl.innerHTML = `
        <span class="status-pill status-ok">✓ Gemini Web Plugin Active</span>
        <div style="font-size:12px;margin-top:6px;color:#a7f3d0;">
          Authenticated on ${resp.url || 'gemini.google.com'}. Ready to rewrite or send text!
        </div>`;
    } else if (resp && !resp.authenticated) {
      resultEl.innerHTML = `
        <span class="status-pill status-err">✕ Sign-in Required</span>
        <div style="font-size:12px;margin-top:6px;color:#fca5a5;">
          You are not signed in on Gemini Web. Please open <a href="https://gemini.google.com" target="_blank" style="color:#93c5fd;">gemini.google.com</a> and log into your Google account.
        </div>`;
    } else {
      resultEl.innerHTML = `
        <span class="status-pill status-err">✕ Gemini Web Error</span>
        <div style="font-size:12px;margin-top:6px;color:#fca5a5;">
          ${resp ? resp.error : 'Empty response from Gemini tab'}
        </div>`;
    }
  } catch (err) {
    resultEl.innerHTML = `
      <span class="status-pill status-err">✕ Error</span>
      <div style="font-size:12px;margin-top:6px;color:#fca5a5;">
        ${err.message}
      </div>`;
  }
}

// Run Test Profile
function runTestProfile() {
  const profileId = document.getElementById('testProfileSelect').value;
  const profile = currentProfiles.find(p => p.id === profileId);
  if (!profile) return;

  const testInput = document.getElementById('testInputText').value;
  const consoleEl = document.getElementById('testConsole');

  consoleEl.textContent = `[Testing ${profile.name}] Running via ${profile.engine === 'plugin' ? 'Plugin (' + profile.plugin_id + ')' : 'Host Bridge'}...\n`;

  if (profile.engine === 'plugin') {
    chrome.runtime.sendMessage({
      action: 'ping-gemini-web'
    }, (pingResp) => {
      if (chrome.runtime.lastError) {
        consoleEl.textContent += `[Error] ${chrome.runtime.lastError.message}\n`;
        return;
      }
      if (!pingResp || !pingResp.authenticated) {
        consoleEl.textContent += `[Auth Required] Please sign into https://gemini.google.com first.\n`;
        return;
      }
      consoleEl.textContent += `[Status] Gemini plugin connected. Flow: ${profile.expects_return ? 'Two-way' : 'One-way'}. Ready to trigger from any webpage!\n`;
    });
    return;
  }

  // CLI execution test
  const payload = {
    command: profile.command,
    args: parseArgs(profile.args),
    input_mode: profile.input_mode || 'stdin',
    text: testInput,
    prompt: '',
    timeout_seconds: profile.timeout_seconds || 30,
    fire_and_forget: !profile.expects_return
  };

  chrome.runtime.sendNativeMessage(NATIVE_HOST, payload, (resp) => {
    if (chrome.runtime.lastError) {
      consoleEl.textContent += `[Native Error] ${chrome.runtime.lastError.message}\nMake sure native host is installed via 'send-to-anything-host-bridge -install'.`;
      return;
    }

    if (!resp) {
      consoleEl.textContent += `[Error] Empty response received from native host.\n`;
      return;
    }

    if (resp.exit_code !== 0) {
      consoleEl.textContent += `[Exit Code ${resp.exit_code}]\nError: ${resp.error || '(no stderr)'}\n`;
    } else {
      consoleEl.textContent += `[Success (Exit 0)] Output:\n${resp.output}\n`;
      if (resp.error) {
        consoleEl.textContent += `[Stderr Notice]: ${resp.error}\n`;
      }
    }
  });
}
