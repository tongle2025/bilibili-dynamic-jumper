// ==UserScript==
// @name         B站动态日期跳转助手
// @name:en      Bilibili Dynamic Time Jumper
// @namespace    https://github.com/tongle2025/bilibili-dynamic-jumper
// @version      1.0.0
// @description  快速跳转到B站UP主指定年月的动态,支持自定义滚动参数和重试次数,适合查找历史动态
// @description:en Quickly jump to Bilibili UP master's dynamics at specified year and month
// @author       Sakurakid
// @match        https://space.bilibili.com/*/dynamic
// @icon         https://www.bilibili.com/favicon.ico
// @grant        none
// @license      MIT
// @homepage     https://github.com/tongle2025/bilibili-dynamic-jumper
// @supportURL   https://github.com/tongle2025/bilibili-dynamic-jumper/issues
// @downloadURL https://update.greasyfork.org/scripts/552739/B%E7%AB%99%E5%8A%A8%E6%80%81%E6%97%A5%E6%9C%9F%E8%B7%B3%E8%BD%AC%E5%8A%A9%E6%89%8B.user.js
// @updateURL https://update.greasyfork.org/scripts/552739/B%E7%AB%99%E5%8A%A8%E6%80%81%E6%97%A5%E6%9C%9F%E8%B7%B3%E8%BD%AC%E5%8A%A9%E6%89%8B.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // 全局状态
    let isSearching = false;
    let targetYear = null;
    let targetMonth = null;
    let currentRetries = 0;
    let lastDynamicCount = 0;
    let totalScrolls = 0;

    function debugLog(...args) {
        console.log('[动态跳转]', ...args);
    }

    function createControlPanel() {
        const panel = document.createElement('div');
        panel.id = 'dynamic-jumper-panel';
        panel.innerHTML = `
            <div style="position: fixed; top: 80px; right: 20px; z-index: 10000;
                        background: white; padding: 20px; border-radius: 12px;
                        box-shadow: 0 4px 20px rgba(0,0,0,0.2); min-width: 340px; max-width: 400px;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;
                            border-bottom: 2px solid #00a1d6; padding-bottom: 10px;">
                    <h3 style="margin: 0; font-size: 17px; color: #333;">
                        📅 动态时间跳转 v1.0.0
                    </h3>
                    <button id="hide-panel" style="background: transparent; border: none; cursor: pointer;
                                                    font-size: 18px; color: #999; padding: 4px 8px;
                                                    transition: color 0.2s;" title="隐藏面板">
                        ✕
                    </button>
                </div>

                <!-- 基本设置 -->
                <div style="margin-bottom: 12px;">
                    <label style="display: block; margin-bottom: 5px; font-size: 14px; color: #666; font-weight: 500;">
                        目标年份:
                    </label>
                    <select id="target-year"
                            style="width: 100%; padding: 8px; border: 1px solid #ddd;
                                   border-radius: 6px; font-size: 14px;">
                    </select>
                </div>
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-size: 14px; color: #666; font-weight: 500;">
                        目标月份:
                    </label>
                    <select id="target-month"
                            style="width: 100%; padding: 8px; border: 1px solid #ddd;
                                   border-radius: 6px; font-size: 14px;">
                        <option value="1">1月</option>
                        <option value="2">2月</option>
                        <option value="3">3月</option>
                        <option value="4">4月</option>
                        <option value="5">5月</option>
                        <option value="6">6月</option>
                        <option value="7">7月</option>
                        <option value="8">8月</option>
                        <option value="9">9月</option>
                        <option value="10">10月</option>
                        <option value="11">11月</option>
                        <option value="12">12月</option>
                    </select>
                </div>

                <!-- 高级设置(可折叠) -->
                <div style="margin-bottom: 15px; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                    <div id="advanced-toggle" style="padding: 10px 12px; background: #f8f9fa; cursor: pointer;
                                                     display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 14px; font-weight: 500; color: #555;">⚙️ 高级设置</span>
                        <span id="toggle-icon" style="font-size: 12px; color: #999;">▼</span>
                    </div>
                    <div id="advanced-panel" style="padding: 15px; background: #fafbfc; display: none;">

                        <!-- 最大重试次数 -->
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-size: 13px; color: #555; font-weight: 500;">
                                最大重试次数:
                            </label>
                            <input type="number" id="max-retries" value="10" min="1" max="50"
                                   style="width: 100%; padding: 6px 8px; border: 1px solid #ddd;
                                          border-radius: 4px; font-size: 13px;">
                            <div style="font-size: 11px; color: #888; margin-top: 4px; line-height: 1.4;">
                                当连续N次滚动都没有加载出新动态时停止。数值越大等待时间越长,适合搜索很早期的动态。
                            </div>
                        </div>

                        <!-- 滚动等待时间 -->
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-size: 13px; color: #555; font-weight: 500;">
                                滚动等待时间(毫秒):
                            </label>
                            <input type="number" id="scroll-delay" value="2000" min="500" max="10000" step="500"
                                   style="width: 100%; padding: 6px 8px; border: 1px solid #ddd;
                                          border-radius: 4px; font-size: 13px;">
                            <div style="font-size: 11px; color: #888; margin-top: 4px; line-height: 1.4;">
                                每次滚动后等待多久才检查新动态。数值越大越稳定,但速度越慢。推荐1500-3000毫秒。
                            </div>
                        </div>

                        <!-- 滚动激进度 -->
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-size: 13px; color: #555; font-weight: 500;">
                                滚动激进度:
                            </label>
                            <select id="scroll-aggressiveness"
                                    style="width: 100%; padding: 6px 8px; border: 1px solid #ddd;
                                           border-radius: 4px; font-size: 13px;">
                                <option value="normal">普通 - 滚动到页面底部</option>
                                <option value="aggressive" selected>激进 - 底部+额外滚动</option>
                                <option value="extreme">极限 - 多次超量滚动</option>
                            </select>
                            <div style="font-size: 11px; color: #888; margin-top: 4px; line-height: 1.4;">
                                控制滚动的力度。如果遇到加载困难,可以尝试"极限"模式。
                            </div>
                        </div>

                        <!-- 额外滚动距离 -->
                        <div style="margin-bottom: 0;">
                            <label style="display: block; margin-bottom: 5px; font-size: 13px; color: #555; font-weight: 500;">
                                额外滚动距离(像素):
                            </label>
                            <input type="number" id="extra-scroll" value="2000" min="0" max="10000" step="500"
                                   style="width: 100%; padding: 6px 8px; border: 1px solid #ddd;
                                          border-radius: 4px; font-size: 13px;">
                            <div style="font-size: 11px; color: #888; margin-top: 4px; line-height: 1.4;">
                                在滚动到底部后,再额外向下滚动的距离。这能更可靠地触发懒加载机制。
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 操作按钮 -->
                <button id="start-jump"
                        style="width: 100%; padding: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                               color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 15px;
                               font-weight: 600; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
                               transition: transform 0.2s, box-shadow 0.2s;">
                    🚀 开始搜索
                </button>
                <button id="stop-jump"
                        style="width: 100%; padding: 12px; background: #ff6b6b; color: white;
                               border: none; border-radius: 8px; cursor: pointer; font-size: 15px;
                               font-weight: 600; margin-top: 10px; display: none;
                               box-shadow: 0 4px 12px rgba(255, 107, 107, 0.4);">
                    ⏸️ 停止搜索
                </button>

                <!-- 进度信息 -->
                <div id="progress-info"
                     style="margin-top: 15px; padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            border-radius: 8px; font-size: 13px; color: white; display: none;
                            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);">
                    <div style="margin-bottom: 12px; font-weight: 500;">
                        📍 当前位置:
                        <div id="current-date" style="margin-top: 5px; font-size: 16px; font-weight: bold;
                                                      text-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                            等待开始...
                        </div>
                    </div>
                    <div style="font-size: 12px; opacity: 0.95; border-top: 1px solid rgba(255,255,255,0.3);
                                padding-top: 10px; margin-top: 10px;">
                        已加载 <span id="loaded-count" style="font-weight: bold;">0</span> 条动态 |
                        滚动 <span id="scroll-count" style="font-weight: bold;">0</span> 次 |
                        重试 <span id="retry-count" style="font-weight: bold;">0</span>/<span id="max-retry-display">10</span>
                    </div>
                    <div id="status-msg" style="margin-top: 10px; font-size: 12px; opacity: 0.9;
                                                background: rgba(255,255,255,0.15); padding: 8px; border-radius: 4px;"></div>
                </div>

                <!-- 提示信息 -->
                <div style="margin-top: 12px; padding: 12px; background: #e7f3ff; border-left: 3px solid #00a1d6;
                            border-radius: 4px; font-size: 12px; color: #555; line-height: 1.6;">
                    <strong>💡 使用技巧:</strong><br>
                    • 搜索早期动态(如2019年)需要较长时间,请耐心等待<br>
                    • 如果长时间无进展,尝试增加"最大重试次数"或使用"极限"滚动模式<br>
                    • 滚动过快或过多可能会触发b站机制，需要手动过一下验证，无其他影响<br>
                    • 观察"当前位置"来判断搜索进度
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // 填充年份选项
        const yearSelect = document.getElementById('target-year');
        const currentYear = new Date().getFullYear();
        for (let year = currentYear; year >= 2009; year--) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year + '年';
            yearSelect.appendChild(option);
        }

        // 绑定事件
        document.getElementById('start-jump').addEventListener('click', startJump);
        document.getElementById('stop-jump').addEventListener('click', stopJump);

        // 隐藏/显示面板功能
        document.getElementById('hide-panel').addEventListener('click', () => {
            const panelDiv = document.getElementById('dynamic-jumper-panel').firstElementChild;
            panelDiv.style.display = 'none';

            // 创建显示按钮
            const showBtn = document.createElement('button');
            showBtn.id = 'show-panel-btn';
            showBtn.innerHTML = '📅';
            showBtn.title = '显示动态跳转面板';
            showBtn.style.cssText = `
                position: fixed;
                top: 80px;
                right: 20px;
                z-index: 10000;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border: none;
                font-size: 24px;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(102, 126, 234, 0.5);
                transition: transform 0.2s, box-shadow 0.2s;
            `;

            showBtn.addEventListener('click', () => {
                panelDiv.style.display = 'block';
                showBtn.remove();
            });

            showBtn.addEventListener('mouseenter', () => {
                showBtn.style.transform = 'scale(1.1)';
                showBtn.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.6)';
            });

            showBtn.addEventListener('mouseleave', () => {
                showBtn.style.transform = 'scale(1)';
                showBtn.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.5)';
            });

            document.body.appendChild(showBtn);
        });

        // 隐藏按钮悬停效果
        const hideBtn = document.getElementById('hide-panel');
        hideBtn.addEventListener('mouseenter', () => {
            hideBtn.style.color = '#ff6b6b';
        });
        hideBtn.addEventListener('mouseleave', () => {
            hideBtn.style.color = '#999';
        });

        // 高级设置折叠功能
        document.getElementById('advanced-toggle').addEventListener('click', () => {
            const panel = document.getElementById('advanced-panel');
            const icon = document.getElementById('toggle-icon');
            if (panel.style.display === 'none') {
                panel.style.display = 'block';
                icon.textContent = '▲';
            } else {
                panel.style.display = 'none';
                icon.textContent = '▼';
            }
        });

        // 按钮悬停效果
        const startBtn = document.getElementById('start-jump');
        startBtn.addEventListener('mouseenter', () => {
            startBtn.style.transform = 'translateY(-2px)';
            startBtn.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.5)';
        });
        startBtn.addEventListener('mouseleave', () => {
            startBtn.style.transform = 'translateY(0)';
            startBtn.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
        });

        debugLog('控制面板已创建');
    }

    function startJump() {
        targetYear = parseInt(document.getElementById('target-year').value);
        targetMonth = parseInt(document.getElementById('target-month').value);

        debugLog(`========== 开始搜索: ${targetYear}年${targetMonth}月 ==========`);

        // 读取用户设置的参数
        const maxRetries = parseInt(document.getElementById('max-retries').value);
        const scrollDelay = parseInt(document.getElementById('scroll-delay').value);
        const aggressiveness = document.getElementById('scroll-aggressiveness').value;
        const extraScroll = parseInt(document.getElementById('extra-scroll').value);

        debugLog(`参数设置: 最大重试=${maxRetries}, 滚动延迟=${scrollDelay}ms, 激进度=${aggressiveness}, 额外滚动=${extraScroll}px`);

        // 保存到全局配置
        window.jumpConfig = {
            maxRetries: maxRetries,
            scrollDelay: scrollDelay,
            aggressiveness: aggressiveness,
            extraScroll: extraScroll
        };

        isSearching = true;
        currentRetries = 0;
        lastDynamicCount = 0;
        totalScrolls = 0;

        document.getElementById('start-jump').style.display = 'none';
        document.getElementById('stop-jump').style.display = 'block';
        document.getElementById('progress-info').style.display = 'block';
        document.getElementById('current-date').textContent = '初始化中...';
        document.getElementById('max-retry-display').textContent = maxRetries;
        document.getElementById('retry-count').textContent = '0';
        updateStatus('准备开始搜索...');

        // 先做一次小幅滚动,触发初始加载
        window.scrollBy(0, 500);
        setTimeout(autoScroll, 1000);
    }

    function stopJump() {
        isSearching = false;
        document.getElementById('start-jump').style.display = 'block';
        document.getElementById('stop-jump').style.display = 'none';
        document.getElementById('current-date').textContent = '已手动停止';
        updateStatus('');
        debugLog('========== 搜索已停止 ==========');
    }

    function updateStatus(msg) {
        document.getElementById('status-msg').textContent = msg;
    }

    // 超级激进的滚动策略
    function autoScroll() {
        if (!isSearching) return;

        totalScrolls++;
        document.getElementById('scroll-count').textContent = totalScrolls;

        const config = window.jumpConfig;
        const scrollHeight = document.documentElement.scrollHeight;
        const clientHeight = document.documentElement.clientHeight;

        debugLog(`第${totalScrolls}次滚动 - 页面高度:${scrollHeight}, 可见高度:${clientHeight}`);

        updateStatus('🔄 执行激进滚动策略...');

        // 根据激进度选择不同的滚动策略
        if (config.aggressiveness === 'normal') {
            // 普通模式:只滚动到底部
            window.scrollTo({
                top: scrollHeight,
                behavior: 'auto'
            });
            debugLog('使用普通滚动:scrollTo(scrollHeight)');

        } else if (config.aggressiveness === 'aggressive') {
            // 激进模式:滚动到底部 + 额外滚动
            window.scrollTo({
                top: scrollHeight,
                behavior: 'auto'
            });

            // 等待一下,然后再额外滚动
            setTimeout(() => {
                window.scrollBy({
                    top: config.extraScroll,
                    behavior: 'auto'
                });
                debugLog(`激进滚动:scrollTo(scrollHeight) + scrollBy(${config.extraScroll})`);
            }, 300);

        } else if (config.aggressiveness === 'extreme') {
            // 极限模式:多次超量滚动
            window.scrollTo({
                top: scrollHeight + config.extraScroll,
                behavior: 'auto'
            });

            setTimeout(() => {
                window.scrollBy({
                    top: config.extraScroll,
                    behavior: 'auto'
                });

                // 第三次滚动,确保绝对到底
                setTimeout(() => {
                    window.scrollTo({
                        top: document.documentElement.scrollHeight + 5000,
                        behavior: 'auto'
                    });
                    debugLog('极限滚动:三次超量滚动,scrollHeight + ' + (config.extraScroll + 5000));
                }, 200);
            }, 200);
        }

        updateStatus('⏳ 等待B站加载新内容...');

        // 第一次等待:让滚动完成
        setTimeout(() => {
            updateStatus('📡 等待服务器响应...');

            // 第二次等待:让内容渲染
            setTimeout(() => {
                checkDynamics();
            }, config.scrollDelay);
        }, 800);
    }

    function checkDynamics() {
        let dynamicCards = document.querySelectorAll('.bili-dyn-item');
        const currentCount = dynamicCards.length;
        const config = window.jumpConfig;

        debugLog(`检查动态 - 当前:${currentCount}条, 上次:${lastDynamicCount}条`);

        document.getElementById('loaded-count').textContent = currentCount;
        document.getElementById('retry-count').textContent = currentRetries;

        const hasNewContent = currentCount > lastDynamicCount;

        if (hasNewContent) {
            const newCount = currentCount - lastDynamicCount;
            debugLog(`✓ 成功加载 ${newCount} 条新动态`);
            currentRetries = 0;
            lastDynamicCount = currentCount;
            updateStatus(`✅ 新增 ${newCount} 条动态`);
            document.getElementById('retry-count').textContent = '0';
        } else {
            currentRetries++;
            debugLog(`✗ 未检测到新动态 (${currentRetries}/${config.maxRetries})`);
            updateStatus(`⏳ 未检测到新内容,重试中... (${currentRetries}/${config.maxRetries})`);

            if (currentRetries >= config.maxRetries) {
                handleReachedBottom();
                return;
            }
        }

        // 分析当前的动态
        if (currentCount > 0) {
            const result = analyzeDynamics(dynamicCards);

            if (result.found) {
                highlightTargetDynamic(result.targetCard);
                stopJump();
                const d = result.targetDate;
                alert(`🎉 找到目标动态!\n\n时间: ${d.year}年${d.month}月${d.day}日\n\n已为您高亮显示该动态。`);
                return;
            } else if (result.passed) {
                handlePassedTarget(result);
                return;
            } else if (result.latestDate) {
                const d = result.latestDate;
                document.getElementById('current-date').textContent =
                    `${d.year}年${d.month}月${d.day}日`;
            }
        }

        // 继续滚动
        setTimeout(autoScroll, 500);
    }

    function analyzeDynamics(dynamicCards) {
        const checkCount = Math.min(20, dynamicCards.length);
        let latestDate = null;
        let targetCard = null;
        let targetDate = null;

        for (let i = dynamicCards.length - 1; i >= dynamicCards.length - checkCount && i >= 0; i--) {
            const card = dynamicCards[i];
            const dateInfo = extractDateInfo(card);

            if (!dateInfo) continue;

            if (!latestDate || dateInfo.timestamp > latestDate.timestamp) {
                latestDate = dateInfo;
            }

            if (dateInfo.year === targetYear && dateInfo.month === targetMonth) {
                targetCard = card;
                targetDate = dateInfo;
                debugLog(`🎯 找到目标! ${dateInfo.year}年${dateInfo.month}月${dateInfo.day}日`);
                return { found: true, targetCard, targetDate, latestDate };
            }

            if (dateInfo.year < targetYear ||
                (dateInfo.year === targetYear && dateInfo.month < targetMonth)) {
                debugLog(`⚠️ 已超过目标时间: ${dateInfo.year}年${dateInfo.month}月`);
                return { found: false, passed: true, passedDate: dateInfo, latestDate };
            }
        }

        return { found: false, passed: false, latestDate };
    }

    function handleReachedBottom() {
        stopJump();

        const dynamicCards = document.querySelectorAll('.bili-dyn-item');
        if (dynamicCards.length > 0) {
            const lastCard = dynamicCards[dynamicCards.length - 1];
            const lastDate = extractDateInfo(lastCard);

            if (lastDate) {
                const msg = `📍 已达到搜索限制\n\n` +
                           `最早动态: ${lastDate.year}年${lastDate.month}月${lastDate.day}日\n` +
                           `目标时间: ${targetYear}年${targetMonth}月\n` +
                           `已加载动态: ${dynamicCards.length}条\n\n` +
                           `可能原因:\n` +
                           `• 该UP主在目标时间未发布动态\n` +
                           `• 早期动态已被删除\n` +
                           `• B站对历史动态有显示限制\n\n` +
                           `建议:\n` +
                           `• 尝试增加"最大重试次数"到20-30\n` +
                           `• 使用"极限"滚动模式\n` +
                           `• 增加"滚动等待时间"到3000-4000ms`;
                alert(msg);
            } else {
                alert('⚠️ 已达到搜索限制,但无法识别最后一条动态的时间。');
            }
        } else {
            alert('⚠️ 未能加载到动态内容。请刷新页面后重试。');
        }
    }

    function handlePassedTarget(result) {
        stopJump();
        const d = result.passedDate;
        alert(`⚠️ 已超过目标时间\n\n当前位置: ${d.year}年${d.month}月${d.day}日\n目标时间: ${targetYear}年${targetMonth}月\n\n在当前位置附近未找到${targetYear}年${targetMonth}月的动态。\n\n建议: 可以尝试手动向上滚动查找,或者该UP主在目标月份可能没有发动态。`);
    }

    function extractDateInfo(dynamicCard) {
        try {
            const timeElement = dynamicCard.querySelector('.bili-dyn-time');
            if (timeElement) {
                const timeText = timeElement.textContent.trim();
                return parseTimeText(timeText);
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
        const now = new Date();

        try {
            let match = timeText.match(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})/);
            if (match) {
                return {
                    year: parseInt(match[1]),
                    month: parseInt(match[2]),
                    day: parseInt(match[3]),
                    timestamp: new Date(match[1], match[2] - 1, match[3]).getTime() / 1000,
                    original: timeText
                };
            }

            match = timeText.match(/(\d{1,2})[-月](\d{1,2})/);
            if (match) {
                const month = parseInt(match[1]);
                const day = parseInt(match[2]);
                let year = now.getFullYear();
                if (month > now.getMonth() + 1) year--;
                return {
                    year: year,
                    month: month,
                    day: day,
                    timestamp: new Date(year, month - 1, day).getTime() / 1000,
                    original: timeText
                };
            }

            if (timeText.includes('分钟前')) {
                match = timeText.match(/(\d+)分钟前/);
                if (match) {
                    const date = new Date(now.getTime() - parseInt(match[1]) * 60000);
                    return {
                        year: date.getFullYear(),
                        month: date.getMonth() + 1,
                        day: date.getDate(),
                        timestamp: date.getTime() / 1000,
                        original: timeText
                    };
                }
            }

            if (timeText.includes('小时前')) {
                match = timeText.match(/(\d+)小时前/);
                if (match) {
                    const date = new Date(now.getTime() - parseInt(match[1]) * 3600000);
                    return {
                        year: date.getFullYear(),
                        month: date.getMonth() + 1,
                        day: date.getDate(),
                        timestamp: date.getTime() / 1000,
                        original: timeText
                    };
                }
            }

            if (timeText.includes('昨天')) {
                const date = new Date(now.getTime() - 86400000);
                return {
                    year: date.getFullYear(),
                    month: date.getMonth() + 1,
                    day: date.getDate(),
                    timestamp: date.getTime() / 1000,
                    original: timeText
                };
            }

            if (timeText.includes('前天')) {
                const date = new Date(now.getTime() - 172800000);
                return {
                    year: date.getFullYear(),
                    month: date.getMonth() + 1,
                    day: date.getDate(),
                    timestamp: date.getTime() / 1000,
                    original: timeText
                };
            }

            return null;
        } catch (error) {
            return null;
        }
    }

    function highlightTargetDynamic(dynamicCard) {
        dynamicCard.style.border = '4px solid #667eea';
        dynamicCard.style.boxShadow = '0 0 40px rgba(102, 126, 234, 0.8)';
        dynamicCard.style.transition = 'all 0.3s ease';
        dynamicCard.style.backgroundColor = '#f0f4ff';
        dynamicCard.style.position = 'relative';

        const badge = document.createElement('div');
        badge.innerHTML = '🎯 找到了!';
        badge.style.cssText = `
            position: absolute;
            top: -18px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 8px 20px;
            border-radius: 25px;
            font-size: 15px;
            font-weight: bold;
            z-index: 100;
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
            animation: bounce 0.6s ease;
        `;

        // 添加动画样式
        const style = document.createElement('style');
        style.textContent = `
            @keyframes bounce {
                0%, 100% { transform: translateX(-50%) translateY(0); }
                50% { transform: translateX(-50%) translateY(-10px); }
            }
        `;
        document.head.appendChild(style);

        dynamicCard.insertBefore(badge, dynamicCard.firstChild);

        // 滚动到目标
        setTimeout(() => {
            dynamicCard.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }, 400);

        // 闪烁效果
        let blinks = 0;
        const blinkInterval = setInterval(() => {
            dynamicCard.style.backgroundColor =
                blinks % 2 === 0 ? '#fffacd' : '#f0f4ff';
            blinks++;
            if (blinks > 10) {
                clearInterval(blinkInterval);
                dynamicCard.style.backgroundColor = '#f0f4ff';
            }
        }, 350);

        debugLog('✓ 已高亮目标动态');
    }

    // 初始化
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

    debugLog('========================================');
    debugLog('B站动态日期跳转助手 v1.0.0 已启动');
    debugLog('新特性: 可自定义滚动参数和重试次数');
    debugLog('========================================');
    console.log('%c[动态跳转] 脚本v1.0.0已加载! 现在支持自定义参数', 'color: #667eea; font-size: 14px; font-weight: bold; background: #f0f4ff; padding: 4px 8px; border-radius: 4px;');
})();
