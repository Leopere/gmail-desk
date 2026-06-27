(() => {
  if (window.__gmailDeskAiOverlayInstalled) {
    window.dispatchEvent(new CustomEvent("gmail-desk-ai-show"));
    return;
  }

  window.__gmailDeskAiOverlayInstalled = true;

  const state = {
    currentEmail: null,
    debugAvailable: false,
    debugEnabled: false,
    lastAssessedEmailKey: "",
    lastAssessment: null,
    lastDraftResult: null,
    replyAssistAvailable: false,
    selectedOption: ""
  };

  const style = document.createElement("style");
  style.textContent = `
    #gmdesk-ai-button,
    #gmdesk-grammarly-button {
      align-items: center;
      background: #1f2937;
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 8px;
      bottom: 18px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.22);
      color: #fff;
      cursor: pointer;
      display: flex;
      font: 600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      gap: 6px;
      height: 36px;
      padding: 0 12px;
      position: fixed;
      right: 18px;
      z-index: 2147483647;
    }
    #gmdesk-ai-button[hidden],
    #gmdesk-grammarly-button[hidden],
    #gmdesk-ai-panel[hidden] {
      display: none !important;
    }
    #gmdesk-grammarly-button {
      background: #0f7b6c;
      right: 134px;
    }
    @media (max-width: 520px) {
      #gmdesk-ai-button,
      #gmdesk-grammarly-button {
        bottom: 12px;
        height: 34px;
        padding: 0 10px;
      }
      #gmdesk-ai-button {
        right: 12px;
      }
      #gmdesk-grammarly-button {
        right: 122px;
      }
    }
    #gmdesk-ai-panel {
      background: #fff;
      border: 1px solid #dadce0;
      border-radius: 8px;
      bottom: 64px;
      box-shadow: 0 18px 48px rgba(60,64,67,0.28);
      color: #202124;
      display: none;
      font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      max-height: min(780px, calc(100vh - 92px));
      overflow: auto;
      padding: 12px;
      position: fixed;
      right: 18px;
      width: min(440px, calc(100vw - 36px));
      z-index: 2147483647;
    }
    #gmdesk-ai-panel[data-open="true"] {
      display: block;
    }
    .gmdesk-ai-row {
      align-items: center;
      display: flex;
      gap: 8px;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .gmdesk-ai-title {
      font-size: 14px;
      font-weight: 700;
    }
    .gmdesk-ai-close {
      background: transparent;
      border: 0;
      color: #5f6368;
      cursor: pointer;
      font-size: 18px;
      line-height: 18px;
      min-height: 32px;
      min-width: 32px;
      padding: 0;
    }
    .gmdesk-ai-meta {
      background: #f8fafc;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      color: #374151;
      font-size: 12px;
      line-height: 1.35;
      margin-bottom: 10px;
      padding: 8px;
      white-space: pre-wrap;
    }
    .gmdesk-ai-label {
      color: #374151;
      display: block;
      font-size: 12px;
      font-weight: 650;
      margin: 10px 0 5px;
    }
    #gmdesk-ai-direction {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      box-sizing: border-box;
      color: #111827;
      font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 72px;
      padding: 8px;
      resize: vertical;
      width: 100%;
    }
    .gmdesk-ai-actions,
    .gmdesk-ai-inline-actions,
    .gmdesk-ai-draft-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .gmdesk-ai-actions button,
    .gmdesk-ai-inline-actions button,
    .gmdesk-ai-draft-actions button,
    .gmdesk-ai-token {
      background: #fff;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      color: #111827;
      cursor: pointer;
      font: 600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 30px;
      padding: 5px 9px;
    }
    .gmdesk-ai-actions button.primary {
      background: #1a73e8;
      border-color: #1a73e8;
      color: #fff;
    }
    .gmdesk-ai-token {
      border-radius: 999px;
      margin: 4px 5px 0 0;
      min-height: 24px;
      padding: 3px 8px;
    }
    .gmdesk-ai-token.sender {
      background: #eef2ff;
      color: #3730a3;
    }
    .gmdesk-ai-token.option {
      background: #ecfdf5;
      color: #166534;
    }
    .gmdesk-ai-status {
      color: #5f6368;
      font-size: 12px;
      line-height: 1.35;
      margin-top: 9px;
      min-height: 16px;
    }
    .gmdesk-ai-status.error {
      color: #b91c1c;
    }
    .gmdesk-ai-extension-status {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      color: #4b5563;
      font-size: 12px;
      line-height: 1.35;
      margin-bottom: 10px;
      padding: 7px 8px;
    }
    .gmdesk-ai-extension-status strong {
      color: #111827;
    }
    .gmdesk-ai-extension-status .gmdesk-ai-inline-actions {
      margin-top: 7px;
    }
    .gmdesk-ai-debug {
      align-items: center;
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      border-radius: 6px;
      color: #475569;
      display: flex;
      font-size: 12px;
      gap: 8px;
      justify-content: space-between;
      margin-bottom: 10px;
      padding: 7px 8px;
    }
    .gmdesk-ai-debug[hidden] {
      display: none;
    }
    .gmdesk-ai-section {
      border-top: 1px solid #e5e7eb;
      margin-top: 12px;
      padding-top: 12px;
    }
    .gmdesk-ai-pill {
      background: #f3f4f6;
      border-radius: 999px;
      color: #374151;
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      margin-bottom: 8px;
      padding: 3px 8px;
      text-transform: uppercase;
    }
    .gmdesk-ai-text {
      color: #374151;
      line-height: 1.45;
      margin: 0 0 8px;
      white-space: pre-wrap;
    }
    .gmdesk-ai-list {
      margin: 6px 0 0;
      padding-left: 18px;
    }
    .gmdesk-ai-draft {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      margin-top: 10px;
      padding: 9px;
    }
    .gmdesk-ai-draft h4 {
      font-size: 13px;
      margin: 0 0 6px;
    }
    .gmdesk-ai-radio {
      align-items: center;
      color: #374151;
      display: inline-flex;
      gap: 5px;
      margin: 4px 12px 0 0;
    }
  `;
  document.documentElement.appendChild(style);

  function node(tagName, attributes = {}, children = []) {
    const element = document.createElement(tagName);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === undefined || value === null || value === false) {
        continue;
      }

      if (name === "className") {
        element.className = value;
      } else if (name === "text") {
        element.textContent = String(value);
      } else if (name === "dataset") {
        Object.assign(element.dataset, value);
      } else if (name === "hidden") {
        element.hidden = Boolean(value);
      } else if (name === "checked") {
        element.checked = Boolean(value);
      } else {
        element.setAttribute(name, String(value));
      }
    }

    for (const child of children) {
      element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }

    return element;
  }

  function buttonNode(attributes, text) {
    return node("button", { type: "button", ...attributes, text });
  }

  const button = document.createElement("button");
  button.id = "gmdesk-ai-button";
  button.type = "button";
  button.title = "Open Gmail Desk AI Reply Assist";
  button.textContent = "AI Reply Assist";

  const grammarlyButton = document.createElement("button");
  grammarlyButton.id = "gmdesk-grammarly-button";
  grammarlyButton.type = "button";
  grammarlyButton.title = "Open Grammarly editor inside Gmail Desk";
  grammarlyButton.textContent = "Grammarly";

  const panel = document.createElement("section");
  panel.id = "gmdesk-ai-panel";
  panel.setAttribute("aria-live", "polite");
  panel.append(
    node("div", { className: "gmdesk-ai-row" }, [
      node("div", { className: "gmdesk-ai-title", text: "Reply Assist" }),
      buttonNode({ className: "gmdesk-ai-close", "aria-label": "Close" }, "x")
    ]),
    node("div", { id: "gmdesk-ai-extensions", className: "gmdesk-ai-extension-status" }, [
      node("div", { id: "gmdesk-ai-extensions-copy", text: "Checking writing tools..." }),
      node("div", { className: "gmdesk-ai-inline-actions" }, [
        buttonNode({ id: "gmdesk-ai-open-grammarly" }, "Open Grammarly"),
        buttonNode({ id: "gmdesk-ai-copy-draft-grammarly" }, "Copy draft to Grammarly"),
        buttonNode({ id: "gmdesk-ai-paste-grammarly" }, "Paste checked text"),
        buttonNode({ id: "gmdesk-ai-refresh-writing-tools" }, "Refresh in Gmail")
      ])
    ]),
    node("div", { id: "gmdesk-ai-debug", className: "gmdesk-ai-debug", hidden: true }, [
      node("span", { id: "gmdesk-ai-debug-label", text: "Debug trace off" }),
      buttonNode({ id: "gmdesk-ai-debug-toggle" }, "Enable debug")
    ]),
    node("div", { id: "gmdesk-ai-email", className: "gmdesk-ai-meta", text: "Open an email thread, then assess it." }),
    node("div", { className: "gmdesk-ai-actions" }, [
      buttonNode({ id: "gmdesk-ai-refresh" }, "Read message"),
      buttonNode({ id: "gmdesk-ai-assess", className: "primary" }, "Assess sender intent")
    ]),
    node("div", { id: "gmdesk-ai-assessment" }),
    node("div", { id: "gmdesk-ai-direction-wrap", className: "gmdesk-ai-section", hidden: true }, [
      node("label", { className: "gmdesk-ai-label", for: "gmdesk-ai-direction", text: "What should the reply accomplish?" }),
      node("textarea", {
        id: "gmdesk-ai-direction",
        placeholder: "Example: accept and ask for the calendar invite, decline politely, ask for budget/timeline, confirm receipt only..."
      }),
      node("label", { className: "gmdesk-ai-label", text: "Reply target" }),
      node("div", {}, [
        node("label", { className: "gmdesk-ai-radio" }, [
          node("input", { type: "radio", name: "gmdesk-ai-reply-mode", value: "reply", checked: true }),
          " Sender only"
        ]),
        node("label", { className: "gmdesk-ai-radio" }, [
          node("input", { type: "radio", name: "gmdesk-ai-reply-mode", value: "replyAll" }),
          " Everyone on thread"
        ])
      ]),
      node("div", { className: "gmdesk-ai-actions" }, [
        buttonNode({ id: "gmdesk-ai-draft", className: "primary" }, "Create draft text")
      ])
    ]),
    node("div", { id: "gmdesk-ai-status", className: "gmdesk-ai-status" }),
    node("div", { id: "gmdesk-ai-result" })
  );

  document.documentElement.append(grammarlyButton, button, panel);

  const closeButton = panel.querySelector(".gmdesk-ai-close");
  const extensionsEl = panel.querySelector("#gmdesk-ai-extensions");
  const extensionsCopyEl = panel.querySelector("#gmdesk-ai-extensions-copy");
  const openGrammarlyButton = panel.querySelector("#gmdesk-ai-open-grammarly");
  const copyDraftToGrammarlyButton = panel.querySelector("#gmdesk-ai-copy-draft-grammarly");
  const pasteGrammarlyButton = panel.querySelector("#gmdesk-ai-paste-grammarly");
  const refreshWritingToolsButton = panel.querySelector("#gmdesk-ai-refresh-writing-tools");
  const debugEl = panel.querySelector("#gmdesk-ai-debug");
  const debugLabelEl = panel.querySelector("#gmdesk-ai-debug-label");
  const debugToggleEl = panel.querySelector("#gmdesk-ai-debug-toggle");
  const emailEl = panel.querySelector("#gmdesk-ai-email");
  const assessmentEl = panel.querySelector("#gmdesk-ai-assessment");
  const directionWrap = panel.querySelector("#gmdesk-ai-direction-wrap");
  const directionEl = panel.querySelector("#gmdesk-ai-direction");
  const statusEl = panel.querySelector("#gmdesk-ai-status");
  const resultEl = panel.querySelector("#gmdesk-ai-result");

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function visibleText(element) {
    if (!element) {
      return "";
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return "";
    }

    return normalize(element.innerText || element.textContent);
  }

  function uniqueTextParts(parts) {
    const seen = new Set();
    return parts
      .map(normalize)
      .filter(Boolean)
      .filter((part) => {
        const key = part.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  function richMessageText(element) {
    if (!element) {
      return "";
    }

    const parts = [visibleText(element)];
    const metadataNodes = element.querySelectorAll("img[alt], img[title], iframe[title], object[title], embed[title], [role='img'][aria-label]");
    for (const metadataNode of metadataNodes) {
      const label = metadataNode.getAttribute("alt") ||
        metadataNode.getAttribute("aria-label") ||
        metadataNode.getAttribute("title") ||
        "";
      if (label) {
        parts.push(label);
      }
    }

    const attachmentNodes = element.querySelectorAll("[download], a[href][title], a[href][aria-label]");
    for (const attachmentNode of attachmentNodes) {
      const label = attachmentNode.getAttribute("aria-label") ||
        attachmentNode.getAttribute("title") ||
        visibleText(attachmentNode);
      if (label) {
        parts.push(label);
      }
    }

    return uniqueTextParts(parts).join("\n");
  }

  function findLastVisible(selectors) {
    const elements = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    return elements.reverse().find((element) => visibleText(element));
  }

  function findLastVisibleFrom(root, selectors) {
    const elements = selectors.flatMap((selector) => Array.from(root.querySelectorAll(selector)));
    return elements.reverse().find((element) => visibleText(element));
  }

  function collectEmailContext() {
    const subject = visibleText(findLastVisible([
      "h2.hP",
      "[data-thread-perm-id] h2",
      "div[role='main'] h2"
    ]));

    const messageRoot = findLastVisible([
      "div.adn.ads",
      "div[role='listitem']",
      "div.gs"
    ]);

    const bodyElement = messageRoot
      ? findLastVisibleFrom(messageRoot, [".a3s.aiL", ".a3s", "div[dir='ltr']", "[data-message-id]"])
      : findLastVisible([".a3s.aiL", ".a3s"]);
    const senderElement = messageRoot
      ? findLastVisibleFrom(messageRoot, [".gD[email]", ".go", "[email]"])
      : findLastVisible([".gD[email]", ".go", "[email]"]);
    const dateElement = messageRoot
      ? findLastVisibleFrom(messageRoot, [".g3", ".gH .gK"])
      : findLastVisible([".g3", ".gH .gK"]);

    let from = "";
    if (senderElement) {
      const email = senderElement.getAttribute("email") || "";
      from = [visibleText(senderElement), email].filter(Boolean).join(" ");
    }

    const selectedText = normalize(window.getSelection && window.getSelection().toString());
    const hasThreadDom = Boolean(messageRoot && (subject || senderElement || dateElement || bodyElement));
    const body = richMessageText(bodyElement) || (hasThreadDom ? selectedText : "");

    return {
      body,
      date: visibleText(dateElement),
      from,
      isThread: hasThreadDom,
      subject
    };
  }

  function emailKey(email) {
    return [email.subject, email.from, email.date, email.body && email.body.slice(0, 160)].map(normalize).join("|");
  }

  function setStatus(message, error = false) {
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", Boolean(error));
  }

  function closePanel() {
    panel.dataset.open = "false";
    button.setAttribute("aria-expanded", "false");
  }

  function updateReplyAssistAvailability() {
    const email = collectEmailContext();
    const available = Boolean(email.isThread && email.body);
    const draftAvailable = Boolean(findVisibleDraft());
    state.replyAssistAvailable = available;
    button.hidden = !available;
    panel.hidden = !available;
    grammarlyButton.hidden = !draftAvailable;

    if (!available) {
      closePanel();
      state.currentEmail = null;
      state.lastAssessedEmailKey = "";
      emailEl.textContent = "Open an email thread, then assess it.";
      setStatus("");
    }

    return available;
  }

  function debugLog(eventName, details) {
    if (!state.debugEnabled) {
      return;
    }

    console.debug(`[Gmail Desk AI Debug] ${eventName}`, details || {});
  }

  function refreshEmailPreview() {
    state.currentEmail = collectEmailContext();
    const email = state.currentEmail;
    if (!email.isThread || !email.body) {
      emailEl.textContent = "No open email body detected. Open a message or select email text first.";
      updateReplyAssistAvailability();
      return false;
    }

    emailEl.textContent = [
      email.subject ? `Subject: ${email.subject}` : "",
      email.from ? `From: ${email.from}` : "",
      email.date ? `Date: ${email.date}` : "",
      `Body: ${email.body.slice(0, 280)}${email.body.length > 280 ? "..." : ""}`
    ].filter(Boolean).join("\n");
    debugLog("email-preview", {
      bodyChars: email.body.length,
      dateChars: email.date.length,
      fromPresent: Boolean(email.from),
      subjectChars: email.subject.length
    });
    return true;
  }

  function openPanel() {
    if (!updateReplyAssistAvailability()) {
      return;
    }

    panel.dataset.open = "true";
    button.setAttribute("aria-expanded", "true");
    refreshExtensionStatus();
    refreshDebugStatus();
    if (refreshEmailPreview()) {
      const key = emailKey(state.currentEmail);
      if (key && key !== state.lastAssessedEmailKey) {
        assess();
      }
    }
  }

  function togglePanel() {
    if (!updateReplyAssistAvailability()) {
      return;
    }

    if (panel.dataset.open === "true") {
      closePanel();
    } else {
      openPanel();
    }
  }

  function listNode(items, emptyText = "") {
    if (!items || items.length === 0) {
      return emptyText ? node("p", { className: "gmdesk-ai-text", text: emptyText }) : null;
    }

    const listElement = node("ul", { className: "gmdesk-ai-list" });
    for (const item of items) {
      listElement.append(node("li", { text: item }));
    }
    return listElement;
  }

  function tokenContainer(items, className, emptyText) {
    const container = node("div");
    if (!items || items.length === 0) {
      container.append(node("span", { className: "gmdesk-ai-text", text: emptyText }));
      return container;
    }

    for (const item of items) {
      container.append(buttonNode({
        className: `gmdesk-ai-token ${className}`,
        dataset: { option: String(item || "") }
      }, item));
    }
    return container;
  }

  function textLine(label, value) {
    return node("p", { className: "gmdesk-ai-text" }, [
      node("strong", { text: label }),
      document.createTextNode(` ${value || ""}`)
    ]);
  }

  function renderAssessment(result) {
    state.lastAssessment = result;
    state.lastAssessedEmailKey = emailKey(state.currentEmail || {});
    resultEl.replaceChildren();
    const section = node("div", { className: "gmdesk-ai-section" }, [
      node("span", { className: "gmdesk-ai-pill", text: result.classification || "assessment" }),
      node("p", { className: "gmdesk-ai-text" }, [node("strong", { text: "Sender intent:" })]),
      tokenContainer(result.senderIntentTokens, "sender", "No clear intent tokens."),
      node("p", { className: "gmdesk-ai-text" }, [node("strong", { text: "Possible response intents:" })]),
      tokenContainer(result.responseIntentOptions, "option", "Add your direction below."),
      textLine("What seems warranted:", result.warrantedResponse),
      textLine("Reply-all read:", result.replyAllRecommendation),
      textLine("Why:", result.reasoning)
    ]);

    const questions = listNode(result.suggestedIntentQuestions);
    if (questions) {
      section.append(
        node("p", { className: "gmdesk-ai-text" }, [node("strong", { text: "Before drafting, consider:" })]),
        questions
      );
    }

    assessmentEl.replaceChildren(section);
    directionWrap.hidden = false;
    debugLog("assessment-rendered", {
      classification: result.classification,
      responseIntentCount: (result.responseIntentOptions || []).length,
      senderIntentCount: (result.senderIntentTokens || []).length
    });
  }

  function renderDrafts(result) {
    state.lastDraftResult = result;
    const drafts = result.drafts || [];
    const riskList = listNode(result.risks || [], "None noted.");
    const replyMode = selectedReplyMode();
    const replyButtonClass = replyMode === "reply" ? "primary" : "";
    const replyAllButtonClass = replyMode === "replyAll" ? "primary" : "";
    const children = [
      node("div", { className: "gmdesk-ai-section" }, [
        node("span", { className: "gmdesk-ai-pill", text: result.classification || "draft" }),
        textLine("Strategy:", result.responseStrategy),
        textLine("Reply target:", replyMode === "replyAll" ? "everyone on thread" : "sender only"),
        node("p", { className: "gmdesk-ai-text" }, [node("strong", { text: "Watch outs:" })]),
        riskList
      ])
    ];

    drafts.forEach((draft, index) => {
      children.push(node("article", { className: "gmdesk-ai-draft", dataset: { draftIndex: String(index) } }, [
        node("h4", { text: `${draft.label || "Suggested reply"}${draft.tone ? ` - ${draft.tone}` : ""}` }),
        node("p", { className: "gmdesk-ai-text", text: draft.body || "" }),
        node("div", { className: "gmdesk-ai-draft-actions" }, [
          buttonNode({ dataset: { copyDraft: String(index) } }, "Copy"),
          buttonNode({ className: replyButtonClass, dataset: { openReply: String(index) } }, "Prepare sender-only reply"),
          buttonNode({ className: replyAllButtonClass, dataset: { openReplyAll: String(index) } }, "Prepare reply-all draft"),
          buttonNode({ dataset: { insertDraft: String(index) } }, "Insert into focused compose")
        ])
      ]));
    });

    resultEl.replaceChildren(...children);
    debugLog("drafts-rendered", {
      classification: result.classification,
      draftCount: drafts.length,
      draftChars: drafts.map((draft) => String(draft.body || "").length)
    });
  }

  async function assess() {
    if (!window.gmailDeskAI || typeof window.gmailDeskAI.analyzeEmail !== "function") {
      setStatus("AI bridge is unavailable. Rebuild and relaunch Gmail Desk.", true);
      return;
    }

    if (!refreshEmailPreview()) {
      setStatus("Open an email or select the email text first.", true);
      return;
    }

    assessmentEl.replaceChildren();
    resultEl.replaceChildren();
    directionWrap.hidden = true;
    setStatus("Assessing sender intent...");
    panel.querySelector("#gmdesk-ai-assess").disabled = true;
    try {
      debugLog("assessment-request", {
        bodyChars: state.currentEmail.body.length,
        mode: "assess"
      });
      const result = await window.gmailDeskAI.analyzeEmail({
        email: state.currentEmail,
        mode: "assess"
      });
      renderAssessment(result);
      setStatus("Intent assessment ready. Add your direction before drafting.");
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), true);
    } finally {
      panel.querySelector("#gmdesk-ai-assess").disabled = false;
    }
  }

  async function refreshDebugStatus() {
    if (!window.gmailDeskAI || typeof window.gmailDeskAI.getDebugStatus !== "function") {
      debugEl.hidden = true;
      return;
    }

    try {
      const status = await window.gmailDeskAI.getDebugStatus();
      state.debugAvailable = Boolean(status.available);
      state.debugEnabled = Boolean(status.enabled);
      debugEl.hidden = !state.debugAvailable;
      debugLabelEl.textContent = state.debugEnabled ? "Debug trace on" : "Debug trace off";
      debugToggleEl.textContent = state.debugEnabled ? "Disable debug" : "Enable debug";
    } catch (_error) {
      debugEl.hidden = true;
    }
  }

  async function toggleDebug() {
    if (!window.gmailDeskAI || typeof window.gmailDeskAI.setDebugEnabled !== "function") {
      return;
    }

    const status = await window.gmailDeskAI.setDebugEnabled(!state.debugEnabled);
    state.debugAvailable = Boolean(status.available);
    state.debugEnabled = Boolean(status.enabled);
    debugEl.hidden = !state.debugAvailable;
    debugLabelEl.textContent = state.debugEnabled ? "Debug trace on" : "Debug trace off";
    debugToggleEl.textContent = state.debugEnabled ? "Disable debug" : "Enable debug";
    debugLog("debug-enabled", { enabled: state.debugEnabled });
  }

  async function refreshExtensionStatus() {
    if (!window.gmailDeskAI || typeof window.gmailDeskAI.getExtensionStatus !== "function") {
      extensionsCopyEl.textContent = "Writing tools: extension bridge unavailable.";
      return;
    }

    try {
      const status = await window.gmailDeskAI.getExtensionStatus();
      const loaded = status.loaded || [];
      const errors = status.errors || [];
      const grammarly = loaded.find((extension) => /grammarly/i.test(extension.name || ""));
      const grammarlyMode = grammarly ? "available" : "not available";
      const parts = [
        ["Grammarly:", grammarlyMode]
      ];
      if (errors.length) {
        parts.push(["Notes:", errors[0]]);
      } else if (grammarly) {
        parts.push([null, "Electron does not show Chrome extension toolbar icons."]);
      }

      const statusNodes = [];
      parts.forEach(([label, value], index) => {
        if (index > 0) {
          statusNodes.push(document.createTextNode(" · "));
        }
        if (label) {
          statusNodes.push(node("strong", { text: label }));
          statusNodes.push(document.createTextNode(` ${value || ""}`));
        } else {
          statusNodes.push(document.createTextNode(value || ""));
        }
      });
      extensionsCopyEl.replaceChildren(...statusNodes);
    } catch (error) {
      extensionsCopyEl.textContent = `Writing tools: ${error && error.message ? error.message : error}`;
    }
  }

  async function openGrammarly() {
    if (!window.gmailDeskAI || typeof window.gmailDeskAI.openGrammarly !== "function") {
      setStatus("Grammarly bridge is unavailable. Rebuild and relaunch Gmail Desk.", true);
      return;
    }

    try {
      await window.gmailDeskAI.openGrammarly();
      setStatus("Opened Grammarly inside Gmail Desk.");
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), true);
    }
  }

  async function copyFocusedDraftToGrammarly() {
    const draft = findFocusedDraft();
    if (!draft) {
      setStatus("Focus an existing Gmail draft first, or create reply text and prepare a Gmail draft.", true);
      return;
    }

    const text = normalize(draft.innerText || draft.textContent);
    if (!text) {
      setStatus("Focused Gmail draft is empty.", true);
      return;
    }

    await copyText(text);
    await openGrammarly();
    setStatus("Copied focused draft. Paste it into the Grammarly editor inside Gmail Desk.");
  }

  async function pasteClipboardIntoFocusedDraft() {
    const text = await navigator.clipboard.readText();
    if (!text) {
      setStatus("Clipboard is empty. Copy the checked Grammarly text first.", true);
      return;
    }

    const inserted = insertIntoFocusedDraft(text);
    setStatus(inserted ? "Checked text inserted into the focused Gmail draft. Review before sending." : "Focus an existing Gmail draft first, or prepare a reply draft from a suggestion.", !inserted);
  }

  async function refreshWritingTools() {
    if (!window.gmailDeskAI || typeof window.gmailDeskAI.refreshWritingTools !== "function") {
      setStatus("Writing tools refresh is unavailable. Rebuild and relaunch Gmail Desk.", true);
      return;
    }

    refreshWritingToolsButton.disabled = true;
    setStatus("Refreshing writing tools and reloading Gmail...");
    try {
      await window.gmailDeskAI.refreshWritingTools();
      await refreshExtensionStatus();
      setStatus("Writing tools refreshed. Gmail is reloading.");
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), true);
    } finally {
      refreshWritingToolsButton.disabled = false;
    }
  }

  function selectedReplyMode() {
    const checked = panel.querySelector("input[name='gmdesk-ai-reply-mode']:checked");
    return checked ? checked.value : "reply";
  }

  async function draft() {
    if (!refreshEmailPreview()) {
      setStatus("Open an email before creating reply text.", true);
      return;
    }

    const direction = normalize(directionEl.value || state.selectedOption);
    if (!direction) {
      setStatus("Choose a response-intent token or write your direction first.", true);
      directionEl.focus();
      return;
    }

    setStatus("Creating reply text...");
    panel.querySelector("#gmdesk-ai-draft").disabled = true;
    try {
      debugLog("draft-request", {
        bodyChars: state.currentEmail && state.currentEmail.body ? state.currentEmail.body.length : 0,
        directionChars: direction.length,
        mode: "draft",
        replyMode: selectedReplyMode()
      });
      const result = await window.gmailDeskAI.analyzeEmail({
        email: state.currentEmail,
        mode: "draft",
        replyMode: selectedReplyMode(),
        userDirection: direction
      });
      renderDrafts(result);
      setStatus("Reply text ready. Choose a prepare button to place it in Gmail. Nothing has been sent.");
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), true);
    } finally {
      panel.querySelector("#gmdesk-ai-draft").disabled = false;
    }
  }

  async function copyText(text) {
    await navigator.clipboard.writeText(text);
  }

  function visibleDrafts() {
    return Array.from(document.querySelectorAll("[contenteditable='true']")).reverse().find((element) => {
      const label = [
        element.getAttribute("aria-label"),
        element.getAttribute("role"),
        element.getAttribute("g_editable")
      ].join(" ");
      return /message body|textbox|true/i.test(label) && element.offsetParent !== null;
    });
  }

  function findVisibleDraft() {
    return visibleDrafts();
  }

  function findFocusedDraft() {
    const activeElement = document.activeElement;
    if (activeElement && activeElement.matches && activeElement.matches("[contenteditable='true']")) {
      const label = [
        activeElement.getAttribute("aria-label"),
        activeElement.getAttribute("role"),
        activeElement.getAttribute("g_editable")
      ].join(" ");
      if (/message body|textbox|true/i.test(label) && activeElement.offsetParent !== null) {
        return activeElement;
      }
    }

    return findVisibleDraft();
  }

  function clickReplyControl(mode) {
    const patterns = mode === "replyAll"
      ? [/reply all/i, /reply to all/i]
      : [/^reply$/i, /^reply to (?!all\b).+/i];
    const selectors = [
      "div[role='button'][aria-label]",
      "span[role='link'][aria-label]",
      "div[role='button'][data-tooltip]",
      "span[role='button'][data-tooltip]",
      ".ams.bkH",
      ".amn > .ams"
    ];
    const controls = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const control = controls.find((element) => {
      if (element.offsetParent === null) {
        return false;
      }
      const label = [
        element.getAttribute("aria-label"),
        element.getAttribute("data-tooltip"),
        element.textContent
      ].join(" ");
      if (mode === "reply" && /reply all|reply to all/i.test(normalize(label))) {
        return false;
      }
      return patterns.some((pattern) => pattern.test(normalize(label)));
    });
    if (!control) {
      return false;
    }
    control.click();
    return true;
  }

  async function waitForDraft() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const draft = findFocusedDraft();
      if (draft) {
        return draft;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return null;
  }

  async function openReplyAndInsert(mode, text) {
    const clicked = clickReplyControl(mode);
    if (!clicked) {
      return false;
    }
    const draft = await waitForDraft();
    if (!draft) {
      return false;
    }
    insertIntoDraft(draft, text);
    return true;
  }

  function insertIntoDraft(draft, text) {
    draft.focus();
    document.execCommand("insertText", false, text);
    draft.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text
    }));
  }

  function insertIntoFocusedDraft(text) {
    const draft = findFocusedDraft();
    if (!draft) {
      return false;
    }
    insertIntoDraft(draft, text);
    return true;
  }

  button.setAttribute("aria-controls", "gmdesk-ai-panel");
  button.setAttribute("aria-expanded", "false");
  button.hidden = true;
  grammarlyButton.hidden = true;
  panel.hidden = true;
  button.addEventListener("click", togglePanel);
  grammarlyButton.addEventListener("click", openGrammarly);
  closeButton.addEventListener("click", closePanel);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.dataset.open === "true") {
      closePanel();
    }
  });
  debugToggleEl.addEventListener("click", toggleDebug);
  openGrammarlyButton.addEventListener("click", openGrammarly);
  copyDraftToGrammarlyButton.addEventListener("click", copyFocusedDraftToGrammarly);
  pasteGrammarlyButton.addEventListener("click", pasteClipboardIntoFocusedDraft);
  refreshWritingToolsButton.addEventListener("click", refreshWritingTools);
  panel.querySelector("#gmdesk-ai-refresh").addEventListener("click", () => {
    refreshEmailPreview();
    setStatus("Email context refreshed.");
  });
  panel.querySelector("#gmdesk-ai-assess").addEventListener("click", assess);
  panel.querySelector("#gmdesk-ai-draft").addEventListener("click", draft);
  assessmentEl.addEventListener("click", (event) => {
    const option = event.target && event.target.getAttribute("data-option");
    if (!option) {
      return;
    }
    state.selectedOption = option;
    directionEl.value = directionEl.value ? `${directionEl.value}\n${option}` : option;
    directionEl.focus();
  });
  panel.addEventListener("click", async (event) => {
    const copyIndex = event.target && event.target.getAttribute("data-copy-draft");
    const insertIndex = event.target && event.target.getAttribute("data-insert-draft");
    const replyIndex = event.target && event.target.getAttribute("data-open-reply");
    const replyAllIndex = event.target && event.target.getAttribute("data-open-reply-all");
    const drafts = state.lastDraftResult && state.lastDraftResult.drafts ? state.lastDraftResult.drafts : [];

    if (copyIndex !== null) {
      await copyText(drafts[Number(copyIndex)].body);
      setStatus("Draft copied. Nothing has been sent.");
    }

    if (insertIndex !== null) {
      const inserted = insertIntoFocusedDraft(drafts[Number(insertIndex)].body);
      setStatus(inserted ? "Draft text inserted into the focused compose box. Review before sending." : "Focus an existing Gmail compose box first, or use a prepare reply button.", !inserted);
    }

    if (replyIndex !== null) {
      const inserted = await openReplyAndInsert("reply", drafts[Number(replyIndex)].body);
      setStatus(inserted ? "Sender-only reply draft prepared in Gmail. Review before sending." : "Could not find Gmail's reply control.", !inserted);
    }

    if (replyAllIndex !== null) {
      const inserted = await openReplyAndInsert("replyAll", drafts[Number(replyAllIndex)].body);
      setStatus(inserted ? "Reply-all draft prepared in Gmail. Review before sending." : "Could not find Gmail's reply-all control.", !inserted);
    }
  });

  window.addEventListener("gmail-desk-ai-show", openPanel);
  refreshExtensionStatus();
  updateReplyAssistAvailability();

  let availabilityCheckTimer = 0;
  let lastHref = window.location.href;
  function scheduleAvailabilityCheck() {
    if (availabilityCheckTimer) {
      return;
    }

    availabilityCheckTimer = window.setTimeout(() => {
      availabilityCheckTimer = 0;
      updateReplyAssistAvailability();
    }, 250);
  }

  new MutationObserver(scheduleAvailabilityCheck).observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  window.setInterval(() => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      scheduleAvailabilityCheck();
    }
  }, 500);
})();
