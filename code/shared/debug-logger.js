/**
 * Debug Logger for Slideshow Generation
 * Captures every step with inputs and outputs
 */

import fs from 'fs';
import path from 'path';

class DebugLogger {
  constructor() {
    this.steps = [];
    this.startTime = Date.now();
  }

  /**
   * Log a step with input and output
   */
  logStep(stepName, category, input, output, metadata = {}) {
    const step = {
      stepNumber: this.steps.length + 1,
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - this.startTime,
      category,
      stepName,
      input,
      output,
      metadata
    };
    this.steps.push(step);
    return step;
  }

  /**
   * Get all steps
   */
  getSteps() {
    return this.steps;
  }

  /**
   * Save debug log to JSON file
   */
  saveJSON(outputFolder) {
    const logPath = path.join(outputFolder, 'debug-log.json');
    fs.writeFileSync(logPath, JSON.stringify(this.steps, null, 2));
    return logPath;
  }

  /**
   * Generate beautiful HTML debug report
   */
  saveHTML(outputFolder) {
    const htmlPath = path.join(outputFolder, 'debug-report.html');
    const html = this.generateHTML();
    fs.writeFileSync(htmlPath, html);
    return htmlPath;
  }

  /**
   * Generate the HTML report - Conversational Chat Interface
   */
  generateHTML() {
    // Group steps into conversation flow
    const conversationHTML = this.renderConversation();

    // Summary stats
    const summaryStats = this.getSummaryStats();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pipeline Debug Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f0f;
      min-height: 100vh;
      color: #e5e5e5;
    }

    .app {
      display: flex;
      height: 100vh;
    }

    /* Sidebar */
    .sidebar {
      width: 280px;
      background: #171717;
      border-right: 1px solid #262626;
      padding: 1.5rem;
      overflow-y: auto;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #262626;
    }

    .logo-icon {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #f472b6, #8b5cf6);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
    }

    .logo-text {
      font-weight: 600;
      font-size: 1.1rem;
    }

    .stats-section {
      margin-bottom: 2rem;
    }

    .stats-title {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #737373;
      margin-bottom: 0.75rem;
    }

    .stat-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      background: #262626;
      border-radius: 6px;
      margin-bottom: 0.5rem;
      font-size: 0.85rem;
    }

    .stat-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .stat-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .stat-count {
      font-weight: 600;
      color: #a3a3a3;
    }

    .time-display {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(6, 182, 212, 0.2));
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
    }

    .time-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #10b981;
      margin-bottom: 0.25rem;
    }

    .time-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: #6ee7b7;
    }

    /* Main chat area */
    .chat-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .chat-header {
      padding: 1rem 1.5rem;
      background: #171717;
      border-bottom: 1px solid #262626;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .chat-title {
      font-weight: 600;
    }

    .chat-controls {
      display: flex;
      gap: 0.5rem;
    }

    .control-btn {
      padding: 0.5rem 1rem;
      background: #262626;
      border: 1px solid #404040;
      border-radius: 6px;
      color: #e5e5e5;
      cursor: pointer;
      font-size: 0.8rem;
      transition: all 0.2s;
    }

    .control-btn:hover {
      background: #404040;
    }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem;
    }

    /* Message types */
    .message {
      margin-bottom: 1.5rem;
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* System message */
    .msg-system {
      text-align: center;
      padding: 0.75rem 1rem;
      background: #262626;
      border-radius: 8px;
      font-size: 0.85rem;
      color: #a3a3a3;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }

    .msg-system .icon {
      font-size: 1rem;
    }

    /* AI message */
    .msg-ai {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
    }

    .msg-avatar {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.1rem;
      flex-shrink: 0;
    }

    .msg-avatar.grok {
      background: linear-gradient(135deg, #8b5cf6, #6366f1);
    }

    .msg-avatar.tool {
      background: linear-gradient(135deg, #f59e0b, #ea580c);
    }

    .msg-avatar.image {
      background: linear-gradient(135deg, #ec4899, #f472b6);
    }

    .msg-avatar.screenshot {
      background: linear-gradient(135deg, #10b981, #14b8a6);
    }

    .msg-content {
      flex: 1;
      min-width: 0;
    }

    .msg-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }

    .msg-name {
      font-weight: 600;
      font-size: 0.9rem;
    }

    .msg-time {
      font-size: 0.75rem;
      color: #737373;
    }

    .msg-badge {
      font-size: 0.65rem;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 500;
    }

    .badge-research { background: #3b82f620; color: #60a5fa; }
    .badge-generation { background: #8b5cf620; color: #a78bfa; }
    .badge-tool { background: #f59e0b20; color: #fbbf24; }
    .badge-image { background: #ec489920; color: #f472b6; }

    .msg-body {
      background: #1a1a1a;
      border: 1px solid #262626;
      border-radius: 12px;
      padding: 1rem;
      line-height: 1.6;
    }

    .msg-body p {
      margin-bottom: 0.75rem;
    }

    .msg-body p:last-child {
      margin-bottom: 0;
    }

    /* Tool call styling */
    .tool-call {
      background: #1c1917;
      border: 1px solid #44403c;
      border-radius: 8px;
      margin-top: 0.75rem;
      overflow: hidden;
    }

    .tool-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background: #292524;
      border-bottom: 1px solid #44403c;
      cursor: pointer;
    }

    .tool-icon {
      font-size: 1rem;
    }

    .tool-name {
      font-weight: 600;
      font-size: 0.85rem;
      color: #fbbf24;
    }

    .tool-toggle {
      margin-left: auto;
      color: #737373;
      transition: transform 0.2s;
    }

    .tool-call.collapsed .tool-toggle {
      transform: rotate(-90deg);
    }

    .tool-params {
      padding: 0.75rem 1rem;
      font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
      font-size: 0.8rem;
      color: #a3a3a3;
      max-height: 200px;
      overflow-y: auto;
    }

    .tool-call.collapsed .tool-params {
      display: none;
    }

    .param-row {
      display: flex;
      margin-bottom: 0.5rem;
    }

    .param-key {
      color: #f472b6;
      min-width: 100px;
    }

    .param-value {
      color: #86efac;
      word-break: break-all;
    }

    /* Tool result */
    .tool-result {
      background: #052e16;
      border: 1px solid #166534;
      border-radius: 8px;
      margin-top: 0.75rem;
      overflow: hidden;
    }

    .tool-result .tool-header {
      background: #14532d;
      border-bottom-color: #166534;
    }

    .tool-result .tool-name {
      color: #86efac;
    }

    .result-content {
      padding: 0.75rem 1rem;
      font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
      font-size: 0.8rem;
      max-height: 300px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .tool-result.collapsed .result-content {
      display: none;
    }

    /* Image preview */
    .image-preview-container {
      margin-top: 1rem;
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .image-preview-card {
      background: #262626;
      border-radius: 12px;
      overflow: hidden;
      max-width: 280px;
    }

    .image-preview-card img {
      width: 100%;
      height: auto;
      display: block;
    }

    .image-preview-info {
      padding: 0.75rem;
      font-size: 0.8rem;
    }

    .image-prompt {
      color: #a3a3a3;
      font-style: italic;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* IMG2IMG comparison */
    .img2img-comparison {
      display: flex;
      align-items: flex-start;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .img2img-reference,
    .img2img-output {
      background: #262626;
      border-radius: 12px;
      overflow: hidden;
      max-width: 200px;
    }

    .img2img-label {
      padding: 0.5rem 0.75rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: #a3a3a3;
      background: #1a1a1a;
    }

    .img2img-reference img,
    .img2img-output img {
      width: 100%;
      height: auto;
      display: block;
    }

    .img2img-arrow {
      font-size: 2rem;
      color: #8b5cf6;
      align-self: center;
      padding: 0 0.5rem;
    }

    /* Metadata tag list */
    .metadata-tag-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .metadata-tag {
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 500;
    }

    .metadata-warning {
      background: #fef2f220;
      color: #fca5a5;
      border: 1px solid #fca5a540;
    }

    .metadata-caution {
      background: #fef9c320;
      color: #fde047;
      border: 1px solid #fde04740;
    }

    .metadata-safe {
      background: #dcfce720;
      color: #86efac;
      border: 1px solid #86efac40;
    }

    /* Expandable text */
    .expandable {
      cursor: pointer;
    }

    .expandable-content {
      max-height: 150px;
      overflow: hidden;
      position: relative;
    }

    .expandable-content.expanded {
      max-height: none;
    }

    .expandable-content:not(.expanded)::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 50px;
      background: linear-gradient(transparent, #1a1a1a);
    }

    .expand-btn {
      color: #60a5fa;
      font-size: 0.8rem;
      margin-top: 0.5rem;
      cursor: pointer;
    }

    .expand-btn:hover {
      text-decoration: underline;
    }

    /* JSON highlighting */
    .json-key { color: #f472b6; }
    .json-string { color: #86efac; }
    .json-number { color: #fbbf24; }
    .json-boolean { color: #60a5fa; }
    .json-null { color: #a3a3a3; }

    /* Section divider */
    .section-divider {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin: 2rem 0;
      color: #525252;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .section-divider::before,
    .section-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #262626;
    }

    .section-divider .icon {
      font-size: 1.2rem;
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="logo">
        <div class="logo-icon">🎬</div>
        <span class="logo-text">Pipeline Debug</span>
      </div>

      <div class="stats-section">
        <div class="stats-title">Pipeline Steps</div>
        ${summaryStats}
      </div>

      <div class="time-display">
        <div class="time-label">Total Duration</div>
        <div class="time-value">${this.formatTime(Date.now() - this.startTime)}</div>
      </div>
    </aside>

    <main class="chat-container">
      <header class="chat-header">
        <span class="chat-title">Generation Flow</span>
        <div class="chat-controls">
          <button class="control-btn" onclick="expandAll()">Expand All</button>
          <button class="control-btn" onclick="collapseAll()">Collapse All</button>
        </div>
      </header>

      <div class="chat-messages">
        ${conversationHTML}
      </div>
    </main>
  </div>

  <script>
    function toggleTool(el) {
      el.closest('.tool-call, .tool-result').classList.toggle('collapsed');
    }

    function toggleExpand(el) {
      const content = el.previousElementSibling;
      content.classList.toggle('expanded');
      el.textContent = content.classList.contains('expanded') ? 'Show less' : 'Show more';
    }

    function expandAll() {
      document.querySelectorAll('.tool-call, .tool-result').forEach(el => el.classList.remove('collapsed'));
      document.querySelectorAll('.expandable-content').forEach(el => el.classList.add('expanded'));
    }

    function collapseAll() {
      document.querySelectorAll('.tool-call, .tool-result').forEach(el => el.classList.add('collapsed'));
      document.querySelectorAll('.expandable-content').forEach(el => el.classList.remove('expanded'));
    }

    // Start with tool details collapsed
    document.querySelectorAll('.tool-call, .tool-result').forEach(el => el.classList.add('collapsed'));
  </script>
</body>
</html>`;
  }

  /**
   * Get summary stats HTML for sidebar
   */
  getSummaryStats() {
    const categoryConfig = {
      'grok-prompt': { color: '#6366f1', icon: '🤖', label: 'AI Prompts' },
      'grok-response': { color: '#8b5cf6', icon: '💬', label: 'AI Responses' },
      'research-extraction': { color: '#4285f4', icon: '🔎', label: 'Research Extraction' },
      'structured-format': { color: '#34a853', icon: '📋', label: 'Structured Formatting' },
      'tool-call': { color: '#f59e0b', icon: '🔧', label: 'Tool Calls' },
      'tool-result': { color: '#10b981', icon: '📋', label: 'Tool Results' },
      'web-search': { color: '#3b82f6', icon: '🔍', label: 'Web Searches' },
      'image-generation': { color: '#ec4899', icon: '🎨', label: 'Images Generated' },
      'screenshot': { color: '#14b8a6', icon: '📱', label: 'Screenshots' },
      'overlay': { color: '#06b6d4', icon: '📝', label: 'Overlays' },
      'save': { color: '#64748b', icon: '💾', label: 'Saves' }
    };

    const counts = {};
    this.steps.forEach(s => {
      counts[s.category] = (counts[s.category] || 0) + 1;
    });

    return Object.entries(counts).map(([cat, count]) => {
      const config = categoryConfig[cat] || { color: '#6b7280', icon: '📌', label: cat };
      return `
        <div class="stat-item">
          <span class="stat-label">
            <span class="stat-dot" style="background: ${config.color}"></span>
            ${config.label}
          </span>
          <span class="stat-count">${count}</span>
        </div>
      `;
    }).join('');
  }

  /**
   * Render conversation flow from steps
   */
  renderConversation() {
    const html = [];
    let currentPhase = '';

    for (const step of this.steps) {
      // Add phase dividers
      const phase = this.getPhase(step.category);
      if (phase !== currentPhase) {
        currentPhase = phase;
        html.push(this.renderPhaseDivider(phase));
      }

      html.push(this.renderStep(step));
    }

    return html.join('\n');
  }

  /**
   * Get phase from category
   */
  getPhase(category) {
    if (['grok-prompt', 'grok-response', 'tool-call', 'tool-result', 'web-search', 'content-generation', 'research-extraction', 'structured-format'].includes(category)) {
      return 'research';
    }
    if (category === 'image-generation') return 'images';
    if (['screenshot', 'overlay'].includes(category)) return 'compositing';
    if (category === 'save') return 'output';
    return 'other';
  }

  /**
   * Render phase divider
   */
  renderPhaseDivider(phase) {
    const phaseConfig = {
      'research': { icon: '🔍', label: 'Research & Content Generation' },
      'images': { icon: '🎨', label: 'Image Generation' },
      'compositing': { icon: '📱', label: 'Compositing & Overlays' },
      'output': { icon: '💾', label: 'Output' }
    };
    const config = phaseConfig[phase] || { icon: '📌', label: phase };
    return `<div class="section-divider"><span class="icon">${config.icon}</span> ${config.label}</div>`;
  }

  /**
   * Render individual step
   */
  renderStep(step) {
    switch (step.category) {
      case 'grok-response':
        return this.renderAIMessage(step);
      case 'research-extraction':
        return this.renderResearchExtraction(step);
      case 'structured-format':
        return this.renderStructuredFormat(step);
      case 'tool-call':
        return this.renderToolCall(step);
      case 'web-search':
      case 'tool-result':
        return this.renderToolResult(step);
      case 'image-generation':
        return this.renderImageGeneration(step);
      case 'screenshot':
        return this.renderScreenshot(step);
      case 'overlay':
        return this.renderOverlay(step);
      case 'save':
        return this.renderSystemMessage(step);
      default:
        return this.renderGenericStep(step);
    }
  }

  /**
   * Render AI message
   */
  renderAIMessage(step) {
    const output = step.output || {};
    const content = output.content || '';
    const toolCalls = output.tool_calls || [];

    // Format content nicely
    let formattedContent = '';
    if (content) {
      formattedContent = `<p>${this.escapeHtml(content).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
    }

    // Render tool calls (only if there are any)
    const toolCallsHTML = toolCalls.length > 0 ? toolCalls.map(tc => {
      if (!tc.function?.name) return ''; // Skip if no function name
      const args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
      return `
        <div class="tool-call collapsed">
          <div class="tool-header" onclick="toggleTool(this)">
            <span class="tool-icon">🔧</span>
            <span class="tool-name">${tc.function.name}</span>
            <span class="tool-toggle">▼</span>
          </div>
          <div class="tool-params">
            ${this.renderParams(args)}
          </div>
        </div>
      `;
    }).filter(Boolean).join('') : '';

    return `
      <div class="message msg-ai">
        <div class="msg-avatar grok">🤖</div>
        <div class="msg-content">
          <div class="msg-header">
            <span class="msg-name">Grok</span>
            <span class="msg-badge badge-research">${step.stepName}</span>
            <span class="msg-time">${this.formatTime(step.elapsedMs)}</span>
          </div>
          <div class="msg-body">
            ${formattedContent || '<em>No text response</em>'}
            ${toolCallsHTML}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render research extraction step - shows input prompt and raw output
   */
  renderResearchExtraction(step) {
    const input = step.input || {};
    const output = step.output || {};

    return `
      <div class="message msg-ai">
        <div class="msg-avatar" style="background: linear-gradient(135deg, #4285f4, #34a853);">🔎</div>
        <div class="msg-content">
          <div class="msg-header">
            <span class="msg-name">${step.stepName}</span>
            <span class="msg-badge" style="background: #4285f420; color: #4285f4;">Research Extraction</span>
            <span class="msg-time">${this.formatTime(step.elapsedMs)}</span>
          </div>
          <div class="msg-body">
            <!-- INPUT: Prompt -->
            <div class="tool-call">
              <div class="tool-header" onclick="toggleTool(this)">
                <span class="tool-icon">📥</span>
                <span class="tool-name" style="color: #4285f4;">INPUT: Search Prompt</span>
                <span class="tool-toggle">▼</span>
              </div>
              <div class="tool-params" style="background: #1a1a2e;">
                <pre style="white-space: pre-wrap; color: #e5e5e5; margin: 0;">${this.escapeHtml(input.prompt || 'No prompt')}</pre>
              </div>
            </div>

            ${output.thinking ? `
            <!-- THINKING -->
            <div class="tool-call" style="border-color: #8b5cf6;">
              <div class="tool-header" onclick="toggleTool(this)" style="background: linear-gradient(135deg, #4c1d95, #5b21b6);">
                <span class="tool-icon">🧠</span>
                <span class="tool-name" style="color: #c4b5fd;">THINKING</span>
                <span class="tool-toggle">▼</span>
              </div>
              <div class="tool-params" style="background: #1e1b4b; max-height: 400px;">
                <pre style="white-space: pre-wrap; color: #c4b5fd; margin: 0;">${this.escapeHtml(output.thinking)}</pre>
              </div>
            </div>
            ` : ''}

            <!-- OUTPUT: Raw Response -->
            <div class="tool-result" style="border-color: #34a853; background: #052e16;">
              <div class="tool-header" onclick="toggleTool(this)" style="background: #14532d;">
                <span class="tool-icon">📤</span>
                <span class="tool-name" style="color: #86efac;">OUTPUT: Raw Response (${output.responseLength || 0} chars)</span>
                <span class="tool-toggle">▼</span>
              </div>
              <div class="result-content" style="max-height: 500px;">
                <pre style="white-space: pre-wrap; margin: 0;">${this.escapeHtml(output.raw || 'No response')}</pre>
              </div>
            </div>

            ${output.sources?.length > 0 ? `
            <!-- SOURCES -->
            <div style="margin-top: 0.75rem; padding: 0.75rem; background: #262626; border-radius: 8px;">
              <div style="font-size: 0.75rem; color: #737373; margin-bottom: 0.5rem;">Sources:</div>
              ${output.sources.map(s => `<a href="${this.escapeHtml(s)}" target="_blank" style="display: block; font-size: 0.8rem; color: #60a5fa; word-break: break-all; margin-bottom: 0.25rem;">${this.escapeHtml(s)}</a>`).join('')}
            </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render structured format step - shows formatting input/output
   */
  renderStructuredFormat(step) {
    const input = step.input || {};
    const output = step.output || {};

    const metadataTags = output.items || output.attributes || [];
    const renderedTags = metadataTags.map((item) => {
      const label = item.name || item.label || item.value || JSON.stringify(item);
      const flag = item.flagType || item.level || 'safe';
      const flagClass = flag === 'warning' ? 'metadata-warning' :
                       flag === 'caution' ? 'metadata-caution' : 'metadata-safe';
      return `<span class="metadata-tag ${flagClass}">${this.escapeHtml(label)}</span>`;
    }).join('');

    return `
      <div class="message msg-ai">
        <div class="msg-avatar" style="background: linear-gradient(135deg, #34a853, #0f9d58);">📋</div>
        <div class="msg-content">
          <div class="msg-header">
            <span class="msg-name">${step.stepName}</span>
            <span class="msg-badge" style="background: #34a85320; color: #34a853;">Structured Format</span>
            <span class="msg-time">${this.formatTime(step.elapsedMs)}</span>
          </div>
          <div class="msg-body">
            <!-- INPUT: Formatting Prompt -->
            <div class="tool-call">
              <div class="tool-header" onclick="toggleTool(this)">
                <span class="tool-icon">📥</span>
                <span class="tool-name" style="color: #34a853;">INPUT: Format Prompt</span>
                <span class="tool-toggle">▼</span>
              </div>
              <div class="tool-params" style="background: #1a1a2e; max-height: 300px;">
                <pre style="white-space: pre-wrap; color: #e5e5e5; margin: 0;">${this.escapeHtml(input.prompt || 'No prompt')}</pre>
              </div>
            </div>

            <!-- OUTPUT: Formatted Response -->
            <div class="tool-result" style="border-color: #34a853; background: #052e16;">
              <div class="tool-header" onclick="toggleTool(this)" style="background: #14532d;">
                <span class="tool-icon">📤</span>
                <span class="tool-name" style="color: #86efac;">OUTPUT: Formatted JSON</span>
                <span class="tool-toggle">▼</span>
              </div>
              <div class="result-content" style="max-height: 300px;">
                <pre style="white-space: pre-wrap; margin: 0;">${this.escapeHtml(output.response || JSON.stringify(output.items || output.attributes, null, 2))}</pre>
              </div>
            </div>

            ${metadataTags.length > 0 ? `
            <!-- PARSED TAGS -->
            <div style="margin-top: 1rem;">
              <div style="font-size: 0.8rem; color: #a3a3a3; margin-bottom: 0.5rem;">Parsed Tags (${metadataTags.length}):</div>
              <div class="metadata-tag-list">${renderedTags}</div>
            </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render tool call
   */
  renderToolCall(step) {
    const input = step.input || {};
    return `
      <div class="message msg-ai">
        <div class="msg-avatar tool">🔧</div>
        <div class="msg-content">
          <div class="msg-header">
            <span class="msg-name">${step.stepName}</span>
            <span class="msg-badge badge-tool">Tool</span>
            <span class="msg-time">${this.formatTime(step.elapsedMs)}</span>
          </div>
          <div class="msg-body">
            <div class="tool-call collapsed">
              <div class="tool-header" onclick="toggleTool(this)">
                <span class="tool-icon">⚡</span>
                <span class="tool-name">Parameters</span>
                <span class="tool-toggle">▼</span>
              </div>
              <div class="tool-params">
                ${this.renderParams(input)}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render tool result - with special handling for webpage reads
   */
  renderToolResult(step) {
    const output = step.output || {};
    const input = step.input || {};

    // Check if this is a webpage read with captured image
    const isWebpageRead = step.stepName.includes('read_webpage');
    const hasImage = output.imagePreview;
    const productName = output.productName;
    const url = output.url || input.url;
    const content = output.content;

    if (isWebpageRead) {
      return `
        <div class="message msg-ai">
          <div class="msg-avatar tool" style="background: linear-gradient(135deg, #3b82f6, #8b5cf6);">🌐</div>
          <div class="msg-content">
            <div class="msg-header">
              <span class="msg-name">Webpage Read${productName ? `: ${this.escapeHtml(productName)}` : ''}</span>
              <span class="msg-badge badge-tool">Scraped</span>
              <span class="msg-time">${this.formatTime(step.elapsedMs)}</span>
            </div>
            <div class="msg-body">
              ${url ? `<p style="font-size: 0.8rem; color: #60a5fa; margin-bottom: 0.75rem; word-break: break-all;">${this.escapeHtml(url)}</p>` : ''}
              ${hasImage ? `
                <div class="image-preview-container" style="margin-bottom: 1rem;">
                  <div class="image-preview-card">
                    <img src="${output.imagePreview}" alt="Captured product image" style="max-height: 200px;" />
                    <div class="image-preview-info">
                      <span style="color: #86efac;">✓ Product image captured for image-to-image</span>
                    </div>
                  </div>
                </div>
              ` : ''}
              ${content ? `
                <div class="tool-result">
                  <div class="tool-header" onclick="toggleTool(this)">
                    <span class="tool-icon">📄</span>
                    <span class="tool-name">Page Content (${content.length} chars)</span>
                    <span class="tool-toggle">▼</span>
                  </div>
                  <div class="result-content" style="max-height: 400px; white-space: pre-wrap;">${this.escapeHtml(content)}</div>
                </div>
              ` : `
                <div class="tool-result collapsed">
                  <div class="tool-header" onclick="toggleTool(this)">
                    <span class="tool-icon">📋</span>
                    <span class="tool-name">Response Data</span>
                    <span class="tool-toggle">▼</span>
                  </div>
                  <div class="result-content">${this.formatResultContent(output)}</div>
                </div>
              `}
            </div>
          </div>
        </div>
      `;
    }

    // Default rendering for other tool results
    return `
      <div class="message msg-ai">
        <div class="msg-avatar tool">✅</div>
        <div class="msg-content">
          <div class="msg-header">
            <span class="msg-name">${step.stepName}</span>
            <span class="msg-badge badge-tool">Result</span>
            <span class="msg-time">${this.formatTime(step.elapsedMs)}</span>
          </div>
          <div class="msg-body">
            <div class="tool-result collapsed">
              <div class="tool-header" onclick="toggleTool(this)">
                <span class="tool-icon">📋</span>
                <span class="tool-name">Response Data</span>
                <span class="tool-toggle">▼</span>
              </div>
              <div class="result-content">${this.formatResultContent(output)}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render image generation step
   */
  renderImageGeneration(step) {
    const input = step.input || {};
    const output = step.output || {};
    const imagePreview = output.imagePreview;
    const prompt = input.image_prompt || input.prompt || 'No prompt';
    const generationMode = input.generation_mode || 'text2img';
    const referenceImagePreview = input.referenceImagePreview;
    const productName = input.product_image_name;

    // For img2img, show both reference and output images
    const isImg2Img = generationMode === 'img2img' && referenceImagePreview;

    return `
      <div class="message msg-ai">
        <div class="msg-avatar image">🎨</div>
        <div class="msg-content">
          <div class="msg-header">
            <span class="msg-name">${step.stepName}</span>
            <span class="msg-badge badge-image">${isImg2Img ? 'IMG2IMG' : 'Image'}</span>
            <span class="msg-time">${this.formatTime(step.elapsedMs)}</span>
          </div>
          <div class="msg-body">
            ${isImg2Img ? `
              <div class="img2img-comparison">
                <div class="img2img-reference">
                  <div class="img2img-label">Reference: ${this.escapeHtml(productName || 'Product')}</div>
                  <img src="${referenceImagePreview}" alt="Reference image" />
                </div>
                ${imagePreview ? `
                  <div class="img2img-arrow">→</div>
                  <div class="img2img-output">
                    <div class="img2img-label">Generated</div>
                    <img src="${imagePreview}" alt="Generated image" />
                  </div>
                ` : ''}
              </div>
              <div class="image-prompt" style="margin-top: 12px;">${this.escapeHtml(prompt)}</div>
            ` : imagePreview ? `
              <div class="image-preview-container">
                <div class="image-preview-card">
                  <img src="${imagePreview}" alt="Generated image" />
                  <div class="image-preview-info">
                    <div class="image-prompt">${this.escapeHtml(prompt)}</div>
                  </div>
                </div>
              </div>
            ` : `<p>Generating image...</p><p class="image-prompt">${this.escapeHtml(prompt)}</p>`}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render screenshot step
   */
  renderScreenshot(step) {
    const input = step.input || {};
    const output = step.output || {};
    const imagePreview = output.imagePreview;
    const metadataTags = input.screenshot_items || input.screenshot_attributes || [];

    const renderedTags = metadataTags.map((item) => {
      const label = item.name || item.label || item.value || JSON.stringify(item);
      const flag = item.flagType || item.level || 'safe';
      const flagClass = flag === 'warning' ? 'metadata-warning' :
                       flag === 'caution' ? 'metadata-caution' : 'metadata-safe';
      return `<span class="metadata-tag ${flagClass}">${this.escapeHtml(label)}</span>`;
    }).join('');

    return `
      <div class="message msg-ai">
        <div class="msg-avatar screenshot">📱</div>
        <div class="msg-content">
          <div class="msg-header">
            <span class="msg-name">${step.stepName}</span>
            <span class="msg-badge badge-generation">Screenshot</span>
            <span class="msg-time">${this.formatTime(step.elapsedMs)}</span>
          </div>
          <div class="msg-body">
            ${imagePreview ? `
              <div class="image-preview-container">
                <div class="image-preview-card">
                  <img src="${imagePreview}" alt="Screenshot" />
                </div>
              </div>
            ` : ''}
            ${metadataTags.length > 0 ? `
              <p style="margin-top: 1rem; font-size: 0.85rem; color: #a3a3a3;">Metadata tags:</p>
              <div class="metadata-tag-list">${renderedTags}</div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render overlay step
   */
  renderOverlay(step) {
    const input = step.input || {};
    return `
      <div class="message msg-ai">
        <div class="msg-avatar screenshot">📝</div>
        <div class="msg-content">
          <div class="msg-header">
            <span class="msg-name">${step.stepName}</span>
            <span class="msg-badge badge-generation">Overlay</span>
            <span class="msg-time">${this.formatTime(step.elapsedMs)}</span>
          </div>
          <div class="msg-body">
            <p><strong>Text:</strong> ${this.escapeHtml(input.text_overlay || 'None')}</p>
            <p><strong>Position:</strong> ${input.text_position || 'default'}</p>
            ${input.has_screenshot ? `<p><strong>Has Screenshot:</strong> Yes (${input.screenshot_position || 'default'})</p>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render system message
   */
  renderSystemMessage(step) {
    return `
      <div class="message">
        <div class="msg-system">
          <span class="icon">💾</span>
          ${step.stepName} • ${this.formatTime(step.elapsedMs)}
        </div>
      </div>
    `;
  }

  /**
   * Render generic step
   */
  renderGenericStep(step) {
    return `
      <div class="message msg-ai">
        <div class="msg-avatar tool">📌</div>
        <div class="msg-content">
          <div class="msg-header">
            <span class="msg-name">${step.stepName}</span>
            <span class="msg-time">${this.formatTime(step.elapsedMs)}</span>
          </div>
          <div class="msg-body">
            ${step.input ? `<div class="expandable-content">${this.formatResultContent(step.input)}</div><div class="expand-btn" onclick="toggleExpand(this)">Show more</div>` : ''}
            ${step.output ? `<div class="expandable-content">${this.formatResultContent(step.output)}</div><div class="expand-btn" onclick="toggleExpand(this)">Show more</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render parameters as key-value pairs - FULL content, no truncation
   */
  renderParams(obj) {
    if (!obj || typeof obj !== 'object') return this.escapeHtml(String(obj));
    return Object.entries(obj).map(([key, value]) => {
      let displayValue = value;
      if (typeof value === 'object') {
        displayValue = JSON.stringify(value, null, 2);
      }
      // Show FULL content - no truncation for prompts
      return `<div class="param-row"><span class="param-key">${this.escapeHtml(key)}:</span> <span class="param-value" style="white-space: pre-wrap;">${this.escapeHtml(String(displayValue))}</span></div>`;
    }).join('');
  }

  /**
   * Format result content for display
   */
  formatResultContent(data) {
    if (!data) return '';
    if (typeof data === 'string') {
      return this.escapeHtml(data.length > 2000 ? data.substring(0, 2000) + '...' : data);
    }
    // Remove imagePreview from display (too long)
    if (data.imagePreview) {
      data = { ...data };
      delete data.imagePreview;
      data._hasImagePreview = true;
    }
    const json = JSON.stringify(data, null, 2);
    return this.syntaxHighlightJson(json.length > 3000 ? json.substring(0, 3000) + '...' : json);
  }

  /**
   * Syntax highlight JSON with CSS classes
   */
  syntaxHighlightJson(json) {
    json = this.escapeHtml(json);
    return json.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'json-key' : 'json-string';
        } else if (/true|false/.test(match)) {
          cls = 'json-boolean';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
  }

  /**
   * Format data for display (legacy - kept for compatibility)
   */
  formatData(data, label) {
    if (!data) return '';

    let content;
    let className = 'text';
    let imageHtml = '';

    if (typeof data === 'string') {
      content = this.escapeHtml(data);
    } else {
      // Check if there's an image preview
      if (data.imagePreview) {
        imageHtml = `
          <div class="image-preview">
            <img src="${data.imagePreview}" alt="Generated image" />
          </div>
        `;
        // Remove imagePreview from JSON display (too long)
        const displayData = { ...data };
        delete displayData.imagePreview;
        displayData.hasImage = true;
        content = this.syntaxHighlight(JSON.stringify(displayData, null, 2));
      } else {
        content = this.syntaxHighlight(JSON.stringify(data, null, 2));
      }
      className = 'json';
    }

    return `
      <div class="data-section">
        <div class="data-label">${label}</div>
        ${imageHtml}
        <div class="data-content ${className}">${content}</div>
      </div>
    `;
  }

  /**
   * Syntax highlight JSON
   */
  syntaxHighlight(json) {
    json = this.escapeHtml(json);
    return json.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'highlight-number';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'highlight-key';
          } else {
            cls = 'highlight-string';
          }
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
  }

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const div = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, s => div[s]);
  }

  /**
   * Format milliseconds to readable time
   */
  formatTime(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }
}

// Singleton instance
let loggerInstance = null;

export function getLogger() {
  if (!loggerInstance) {
    loggerInstance = new DebugLogger();
  }
  return loggerInstance;
}

export function resetLogger() {
  loggerInstance = new DebugLogger();
  return loggerInstance;
}

export { DebugLogger };
