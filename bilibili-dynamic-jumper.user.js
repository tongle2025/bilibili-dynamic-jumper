// ==UserScript==
// @name         哔哩哔哩动态日期跳转助手
// @name:en      Bilibili Dynamic Time Jumper
// @namespace    https://github.com/tongle2025/bilibili-dynamic-jumper
// @version      1.5.0
// @description  快速跳转到B站UP主指定日期/年月的历史动态，支持自定义日历选择、自动跟随B站官方与Bilibili-Evolved深色模式、省内存模式、命中结果列表直达与定位当日最早动态
// @description:en Quickly jump to Bilibili UP master's dynamics at specified date
// @author       Sakurakid
// @match        https://space.bilibili.com/*/dynamic*
// @match        https://t.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        none
// @license      MIT
// @homepage     https://github.com/tongle2025/bilibili-dynamic-jumper
// @supportURL   https://github.com/tongle2025/bilibili-dynamic-jumper/issues
// ==/UserScript==

(function() {
    'use strict';

    const DEFAULT_SETTINGS = {
        maxRetries: 10,
        scrollDelay: 2000,
        scrollAggressiveness: 'aggressive',
        extraScroll: 2000,
        memorySaver: true,
        themeMode: 'auto'  // 'auto' | 'light' | 'dark'
    };

    const STORAGE_KEY = 'bilibili_dynamic_jumper_settings';

    // 全局状态
    let isSearching = false;
    let targetYear = null;
    let targetMonth = null;
    let targetDay = null;
    let currentRetries = 0;
    let lastDynamicCount = 0;
    let totalScrolls = 0;
    let prunedCardCount = 0;

    // 日历选择器状态（默认今日）
    const initNow = new Date();
    let selectedYear = initNow.getFullYear();
    let selectedMonth = initNow.getMonth() + 1;
    let selectedDay = initNow.getDate();
    let viewYear = selectedYear;
    let viewMonth = selectedMonth;
    let isMonthOnly = false;
    let isCalendarOpen = false;

    // 深色模式状态
    let currentIsDark = false;
    let themeObserver = null;
    let themeSyncTimer = null;

    // 定时器管理，防止手动停止后残留回调执行
    const pendingTimers = new Set();

    // 匹配结果（按页面从上到下，即从晚到早排列）与高亮状态
    let allMatchedResults = [];
    let matchedResults = [];
    let currentAuthorFilter = '';
    let authorFilterTimer = null;
    let currentMatchIndex = -1;
    let oldestLoadedDateInfo = null;
    let currentHighlightedCard = null;
    let currentHighlightOriginalStyle = null;
    let currentHighlightIsApprox = false;
    let currentFlashTimeout = null;

    function debugLog(...args) {
        console.log('[动态跳转]', ...args);
    }

    function scheduleTimer(fn, delay) {
        const id = setTimeout(() => {
            pendingTimers.delete(id);
            fn();
        }, delay);
        pendingTimers.add(id);
        return id;
    }

    function clearAllTimers() {
        pendingTimers.forEach(id => clearTimeout(id));
        pendingTimers.clear();
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function saveSettings() {
        try {
            const maxRetriesEl = document.getElementById('max-retries');
            const scrollDelayEl = document.getElementById('scroll-delay');
            const aggEl = document.getElementById('scroll-aggressiveness');
            const extraScrollEl = document.getElementById('extra-scroll');
            const memSaverEl = document.getElementById('memory-saver-toggle');
            const themeEl = document.getElementById('theme-mode-select');

            const current = loadSettings();
            const settings = {
                maxRetries: maxRetriesEl ? (parseInt(maxRetriesEl.value, 10) || DEFAULT_SETTINGS.maxRetries) : current.maxRetries,
                scrollDelay: scrollDelayEl ? (parseInt(scrollDelayEl.value, 10) || DEFAULT_SETTINGS.scrollDelay) : current.scrollDelay,
                scrollAggressiveness: aggEl ? (aggEl.value || DEFAULT_SETTINGS.scrollAggressiveness) : current.scrollAggressiveness,
                extraScroll: extraScrollEl ? parseInt(extraScrollEl.value, 10) : current.extraScroll,
                memorySaver: memSaverEl ? Boolean(memSaverEl.checked) : current.memorySaver,
                themeMode: themeEl ? (themeEl.value || DEFAULT_SETTINGS.themeMode) : current.themeMode
            };
            if (isNaN(settings.extraScroll)) settings.extraScroll = DEFAULT_SETTINGS.extraScroll;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            debugLog('设置已保存', settings);
        } catch (e) {
            debugLog('保存设置失败:', e);
        }
    }

    function loadSettings() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(saved));
            }
        } catch (e) {
            debugLog('加载设置失败:', e);
        }
        return Object.assign({}, DEFAULT_SETTINGS);
    }

    // ==================== 深色模式自动检测与实时同步 ====================

    function parseRgbColor(colorStr) {
        if (!colorStr || colorStr === 'transparent') return null;
        const m = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
        if (!m) return null;
        const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
        if (a < 0.1) return null;
        return { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10) };
    }

    function detectPageDarkMode() {
        const html = document.documentElement;
        const body = document.body;

        // 1. Bilibili-Evolved 夜间模式（常见为 body.dark / html.dark / dark-mode）
        if (
            (body && (body.classList.contains('dark') || body.classList.contains('dark-mode'))) ||
            (html && (html.classList.contains('dark') || html.classList.contains('dark-mode')))
        ) {
            return true;
        }

        // 2. B站官方深色模式（data-theme / night-mode / 深色 CSS / cookie）
        if (
            (html && (html.getAttribute('data-theme') === 'dark' || html.classList.contains('night-mode'))) ||
            (body && (body.getAttribute('data-theme') === 'dark' || body.classList.contains('night-mode')))
        ) {
            return true;
        }

        const darkLink = document.querySelector(
            'link[href*="dark.css"], link[id*="dark-style"], link[id*="__bili-dark"], style#dark-mode, style[data-name="dark-mode"]'
        );
        if (darkLink && !darkLink.disabled) {
            return true;
        }

        if (document.cookie && /(?:^|;\s*)theme_style=dark(?:;|$)/.test(document.cookie)) {
            return true;
        }

        // 3. 通用兜底：读取页面实际渲染背景色亮度（兼容官方改版与其他第三方深色插件）
        const probeEls = [
            document.querySelector('.bili-dyn-item'),
            body,
            html,
            document.querySelector('#app')
        ];
        for (const el of probeEls) {
            if (!el) continue;
            try {
                const bg = window.getComputedStyle(el).backgroundColor;
                const rgb = parseRgbColor(bg);
                if (rgb) {
                    const luminance = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
                    return luminance < 128;
                }
            } catch (e) {
                // 忽略异常
            }
        }

        return false;
    }

    function resolveIsDark() {
        const settings = loadSettings();
        if (settings.themeMode === 'dark') return true;
        if (settings.themeMode === 'light') return false;
        return detectPageDarkMode();
    }

    function applyTheme(force = false) {
        const nextDark = resolveIsDark();
        if (!force && nextDark === currentIsDark) return;
        currentIsDark = nextDark;

        const panel = document.getElementById('dynamic-jumper-panel');
        const btn = document.getElementById('show-panel-btn');
        if (panel) panel.classList.toggle('bdj-dark', currentIsDark);
        if (btn) btn.classList.toggle('bdj-dark', currentIsDark);

        // 若当前页面已有高亮动态，同步刷新其深浅底色以保证文字清晰可读
        if (currentHighlightedCard) {
            applyHighlightColors(currentHighlightedCard, currentHighlightIsApprox, false);
        }

        debugLog('主题已切换:', currentIsDark ? '深色' : '浅色');
    }

    function scheduleThemeSync() {
        if (themeSyncTimer) clearTimeout(themeSyncTimer);
        themeSyncTimer = setTimeout(() => {
            themeSyncTimer = null;
            applyTheme(false);
        }, 80);
    }

    function startThemeWatcher() {
        if (themeObserver) return;
        themeObserver = new MutationObserver(scheduleThemeSync);

        if (document.documentElement) {
            themeObserver.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['class', 'style', 'data-theme']
            });
        }
        if (document.body) {
            themeObserver.observe(document.body, {
                attributes: true,
                attributeFilter: ['class', 'style', 'data-theme']
            });
        }
        if (document.head) {
            themeObserver.observe(document.head, {
                childList: true
            });
        }

        try {
            const mq = window.matchMedia('(prefers-color-scheme: dark)');
            if (mq && mq.addEventListener) {
                mq.addEventListener('change', scheduleThemeSync);
            }
        } catch (e) {
            // 忽略旧环境不支持
        }

        applyTheme(true);
    }

    // ==================== 样式定义（Laplace Chatterbox 明暗双色） ====================

    function ensureGlobalStyles() {
        if (document.getElementById('bili-jumper-style')) return;
        const style = document.createElement('style');
        style.id = 'bili-jumper-style';
        style.textContent = `
            /* 浅色主题变量（默认） */
            #show-panel-btn,
            #dynamic-jumper-panel {
                --bdj-bg: #ffffff;
                --bdj-surface: #ffffff;
                --bdj-surface-hover: #f9fafb;
                --bdj-section-bg: #f3f4f6;
                --bdj-border: #e5e7eb;
                --bdj-control-border: #d1d5db;
                --bdj-control-border-hover: #9ca3af;
                --bdj-text: #111827;
                --bdj-text-secondary: #374151;
                --bdj-muted: #6b7280;
                --bdj-accent: #2e9e73;
                --bdj-accent-hover: #258560;
                --bdj-danger: #dc2626;
                --bdj-danger-hover: #b91c1c;
                --bdj-status-bg: #f9fafb;
                --bdj-status-border: #e5e7eb;
                --bdj-status-text: #6b7280;
                --bdj-success-bg: #f2fbf7;
                --bdj-success-border: #bce3d1;
                --bdj-success-text: #1f7051;
                --bdj-warn-bg: #fffbeb;
                --bdj-warn-border: #fde68a;
                --bdj-warn-text: #92400e;
                --bdj-shadow: 0 4px 16px rgba(0, 0, 0, 0.09);
                --bdj-cal-hover: #f3f4f6;
                --bdj-divider: #f3f4f6;
            }

            /* 深色主题变量（对齐 Laplace Chatterbox 深色风格） */
            #show-panel-btn.bdj-dark,
            #dynamic-jumper-panel.bdj-dark {
                --bdj-bg: #18191c;
                --bdj-surface: #1f2024;
                --bdj-surface-hover: #27292f;
                --bdj-section-bg: #0d0e10;
                --bdj-border: #2a2c32;
                --bdj-control-border: #3c3f48;
                --bdj-control-border-hover: #565a66;
                --bdj-text: #e5e7eb;
                --bdj-text-secondary: #d1d5db;
                --bdj-muted: #9ca3af;
                --bdj-accent: #36ad7e;
                --bdj-accent-hover: #2e9e73;
                --bdj-danger: #dc2626;
                --bdj-danger-hover: #b91c1c;
                --bdj-status-bg: #202226;
                --bdj-status-border: #2f3239;
                --bdj-status-text: #9ca3af;
                --bdj-success-bg: #132a21;
                --bdj-success-border: #225943;
                --bdj-success-text: #6ee7b7;
                --bdj-warn-bg: #2b2111;
                --bdj-warn-border: #6b4c16;
                --bdj-warn-text: #fcd34d;
                --bdj-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
                --bdj-cal-hover: #2a2c33;
                --bdj-divider: #26282e;
                color-scheme: dark;
            }

            /* 最小化悬浮按钮 */
            #show-panel-btn {
                position: fixed;
                top: 84px;
                right: 20px;
                z-index: 10000;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                height: 34px;
                padding: 0 12px;
                background: var(--bdj-bg);
                color: var(--bdj-text);
                border: 1px solid var(--bdj-control-border);
                border-radius: 6px;
                font-size: 13px;
                font-weight: 500;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
                cursor: pointer;
                box-shadow: var(--bdj-shadow);
                transition: border-color 0.15s, background-color 0.15s;
            }
            #show-panel-btn:hover {
                background: var(--bdj-surface-hover);
                border-color: var(--bdj-accent);
            }
            #show-panel-btn .bdj-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: var(--bdj-accent);
                flex-shrink: 0;
            }

            /* 主面板 */
            #dynamic-jumper-panel {
                position: fixed;
                top: 84px;
                right: 20px;
                z-index: 10000;
                width: 312px;
                max-height: calc(100vh - 104px);
                background: var(--bdj-bg);
                color: var(--bdj-text);
                border: 1px solid var(--bdj-border);
                border-radius: 6px;
                box-shadow: var(--bdj-shadow);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
                font-size: 13px;
                line-height: 1.5;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                box-sizing: border-box;
            }
            #dynamic-jumper-panel *,
            #dynamic-jumper-panel *::before,
            #dynamic-jumper-panel *::after {
                box-sizing: border-box;
            }

            /* 顶部标签栏 */
            #dynamic-jumper-panel .bdj-topbar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                border-bottom: 1px solid var(--bdj-border);
                padding: 0 8px 0 6px;
                background: var(--bdj-bg);
                flex-shrink: 0;
            }
            #dynamic-jumper-panel .bdj-tabs {
                display: flex;
                align-items: center;
                gap: 2px;
            }
            #dynamic-jumper-panel .bdj-tab {
                position: relative;
                background: transparent;
                border: none;
                padding: 9px 10px;
                font-size: 13px;
                font-weight: 400;
                color: var(--bdj-muted);
                cursor: pointer;
                transition: color 0.15s;
            }
            #dynamic-jumper-panel .bdj-tab:hover {
                color: var(--bdj-text);
            }
            #dynamic-jumper-panel .bdj-tab.is-active {
                color: var(--bdj-text);
                font-weight: 600;
            }
            #dynamic-jumper-panel .bdj-tab.is-active::after {
                content: '';
                position: absolute;
                left: 6px;
                right: 6px;
                bottom: -1px;
                height: 2px;
                background: var(--bdj-accent);
            }
            #dynamic-jumper-panel .bdj-close {
                background: transparent;
                border: none;
                color: var(--bdj-muted);
                width: 24px;
                height: 24px;
                border-radius: 4px;
                font-size: 15px;
                line-height: 1;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                transition: background-color 0.15s, color 0.15s;
            }
            #dynamic-jumper-panel .bdj-close:hover {
                background: var(--bdj-surface-hover);
                color: var(--bdj-text);
            }

            /* 内容区 */
            #dynamic-jumper-panel .bdj-body {
                padding: 10px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            #dynamic-jumper-panel .bdj-pane {
                display: none;
                flex-direction: column;
                gap: 10px;
            }
            #dynamic-jumper-panel .bdj-pane.is-active {
                display: flex;
            }

            /* 分组标题条 */
            #dynamic-jumper-panel .bdj-section-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 5px 9px;
                background: var(--bdj-section-bg);
                border-radius: 4px;
                font-size: 13px;
                font-weight: 600;
                color: var(--bdj-text);
                user-select: none;
            }
            #dynamic-jumper-panel .bdj-section-head .bdj-head-meta {
                font-size: 12px;
                font-weight: 400;
                color: var(--bdj-muted);
            }

            /* 行排版 */
            #dynamic-jumper-panel .bdj-row {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-wrap: wrap;
                color: var(--bdj-text-secondary);
            }
            #dynamic-jumper-panel .bdj-row-between {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
            }

            /* 按钮 */
            #dynamic-jumper-panel .bdj-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                height: 28px;
                padding: 0 11px;
                border-radius: 4px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                border: 1px solid var(--bdj-control-border);
                background: var(--bdj-surface);
                color: var(--bdj-text-secondary);
                transition: background-color 0.15s, border-color 0.15s, color 0.15s;
                white-space: nowrap;
            }
            #dynamic-jumper-panel .bdj-btn:hover:not(:disabled) {
                background: var(--bdj-surface-hover);
                border-color: var(--bdj-control-border-hover);
                color: var(--bdj-text);
            }
            #dynamic-jumper-panel .bdj-btn:disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }
            #dynamic-jumper-panel .bdj-btn-primary {
                background: var(--bdj-accent);
                border-color: var(--bdj-accent);
                color: #ffffff;
            }
            #dynamic-jumper-panel .bdj-btn-primary:hover:not(:disabled) {
                background: var(--bdj-accent-hover);
                border-color: var(--bdj-accent-hover);
                color: #ffffff;
            }
            #dynamic-jumper-panel .bdj-btn-danger {
                background: var(--bdj-danger);
                border-color: var(--bdj-danger);
                color: #ffffff;
            }
            #dynamic-jumper-panel .bdj-btn-danger:hover:not(:disabled) {
                background: var(--bdj-danger-hover);
                border-color: var(--bdj-danger-hover);
                color: #ffffff;
            }
            #dynamic-jumper-panel .bdj-btn-muted {
                color: var(--bdj-muted);
            }
            #dynamic-jumper-panel .bdj-btn-sm {
                height: 24px;
                padding: 0 8px;
                font-size: 12px;
            }

            /* 输入控件 */
            #dynamic-jumper-panel .bdj-input,
            #dynamic-jumper-panel .bdj-select {
                height: 28px;
                padding: 0 8px;
                border: 1px solid var(--bdj-control-border);
                border-radius: 4px;
                background: var(--bdj-surface);
                color: var(--bdj-text);
                font-size: 13px;
                font-family: inherit;
                outline: none;
                transition: border-color 0.15s;
            }
            #dynamic-jumper-panel .bdj-input:focus,
            #dynamic-jumper-panel .bdj-select:focus {
                border-color: var(--bdj-accent);
            }
            #dynamic-jumper-panel .bdj-input-num {
                width: 66px;
                height: 26px;
                padding: 0 6px;
            }

            /* 自定义日历触发器与弹层 */
            #dynamic-jumper-panel .bdj-date-wrap {
                position: relative;
            }
            #dynamic-jumper-panel .bdj-date-trigger {
                width: 100%;
                height: 31px;
                padding: 0 10px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                border: 1px solid var(--bdj-control-border);
                border-radius: 4px;
                background: var(--bdj-surface);
                color: var(--bdj-text);
                font-size: 13px;
                font-family: inherit;
                cursor: pointer;
                transition: border-color 0.15s, background-color 0.15s;
            }
            #dynamic-jumper-panel .bdj-date-trigger:hover,
            #dynamic-jumper-panel .bdj-date-trigger.is-open {
                border-color: var(--bdj-accent);
            }
            #dynamic-jumper-panel .bdj-date-trigger svg {
                width: 15px;
                height: 15px;
                color: var(--bdj-muted);
                flex-shrink: 0;
            }

            #dynamic-jumper-panel .bdj-calendar {
                display: none;
                margin-top: 6px;
                padding: 8px;
                border: 1px solid var(--bdj-control-border);
                border-radius: 4px;
                background: var(--bdj-surface);
            }
            #dynamic-jumper-panel .bdj-calendar.is-open {
                display: block;
            }
            #dynamic-jumper-panel .bdj-cal-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 4px;
                margin-bottom: 8px;
            }
            #dynamic-jumper-panel .bdj-cal-nav {
                width: 24px;
                height: 24px;
                border: 1px solid var(--bdj-control-border);
                border-radius: 4px;
                background: transparent;
                color: var(--bdj-text-secondary);
                font-size: 14px;
                line-height: 1;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0;
            }
            #dynamic-jumper-panel .bdj-cal-nav:hover:not(:disabled) {
                background: var(--bdj-cal-hover);
                color: var(--bdj-text);
            }
            #dynamic-jumper-panel .bdj-cal-nav:disabled {
                opacity: 0.35;
                cursor: not-allowed;
            }
            #dynamic-jumper-panel .bdj-cal-selects {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            #dynamic-jumper-panel .bdj-cal-select {
                height: 24px;
                padding: 0 4px;
                font-size: 12px;
                border: 1px solid var(--bdj-control-border);
                border-radius: 4px;
                background: var(--bdj-bg);
                color: var(--bdj-text);
                outline: none;
                cursor: pointer;
            }
            #dynamic-jumper-panel .bdj-cal-select:focus {
                border-color: var(--bdj-accent);
            }
            #dynamic-jumper-panel .bdj-cal-weekdays {
                display: grid;
                grid-template-columns: repeat(7, 1fr);
                text-align: center;
                font-size: 11px;
                color: var(--bdj-muted);
                margin-bottom: 4px;
            }
            #dynamic-jumper-panel .bdj-cal-days {
                display: grid;
                grid-template-columns: repeat(7, 1fr);
                gap: 2px;
            }
            #dynamic-jumper-panel .bdj-cal-months {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 4px;
            }
            #dynamic-jumper-panel .bdj-cal-cell {
                height: 26px;
                border: 1px solid transparent;
                border-radius: 4px;
                background: transparent;
                color: var(--bdj-text);
                font-size: 12px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                transition: background-color 0.12s, border-color 0.12s;
            }
            #dynamic-jumper-panel .bdj-cal-cell.is-month-cell {
                height: 30px;
            }
            #dynamic-jumper-panel .bdj-cal-cell:hover:not(:disabled):not(.is-selected) {
                background: var(--bdj-cal-hover);
            }
            #dynamic-jumper-panel .bdj-cal-cell.is-outside {
                color: var(--bdj-muted);
                opacity: 0.45;
            }
            #dynamic-jumper-panel .bdj-cal-cell.is-today {
                border-color: var(--bdj-accent);
                color: var(--bdj-accent);
                font-weight: 600;
            }
            #dynamic-jumper-panel .bdj-cal-cell.is-selected {
                background: var(--bdj-accent);
                border-color: var(--bdj-accent);
                color: #ffffff;
                font-weight: 600;
            }
            #dynamic-jumper-panel .bdj-cal-cell:disabled {
                color: var(--bdj-muted);
                opacity: 0.25;
                cursor: not-allowed;
            }
            #dynamic-jumper-panel .bdj-cal-footer {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-top: 8px;
                padding-top: 6px;
                border-top: 1px solid var(--bdj-divider);
            }

            /* 复选框 */
            #dynamic-jumper-panel .bdj-check {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                font-size: 13px;
                color: var(--bdj-text-secondary);
                cursor: pointer;
                user-select: none;
            }
            #dynamic-jumper-panel .bdj-check input[type="checkbox"] {
                width: 14px;
                height: 14px;
                margin: 0;
                accent-color: var(--bdj-accent);
                cursor: pointer;
            }

            /* 状态与次要信息 */
            #dynamic-jumper-panel .bdj-meta {
                font-size: 12px;
                color: var(--bdj-muted);
                line-height: 1.55;
            }
            #dynamic-jumper-panel .bdj-meta strong {
                color: var(--bdj-text-secondary);
                font-weight: 600;
            }
            #dynamic-jumper-panel .bdj-status {
                font-size: 12px;
                color: var(--bdj-status-text);
                line-height: 1.5;
                padding: 6px 8px;
                background: var(--bdj-status-bg);
                border: 1px solid var(--bdj-status-border);
                border-radius: 4px;
            }
            #dynamic-jumper-panel .bdj-status.is-success {
                color: var(--bdj-success-text);
                background: var(--bdj-success-bg);
                border-color: var(--bdj-success-border);
            }
            #dynamic-jumper-panel .bdj-status.is-warn {
                color: var(--bdj-warn-text);
                background: var(--bdj-warn-bg);
                border-color: var(--bdj-warn-border);
            }
            #dynamic-jumper-panel .bdj-divider {
                height: 1px;
                background: var(--bdj-divider);
                margin: 2px 0;
            }
            #dynamic-jumper-panel .bdj-about-list {
                margin: 0;
                padding-left: 16px;
                font-size: 12px;
                color: var(--bdj-muted);
                line-height: 1.65;
            }
            #dynamic-jumper-panel .bdj-about-list li {
                margin-bottom: 4px;
            }
            #dynamic-jumper-panel .bdj-about-list strong {
                color: var(--bdj-text-secondary);
            }
            #dynamic-jumper-panel a.bdj-link {
                color: var(--bdj-accent);
                text-decoration: none;
            }
            #dynamic-jumper-panel a.bdj-link:hover {
                text-decoration: underline;
            }

            /* 匹配结果列表 */
            #dynamic-jumper-panel .bdj-result-list {
                display: flex;
                flex-direction: column;
                max-height: 440px;
                overflow-y: auto;
                border: 1px solid var(--bdj-border);
                border-radius: 4px;
                background: var(--bdj-surface);
            }
            #dynamic-jumper-panel .bdj-result-item {
                width: 100%;
                display: flex;
                flex-direction: column;
                gap: 3px;
                padding: 7px 9px;
                border: none;
                border-left: 2px solid transparent;
                border-bottom: 1px solid var(--bdj-divider);
                background: transparent;
                text-align: left;
                color: inherit;
                font-family: inherit;
                cursor: pointer;
                transition: background-color 0.12s, border-color 0.12s;
            }
            #dynamic-jumper-panel .bdj-result-item:last-child {
                border-bottom: none;
            }
            #dynamic-jumper-panel .bdj-result-item:hover {
                background: var(--bdj-surface-hover);
            }
            #dynamic-jumper-panel .bdj-result-item.is-active {
                background: var(--bdj-success-bg);
                border-left-color: var(--bdj-accent);
            }
            #dynamic-jumper-panel .bdj-result-item-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
                font-size: 11px;
                color: var(--bdj-muted);
            }
            #dynamic-jumper-panel .bdj-result-tag {
                padding: 0 5px;
                border-radius: 3px;
                font-size: 11px;
                font-weight: 500;
                color: #ffffff;
                background: var(--bdj-accent);
            }
            #dynamic-jumper-panel .bdj-result-summary {
                font-size: 12px;
                color: var(--bdj-text);
                line-height: 1.45;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                word-break: break-word;
            }

            #dynamic-jumper-panel .bdj-result-empty {
                padding: 14px 10px;
                text-align: center;
                font-size: 12px;
                color: var(--bdj-muted);
            }
            #dynamic-jumper-panel .bdj-filter-row {
                display: flex;
                align-items: center;
                gap: 6px;
            }
            #dynamic-jumper-panel .bdj-filter-input {
                flex: 1;
                height: 26px;
                padding: 0 8px;
                font-size: 12px;
            }

            /* 目标动态徽章 */
            .bili-jumper-badge {
                position: absolute;
                top: -13px;
                left: 16px;
                z-index: 100;
                padding: 2px 10px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 600;
                color: #ffffff;
                background: #2e9e73;
                box-shadow: 0 2px 6px rgba(46, 158, 115, 0.28);
                white-space: nowrap;
                pointer-events: none;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
            }
            .bili-jumper-badge.is-approx {
                background: #d97706;
                box-shadow: 0 2px 6px rgba(217, 119, 6, 0.28);
            }
        `;
        document.head.appendChild(style);
    }

    function createControlPanel() {
        ensureGlobalStyles();
        startThemeWatcher();
        if (document.getElementById('show-panel-btn') || document.getElementById('dynamic-jumper-panel')) {
            return;
        }
        createMinimizedButton();
    }

    function createMinimizedButton() {
        if (document.getElementById('show-panel-btn')) return;

        const showBtn = document.createElement('button');
        showBtn.id = 'show-panel-btn';
        showBtn.type = 'button';
        showBtn.title = '展开动态跳转面板';
        if (currentIsDark) showBtn.classList.add('bdj-dark');
        showBtn.innerHTML = `<span class="bdj-dot"></span><span>动态跳转</span>`;

        showBtn.addEventListener('click', () => {
            showBtn.remove();
            showExpandedPanel();
        });

        document.body.appendChild(showBtn);
        applyTheme(true);
        debugLog('最小化按钮已创建');
    }

    function showExpandedPanel() {
        const existingPanel = document.getElementById('dynamic-jumper-panel');
        if (existingPanel) {
            existingPanel.style.display = 'flex';
            applyTheme(true);
            return;
        }
        createExpandedPanel();
    }

    // ==================== 自定义日历渲染与交互 ====================

    function updateDateTriggerDisplay() {
        const label = document.getElementById('bdj-date-display');
        if (!label) return;
        label.textContent = isMonthOnly
            ? `${selectedYear}-${pad2(selectedMonth)}`
            : `${selectedYear}-${pad2(selectedMonth)}-${pad2(selectedDay)}`;
    }

    function setCalendarOpen(open) {
        isCalendarOpen = open;
        const cal = document.getElementById('bdj-calendar');
        const trigger = document.getElementById('bdj-date-trigger');
        if (cal) cal.classList.toggle('is-open', open);
        if (trigger) trigger.classList.toggle('is-open', open);
        if (open) {
            viewYear = selectedYear;
            viewMonth = selectedMonth;
            renderCalendar();
        }
    }

    function renderCalendar() {
        const cal = document.getElementById('bdj-calendar');
        if (!cal) return;

        const now = new Date();
        const todayY = now.getFullYear();
        const todayM = now.getMonth() + 1;
        const todayD = now.getDate();

        // 构建年份选项（2009 ~ 今年）
        let yearOptions = '';
        for (let y = todayY; y >= 2009; y--) {
            yearOptions += `<option value="${y}"${y === viewYear ? ' selected' : ''}>${y}年</option>`;
        }

        let monthOptions = '';
        for (let m = 1; m <= 12; m++) {
            const disabled = viewYear === todayY && m > todayM;
            monthOptions += `<option value="${m}"${m === viewMonth ? ' selected' : ''}${disabled ? ' disabled' : ''}>${m}月</option>`;
        }

        const prevDisabled = isMonthOnly
            ? viewYear <= 2009
            : (viewYear <= 2009 && viewMonth <= 1);
        const nextDisabled = isMonthOnly
            ? viewYear >= todayY
            : (viewYear > todayY || (viewYear === todayY && viewMonth >= todayM));

        let gridHtml = '';
        if (isMonthOnly) {
            let cells = '';
            for (let m = 1; m <= 12; m++) {
                const isFuture = viewYear > todayY || (viewYear === todayY && m > todayM);
                const isSelected = viewYear === selectedYear && m === selectedMonth;
                const isToday = viewYear === todayY && m === todayM;
                const cls = [
                    'bdj-cal-cell',
                    'is-month-cell',
                    isSelected ? 'is-selected' : '',
                    !isSelected && isToday ? 'is-today' : ''
                ].filter(Boolean).join(' ');
                cells += `<button type="button" class="${cls}" data-pick-month="${m}"${isFuture ? ' disabled' : ''}>${m}月</button>`;
            }
            gridHtml = `<div class="bdj-cal-months">${cells}</div>`;
        } else {
            const firstDayOfWeek = (new Date(viewYear, viewMonth - 1, 1).getDay() + 6) % 7; // 周一=0
            const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
            const prevMonthDays = new Date(viewYear, viewMonth - 1, 0).getDate();

            const prevY = viewMonth === 1 ? viewYear - 1 : viewYear;
            const prevM = viewMonth === 1 ? 12 : viewMonth - 1;
            const nextY = viewMonth === 12 ? viewYear + 1 : viewYear;
            const nextM = viewMonth === 12 ? 1 : viewMonth + 1;

            let cells = '';
            // 上月补齐
            for (let i = firstDayOfWeek - 1; i >= 0; i--) {
                const d = prevMonthDays - i;
                const isFuture = makeDateKey(prevY, prevM, d, true) > makeDateKey(todayY, todayM, todayD, true);
                const isTooOld = prevY < 2009;
                cells += `<button type="button" class="bdj-cal-cell is-outside" data-pick-y="${prevY}" data-pick-m="${prevM}" data-pick-d="${d}"${(isFuture || isTooOld) ? ' disabled' : ''}>${d}</button>`;
            }
            // 本月日期
            for (let d = 1; d <= daysInMonth; d++) {
                const isFuture = makeDateKey(viewYear, viewMonth, d, true) > makeDateKey(todayY, todayM, todayD, true);
                const isSelected = viewYear === selectedYear && viewMonth === selectedMonth && d === selectedDay;
                const isToday = viewYear === todayY && viewMonth === todayM && d === todayD;
                const cls = [
                    'bdj-cal-cell',
                    isSelected ? 'is-selected' : '',
                    !isSelected && isToday ? 'is-today' : ''
                ].filter(Boolean).join(' ');
                cells += `<button type="button" class="${cls}" data-pick-y="${viewYear}" data-pick-m="${viewMonth}" data-pick-d="${d}"${isFuture ? ' disabled' : ''}>${d}</button>`;
            }
            // 下月补齐至整行
            const totalCells = firstDayOfWeek + daysInMonth;
            const trailing = (7 - (totalCells % 7)) % 7;
            for (let d = 1; d <= trailing; d++) {
                const isFuture = makeDateKey(nextY, nextM, d, true) > makeDateKey(todayY, todayM, todayD, true);
                cells += `<button type="button" class="bdj-cal-cell is-outside" data-pick-y="${nextY}" data-pick-m="${nextM}" data-pick-d="${d}"${isFuture ? ' disabled' : ''}>${d}</button>`;
            }

            gridHtml = `
                <div class="bdj-cal-weekdays">
                    <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
                </div>
                <div class="bdj-cal-days">${cells}</div>
            `;
        }

        cal.innerHTML = `
            <div class="bdj-cal-header">
                <button type="button" class="bdj-cal-nav" id="bdj-cal-prev" title="${isMonthOnly ? '上一年' : '上个月'}"${prevDisabled ? ' disabled' : ''}>‹</button>
                <div class="bdj-cal-selects">
                    <select class="bdj-cal-select" id="bdj-cal-year">${yearOptions}</select>
                    ${isMonthOnly ? '' : `<select class="bdj-cal-select" id="bdj-cal-month">${monthOptions}</select>`}
                </div>
                <button type="button" class="bdj-cal-nav" id="bdj-cal-next" title="${isMonthOnly ? '下一年' : '下个月'}"${nextDisabled ? ' disabled' : ''}>›</button>
            </div>
            ${gridHtml}
            <div class="bdj-cal-footer">
                <button type="button" class="bdj-btn bdj-btn-sm" id="bdj-cal-today">${isMonthOnly ? '回到本月' : '今天'}</button>
                <button type="button" class="bdj-btn bdj-btn-sm bdj-btn-muted" id="bdj-cal-close">收起</button>
            </div>
        `;

        // 绑定日历事件
        cal.querySelector('#bdj-cal-prev').addEventListener('click', () => {
            if (isMonthOnly) {
                viewYear = Math.max(2009, viewYear - 1);
            } else {
                if (viewMonth === 1) {
                    viewYear = Math.max(2009, viewYear - 1);
                    viewMonth = 12;
                } else {
                    viewMonth--;
                }
            }
            renderCalendar();
        });

        cal.querySelector('#bdj-cal-next').addEventListener('click', () => {
            if (isMonthOnly) {
                viewYear = Math.min(todayY, viewYear + 1);
            } else {
                if (viewMonth === 12) {
                    viewYear++;
                    viewMonth = 1;
                } else {
                    viewMonth++;
                }
                if (viewYear > todayY || (viewYear === todayY && viewMonth > todayM)) {
                    viewYear = todayY;
                    viewMonth = todayM;
                }
            }
            renderCalendar();
        });

        cal.querySelector('#bdj-cal-year').addEventListener('change', (e) => {
            viewYear = parseInt(e.target.value, 10);
            if (viewYear === todayY && viewMonth > todayM) {
                viewMonth = todayM;
            }
            renderCalendar();
        });

        const monthSel = cal.querySelector('#bdj-cal-month');
        if (monthSel) {
            monthSel.addEventListener('change', (e) => {
                viewMonth = parseInt(e.target.value, 10);
                renderCalendar();
            });
        }

        cal.querySelector('#bdj-cal-today').addEventListener('click', () => {
            selectedYear = todayY;
            selectedMonth = todayM;
            selectedDay = todayD;
            viewYear = todayY;
            viewMonth = todayM;
            updateDateTriggerDisplay();
            renderCalendar();
        });

        cal.querySelector('#bdj-cal-close').addEventListener('click', () => {
            setCalendarOpen(false);
        });

        if (isMonthOnly) {
            cal.querySelectorAll('[data-pick-month]').forEach(btn => {
                btn.addEventListener('click', () => {
                    selectedYear = viewYear;
                    selectedMonth = parseInt(btn.getAttribute('data-pick-month'), 10);
                    const maxD = new Date(selectedYear, selectedMonth, 0).getDate();
                    if (selectedDay > maxD) selectedDay = maxD;
                    updateDateTriggerDisplay();
                    renderCalendar();
                });
            });
        } else {
            cal.querySelectorAll('[data-pick-d]').forEach(btn => {
                btn.addEventListener('click', () => {
                    selectedYear = parseInt(btn.getAttribute('data-pick-y'), 10);
                    selectedMonth = parseInt(btn.getAttribute('data-pick-m'), 10);
                    selectedDay = parseInt(btn.getAttribute('data-pick-d'), 10);
                    viewYear = selectedYear;
                    viewMonth = selectedMonth;
                    updateDateTriggerDisplay();
                    renderCalendar();
                });
            });
        }
    }

    // ==================== 面板创建 ====================

    function createExpandedPanel() {
        const savedSettings = loadSettings();

        const panel = document.createElement('div');
        panel.id = 'dynamic-jumper-panel';
        if (currentIsDark) panel.classList.add('bdj-dark');

        panel.innerHTML = `
            <div class="bdj-topbar">
                <div class="bdj-tabs" role="tablist">
                    <button type="button" class="bdj-tab is-active" data-tab="jump" role="tab">跳转</button>
                    <button type="button" class="bdj-tab" data-tab="settings" role="tab">设置</button>
                    <button type="button" class="bdj-tab" data-tab="about" role="tab">关于</button>
                </div>
                <button type="button" id="hide-panel" class="bdj-close" title="收起面板">×</button>
            </div>

            <div class="bdj-body">
                <!-- 标签 1：跳转 -->
                <div class="bdj-pane is-active" data-pane="jump">
                    <div class="bdj-date-wrap">
                        <button type="button" id="bdj-date-trigger" class="bdj-date-trigger">
                            <span id="bdj-date-display">${selectedYear}-${pad2(selectedMonth)}-${pad2(selectedDay)}</span>
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <rect x="2" y="3" width="12" height="11" rx="1.5"></rect>
                                <path d="M5 1.75V4M11 1.75V4M2 6.5h12"></path>
                            </svg>
                        </button>
                        <div id="bdj-calendar" class="bdj-calendar"></div>
                    </div>

                    <div class="bdj-row-between">
                        <div class="bdj-row">
                            <button type="button" id="start-jump" class="bdj-btn bdj-btn-primary">开始搜索</button>
                            <button type="button" id="stop-jump" class="bdj-btn bdj-btn-danger" style="display: none;">停止</button>
                            <button type="button" id="clear-highlight-btn" class="bdj-btn bdj-btn-muted" style="display: none;">清除高亮</button>
                        </div>
                        <label class="bdj-check">
                            <input type="checkbox" id="month-only-toggle">
                            <span>仅按年月</span>
                        </label>
                    </div>

                    <div class="bdj-row-between">
                        <label class="bdj-check" title="释放已滑过动态的图片与渲染层，反向查回时自动还原">
                            <input type="checkbox" id="memory-saver-toggle"${savedSettings.memorySaver ? ' checked' : ''}>
                            <span>省内存模式</span>
                        </label>
                        <span class="bdj-meta">大量载入时建议开启</span>
                    </div>

                    <!-- 运行状态 -->
                    <div id="progress-info" style="display: none; flex-direction: column; gap: 6px;">
                        <div class="bdj-meta">
                            当前位置: <strong id="current-date">—</strong> ·
                            最早已加载: <strong id="oldest-loaded-date">—</strong> ·
                            已加载 <strong id="loaded-count">0</strong> 条 ·
                            滚动 <strong id="scroll-count">0</strong> 次 ·
                            重试 <strong id="retry-count">0</strong>/<span id="max-retry-display">${savedSettings.maxRetries}</span><span id="pruned-meta" style="display: none;"> · 已释放 <strong id="pruned-count">0</strong> 条图片</span>
                        </div>
                        <div id="status-msg" class="bdj-status">等待开始</div>
                    </div>

                    <!-- 匹配结果列表 -->
                    <div id="match-nav-bar" style="display: none; flex-direction: column; gap: 6px;">
                        <div class="bdj-section-head">
                            <span>匹配结果</span>
                            <span id="match-nav-summary" class="bdj-head-meta">0 条</span>
                        </div>
                        <div class="bdj-filter-row">
                            <input type="text" id="match-author-filter" class="bdj-input bdj-filter-input" placeholder="按 UP 主名字筛选...">
                            <button type="button" id="match-filter-clear" class="bdj-btn bdj-btn-sm bdj-btn-muted" style="display: none;">清空</button>
                        </div>
                        <div id="match-result-list" class="bdj-result-list"></div>
                    </div>
                </div>

                <!-- 标签 2：设置 -->
                <div class="bdj-pane" data-pane="settings">
                    <div class="bdj-section-head">
                        <span>外观主题</span>
                        <span class="bdj-head-meta">自动同步</span>
                    </div>

                    <div class="bdj-row">
                        <span>面板主题</span>
                        <select id="theme-mode-select" class="bdj-select">
                            <option value="auto">跟随页面（官方 / Evolved）</option>
                            <option value="light">浅色</option>
                            <option value="dark">深色</option>
                        </select>
                    </div>

                    <div class="bdj-section-head">
                        <span>滚动与加载</span>
                        <span class="bdj-head-meta">自动保存</span>
                    </div>

                    <div class="bdj-row">
                        <span>连续</span>
                        <input type="number" id="max-retries" class="bdj-input bdj-input-num" value="${savedSettings.maxRetries}" min="1" max="50">
                        <span>次无新动态时停止</span>
                    </div>

                    <div class="bdj-row">
                        <span>每次滚动后等待</span>
                        <input type="number" id="scroll-delay" class="bdj-input bdj-input-num" value="${savedSettings.scrollDelay}" min="500" max="10000" step="500">
                        <span>毫秒</span>
                    </div>

                    <div class="bdj-row">
                        <span>滚动力度</span>
                        <select id="scroll-aggressiveness" class="bdj-select">
                            <option value="normal">普通</option>
                            <option value="aggressive">激进</option>
                            <option value="extreme">极限</option>
                        </select>
                        <span>额外</span>
                        <input type="number" id="extra-scroll" class="bdj-input bdj-input-num" value="${savedSettings.extraScroll}" min="0" max="10000" step="500">
                        <span>px</span>
                    </div>

                    <div class="bdj-row">
                        <button type="button" id="restore-images-btn" class="bdj-btn">还原所有图片</button>
                        <button type="button" id="reset-settings-btn" class="bdj-btn bdj-btn-muted">恢复默认</button>
                    </div>
                </div>

                <!-- 标签 3：关于 -->
                <div class="bdj-pane" data-pane="about">
                    <div class="bdj-section-head">
                        <span>哔哩哔哩动态日期跳转助手</span>
                        <span class="bdj-head-meta">v1.5.0</span>
                    </div>

                    <ul class="bdj-about-list">
                        <li>支持已加载动态零滚动前后反复跳转，无需刷新页面。</li>
                        <li>查找某日/某月动态时会自动加载完整该时段，默认定位到<strong>最早一条</strong>，并在面板列出全部命中动态供单击直达。</li>
                        <li>内置省内存模式：向下搜索时自动释放已滑过动态的图片与渲染层，反向查回时自动恢复。</li>
                        <li>自动适配 B 站官方深色模式与 Bilibili-Evolved 夜间模式，实时切换。</li>
                    </ul>

                    <div class="bdj-divider"></div>
                    <div class="bdj-meta">
                        仓库：<a class="bdj-link" href="https://github.com/tongle2025/bilibili-dynamic-jumper" target="_blank" rel="noopener noreferrer">tongle2025/bilibili-dynamic-jumper</a>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // 应用保存的下拉选项
        document.getElementById('scroll-aggressiveness').value = savedSettings.scrollAggressiveness;
        document.getElementById('theme-mode-select').value = savedSettings.themeMode;

        // 顶部标签页切换
        const tabs = panel.querySelectorAll('.bdj-tab');
        const panes = panel.querySelectorAll('.bdj-pane');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.getAttribute('data-tab');
                tabs.forEach(t => t.classList.toggle('is-active', t === tab));
                panes.forEach(p => p.classList.toggle('is-active', p.getAttribute('data-pane') === target));
                if (target !== 'jump' && isCalendarOpen) {
                    setCalendarOpen(false);
                }
            });
        });

        // 自定义日历打开/关闭（仅手动切换，不在内部点击重渲染时误收起）
        document.getElementById('bdj-date-trigger').addEventListener('click', (e) => {
            e.stopPropagation();
            setCalendarOpen(!isCalendarOpen);
        });

        document.getElementById('bdj-calendar').addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 切换“精确到日 / 仅按年月”
        document.getElementById('month-only-toggle').addEventListener('change', (e) => {
            isMonthOnly = e.target.checked;
            updateDateTriggerDisplay();
            if (isCalendarOpen) {
                renderCalendar();
            }
        });

        // 主题模式切换
        document.getElementById('theme-mode-select').addEventListener('change', () => {
            saveSettings();
            applyTheme(true);
        });

        // 设置自动保存
        document.getElementById('max-retries').addEventListener('change', saveSettings);
        document.getElementById('scroll-delay').addEventListener('change', saveSettings);
        document.getElementById('scroll-aggressiveness').addEventListener('change', saveSettings);
        document.getElementById('extra-scroll').addEventListener('change', saveSettings);
        document.getElementById('memory-saver-toggle').addEventListener('change', (e) => {
            saveSettings();
            if (!e.target.checked) {
                restoreAllPrunedCards();
            }
        });

        // 手动还原全部已释放图片
        document.getElementById('restore-images-btn').addEventListener('click', () => {
            const restored = restoreAllPrunedCards();
            debugLog(`已手动还原 ${restored} 条动态图片`);
        });

        // 恢复默认设置
        document.getElementById('reset-settings-btn').addEventListener('click', () => {
            document.getElementById('max-retries').value = DEFAULT_SETTINGS.maxRetries;
            document.getElementById('scroll-delay').value = DEFAULT_SETTINGS.scrollDelay;
            document.getElementById('scroll-aggressiveness').value = DEFAULT_SETTINGS.scrollAggressiveness;
            document.getElementById('extra-scroll').value = DEFAULT_SETTINGS.extraScroll;
            document.getElementById('memory-saver-toggle').checked = DEFAULT_SETTINGS.memorySaver;
            document.getElementById('theme-mode-select').value = DEFAULT_SETTINGS.themeMode;
            saveSettings();
            applyTheme(true);
        });

        // 搜索、停止与清除高亮
        document.getElementById('start-jump').addEventListener('click', startJump);
        document.getElementById('stop-jump').addEventListener('click', () => stopJump('已手动停止'));
        document.getElementById('clear-highlight-btn').addEventListener('click', () => {
            clearHighlight();
            allMatchedResults = [];
            matchedResults = [];
            currentMatchIndex = -1;
            currentAuthorFilter = '';
            const filterInput = document.getElementById('match-author-filter');
            const filterClearBtn = document.getElementById('match-filter-clear');
            if (filterInput) filterInput.value = '';
            if (filterClearBtn) filterClearBtn.style.display = 'none';
            updateMatchNavUI();
        });

        // 按 UP 主名字筛选
        const filterInput = document.getElementById('match-author-filter');
        const filterClearBtn = document.getElementById('match-filter-clear');
        filterInput.addEventListener('input', () => {
            const val = filterInput.value.trim();
            filterClearBtn.style.display = val ? 'inline-flex' : 'none';
            if (authorFilterTimer) clearTimeout(authorFilterTimer);
            authorFilterTimer = setTimeout(() => {
                authorFilterTimer = null;
                applyAuthorFilter(val);
            }, 120);
        });
        filterClearBtn.addEventListener('click', () => {
            filterInput.value = '';
            filterClearBtn.style.display = 'none';
            if (authorFilterTimer) clearTimeout(authorFilterTimer);
            applyAuthorFilter('');
        });

        // 收起面板
        document.getElementById('hide-panel').addEventListener('click', () => {
            setCalendarOpen(false);
            panel.style.display = 'none';
            createMinimizedButton();
        });

        applyTheme(true);
        debugLog('控制面板已创建');
    }

    // ==================== 日期解析与动态扫描 ====================

    function makeDateKey(year, month, day, includeDay) {
        return includeDay ? (year * 10000 + month * 100 + day) : (year * 100 + month);
    }

    function formatDateInfo(d, includeDay = true) {
        if (!d) return '未知';
        return includeDay
            ? `${d.year}-${pad2(d.month)}-${pad2(d.day)}`
            : `${d.year}-${pad2(d.month)}`;
    }

    function isPinnedDynamic(card) {
        try {
            const vueData = getVueDynamicData(card);
            if (vueData && vueData.modules && vueData.modules.module_tag) {
                const tagText = vueData.modules.module_tag.text || '';
                if (tagText.includes('置顶')) return true;
            }
            const tagEl = card.querySelector('.bili-dyn-item__tag, .bili-dyn-tag, [class*="dyn-tag"]');
            if (tagEl && tagEl.textContent && tagEl.textContent.includes('置顶')) {
                return true;
            }
        } catch (e) {
            // 忽略异常
        }
        return false;
    }

    function getVueDynamicData(card) {
        try {
            const candidates = [card, card.firstElementChild, card.parentElement];
            for (const el of candidates) {
                if (!el) continue;

                const v3 = el.__vueParentComponent;
                if (v3) {
                    const data = (v3.props && (v3.props.data || v3.props.item)) ||
                                 (v3.ctx && (v3.ctx.data || v3.ctx.item)) ||
                                 (v3.setupState && (v3.setupState.data || v3.setupState.item));
                    if (data && data.modules) return data;
                    if (v3.parent && v3.parent.props) {
                        const pData = v3.parent.props.data || v3.parent.props.item;
                        if (pData && pData.modules) return pData;
                    }
                }

                const v2 = el.__vue__;
                if (v2) {
                    const data = v2.data || v2.item || (v2.$props && (v2.$props.data || v2.$props.item));
                    if (data && data.modules) return data;
                }
            }
        } catch (e) {
            // 忽略读取失败，交由文本解析兜底
        }
        return null;
    }

    function extractDateInfo(dynamicCard) {
        try {
            const vueData = getVueDynamicData(dynamicCard);
            const pubTs = vueData && vueData.modules && vueData.modules.module_author && vueData.modules.module_author.pub_ts;
            if (typeof pubTs === 'number' && pubTs > 1200000000) {
                const date = new Date(pubTs * 1000);
                return {
                    year: date.getFullYear(),
                    month: date.getMonth() + 1,
                    day: date.getDate(),
                    timestamp: pubTs,
                    source: 'vue_pub_ts',
                    original: (vueData.modules.module_author.pub_time || '').trim()
                };
            }

            const timeElement = dynamicCard.querySelector('.bili-dyn-time');
            if (timeElement) {
                const parsed = parseTimeText(timeElement.textContent.trim());
                if (parsed) return parsed;
            }

            const timeSelectors = ['[class*="time"]', 'span[class*="time"]'];
            for (const selector of timeSelectors) {
                const el = dynamicCard.querySelector(selector);
                if (el) {
                    const parsed = parseTimeText(el.textContent.trim());
                    if (parsed) return parsed;
                }
            }

            return null;
        } catch (error) {
            return null;
        }
    }

    function parseTimeText(timeText) {
        if (!timeText) return null;
        const now = new Date();
        const nowYear = now.getFullYear();
        const nowMonth = now.getMonth() + 1;
        const nowDay = now.getDate();

        try {
            let match = timeText.match(/(\d{4})[-年./](\d{1,2})[-月./](\d{1,2})/);
            if (match) {
                const year = parseInt(match[1], 10);
                const month = parseInt(match[2], 10);
                const day = parseInt(match[3], 10);
                return {
                    year,
                    month,
                    day,
                    timestamp: Math.floor(new Date(year, month - 1, day).getTime() / 1000),
                    source: 'text_ymd',
                    original: timeText
                };
            }

            match = timeText.match(/(\d{1,2})[-月](\d{1,2})/);
            if (match) {
                const month = parseInt(match[1], 10);
                const day = parseInt(match[2], 10);
                let year = nowYear;
                if (month > nowMonth || (month === nowMonth && day > nowDay)) {
                    year--;
                }
                return {
                    year,
                    month,
                    day,
                    timestamp: Math.floor(new Date(year, month - 1, day).getTime() / 1000),
                    source: 'text_md',
                    original: timeText
                };
            }

            if (timeText.includes('刚刚')) {
                return {
                    year: nowYear,
                    month: nowMonth,
                    day: nowDay,
                    timestamp: Math.floor(now.getTime() / 1000),
                    source: 'text_just_now',
                    original: timeText
                };
            }

            match = timeText.match(/(\d+)\s*秒前/);
            if (match) {
                const date = new Date(now.getTime() - parseInt(match[1], 10) * 1000);
                return {
                    year: date.getFullYear(),
                    month: date.getMonth() + 1,
                    day: date.getDate(),
                    timestamp: Math.floor(date.getTime() / 1000),
                    source: 'text_sec_ago',
                    original: timeText
                };
            }

            match = timeText.match(/(\d+)\s*分钟前/);
            if (match) {
                const date = new Date(now.getTime() - parseInt(match[1], 10) * 60000);
                return {
                    year: date.getFullYear(),
                    month: date.getMonth() + 1,
                    day: date.getDate(),
                    timestamp: Math.floor(date.getTime() / 1000),
                    source: 'text_min_ago',
                    original: timeText
                };
            }

            match = timeText.match(/(\d+)\s*小时前/);
            if (match) {
                const date = new Date(now.getTime() - parseInt(match[1], 10) * 3600000);
                return {
                    year: date.getFullYear(),
                    month: date.getMonth() + 1,
                    day: date.getDate(),
                    timestamp: Math.floor(date.getTime() / 1000),
                    source: 'text_hour_ago',
                    original: timeText
                };
            }

            if (timeText.includes('昨天')) {
                const date = new Date(nowYear, nowMonth - 1, nowDay - 1);
                const hmMatch = timeText.match(/(\d{1,2}):(\d{2})/);
                if (hmMatch) {
                    date.setHours(parseInt(hmMatch[1], 10), parseInt(hmMatch[2], 10), 0, 0);
                }
                return {
                    year: date.getFullYear(),
                    month: date.getMonth() + 1,
                    day: date.getDate(),
                    timestamp: Math.floor(date.getTime() / 1000),
                    source: 'text_yesterday',
                    original: timeText
                };
            }

            if (timeText.includes('前天')) {
                const date = new Date(nowYear, nowMonth - 1, nowDay - 2);
                return {
                    year: date.getFullYear(),
                    month: date.getMonth() + 1,
                    day: date.getDate(),
                    timestamp: Math.floor(date.getTime() / 1000),
                    source: 'text_day_before_yesterday',
                    original: timeText
                };
            }

            match = timeText.match(/(\d+)\s*天前/);
            if (match) {
                const daysAgo = parseInt(match[1], 10);
                const date = new Date(nowYear, nowMonth - 1, nowDay - daysAgo);
                return {
                    year: date.getFullYear(),
                    month: date.getMonth() + 1,
                    day: date.getDate(),
                    timestamp: Math.floor(date.getTime() / 1000),
                    source: 'text_days_ago',
                    original: timeText
                };
            }

            return null;
        } catch (error) {
            return null;
        }
    }

    function scanDynamics(dynamicCards) {
        const hasDay = targetDay !== null;
        const targetKey = makeDateKey(targetYear, targetMonth, targetDay || 1, hasDay);
        const targetCenterTs = Math.floor(
            new Date(targetYear, targetMonth - 1, targetDay || 15, 12, 0, 0).getTime() / 1000
        );

        const matches = [];
        let newestDate = null;
        let oldestDate = null;
        let closestCard = null;
        let closestDate = null;
        let minDiff = Infinity;

        for (let i = 0; i < dynamicCards.length; i++) {
            const card = dynamicCards[i];
            const pinned = isPinnedDynamic(card);
            const dateInfo = extractDateInfo(card);
            if (!dateInfo) continue;

            const cardDayKey = makeDateKey(dateInfo.year, dateInfo.month, dateInfo.day, true);
            const cardCompareKey = makeDateKey(dateInfo.year, dateInfo.month, dateInfo.day, hasDay);

            if (!pinned) {
                if (!newestDate || cardDayKey > makeDateKey(newestDate.year, newestDate.month, newestDate.day, true)) {
                    newestDate = dateInfo;
                }
                if (!oldestDate || cardDayKey < makeDateKey(oldestDate.year, oldestDate.month, oldestDate.day, true)) {
                    oldestDate = dateInfo;
                }

                const diff = Math.abs(dateInfo.timestamp - targetCenterTs);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestCard = card;
                    closestDate = dateInfo;
                }
            }

            if (cardCompareKey === targetKey) {
                matches.push({ card, dateInfo, index: i, pinned });
            }
        }

        const passed = Boolean(
            oldestDate &&
            makeDateKey(oldestDate.year, oldestDate.month, oldestDate.day, hasDay) < targetKey
        );

        return {
            matches,
            newestDate,
            oldestDate,
            closestCard,
            closestDate,
            passed
        };
    }

    // ==================== 省内存模式（释放/还原已滑过动态图片与渲染层） ====================

    function updatePrunedMetaUI() {
        const wrap = document.getElementById('pruned-meta');
        const countEl = document.getElementById('pruned-count');
        if (!wrap || !countEl) return;
        if (prunedCardCount > 0) {
            wrap.style.display = 'inline';
            countEl.textContent = String(prunedCardCount);
        } else {
            wrap.style.display = 'none';
        }
    }

    function pruneCardMemory(card) {
        if (!card || card.dataset.bdjPruned === '1') return false;
        try {
            const rect = card.getBoundingClientRect();
            const measuredH = rect && rect.height > 40 ? Math.round(rect.height) : 240;

            card.querySelectorAll('img').forEach(img => {
                if (img.hasAttribute('src') && !img.dataset.bdjOrigSrc) {
                    img.dataset.bdjOrigSrc = img.getAttribute('src') || '';
                    img.removeAttribute('src');
                }
                if (img.hasAttribute('srcset') && !img.dataset.bdjOrigSrcset) {
                    img.dataset.bdjOrigSrcset = img.getAttribute('srcset') || '';
                    img.removeAttribute('srcset');
                }
            });

            card.querySelectorAll('source').forEach(srcEl => {
                if (srcEl.hasAttribute('srcset') && !srcEl.dataset.bdjOrigSrcset) {
                    srcEl.dataset.bdjOrigSrcset = srcEl.getAttribute('srcset') || '';
                    srcEl.removeAttribute('srcset');
                }
            });

            card.querySelectorAll('video').forEach(video => {
                try { video.pause(); } catch (e) {}
                if (video.hasAttribute('src') && !video.dataset.bdjOrigSrc) {
                    video.dataset.bdjOrigSrc = video.getAttribute('src') || '';
                    video.removeAttribute('src');
                    try { video.load(); } catch (e) {}
                }
            });

            card.dataset.bdjOrigCv = card.style.contentVisibility || '';
            card.dataset.bdjOrigCis = card.style.containIntrinsicSize || '';
            card.style.contentVisibility = 'hidden';
            card.style.containIntrinsicSize = `auto ${measuredH}px`;
            card.dataset.bdjPruned = '1';
            prunedCardCount++;
            return true;
        } catch (e) {
            return false;
        }
    }

    function restoreCardMemory(card) {
        if (!card || card.dataset.bdjPruned !== '1') return false;
        try {
            card.querySelectorAll('img').forEach(img => {
                if (img.dataset.bdjOrigSrc !== undefined) {
                    if (img.dataset.bdjOrigSrc) img.setAttribute('src', img.dataset.bdjOrigSrc);
                    delete img.dataset.bdjOrigSrc;
                }
                if (img.dataset.bdjOrigSrcset !== undefined) {
                    if (img.dataset.bdjOrigSrcset) img.setAttribute('srcset', img.dataset.bdjOrigSrcset);
                    delete img.dataset.bdjOrigSrcset;
                }
            });

            card.querySelectorAll('source').forEach(srcEl => {
                if (srcEl.dataset.bdjOrigSrcset !== undefined) {
                    if (srcEl.dataset.bdjOrigSrcset) srcEl.setAttribute('srcset', srcEl.dataset.bdjOrigSrcset);
                    delete srcEl.dataset.bdjOrigSrcset;
                }
            });

            card.querySelectorAll('video').forEach(video => {
                if (video.dataset.bdjOrigSrc !== undefined) {
                    if (video.dataset.bdjOrigSrc) video.setAttribute('src', video.dataset.bdjOrigSrc);
                    delete video.dataset.bdjOrigSrc;
                }
            });

            card.style.contentVisibility = card.dataset.bdjOrigCv || '';
            card.style.containIntrinsicSize = card.dataset.bdjOrigCis || '';
            delete card.dataset.bdjOrigCv;
            delete card.dataset.bdjOrigCis;
            delete card.dataset.bdjPruned;
            prunedCardCount = Math.max(0, prunedCardCount - 1);
            return true;
        } catch (e) {
            return false;
        }
    }

    function restoreAllPrunedCards() {
        const cards = document.querySelectorAll('.bili-dyn-item[data-bdj-pruned="1"]');
        let count = 0;
        cards.forEach(card => {
            if (restoreCardMemory(card)) count++;
        });
        prunedCardCount = 0;
        updatePrunedMetaUI();
        return count;
    }

    // 还原目标卡片及其前后相邻若干条动态的图片，确保浏览上下文清晰完整
    function restoreAroundCard(targetCard, radius = 6) {
        if (!targetCard) return;
        const allCards = document.querySelectorAll('.bili-dyn-item');
        let idx = -1;
        for (let i = 0; i < allCards.length; i++) {
            if (allCards[i] === targetCard) {
                idx = i;
                break;
            }
        }
        if (idx === -1) {
            restoreCardMemory(targetCard);
            updatePrunedMetaUI();
            return;
        }
        const start = Math.max(0, idx - radius);
        const end = Math.min(allCards.length - 1, idx + radius);
        for (let i = start; i <= end; i++) {
            restoreCardMemory(allCards[i]);
        }
        updatePrunedMetaUI();
    }

    // 向下滚动过程中，释放距离底部较远且早于/晚于目标（严格晚于目标日期）的已滑过卡片图片
    function prunePassedUpperCards(dynamicCards) {
        const memToggle = document.getElementById('memory-saver-toggle');
        if (!memToggle || !memToggle.checked) return;

        // 保留最底部 24 条不释放，防止影响当前懒加载与目标附近视图
        const safeTail = 24;
        if (dynamicCards.length <= safeTail) return;

        const hasDay = targetDay !== null;
        const targetKey = makeDateKey(targetYear, targetMonth, targetDay || 1, hasDay);
        const limit = dynamicCards.length - safeTail;

        for (let i = 0; i < limit; i++) {
            const card = dynamicCards[i];
            if (card.dataset.bdjPruned === '1') continue;
            if (isPinnedDynamic(card)) continue;
            const dateInfo = extractDateInfo(card);
            if (!dateInfo) continue;

            const cardCompareKey = makeDateKey(dateInfo.year, dateInfo.month, dateInfo.day, hasDay);
            if (cardCompareKey > targetKey) {
                pruneCardMemory(card);
            }
        }
        updatePrunedMetaUI();
    }

    // ==================== 匹配结果摘要提取与列表渲染 ====================

    function extractCardSummary(card) {
        try {
            const vueData = getVueDynamicData(card);
            if (vueData && vueData.modules) {
                const dyn = vueData.modules.module_dynamic;
                const descText = dyn && dyn.desc && dyn.desc.text ? dyn.desc.text.trim() : '';
                const major = dyn && dyn.major;
                const type = major && major.type;
                if (descText) {
                    const clean = descText.replace(/\s+/g, ' ');
                    return clean.length > 80 ? clean.slice(0, 80) + '…' : clean;
                }
                if (type === 'MAJOR_TYPE_OPUS' && major.opus) {
                    const title = major.opus.title ? major.opus.title.trim() : '';
                    const text = major.opus.summary && major.opus.summary.text
                        ? major.opus.summary.text.replace(/\s+/g, ' ').trim()
                        : '';
                    const combined = title && text ? `${title} - ${text}` : (title || text);
                    if (combined) return combined.length > 80 ? combined.slice(0, 80) + '…' : combined;
                }
                if (type === 'MAJOR_TYPE_ARCHIVE' && major.archive && major.archive.title) {
                    return `投稿视频：${major.archive.title}`;
                }
                if (type === 'MAJOR_TYPE_DRAW') {
                    const count = (major.draw && major.draw.items && major.draw.items.length) || 0;
                    return `图文动态（${count} 张图片）`;
                }
                if (type === 'MAJOR_TYPE_ARTICLE' && major.article && major.article.title) {
                    return `专栏：${major.article.title}`;
                }
                if (vueData.orig && vueData.orig.modules) {
                    const origDyn = vueData.orig.modules.module_dynamic;
                    const origText = origDyn && origDyn.desc && origDyn.desc.text ? origDyn.desc.text.replace(/\s+/g, ' ').trim() : '';
                    if (origText) return `转发：${origText.length > 74 ? origText.slice(0, 74) + '…' : origText}`;
                }
            }

            // DOM 文本兜底提取
            const selectors = [
                '.bili-rich-text__content',
                '.dyn-card-opus__title',
                '.dyn-card-opus__summary',
                '.bili-dyn-card-video__title',
                '.bili-dyn-card-article__title',
                '.bili-dyn-content__orig__desc'
            ];
            for (const sel of selectors) {
                const el = card.querySelector(sel);
                if (el && el.textContent) {
                    const text = el.textContent.replace(/\s+/g, ' ').trim();
                    if (text) return text.length > 80 ? text.slice(0, 80) + '…' : text;
                }
            }
        } catch (e) {
            // 忽略异常
        }
        return '（无文字内容）';
    }

    function extractCardAuthor(card) {
        try {
            const vueData = getVueDynamicData(card);
            const vueName = vueData && vueData.modules && vueData.modules.module_author && vueData.modules.module_author.name;
            if (vueName && String(vueName).trim()) {
                return String(vueName).trim();
            }

            const selectors = [
                '.bili-dyn-title__text',
                '.bili-dyn-title',
                '.bili-dyn-author__name',
                '[class*="dyn-title"]'
            ];
            for (const sel of selectors) {
                const el = card.querySelector(sel);
                if (el && el.textContent) {
                    const text = el.textContent.replace(/\s+/g, ' ').trim();
                    if (text) return text;
                }
            }
        } catch (e) {
            // 忽略异常
        }
        return '';
    }

    function formatExactCardTime(dateInfo) {
        if (!dateInfo) return '未知时间';
        if (dateInfo.source === 'vue_pub_ts' && dateInfo.timestamp > 1200000000) {
            const d = new Date(dateInfo.timestamp * 1000);
            return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
        }
        return formatDateInfo(dateInfo, true);
    }

    function updateOldestLoadedDate(dateInfo) {
        if (!dateInfo) return;
        oldestLoadedDateInfo = dateInfo;
        const el = document.getElementById('oldest-loaded-date');
        if (el) el.textContent = formatDateInfo(dateInfo, true);
    }

    function applyAuthorFilter(keyword) {
        currentAuthorFilter = (keyword || '').trim();
        const lower = currentAuthorFilter.toLowerCase();
        const prevSelectedCard = (currentMatchIndex >= 0 && matchedResults[currentMatchIndex])
            ? matchedResults[currentMatchIndex].card
            : null;

        if (!lower) {
            matchedResults = allMatchedResults.slice();
        } else {
            matchedResults = allMatchedResults.filter(item =>
                (item.author || '').toLowerCase().includes(lower)
            );
        }

        if (matchedResults.length === 0) {
            currentMatchIndex = -1;
        } else {
            const keptIdx = prevSelectedCard
                ? matchedResults.findIndex(item => item.card === prevSelectedCard)
                : -1;
            currentMatchIndex = keptIdx >= 0 ? keptIdx : matchedResults.length - 1;
        }

        updateMatchNavUI();
    }

    function renderMatchList() {
        const listEl = document.getElementById('match-result-list');
        if (!listEl) return;

        listEl.innerHTML = '';

        if (allMatchedResults.length === 0) {
            return;
        }

        if (matchedResults.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'bdj-result-empty';
            empty.textContent = `未找到包含“${currentAuthorFilter}”的 UP 主动态`;
            listEl.appendChild(empty);
            return;
        }

        const frag = document.createDocumentFragment();
        // 列表按从早到晚排列（最早一条在最上方），方便浏览并单击跳转
        for (let displayIdx = 0; displayIdx < matchedResults.length; displayIdx++) {
            const resultIdx = matchedResults.length - 1 - displayIdx;
            const item = matchedResults[resultIdx];
            const isActive = resultIdx === currentMatchIndex;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = isActive ? 'bdj-result-item is-active' : 'bdj-result-item';

            const head = document.createElement('div');
            head.className = 'bdj-result-item-head';

            const leftSpan = document.createElement('span');
            const dateStr = formatExactCardTime(item.dateInfo);
            leftSpan.textContent = item.author ? `${dateStr} · ${item.author}` : dateStr;
            leftSpan.style.overflow = 'hidden';
            leftSpan.style.textOverflow = 'ellipsis';
            leftSpan.style.whiteSpace = 'nowrap';
            head.appendChild(leftSpan);

            if (displayIdx === 0) {
                const tag = document.createElement('span');
                tag.className = 'bdj-result-tag';
                tag.textContent = matchedResults.length > 1 ? '最早' : '命中';
                head.appendChild(tag);
            } else {
                const numSpan = document.createElement('span');
                numSpan.textContent = `#${displayIdx + 1}`;
                head.appendChild(numSpan);
            }

            const summary = document.createElement('div');
            summary.className = 'bdj-result-summary';
            summary.textContent = item.summary || '（无文字内容）';

            btn.appendChild(head);
            btn.appendChild(summary);

            btn.addEventListener('click', () => {
                selectMatchByIndex(resultIdx);
            });

            frag.appendChild(btn);
        }
        listEl.appendChild(frag);
    }

    function selectMatchByIndex(index) {
        if (matchedResults.length === 0) return;
        currentMatchIndex = ((index % matchedResults.length) + matchedResults.length) % matchedResults.length;
        const item = matchedResults[currentMatchIndex];
        restoreAroundCard(item.card);

        const isEarliest = currentMatchIndex === matchedResults.length - 1;
        let badgeText;
        if (matchedResults.length > 1) {
            badgeText = isEarliest
                ? `最早一条 (${currentMatchIndex + 1}/${matchedResults.length})`
                : `匹配动态 (${currentMatchIndex + 1}/${matchedResults.length})`;
        } else {
            badgeText = '目标动态';
        }
        highlightTargetDynamic(item.card, badgeText);
        document.getElementById('current-date').textContent = formatDateInfo(item.dateInfo, true);
        updateMatchNavUI();
    }

    // ==================== 搜索控制与高亮 ====================

    function updateMatchNavUI() {
        const navBar = document.getElementById('match-nav-bar');
        const clearBtn = document.getElementById('clear-highlight-btn');
        if (!navBar) return;

        if (clearBtn) {
            clearBtn.style.display = currentHighlightedCard ? 'inline-flex' : 'none';
        }

        if (allMatchedResults.length === 0) {
            navBar.style.display = 'none';
            renderMatchList();
            return;
        }

        navBar.style.display = 'flex';
        const targetDesc = formatDateInfo(
            { year: targetYear, month: targetMonth, day: targetDay || 1 },
            Boolean(targetDay)
        );
        const isEarliest = matchedResults.length > 0 && currentMatchIndex === matchedResults.length - 1;

        if (currentAuthorFilter) {
            document.getElementById('match-nav-summary').textContent =
                `${targetDesc} · 筛选 ${matchedResults.length}/${allMatchedResults.length} 条`;
        } else {
            document.getElementById('match-nav-summary').textContent =
                `${targetDesc} · 共 ${allMatchedResults.length} 条${isEarliest ? '（最早）' : ''}`;
        }

        renderMatchList();
    }

    function updateStatus(msg, tone = 'normal') {
        const el = document.getElementById('status-msg');
        if (!el) return;
        el.textContent = msg;
        el.classList.remove('is-success', 'is-warn');
        if (tone === 'success') el.classList.add('is-success');
        if (tone === 'warn') el.classList.add('is-warn');
    }

    function startJump() {
        clearAllTimers();
        clearHighlight();

        targetYear = selectedYear;
        targetMonth = selectedMonth;
        targetDay = isMonthOnly ? null : selectedDay;

        const progressInfo = document.getElementById('progress-info');
        progressInfo.style.display = 'flex';

        const targetDesc = formatDateInfo(
            { year: targetYear, month: targetMonth, day: targetDay || 1 },
            Boolean(targetDay)
        );
        debugLog(`========== 开始搜索: ${targetDesc} ==========`);

        const maxRetries = parseInt(document.getElementById('max-retries').value, 10) || DEFAULT_SETTINGS.maxRetries;
        const scrollDelay = parseInt(document.getElementById('scroll-delay').value, 10) || DEFAULT_SETTINGS.scrollDelay;
        const aggressiveness = document.getElementById('scroll-aggressiveness').value || DEFAULT_SETTINGS.scrollAggressiveness;
        const extraScroll = parseInt(document.getElementById('extra-scroll').value, 10);

        window.jumpConfig = {
            maxRetries,
            scrollDelay,
            aggressiveness,
            extraScroll: isNaN(extraScroll) ? DEFAULT_SETTINGS.extraScroll : extraScroll
        };

        isSearching = true;
        currentRetries = 0;
        totalScrolls = 0;
        allMatchedResults = [];
        matchedResults = [];
        currentMatchIndex = -1;
        currentAuthorFilter = '';
        const filterInput = document.getElementById('match-author-filter');
        const filterClearBtn = document.getElementById('match-filter-clear');
        if (filterInput) filterInput.value = '';
        if (filterClearBtn) filterClearBtn.style.display = 'none';
        updateMatchNavUI();

        document.getElementById('start-jump').style.display = 'none';
        document.getElementById('stop-jump').style.display = 'inline-flex';
        document.getElementById('scroll-count').textContent = '0';
        document.getElementById('max-retry-display').textContent = maxRetries;
        document.getElementById('retry-count').textContent = '0';
        document.getElementById('current-date').textContent = '扫描中';
        updateStatus('正在扫描页面已加载的动态...');

        const dynamicCards = document.querySelectorAll('.bili-dyn-item');
        lastDynamicCount = dynamicCards.length;
        document.getElementById('loaded-count').textContent = dynamicCards.length;

        if (dynamicCards.length > 0) {
            const scanResult = scanDynamics(dynamicCards);

            if (scanResult.oldestDate) {
                document.getElementById('current-date').textContent =
                    formatDateInfo(scanResult.oldestDate, true);
                updateOldestLoadedDate(scanResult.oldestDate);
            }

            if (scanResult.passed) {
                if (scanResult.matches.length > 0) {
                    handleFoundMatches(scanResult.matches, true);
                } else {
                    handlePassedTarget(scanResult);
                }
                return;
            }

            if (scanResult.matches.length > 0) {
                updateStatus(`已找到 ${scanResult.matches.length} 条 ${targetDesc} 动态，继续向下确认最早一条...`);
            } else {
                updateStatus(`已加载动态未到达 ${targetDesc}，开始向下滚动加载...`);
            }
        } else {
            updateStatus('正在向下滚动加载动态...');
        }

        window.scrollBy(0, 500);
        scheduleTimer(autoScroll, 800);
    }

    function stopJump(statusLabel) {
        isSearching = false;
        clearAllTimers();
        const startBtn = document.getElementById('start-jump');
        const stopBtn = document.getElementById('stop-jump');
        if (startBtn) startBtn.style.display = 'inline-flex';
        if (stopBtn) stopBtn.style.display = 'none';
        if (statusLabel) {
            updateStatus(statusLabel, 'normal');
        }
        debugLog('========== 搜索已停止 ==========');
    }

    function handleFoundMatches(matches, fromLoadedCache, reachedBottom = false) {
        isSearching = false;
        clearAllTimers();
        document.getElementById('start-jump').style.display = 'inline-flex';
        document.getElementById('stop-jump').style.display = 'none';

        allMatchedResults = matches.map(m => Object.assign({}, m, {
            author: extractCardAuthor(m.card),
            summary: extractCardSummary(m.card)
        }));
        matchedResults = allMatchedResults.slice();
        currentMatchIndex = matchedResults.length - 1;

        const earliest = matchedResults[currentMatchIndex];
        restoreAroundCard(earliest.card);

        const badgeText = matchedResults.length > 1
            ? `最早一条 (${currentMatchIndex + 1}/${matchedResults.length})`
            : '目标动态';
        highlightTargetDynamic(earliest.card, badgeText);
        updateMatchNavUI();

        const targetDesc = formatDateInfo(earliest.dateInfo, Boolean(targetDay));
        document.getElementById('current-date').textContent = formatDateInfo(earliest.dateInfo, true);

        let suffix = '';
        if (fromLoadedCache) suffix = '（已加载中直接命中）';
        else if (reachedBottom) suffix = '（已达动态底部）';

        updateStatus(`找到 ${matchedResults.length} 条 ${targetDesc} 动态，已定位至最早一条${suffix}`, 'success');
        debugLog(`命中 ${matchedResults.length} 条目标动态，定位最早一条:`, earliest.dateInfo);
    }

    function handlePassedTarget(scanResult) {
        isSearching = false;
        clearAllTimers();
        document.getElementById('start-jump').style.display = 'inline-flex';
        document.getElementById('stop-jump').style.display = 'none';

        const targetDesc = formatDateInfo(
            { year: targetYear, month: targetMonth, day: targetDay || 1 },
            Boolean(targetDay)
        );

        if (scanResult.closestCard && scanResult.closestDate) {
            const closestDesc = formatDateInfo(scanResult.closestDate, true);
            restoreAroundCard(scanResult.closestCard);
            highlightTargetDynamic(scanResult.closestCard, `最接近 (${closestDesc})`, true);
            updateMatchNavUI();
            document.getElementById('current-date').textContent = closestDesc;
            updateStatus(`未找到 ${targetDesc} 的动态，已定位到最接近的动态（${closestDesc}）`, 'warn');
        } else {
            const oldestDesc = formatDateInfo(scanResult.oldestDate, true);
            document.getElementById('current-date').textContent = oldestDesc;
            updateStatus(`已超过目标时间 ${targetDesc}（当前最旧 ${oldestDesc}），未找到匹配动态`, 'warn');
        }
    }

    function handleReachedBottom() {
        const dynamicCards = document.querySelectorAll('.bili-dyn-item');
        if (dynamicCards.length > 0) {
            const fullScan = scanDynamics(dynamicCards);
            if (fullScan.matches.length > 0) {
                handleFoundMatches(fullScan.matches, false, true);
                return;
            }

            isSearching = false;
            clearAllTimers();
            document.getElementById('start-jump').style.display = 'inline-flex';
            document.getElementById('stop-jump').style.display = 'none';

            const oldestDesc = fullScan.oldestDate ? formatDateInfo(fullScan.oldestDate, true) : '未知';
            const targetDesc = formatDateInfo(
                { year: targetYear, month: targetMonth, day: targetDay || 1 },
                Boolean(targetDay)
            );
            document.getElementById('current-date').textContent = oldestDesc;
            updateStatus(`已达重试上限（最早 ${oldestDesc}），未到达 ${targetDesc}，可在“设置”中调大重试次数`, 'warn');
        } else {
            isSearching = false;
            clearAllTimers();
            document.getElementById('start-jump').style.display = 'inline-flex';
            document.getElementById('stop-jump').style.display = 'none';
            updateStatus('未能加载到动态内容，请刷新页面后重试', 'warn');
        }
    }

    function autoScroll() {
        if (!isSearching) return;

        totalScrolls++;
        document.getElementById('scroll-count').textContent = totalScrolls;

        const config = window.jumpConfig;
        const scrollHeight = document.documentElement.scrollHeight;

        debugLog(`第${totalScrolls}次滚动 - 页面高度:${scrollHeight}`);
        updateStatus('正在向下滚动加载更多动态...');

        if (config.aggressiveness === 'normal') {
            window.scrollTo({ top: scrollHeight, behavior: 'auto' });
        } else if (config.aggressiveness === 'aggressive') {
            window.scrollTo({ top: scrollHeight, behavior: 'auto' });
            scheduleTimer(() => {
                if (!isSearching) return;
                window.scrollBy({ top: config.extraScroll, behavior: 'auto' });
            }, 300);
        } else if (config.aggressiveness === 'extreme') {
            window.scrollTo({ top: scrollHeight + config.extraScroll, behavior: 'auto' });
            scheduleTimer(() => {
                if (!isSearching) return;
                window.scrollBy({ top: config.extraScroll, behavior: 'auto' });
                scheduleTimer(() => {
                    if (!isSearching) return;
                    window.scrollTo({
                        top: document.documentElement.scrollHeight + 5000,
                        behavior: 'auto'
                    });
                }, 200);
            }, 200);
        }

        scheduleTimer(() => {
            if (!isSearching) return;
            updateStatus('等待服务器响应...');
            scheduleTimer(() => {
                if (!isSearching) return;
                checkDynamics();
            }, config.scrollDelay);
        }, 800);
    }

    function checkDynamics() {
        if (!isSearching) return;

        const dynamicCards = document.querySelectorAll('.bili-dyn-item');
        const currentCount = dynamicCards.length;
        const config = window.jumpConfig;

        document.getElementById('loaded-count').textContent = currentCount;

        const hasNewContent = currentCount > lastDynamicCount;

        if (hasNewContent) {
            const newCount = currentCount - lastDynamicCount;
            currentRetries = 0;
            lastDynamicCount = currentCount;
            document.getElementById('retry-count').textContent = '0';
            updateStatus(`新增 ${newCount} 条动态，正在比对日期...`);
        } else {
            currentRetries++;
            document.getElementById('retry-count').textContent = currentRetries;
            updateStatus(`未检测到新内容，重试中 (${currentRetries}/${config.maxRetries})...`);

            if (currentRetries >= config.maxRetries) {
                handleReachedBottom();
                return;
            }
        }

        if (currentCount > 0) {
            const fullScan = scanDynamics(dynamicCards);

            if (fullScan.oldestDate) {
                document.getElementById('current-date').textContent =
                    formatDateInfo(fullScan.oldestDate, true);
                updateOldestLoadedDate(fullScan.oldestDate);
            }

            if (fullScan.passed) {
                if (fullScan.matches.length > 0) {
                    handleFoundMatches(fullScan.matches, false);
                } else {
                    handlePassedTarget(fullScan);
                }
                return;
            }

            if (fullScan.matches.length > 0) {
                const targetDesc = formatDateInfo(
                    { year: targetYear, month: targetMonth, day: targetDay || 1 },
                    Boolean(targetDay)
                );
                updateStatus(`已找到 ${fullScan.matches.length} 条 ${targetDesc} 动态，继续向下查找更早的同日动态...`);
            }

            // 省内存模式：释放远在上方且已滑过（严格晚于目标日期）的动态图片与渲染层
            prunePassedUpperCards(dynamicCards);
        }

        scheduleTimer(autoScroll, 500);
    }

    function clearHighlight() {
        if (currentFlashTimeout) {
            clearTimeout(currentFlashTimeout);
            currentFlashTimeout = null;
        }
        if (currentHighlightedCard) {
            const oldBadge = currentHighlightedCard.querySelector('.bili-jumper-badge');
            if (oldBadge) oldBadge.remove();
            if (currentHighlightOriginalStyle) {
                currentHighlightedCard.style.border = currentHighlightOriginalStyle.border;
                currentHighlightedCard.style.boxShadow = currentHighlightOriginalStyle.boxShadow;
                currentHighlightedCard.style.transition = currentHighlightOriginalStyle.transition;
                currentHighlightedCard.style.backgroundColor = currentHighlightOriginalStyle.backgroundColor;
                currentHighlightedCard.style.position = currentHighlightOriginalStyle.position;
            }
            currentHighlightedCard = null;
            currentHighlightOriginalStyle = null;
            currentHighlightIsApprox = false;
        }
    }

    function applyHighlightColors(dynamicCard, isApproximate, withFlash) {
        const accentColor = isApproximate ? '#d97706' : (currentIsDark ? '#36ad7e' : '#2e9e73');
        const ringColor = isApproximate
            ? (currentIsDark ? 'rgba(217, 119, 6, 0.28)' : 'rgba(217, 119, 6, 0.16)')
            : (currentIsDark ? 'rgba(54, 173, 126, 0.25)' : 'rgba(46, 158, 115, 0.16)');
        const bgColor = isApproximate
            ? (currentIsDark ? 'rgba(217, 119, 6, 0.10)' : '#fffbeb')
            : (currentIsDark ? 'rgba(54, 173, 126, 0.10)' : '#f2fbf7');
        const flashBg = isApproximate
            ? (currentIsDark ? 'rgba(217, 119, 6, 0.20)' : '#fef3c7')
            : (currentIsDark ? 'rgba(54, 173, 126, 0.20)' : '#e0f5ec');

        dynamicCard.style.border = `2px solid ${accentColor}`;
        dynamicCard.style.boxShadow = `0 0 0 3px ${ringColor}`;
        dynamicCard.style.transition = 'background-color 0.25s ease, box-shadow 0.25s ease';
        dynamicCard.style.backgroundColor = withFlash ? flashBg : bgColor;
        dynamicCard.style.position = 'relative';

        if (withFlash) {
            if (currentFlashTimeout) clearTimeout(currentFlashTimeout);
            currentFlashTimeout = setTimeout(() => {
                if (currentHighlightedCard === dynamicCard) {
                    applyHighlightColors(dynamicCard, isApproximate, false);
                }
                currentFlashTimeout = null;
            }, 700);
        }
    }

    function highlightTargetDynamic(dynamicCard, badgeText = '目标动态', isApproximate = false) {
        clearHighlight();

        currentHighlightedCard = dynamicCard;
        currentHighlightIsApprox = isApproximate;
        currentHighlightOriginalStyle = {
            border: dynamicCard.style.border,
            boxShadow: dynamicCard.style.boxShadow,
            transition: dynamicCard.style.transition,
            backgroundColor: dynamicCard.style.backgroundColor,
            position: dynamicCard.style.position
        };

        applyHighlightColors(dynamicCard, isApproximate, true);

        const badge = document.createElement('div');
        badge.className = isApproximate ? 'bili-jumper-badge is-approx' : 'bili-jumper-badge';
        badge.textContent = badgeText;
        dynamicCard.insertBefore(badge, dynamicCard.firstChild);

        setTimeout(() => {
            dynamicCard.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }, 250);

        debugLog('已高亮目标动态:', badgeText);
    }

    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(createControlPanel, 1500);
            });
        } else {
            setTimeout(createControlPanel, 1500);
        }
    }

    init();

    debugLog('哔哩哔哩动态日期跳转助手 v1.5.0 已启动');
})();
