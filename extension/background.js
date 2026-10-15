// Send-to-anything - Background Service Worker (MV3)

const NATIVE_HOST = 'com.send.to.anything';

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

function formatReturnOutput(rawOutput, returnFormat, formatTemplate) {
  if (returnFormat === 'custom' && formatTemplate) {
    return formatTemplate.replace(/{{output}}/g, rawOutput);
  }
  return rawOutput;
}

// Initialize settings and context menus
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.sync.get(['profiles']);
  if (!data.profiles || data.profiles.length === 0) {
    await chrome.storage.sync.set({ profiles: DEFAULT_PROFILES });
  }
  updateContextMenus();
});

// Update context menus whenever storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.profiles) {
    updateContextMenus();
  }
});

let isUpdatingMenus = false;
let pendingMenuUpdate = false;

async function updateContextMenus() {
  if (isUpdatingMenus) {
    pendingMenuUpdate = true;
    return;
  }
  isUpdatingMenus = true;

  try {
    await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));

    const data = await chrome.storage.sync.get(['profiles']);
    const profiles = data.profiles || DEFAULT_PROFILES;

    chrome.contextMenus.create({
      id: 'send-to-anything-root',
      title: 'Send to Anything',
      contexts: ['selection', 'editable']
    }, () => { void chrome.runtime.lastError; });

    profiles.forEach((profile) => {
      chrome.contextMenus.create({
        id: `profile-${profile.id}`,
        parentId: 'send-to-anything-root',
        title: `${profile.name}`,
        contexts: ['selection', 'editable']
      }, () => { void chrome.runtime.lastError; });
    });

    chrome.contextMenus.create({
      id: 'separator-options',
      parentId: 'send-to-anything-root',
      type: 'separator',
      contexts: ['selection', 'editable']
    }, () => { void chrome.runtime.lastError; });

    chrome.contextMenus.create({
      id: 'open-options',
      parentId: 'send-to-anything-root',
      title: 'Configure Profiles...',
      contexts: ['selection', 'editable']
    }, () => { void chrome.runtime.lastError; });
  } finally {
    isUpdatingMenus = false;
    if (pendingMenuUpdate) {
      pendingMenuUpdate = false;
      updateContextMenus();
    }
  }
}

// Handle Context Menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'open-options') {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (info.menuItemId.startsWith('profile-')) {
    const profileId = info.menuItemId.replace('profile-', '');
    const data = await chrome.storage.sync.get(['profiles']);
    const profiles = data.profiles || DEFAULT_PROFILES;
    const profile = profiles.find(p => p.id === profileId);

    if (profile && tab && tab.id) {
      await executeProfilePipeline(tab.id, profile, info.selectionText);
    }
  }
});

// Handle Shortcut Commands
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  const data = await chrome.storage.sync.get(['profiles']);
  const profiles = data.profiles || DEFAULT_PROFILES;
  const profile = profiles.find(p => p.shortcut === command);

  if (profile) {
    await executeProfilePipeline(tab.id, profile);
  }
});

// Handle Messages from Popup or Options
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'run-profile-by-id') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        sendResponse({ success: false, error: 'No active tab found' });
        return;
      }
      const data = await chrome.storage.sync.get(['profiles']);
      const profiles = data.profiles || DEFAULT_PROFILES;
      const profile = profiles.find(p => p.id === msg.profileId);
      if (!profile) {
        sendResponse({ success: false, error: 'Profile not found' });
        return;
      }
      executeProfilePipeline(tab.id, profile);
      sendResponse({ success: true });
    })();
    return true;
  }

  if (msg.action === 'ping-native-host') {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, {
      command: 'echo',
      args: ['pong'],
      input_mode: 'arg',
      text: 'pong'
    }, (resp) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else if (resp && resp.exit_code === 0) {
        sendResponse({ ok: true, output: resp.output });
      } else {
        sendResponse({ ok: false, error: resp ? resp.error : 'Unknown host response' });
      }
    });
    return true;
  }

  if (msg.action === 'ping-gemini-web') {
    (async () => {
      try {
        const tabs = await findGeminiTabs();
        if (!tabs || tabs.length === 0) {
          await chrome.tabs.create({
            url: 'https://gemini.google.com/app',
            active: true
          });
          sendResponse({
            ok: false,
            needs_login: true,
            error: 'No active Gemini tab was found. Opened https://gemini.google.com/app in a new tab for you—please make sure you are signed in, then click Test again.'
          });
          return;
        }

        const tab = tabs[0];
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['gemini_bridge.js']
          });
        } catch (e) {}

        await new Promise(r => setTimeout(r, 150));

        let resp;
        try {
          resp = await chrome.tabs.sendMessage(tab.id, { action: 'gemini-web-ping' });
        } catch (sendErr) {
          sendResponse({
            ok: false,
            error: `Could not connect to Gemini tab: ${sendErr.message}. Make sure the tab is finished loading.`
          });
          return;
        }
        sendResponse(resp || { ok: false, error: 'Empty response from Gemini Web tab' });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
});

// Ensure Content Script is injected into the active tab
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  } catch (err) {
    console.debug('[Send-to-anything] Script injection check:', err.message);
  }
}

let trackedGeminiTabId = null;

async function findGeminiTabs() {
  if (trackedGeminiTabId) {
    try {
      const tab = await chrome.tabs.get(trackedGeminiTabId);
      if (tab) return [tab];
    } catch (e) {
      trackedGeminiTabId = null;
    }
  }

  try {
    const matched = await chrome.tabs.query({
      url: [
        "https://gemini.google.com/*",
        "https://bard.google.com/*"
      ]
    });
    if (matched && matched.length > 0) return matched;
  } catch (e) {}

  try {
    const allTabs = await chrome.tabs.query({});
    const matched = allTabs.filter(t => {
      const u = (t.url || t.pendingUrl || '').toLowerCase();
      const title = (t.title || '').toLowerCase();
      return u.includes('gemini.google.com') || u.includes('bard.google.com') ||
             title.includes('gemini') || title.includes('bard');
    });
    if (matched && matched.length > 0) return matched;
  } catch (e) {}

  return [];
}

// Locate or create a background/pinned tab for Gemini Web
async function getGeminiWebTab() {
  const tabs = await findGeminiTabs();
  if (tabs && tabs.length > 0) {
    const tab = tabs.find(t => (t.url || '').includes('/app')) || tabs[0];
    trackedGeminiTabId = tab.id;
    return tab;
  }

  // Create background pinned tab
  const newTab = await chrome.tabs.create({
    url: 'https://gemini.google.com/app',
    active: false,
    pinned: true
  });
  trackedGeminiTabId = newTab.id;

  // Wait for tab to load with early resolution
  await new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }, 4000);

    const listener = (tabId, changeInfo) => {
      if (tabId === newTab.id && changeInfo.status === 'complete') {
        if (!done) {
          done = true;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });

  try {
    await chrome.scripting.executeScript({
      target: { tabId: newTab.id },
      files: ['gemini_bridge.js']
    });
  } catch (e) {}

  await new Promise(r => setTimeout(r, 400));
  return newTab;
}

// Execute Gemini Web backend pipeline
async function executeGeminiWebPipeline(tabId, profile, targetText) {
  const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  let geminiTab;

  try {
    geminiTab = await getGeminiWebTab();
  } catch (err) {
    await chrome.tabs.sendMessage(tabId, {
      action: 'show-error',
      message: 'Failed to open Gemini Web tab: ' + err.message
    });
    return;
  }

  const instruction = profile.instruction || 'Rewrite the following text concisely and professionally. Correct spelling and grammar, improve clarity, and preserve all meaning and factual details. Return ONLY the rewritten text.';
  const isOneWay = profile.expects_return === false;

  let response;
  try {
    response = await chrome.tabs.sendMessage(geminiTab.id, {
      action: 'gemini-web-rewrite',
      request_id: requestId,
      instruction: instruction,
      text: targetText,
      timeout_seconds: profile.timeout_seconds || 60,
      one_way: isOneWay
    });
  } catch (err) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: geminiTab.id },
        files: ['gemini_bridge.js']
      });
      await new Promise(r => setTimeout(r, 100));
      response = await chrome.tabs.sendMessage(geminiTab.id, {
        action: 'gemini-web-rewrite',
        request_id: requestId,
        instruction: instruction,
        text: targetText,
        timeout_seconds: profile.timeout_seconds || 60,
        one_way: isOneWay
      });
    } catch (retryErr) {
      await chrome.tabs.sendMessage(tabId, {
        action: 'show-error',
        message: `Gemini Web error: ${retryErr.message}. Make sure https://gemini.google.com is loaded and signed in.`
      });
      return;
    }
  }

  if (!response || response.status !== 'success') {
    const msg = response ? response.message : 'Unknown response from Gemini Web.';
    await chrome.tabs.sendMessage(tabId, {
      action: 'show-error',
      message: `Gemini Web: ${msg}`
    });
    return;
  }

  if (isOneWay) {
    // One-way: show brief success notification and complete
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'show-toast',
        type: 'success',
        message: `✓ Sent to ${profile.name}`,
        duration: 2500
      });
    } catch (e) {}
    return;
  }

  // Format return data
  const formattedOutput = formatReturnOutput(response.output, profile.return_format, profile.format_template);

  // Apply result to originating page
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'apply-result',
      output: formattedOutput,
      output_mode: profile.output_mode || 'replace',
      write_selector: profile.write_selector || '',
      profile_name: profile.name
    });
  } catch (e) {
    console.error('[Send-to-anything] Failed to dispatch result to content script:', e);
  }
}

// Full Execution Pipeline
async function executeProfilePipeline(tabId, profile, preselectedText = '') {
  // 1. Extract text from the page (try direct message, fallback to inject)
  let targetText = preselectedText;
  if (!targetText) {
    let extractResp;
    try {
      extractResp = await chrome.tabs.sendMessage(tabId, {
        action: 'extract-text',
        input_source: profile.input_source || 'editable'
      });
    } catch (e) {
      await ensureContentScript(tabId);
      try {
        extractResp = await chrome.tabs.sendMessage(tabId, {
          action: 'extract-text',
          input_source: profile.input_source || 'editable'
        });
      } catch (err) {}
    }

    if (!extractResp) return;
    if (extractResp.cancelled) return; // User cancelled element picker

    if (extractResp.error) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          action: 'show-error',
          message: extractResp.message || 'Error capturing input data.'
        });
      } catch (e) {}
      return;
    }

    if (extractResp.text) {
      targetText = extractResp.text;
    }
  }

  if (!targetText || !targetText.trim()) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'show-error',
        message: 'No text or input found to process.'
      });
    } catch (e) {}
    return;
  }

  // 2. Show loading spinner
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'show-loading',
      message: `Sending to ${profile.name}...`
    });
  } catch (e) {}

  // Determine engine
  const isPlugin = profile.engine === 'plugin' || profile.backend_type === 'gemini_web';

  // 3. Dispatch to Plugin (e.g. Gemini Web)
  if (isPlugin) {
    await executeGeminiWebPipeline(tabId, profile, targetText);
    return;
  }

  // 4. Host Bridge (CLI / Native Messaging)
  const isOneWay = profile.expects_return === false;
  let finalArgs = parseArgs(profile.args);
  const promptIdx = finalArgs.indexOf('--prompt') !== -1 ? finalArgs.indexOf('--prompt') : finalArgs.indexOf('-p');
  if (promptIdx !== -1 && finalArgs.length > promptIdx + 2) {
    const rest = finalArgs.slice(promptIdx + 1);
    if (rest.every(w => !w.startsWith('-'))) {
      finalArgs = [...finalArgs.slice(0, promptIdx + 1), rest.join(' ')];
    }
  }

  const nativePayload = {
    command: profile.command,
    args: finalArgs,
    input_mode: profile.input_mode || 'stdin',
    text: targetText,
    prompt: '',
    timeout_seconds: profile.timeout_seconds || 30,
    fire_and_forget: isOneWay
  };

  chrome.runtime.sendNativeMessage(NATIVE_HOST, nativePayload, async (response) => {
    if (chrome.runtime.lastError) {
      const errMsg = `Host Bridge Error: ${chrome.runtime.lastError.message}\nMake sure to run: send-to-anything-host-bridge -install`;
      try {
        await chrome.tabs.sendMessage(tabId, {
          action: 'show-error',
          message: errMsg
        });
      } catch (e) {}
      return;
    }

    if (!response) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          action: 'show-error',
          message: 'Received empty response from Host Bridge.'
        });
      } catch (e) {}
      return;
    }

    if (response.exit_code !== 0 && response.error) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          action: 'show-error',
          message: `Command failed (exit ${response.exit_code}): ${response.error}`
        });
      } catch (e) {}
      return;
    }

    if (isOneWay) {
      // One-way command complete
      try {
        await chrome.tabs.sendMessage(tabId, {
          action: 'show-toast',
          type: 'success',
          message: `✓ Sent to ${profile.name}`,
          duration: 2500
        });
      } catch (e) {}
      return;
    }

    // Format output
    const formattedOutput = formatReturnOutput(response.output, profile.return_format, profile.format_template);

    // Apply result to web page
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'apply-result',
        output: formattedOutput,
        output_mode: profile.output_mode || 'replace',
        write_selector: profile.write_selector || '',
        profile_name: profile.name
      });
    } catch (e) {
      console.error('[Send-to-anything] Failed to dispatch result to content script:', e);
    }
  });
}
