// Send-to-anything - Content Script

(() => {
  // Prevent duplicate injection
  if (window.__textProxyInjected) return;
  window.__textProxyInjected = true;

  let lastActiveElement = null;
  let lastSelectionRange = null;

  // Track the most recently focused editable element
  document.addEventListener('focusin', (e) => {
    if (isEditable(e.target)) {
      lastActiveElement = e.target;
    }
  }, true);

  function isEditable(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.tagName === 'INPUT' && el.type !== 'password' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(el.type)) {
      return true;
    }
    if (el.tagName === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function promptUserToSelectField(promptMessage) {
    return new Promise((resolve) => {
      const old = document.querySelector('.text-proxy-picker-banner');
      if (old) old.remove();

      const banner = document.createElement('div');
      banner.className = 'text-proxy-picker-banner';
      banner.innerHTML = `
        <span class="text-proxy-picker-msg">👉 ${promptMessage}</span>
        <button class="text-proxy-picker-cancel">Cancel (Esc)</button>
      `;

      let hoveredEl = null;

      function onMouseMove(e) {
        let el = e.target;
        while (el && el !== document.body && !isEditable(el)) {
          el = el.parentElement;
        }
        if (el && isEditable(el)) {
          if (hoveredEl && hoveredEl !== el) {
            hoveredEl.classList.remove('text-proxy-editable-hover');
          }
          hoveredEl = el;
          hoveredEl.classList.add('text-proxy-editable-hover');
        } else if (hoveredEl) {
          hoveredEl.classList.remove('text-proxy-editable-hover');
          hoveredEl = null;
        }
      }

      function cleanUp() {
        if (hoveredEl) {
          hoveredEl.classList.remove('text-proxy-editable-hover');
          hoveredEl = null;
        }
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeyDown, true);
        banner.remove();
      }

      function onClick(e) {
        let el = e.target;
        while (el && el !== document.body && !isEditable(el)) {
          el = el.parentElement;
        }
        if (el && isEditable(el)) {
          e.preventDefault();
          e.stopPropagation();
          cleanUp();
          el.focus();
          lastActiveElement = el;
          resolve(el);
        }
      }

      function onKeyDown(e) {
        if (e.key === 'Escape') {
          cleanUp();
          resolve(null);
        }
      }

      banner.querySelector('.text-proxy-picker-cancel').onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        cleanUp();
        resolve(null);
      };

      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKeyDown, true);

      document.body.appendChild(banner);
    });
  }

  async function extractText(inputSource = 'editable') {
    const windowSelection = window.getSelection();
    const selectedText = windowSelection ? windowSelection.toString().trim() : '';

    // Mode: Explicit user selection
    if (inputSource === 'selection') {
      if (selectedText) {
        return { text: selectedText, hasSelection: true, isEditable: false };
      }
      return { error: 'NO_SELECTION', message: 'Please highlight/select some text first, then trigger this action.' };
    }

    // Mode: Entire webpage content
    if (inputSource === 'page') {
      const pageText = (document.body ? document.body.innerText : '').trim();
      return { text: pageText, hasSelection: false, isEditable: false };
    }

    // Mode: Form / Editable Field (default)
    let target = null;
    if (isEditable(document.activeElement) && document.activeElement !== document.body) {
      target = document.activeElement;
    } else if (lastActiveElement && document.contains(lastActiveElement)) {
      target = lastActiveElement;
    }

    // If no editable field is currently active, interactively ask the user to select one!
    if (!target) {
      target = await promptUserToSelectField('Click the form field or text area you want to use as input');
      if (!target) {
        return { cancelled: true };
      }
    }

    lastActiveElement = target;

    // Standard input/textarea
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      const start = target.selectionStart;
      const end = target.selectionEnd;
      if (typeof start === 'number' && typeof end === 'number' && start !== end) {
        return {
          text: target.value.substring(start, end),
          hasSelection: true,
          isEditable: true
        };
      }
      return {
        text: target.value || '',
        hasSelection: false,
        isEditable: true
      };
    }

    // ContentEditable elements
    if (target.isContentEditable) {
      if (selectedText) {
        return {
          text: selectedText,
          hasSelection: true,
          isEditable: true
        };
      }
      return {
        text: (target.innerText || target.textContent || '').trim(),
        hasSelection: false,
        isEditable: true
      };
    }

    return { text: '', isEditable: false };
  }

  async function applyReplacement(text, allowInteractivePicker = true) {
    let target = null;

    if (isEditable(document.activeElement) && document.activeElement !== document.body) {
      target = document.activeElement;
    } else if (lastActiveElement && document.contains(lastActiveElement)) {
      target = lastActiveElement;
    }

    // If no active field, interactively ask the user to click the destination field!
    if (!target && allowInteractivePicker) {
      target = await promptUserToSelectField('Click the form field or text area where you want to insert the result');
      if (!target) {
        return { success: false, reason: 'cancelled' };
      }
    }

    if (!target) {
      return { success: false, reason: 'no-target' };
    }

    target.focus();
    lastActiveElement = target;

    // Standard input/textarea
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      const start = target.selectionStart;
      const end = target.selectionEnd;

      if (typeof start === 'number' && typeof end === 'number' && start !== end) {
        target.setRangeText(text, start, end, 'end');
      } else {
        target.value = text;
      }

      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      showToast('success', '✓ Text inserted', 2000);
      return { success: true };
    }

    // ContentEditable elements (e.g. Gmail, Outlook, Notion, Slack)
    if (target.isContentEditable) {
      const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const paragraphs = text.split(/\n\n+/);
      const html = paragraphs.map(para => {
        const lines = para.split('\n').map(escapeHtml);
        return `<div>${lines.join('<br>')}</div>`;
      }).join('<div><br></div>');

      let inserted = false;
      try {
        inserted = document.execCommand('insertHTML', false, html);
      } catch (e) {}

      if (!inserted) {
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', text);
          dt.setData('text/html', html);
          const pasteEvent = new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true
          });
          target.dispatchEvent(pasteEvent);
          inserted = true;
        } catch (e) {}
      }

      if (!inserted) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const frag = document.createRange().createContextualFragment(html);
          range.insertNode(frag);
        } else {
          target.innerHTML = html;
        }
      }

      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      showToast('success', '✓ Text inserted', 2000);
      return { success: true };
    }

    return { success: false, reason: 'unknown' };
  }

  // Toast UI
  let currentToast = null;
  function showToast(type, message, durationMs = 3000) {
    if (currentToast) {
      currentToast.remove();
      currentToast = null;
    }

    const toast = document.createElement('div');
    toast.className = `text-proxy-toast text-proxy-toast-${type}`;

    if (type === 'running') {
      const spinner = document.createElement('div');
      spinner.className = 'text-proxy-spinner';
      toast.appendChild(spinner);
    }

    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    toast.appendChild(textSpan);

    document.body.appendChild(toast);
    currentToast = toast;

    if (durationMs > 0) {
      setTimeout(() => {
        if (currentToast === toast) {
          toast.style.opacity = '0';
          toast.style.transform = 'translateY(8px)';
          setTimeout(() => toast.remove(), 250);
        }
      }, durationMs);
    }
  }

  function hideToast() {
    if (currentToast) {
      currentToast.remove();
      currentToast = null;
    }
  }

  // Floating Sidecar Panel UI
  let activePanel = null;
  function showSidecarPanel(title, markdownContent, noticeText = '') {
    if (activePanel) {
      activePanel.remove();
      activePanel = null;
    }

    const panel = document.createElement('div');
    panel.className = 'text-proxy-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'text-proxy-panel-header';

    const titleEl = document.createElement('div');
    titleEl.className = 'text-proxy-panel-title';
    titleEl.textContent = `⚡ ${title || 'Send-to-anything Output'}`;

    const controls = document.createElement('div');
    controls.className = 'text-proxy-panel-controls';

    const maxBtn = document.createElement('button');
    maxBtn.className = 'text-proxy-panel-btn text-proxy-panel-max';
    maxBtn.textContent = '[ ]';
    maxBtn.title = 'Full Page View';
    maxBtn.onclick = () => {
      const isFull = panel.classList.toggle('text-proxy-panel-fullscreen');
      maxBtn.textContent = isFull ? '[ – ]' : '[ ]';
      maxBtn.title = isFull ? 'Restore Sidecar View' : 'Full Page View';
    };

    const closeBtn = document.createElement('button');
    closeBtn.className = 'text-proxy-panel-btn text-proxy-panel-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close (Esc)';
    closeBtn.onclick = () => {
      panel.remove();
      activePanel = null;
    };

    controls.appendChild(maxBtn);
    controls.appendChild(closeBtn);

    header.appendChild(titleEl);
    header.appendChild(controls);
    panel.appendChild(header);

    // Optional Notice Banner
    if (noticeText) {
      const notice = document.createElement('div');
      notice.className = 'text-proxy-panel-notice';
      notice.textContent = noticeText;
      panel.appendChild(notice);
    }

    // Body (with safe markdown rendering)
    const body = document.createElement('div');
    body.className = 'text-proxy-panel-body';
    body.innerHTML = renderSafeMarkdown(markdownContent);
    panel.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'text-proxy-panel-footer';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'text-proxy-btn';
    copyBtn.textContent = '📋 Copy Output';
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(markdownContent);
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => { copyBtn.textContent = '📋 Copy Output'; }, 2000);
      } catch (err) {
        showToast('error', 'Clipboard copy failed: ' + err, 2500);
      }
    };

    const insertBtn = document.createElement('button');
    insertBtn.className = 'text-proxy-btn text-proxy-btn-primary';
    insertBtn.textContent = '💬 Insert into Field';
    insertBtn.onclick = async () => {
      const result = await applyReplacement(markdownContent, true);
      if (result.success) {
        panel.remove();
        activePanel = null;
      }
    };

    footer.appendChild(copyBtn);
    footer.appendChild(insertBtn);
    panel.appendChild(footer);

    document.body.appendChild(panel);
    activePanel = panel;

    // Esc key listener
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && activePanel === panel) {
        panel.remove();
        activePanel = null;
        document.removeEventListener('keydown', onKeyDown);
      }
    };
    document.addEventListener('keydown', onKeyDown);
  }

  // Safe Markdown renderer to prevent XSS
  function renderSafeMarkdown(md) {
    if (!md) return '';

    // Step 1: Escape raw HTML entities
    let safe = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    // Step 2: Code blocks (``` ... ```)
    safe = safe.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Step 3: Inline code (`...`)
    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Step 4: Headers
    safe = safe.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    safe = safe.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    safe = safe.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Step 5: Bold and Italics
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Step 6: Blockquotes
    safe = safe.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');

    // Step 7: Unordered list items
    safe = safe.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
    safe = safe.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');

    // Step 8: Clean up duplicate nested <ul>
    safe = safe.replace(/<\/ul>\s*<ul>/g, '');

    // Step 9: Paragraphs for remaining newlines
    const paragraphs = safe.split(/\n\s*\n/);
    return paragraphs.map(p => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<pre') || trimmed.startsWith('<blockquote')) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    }).join('');
  }

  // Chrome Runtime Message Listener
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'extract-text') {
      extractText(msg.input_source || 'editable').then(res => {
        sendResponse(res);
      });
      return true;
    }

    if (msg.action === 'show-loading') {
      showToast('running', msg.message || 'Processing command...', 0);
      sendResponse({ ok: true });
      return true;
    }

    if (msg.action === 'show-toast') {
      hideToast();
      showToast(msg.type || 'success', msg.message, msg.duration || 3000);
      sendResponse({ ok: true });
      return true;
    }

    if (msg.action === 'show-error') {
      hideToast();
      showToast('error', msg.message || 'Command failed.', 5000);
      sendResponse({ ok: true });
      return true;
    }

    if (msg.action === 'apply-result') {
      hideToast();
      const output = msg.output || '';
      const mode = msg.output_mode || 'replace';

      if (mode === 'replace') {
        applyReplacement(output, true).then(result => {
          if (!result.success && result.reason !== 'cancelled') {
            // Auto-copy to clipboard so user output is never lost
            navigator.clipboard.writeText(output).catch(() => {});
            // Show sidecar panel with destination instructions
            showSidecarPanel(
              msg.profile_name || 'Transformed Text',
              output,
              '⚠️ No destination field was active. Output copied to clipboard! Click into your target form field and click "Insert into Field" below.'
            );
          }
          sendResponse(result);
        });
        return true;
      } else if (mode === 'panel') {
        showSidecarPanel(msg.profile_name, output);
        sendResponse({ success: true });
      } else if (mode === 'clipboard') {
        navigator.clipboard.writeText(output).then(() => {
          showToast('success', '📋 Copied output to clipboard', 2500);
          sendResponse({ success: true });
        }).catch(err => {
          showToast('error', 'Clipboard copy failed: ' + err, 3000);
          sendResponse({ success: false });
        });
        return true;
      }
      return true;
    }
  });
})();
