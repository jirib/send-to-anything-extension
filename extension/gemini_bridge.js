// Text Proxy - Gemini Web Bridge Content Script
// Injected into https://gemini.google.com/* to automate the authenticated web session

(() => {
  if (window.__geminiBridgeInjected) return;
  window.__geminiBridgeInjected = true;

  console.log('[Text Proxy] Gemini Web Bridge loaded on:', window.location.href);

  // Check if user is authenticated and on the chat interface
  function checkAuth() {
    if (window.location.href.includes('accounts.google.com')) {
      return false;
    }
    const input = findChatInput();
    const signinBtn = document.querySelector('a[href*="accounts.google.com"], button[aria-label*="Sign in"]');
    if (signinBtn && !input) {
      return false;
    }
    return true;
  }

  // Find Gemini's input textbox
  function findChatInput() {
    const selectors = [
      'rich-textarea div[contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]',
      '.ql-editor[contenteditable="true"]',
      'textarea[aria-label*="prompt" i]',
      'textarea[aria-label*="message" i]',
      'div[contenteditable="true"]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        return el;
      }
    }
    return null;
  }

  // Find Gemini's send button
  function findSendButton() {
    const selectors = [
      'button[aria-label*="Send message" i]',
      'button[aria-label*="Send" i]',
      '.send-button-container button',
      'button.send-button'
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
        return btn;
      }
    }
    return null;
  }

  // Find stop generation button (present while streaming)
  function isGenerating() {
    const stopSelectors = [
      'button[aria-label*="Stop response" i]',
      'button[aria-label*="Stop generating" i]',
      'button[aria-label*="Stop" i]',
      '.stop-button'
    ];
    for (const sel of stopSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        return true;
      }
    }
    return false;
  }

  // Get all model response containers
  function getResponseContainers() {
    const selectors = [
      'model-response',
      '.model-response',
      'message-content.model-response-text',
      '.response-container',
      '[data-test-id="model-response"]'
    ];
    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      if (items.length > 0) {
        return Array.from(items);
      }
    }
    return [];
  }

  // Wait for an element to appear in DOM
  function waitForElement(findFn, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const el = findFn();
      if (el) return resolve(el);

      const startTime = Date.now();
      const interval = setInterval(() => {
        const found = findFn();
        if (found) {
          clearInterval(interval);
          resolve(found);
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          reject(new Error('Timeout waiting for element'));
        }
      }, 200);
    });
  }

  // Set text into input and trigger framework change detection
  function setPromptText(inputEl, text) {
    inputEl.focus();

    if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // ContentEditable elements (rich-textarea / Quill)
    inputEl.focus();

    // Select all existing content
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}

    // Method 1: Clipboard paste event (natively handled by Quill/Lit editors for multiline text)
    let pasteSucceeded = false;
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true
      });
      inputEl.dispatchEvent(pasteEvent);
      // Verify text was inserted
      const current = (inputEl.innerText || inputEl.textContent || '').trim();
      if (current.length > 20) {
        pasteSucceeded = true;
      }
    } catch (e) {
      console.warn('[Text Proxy] Paste event failed:', e);
    }

    // Method 2: Fallback paragraph construction if paste was ignored
    if (!pasteSucceeded) {
      inputEl.innerHTML = '';
      const lines = text.split('\n');
      for (const line of lines) {
        const p = document.createElement('p');
        p.textContent = line || '\u200B';
        inputEl.appendChild(p);
      }
    }

    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
  }

  // Clean raw AI response (strip surrounding fences or preamble if present)
  function cleanOutput(raw) {
    if (!raw) return '';
    let text = raw.trim();

    // If enclosed in markdown code fences, unwrap them
    const fenceMatch = text.match(/^```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)\n```$/);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }

    // If enclosed in surrounding quotes, unwrap them
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('“') && text.endsWith('”'))) {
      text = text.slice(1, -1).trim();
    }

    // Strip leading label if the model repeated it
    text = text.replace(/^\[Rewritten\s+(?:version|text)\]:?\s*/i, '').trim();

    return text;
  }

  // Extract response text strictly from the message content node, preserving all newlines and paragraphs
  function extractResponseText(container) {
    if (!container) return '';
    const contentEl = container.querySelector('message-content, .model-response-text, .markdown, [data-test-id="message-content"]');
    const target = contentEl || container;

    let text = '';
    try {
      const clone = target.cloneNode(true);
      // Remove screen-reader headers from clone
      clone.querySelectorAll('.cdk-visually-hidden, [aria-hidden="true"], h2').forEach(el => {
        if ((el.innerText || el.textContent || '').toLowerCase().includes('gemini said')) {
          el.remove();
        }
      });

      // Ensure <br> becomes explicit newline
      clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));

      // Ensure block elements (paragraphs, list items, headings) end with newline
      const blockSelectors = 'p, li, h1, h2, h3, h4, h5, h6, pre, blockquote';
      clone.querySelectorAll(blockSelectors).forEach(block => {
        block.after(document.createTextNode('\n\n'));
      });

      text = (clone.innerText || clone.textContent || '').trim();
    } catch (e) {
      text = (target.innerText || target.textContent || '').trim();
    }

    // Clean up excessive blank lines (more than 2 in a row)
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    // Strip accessibility heading if still present
    text = text.replace(/^Gemini\s+said\s*:?\s*/i, '').trim();
    return text;
  }

  // Check if Gemini has completely finished generating the response
  function isResponseFinished(container) {
    if (!container) return false;
    const targets = [container, container.parentElement, container.closest('.conversation-turn')].filter(Boolean);
    for (const el of targets) {
      const actionButtons = el.querySelector(
        'button[aria-label*="Copy" i], ' +
        'button[aria-label*="Good response" i], ' +
        'button[data-test-id="copy-button"], ' +
        'response-container-footer, ' +
        '.action-buttons, ' +
        'message-actions'
      );
      if (actionButtons) {
        return true;
      }
    }
    return false;
  }

  // Execute a rewrite task on Gemini Web
  async function executeRewrite({ instruction, text, timeout_seconds = 60, one_way = false }) {
    if (!checkAuth()) {
      return {
        status: 'error',
        error_code: 'AUTH_REQUIRED',
        message: 'You are not logged into Google Gemini. Please sign in at https://gemini.google.com and try again.'
      };
    }

    // Ensure we are on the app page
    if (!window.location.pathname.startsWith('/app')) {
      window.location.href = 'https://gemini.google.com/app';
      return {
        status: 'error',
        error_code: 'NAVIGATING',
        message: 'Navigating to Gemini chat interface...'
      };
    }

    let inputEl;
    try {
      inputEl = await waitForElement(findChatInput, 15000);
    } catch (e) {
      return {
        status: 'error',
        error_code: 'INPUT_NOT_FOUND',
        message: 'Could not find Gemini chat input. Make sure the page is fully loaded and you are signed in.'
      };
    }

    // Count existing responses before sending
    const initialResponses = getResponseContainers();
    const initialCount = initialResponses.length;

    // Compose prompt using %%actual_text%% or {{text}} placeholder if present
    let fullPrompt = '';
    const safeText = text || '';
    if (instruction && instruction.includes('%%actual_text%%')) {
      fullPrompt = instruction.replace(/%%actual_text%%/g, safeText);
    } else if (instruction && instruction.includes('{{text}}')) {
      fullPrompt = instruction.replace(/{{text}}/g, safeText);
    } else if (instruction && safeText) {
      fullPrompt = `${instruction}\n\n[Draft to rewrite]:\n${safeText}\n\n[Rewritten version]:`;
    } else if (instruction) {
      fullPrompt = instruction;
    } else {
      fullPrompt = safeText;
    }

    console.log('[Send-to-anything] Submitting prompt to Gemini Web. Text length:', (text || '').length, 'One-way:', one_way);
    setPromptText(inputEl, fullPrompt);

    // Brief delay to allow framework input validation
    await new Promise(r => setTimeout(r, 100));

    // Find and click Send button
    let sendBtn = findSendButton();
    if (sendBtn) {
      sendBtn.click();
    } else {
      inputEl.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        keyCode: 13
      }));
    }

    if (one_way) {
      return {
        status: 'success',
        output: '',
        one_way: true
      };
    }

    // Monitor response generation
    return new Promise((resolve) => {
      const timeoutMs = (timeout_seconds || 60) * 1000;
      const startTime = Date.now();
      let hasStartedGenerating = false;
      let lastTextChangeTime = Date.now();
      let lastTextSnapshot = '';

      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed > timeoutMs) {
          clearInterval(checkInterval);
          return resolve({
            status: 'error',
            error_code: 'TIMEOUT',
            message: `Gemini generation timed out after ${timeout_seconds}s.`
          });
        }

        const generating = isGenerating();
        const currentContainers = getResponseContainers();
        const hasNewResponse = currentContainers.length > initialCount;

        if (hasNewResponse) {
          const latest = currentContainers[currentContainers.length - 1];
          const currentText = extractResponseText(latest);

          if (generating || currentText.length > 0) {
            hasStartedGenerating = true;
          }

          if (currentText !== lastTextSnapshot) {
            lastTextSnapshot = currentText;
            lastTextChangeTime = Date.now();
          }

          // Generation is complete as soon as:
          // 1. Text has streamed in (currentText.length > 0)
          // 2. We observed generation start
          // 3. AND either:
          //    - Action buttons (Copy/Feedback) appeared
          //    - OR Stop button disappeared AND Send button is restored and ready
          //    - OR text has remained stable for 500ms
          const finishedByActions = isResponseFinished(latest);
          const sendReady = !generating && !!findSendButton();
          const finishedBySilence = !generating && (Date.now() - lastTextChangeTime > 500);

          if (hasStartedGenerating && currentText.length > 0 && (finishedByActions || sendReady || finishedBySilence)) {
            clearInterval(checkInterval);

            const cleaned = cleanOutput(currentText);
            console.log('[Text Proxy] Successfully captured completed output length:', cleaned.length, 'Elapsed:', (Date.now() - startTime) + 'ms');
            return resolve({
              status: 'success',
              output: cleaned
            });
          }
        }
      }, 150);
    });
  }

  // Listen for messages from background.js
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'gemini-web-ping') {
      const authOk = checkAuth();
      const inputEl = findChatInput();
      sendResponse({
        ok: true,
        authenticated: authOk,
        hasInput: !!inputEl,
        url: window.location.href
      });
      return true;
    }

    if (msg.action === 'gemini-web-rewrite') {
      executeRewrite({
        instruction: msg.instruction,
        text: msg.text,
        timeout_seconds: msg.timeout_seconds,
        one_way: !!msg.one_way
      }).then(resp => {
        resp.request_id = msg.request_id;
        sendResponse(resp);
      }).catch(err => {
        sendResponse({
          request_id: msg.request_id,
          status: 'error',
          error_code: 'EXCEPTION',
          message: err.message
        });
      });
      return true; // async
    }
  });
})();
