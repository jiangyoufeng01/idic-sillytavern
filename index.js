const MODULE_NAME = 'idic_companion';
const STATE_STORAGE_PREFIX = 'idic-companion-state:';
const FLOATING_POSITION_STORAGE_KEY = 'idic-companion-floating-position:v1';
const TRANSCRIPT_RENDER_PAGE_SIZE = 50;
const TRANSCRIPT_STORAGE_HARD_CAP = 400;
const COMPANION_RECENT_CHAT_LIMIT = 50;
const MODULE_SYNC_MODES = ['content', 'summary', 'fast', 'ignore'];
const DEFAULT_STATUS_SELECTORS = [
    '.mes_status',
    '.mes-status',
    '.status-bar',
    '.character-status',
    '[data-status-bar]',
    '[data-character-status]',
    '[data-role="character-status"]',
];
const CODE_BLOCK_REGEX = /```([\w-]+)?\s*([\s\S]*?)```/g;
const XML_BLOCK_REGEX = /<([a-zA-Z][\w:-]{0,40})[^>]*>([\s\S]*?)<\/\1>/g;
const HTML_TAG_NAMES = new Set([
    'a', 'article', 'aside', 'audio', 'b', 'blockquote', 'body', 'button', 'canvas', 'code', 'dd', 'details',
    'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'header', 'hr', 'html', 'i', 'img', 'input', 'label', 'li', 'main', 'nav', 'ol', 'option', 'p', 'pre',
    'section', 'select', 'small', 'span', 'strong', 'style', 'sub', 'summary', 'sup', 'svg', 'table', 'tbody',
    'td', 'textarea', 'tfoot', 'th', 'thead', 'tr', 'ul', 'video',
]);
const DEFAULT_SETTINGS = Object.freeze({
    bridgeUrl: '',
    bridgeToken: '',
    bridgeAuthKey: '',
    apiUrl: '',
    apiKey: '',
    apiModel: '',
    apiTemperature: 0.75,
    recentFullTurns: 2,
    stageRollupSize: 20,
    maxFullTurnChars: 3200,
    maxTranscriptTurns: 10,
    statusSelectors: DEFAULT_STATUS_SELECTORS.join('\n'),
    autoGenerateSummaryWhenMissing: false,
});

const runtime = {
    chatState: null,
    panelOpen: false,
    settingsRoot: null,
    activeStateKey: '',
    backgroundQueue: Promise.resolve(),
    latestTurnId: '',
    sendInFlight: false,
    lastSyncStamp: '',
    roleOptions: [],
    roleFetchInFlight: false,
    floatingPosition: loadFloatingPosition(),
    dragState: null,
    transcriptRenderCount: TRANSCRIPT_RENDER_PAGE_SIZE,
    transcriptSelectionMode: false,
    selectedTranscriptIds: new Set(),
};

const ui = {};

void bootstrap().catch((error) => {
    console.error(`[${MODULE_NAME}] bootstrap failed`, error);
    notify('IDIC陪读窗加载失败，请刷新页面后重试', 'error');
});

function getFallbackSettingsMarkup() {
    return `
        <div class="idic-companion-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>IDIC 陪读窗</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="idic-companion-settings-grid">
                        <label class="idic-companion-settings-field">
                            <span>中转地址</span>
                            <input id="idic-companion-bridge-url" type="text" placeholder="https://你的项目.functions.supabase.co/idic-companion-bridge" />
                        </label>
                        <label class="idic-companion-settings-field">
                            <span>中转令牌</span>
                            <input id="idic-companion-bridge-token" type="password" placeholder="没有就留空" />
                        </label>
                        <label class="idic-companion-settings-field">
                            <span>函数密钥</span>
                            <input id="idic-companion-bridge-auth-key" type="password" placeholder="可填 publishable key，也可留空" />
                        </label>
                        <label class="idic-companion-settings-field">
                            <span>主接口地址</span>
                            <input id="idic-companion-api-url" type="text" placeholder="https://api.openai.com/v1" />
                        </label>
                        <label class="idic-companion-settings-field">
                            <span>主接口密钥</span>
                            <input id="idic-companion-api-key" type="password" placeholder="用于陪读回复" />
                        </label>
                        <label class="idic-companion-settings-field">
                            <span>模型名</span>
                            <input id="idic-companion-api-model" type="text" placeholder="跟主聊一致就行" />
                        </label>
                        <label class="idic-companion-settings-field">
                            <span>温度</span>
                            <input id="idic-companion-api-temperature" type="number" min="0" max="2" step="0.05" />
                        </label>
                        <label class="idic-companion-settings-field">
                            <span>最近原文楼数</span>
                            <input id="idic-companion-recent-full-turns" type="number" min="1" max="6" />
                        </label>
                        <label class="idic-companion-settings-field">
                            <span>阶段总结楼数</span>
                            <input id="idic-companion-rollup-size" type="number" min="5" max="60" />
                        </label>
                        <label class="idic-companion-settings-field">
                            <span>单楼最大字数</span>
                            <input id="idic-companion-max-turn-chars" type="number" min="800" max="12000" step="100" />
                        </label>
                        <label class="idic-companion-settings-field">
                            <span>陪读记忆轮数</span>
                            <input id="idic-companion-max-transcript-turns" type="number" min="4" max="40" />
                        </label>
                    </div>

                    <label class="idic-companion-settings-field">
                        <span>状态栏选择器</span>
                        <textarea id="idic-companion-status-selectors" rows="5" placeholder=".status-bar&#10;[data-status-bar]&#10;.mes_status"></textarea>
                    </label>

                    <label class="idic-companion-settings-field idic-companion-settings-check">
                        <input id="idic-companion-auto-summary-toggle" type="checkbox" />
                        <span>没有现成摘要时自动补摘要</span>
                    </label>

                    <div class="idic-companion-settings-actions">
                        <button id="idic-companion-open-panel" class="menu_button">打开小窗</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function bootstrap() {
    await waitForSillyTavern();
    ensureSettings();
    await mountSettings();
    mountPanel();
    bindContextEvents();
    await loadCurrentChatState();
    renderAll();
    scheduleBackgroundMaintenance();
    void fetchRoleOptions({ force: true, announce: false }).catch(() => undefined);
}

async function waitForSillyTavern() {
    const startedAt = Date.now();
    while (!(window.SillyTavern && typeof window.SillyTavern.getContext === 'function')) {
        if (Date.now() - startedAt > 30_000) {
            throw new Error('酒馆环境加载超时');
        }
        await delay(150);
    }
}

function getContextSafe() {
    return window.SillyTavern && typeof window.SillyTavern.getContext === 'function'
        ? window.SillyTavern.getContext()
        : null;
}

function getContext() {
    const context = getContextSafe();
    if (!context) throw new Error('酒馆环境不可用');
    return context;
}

function getLib(name) {
    return window.SillyTavern?.libs?.[name] || window[name] || null;
}

function ensureSettings() {
    const context = getContext();
    if (!context.extensionSettings) context.extensionSettings = {};
    const current = context.extensionSettings[MODULE_NAME] && typeof context.extensionSettings[MODULE_NAME] === 'object'
        ? context.extensionSettings[MODULE_NAME]
        : {};
    const normalized = {
        bridgeUrl: toTrimmedString(current.bridgeUrl),
        bridgeToken: toTrimmedString(current.bridgeToken),
        bridgeAuthKey: toTrimmedString(current.bridgeAuthKey),
        apiUrl: toTrimmedString(current.apiUrl),
        apiKey: toTrimmedString(current.apiKey),
        apiModel: toTrimmedString(current.apiModel),
        apiTemperature: clampFloat(current.apiTemperature, 0, 2, DEFAULT_SETTINGS.apiTemperature),
        recentFullTurns: clampNumber(current.recentFullTurns, 1, 6, DEFAULT_SETTINGS.recentFullTurns),
        stageRollupSize: clampNumber(current.stageRollupSize, 5, 60, DEFAULT_SETTINGS.stageRollupSize),
        maxFullTurnChars: clampNumber(current.maxFullTurnChars, 800, 12000, DEFAULT_SETTINGS.maxFullTurnChars),
        maxTranscriptTurns: clampNumber(current.maxTranscriptTurns, 4, 40, DEFAULT_SETTINGS.maxTranscriptTurns),
        statusSelectors: normalizeSelectorsText(current.statusSelectors || DEFAULT_SETTINGS.statusSelectors),
        autoGenerateSummaryWhenMissing: current.autoGenerateSummaryWhenMissing === true,
    };
    context.extensionSettings[MODULE_NAME] = normalized;
    return normalized;
}

function saveSettings() {
    const context = getContextSafe();
    if (!context) return;
    if (typeof context.saveSettingsDebounced === 'function') {
        context.saveSettingsDebounced();
    } else if (typeof context.saveSettings === 'function') {
        context.saveSettings();
    }
}

function normalizeSelectorsText(value) {
    const lines = String(value == null ? '' : value)
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean);
    return (lines.length ? lines : DEFAULT_STATUS_SELECTORS).join('\n');
}

function createDefaultBinding() {
    return {
        sessionId: createId(),
        selectedRoleId: '',
        displayName: '',
        userId: '',
        charId: '',
        charName: '',
        charPersona: '',
        userName: '',
        userPersona: '',
        systemPrompt: '',
        relationshipHint: '',
        promptProfile: '',
        hippocampusEnabled: false,
        snapshotUpdatedAt: '',
    };
}

function createDefaultChatState() {
    return {
        version: 1,
        turnOrder: [],
        turns: {},
        stageSummaries: [],
        transcript: [],
        modulePreferences: {},
        chatSignature: '',
        updatedAt: 0,
    };
}

function ensureChatMeta() {
    const context = getContextSafe();
    if (!context || !context.chatMetadata || !Array.isArray(context.chat)) return null;
    const current = context.chatMetadata[MODULE_NAME] && typeof context.chatMetadata[MODULE_NAME] === 'object'
        ? context.chatMetadata[MODULE_NAME]
        : {};
    const binding = current.binding && typeof current.binding === 'object'
        ? Object.assign(createDefaultBinding(), current.binding)
        : createDefaultBinding();
    const normalized = {
        version: 1,
        stateId: toTrimmedString(current.stateId) || createId(),
        binding,
    };
    context.chatMetadata[MODULE_NAME] = normalized;
    return normalized;
}

async function saveChatMeta() {
    const context = getContextSafe();
    if (!context) return;
    if (typeof context.saveMetadata === 'function') {
        await context.saveMetadata();
    } else if (typeof context.saveMetadataDebounced === 'function') {
        context.saveMetadataDebounced();
    }
}

async function loadCurrentChatState() {
    const meta = ensureChatMeta();
    if (!meta) {
        runtime.chatState = createDefaultChatState();
        runtime.activeStateKey = '';
        return;
    }

    const storageKey = `${STATE_STORAGE_PREFIX}${meta.stateId}`;
    runtime.activeStateKey = storageKey;
    const localforage = getLib('localforage');
    const loaded = localforage ? await localforage.getItem(storageKey) : null;
    runtime.chatState = normalizeChatState(loaded);
    runtime.transcriptRenderCount = TRANSCRIPT_RENDER_PAGE_SIZE;
    runtime.transcriptSelectionMode = false;
    runtime.selectedTranscriptIds = new Set();
    await syncStateFromChat({ captureLatestStatus: false, forceLatestRescan: false });
    await saveChatMeta();
}

function normalizeChatState(value) {
    const source = value && typeof value === 'object' ? value : {};
    const turns = source.turns && typeof source.turns === 'object' ? source.turns : {};
    const normalizedTurns = {};
    Object.keys(turns).forEach((turnId) => {
        normalizedTurns[turnId] = normalizeTurnEntry(turns[turnId], turnId);
    });
    return Object.assign(createDefaultChatState(), source, {
        turnOrder: Array.isArray(source.turnOrder) ? source.turnOrder.map((item) => String(item)).filter(Boolean) : [],
        turns: normalizedTurns,
        stageSummaries: Array.isArray(source.stageSummaries) ? source.stageSummaries.map(normalizeStageSummary).filter(Boolean) : [],
        transcript: Array.isArray(source.transcript) ? source.transcript.map(normalizeTranscriptEntry).filter(Boolean) : [],
        modulePreferences: source.modulePreferences && typeof source.modulePreferences === 'object'
            ? Object.assign({}, source.modulePreferences)
            : {},
    });
}

function normalizeTurnEntry(value, fallbackTurnId = '') {
    const source = value && typeof value === 'object' ? value : {};
    return {
        turnId: toTrimmedString(source.turnId || fallbackTurnId),
        sourceHash: toTrimmedString(source.sourceHash),
        userKey: toTrimmedString(source.userKey),
        aiKey: toTrimmedString(source.aiKey),
        userText: String(source.userText == null ? '' : source.userText),
        aiText: String(source.aiText == null ? '' : source.aiText),
        aiName: toTrimmedString(source.aiName),
        userIndex: Number.isFinite(Number(source.userIndex)) ? Number(source.userIndex) : -1,
        aiIndex: Number.isFinite(Number(source.aiIndex)) ? Number(source.aiIndex) : -1,
        createdAt: Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : Date.now(),
        updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : Date.now(),
        modules: Array.isArray(source.modules) ? source.modules.map(normalizeModule).filter(Boolean) : [],
        summary: String(source.summary == null ? '' : source.summary),
        summaryTitle: toTrimmedString(source.summaryTitle),
        summaryStatus: ['ready', 'running', 'stale', 'error', 'empty', 'missing'].includes(String(source.summaryStatus))
            ? String(source.summaryStatus)
            : 'missing',
        summarySourceDigest: toTrimmedString(source.summarySourceDigest),
        summaryOrigin: ['builtin', 'generated', 'fallback_raw', ''].includes(String(source.summaryOrigin))
            ? String(source.summaryOrigin)
            : '',
        stageId: toTrimmedString(source.stageId),
    };
}

function normalizeModule(value) {
    const source = value && typeof value === 'object' ? value : null;
    if (!source) return null;
    const text = String(source.text == null ? '' : source.text).trim();
    if (!text) return null;
    const syncMode = normalizeModuleSyncMode(source);
    return {
        id: toTrimmedString(source.id) || createId(),
        kind: toTrimmedString(source.kind) || 'tag_block',
        label: toTrimmedString(source.label) || '文本',
        tagName: toTrimmedString(source.tagName),
        tagKey: toTrimmedString(source.tagKey),
        sourceType: toTrimmedString(source.sourceType) || 'tag_block',
        text,
        syncMode,
        selected: syncMode !== 'ignore',
        persistence: syncMode === 'fast' ? 'fast' : 'long',
        preview: clipText(source.preview || text, 220),
    };
}

function normalizeModuleSyncMode(source) {
    const explicit = toTrimmedString(source && source.syncMode);
    if (MODULE_SYNC_MODES.includes(explicit)) return explicit;
    if (source && source.selected === false) return 'ignore';
    if (toTrimmedString(source && source.kind) === 'summary') return 'summary';
    if (source && source.persistence === 'fast') return 'fast';
    if (['html_scene_text', 'statusbar_raw', 'fast_text'].includes(toTrimmedString(source && source.kind))) {
        return 'fast';
    }
    return 'content';
}

function normalizeStageSummary(value) {
    const source = value && typeof value === 'object' ? value : null;
    if (!source) return null;
    const summary = String(source.summary == null ? '' : source.summary).trim();
    if (!summary) return null;
    return {
        id: toTrimmedString(source.id) || createId(),
        title: toTrimmedString(source.title) || '阶段总结',
        summary,
        turnIds: Array.isArray(source.turnIds) ? source.turnIds.map((item) => String(item)).filter(Boolean) : [],
        createdAt: Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : Date.now(),
    };
}

function normalizeTranscriptEntry(value) {
    const source = value && typeof value === 'object' ? value : null;
    if (!source) return null;
    const text = String(source.text == null ? '' : source.text).trim();
    if (!text) return null;
    return {
        id: toTrimmedString(source.id) || createId(),
        role: ['user', 'assistant', 'system'].includes(String(source.role)) ? String(source.role) : 'system',
        text,
        createdAt: Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : Date.now(),
        pending: Boolean(source.pending),
        batchId: toTrimmedString(source.batchId),
        sourceType: toTrimmedString(source.sourceType),
        sourceTag: toTrimmedString(source.sourceTag),
    };
}

async function persistChatState() {
    if (!runtime.activeStateKey) return;
    const localforage = getLib('localforage');
    if (!localforage || typeof localforage.setItem !== 'function') return;
    runtime.chatState.updatedAt = Date.now();
    await localforage.setItem(runtime.activeStateKey, runtime.chatState);
}

async function mountSettings() {
    const container = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!container) return;
    let html = '';
    try {
        const response = await fetch(new URL('settings.html', import.meta.url));
        if (!response.ok) {
            throw new Error(`settings_html_http_${response.status}`);
        }
        html = await response.text();
    } catch (error) {
        console.warn(`[${MODULE_NAME}] settings.html load failed, using fallback markup`, error);
        html = getFallbackSettingsMarkup();
    }
    const root = document.createElement('div');
    root.innerHTML = html;
    runtime.settingsRoot = root.firstElementChild;
    if (!runtime.settingsRoot || !runtime.settingsRoot.querySelector('#idic-companion-open-panel')) {
        root.innerHTML = getFallbackSettingsMarkup();
        runtime.settingsRoot = root.firstElementChild;
    }
    if (!runtime.settingsRoot) return;
    container.appendChild(runtime.settingsRoot);

    ui.bridgeUrlInput = runtime.settingsRoot.querySelector('#idic-companion-bridge-url');
    ui.bridgeTokenInput = runtime.settingsRoot.querySelector('#idic-companion-bridge-token');
    ui.bridgeAuthKeyInput = runtime.settingsRoot.querySelector('#idic-companion-bridge-auth-key');
    ui.apiUrlInput = runtime.settingsRoot.querySelector('#idic-companion-api-url');
    ui.apiKeyInput = runtime.settingsRoot.querySelector('#idic-companion-api-key');
    ui.apiModelInput = runtime.settingsRoot.querySelector('#idic-companion-api-model');
    ui.apiTemperatureInput = runtime.settingsRoot.querySelector('#idic-companion-api-temperature');
    ui.recentFullTurnsInput = runtime.settingsRoot.querySelector('#idic-companion-recent-full-turns');
    ui.rollupSizeInput = runtime.settingsRoot.querySelector('#idic-companion-rollup-size');
    ui.maxTurnCharsInput = runtime.settingsRoot.querySelector('#idic-companion-max-turn-chars');
    ui.maxTranscriptTurnsInput = runtime.settingsRoot.querySelector('#idic-companion-max-transcript-turns');
    ui.statusSelectorsInput = runtime.settingsRoot.querySelector('#idic-companion-status-selectors');
    ui.autoSummaryToggle = runtime.settingsRoot.querySelector('#idic-companion-auto-summary-toggle');
    ui.openPanelButton = runtime.settingsRoot.querySelector('#idic-companion-open-panel');

    const settings = ensureSettings();
    ui.bridgeUrlInput.value = settings.bridgeUrl;
    ui.bridgeTokenInput.value = settings.bridgeToken;
    ui.bridgeAuthKeyInput.value = settings.bridgeAuthKey;
    ui.apiUrlInput.value = settings.apiUrl;
    ui.apiKeyInput.value = settings.apiKey;
    ui.apiModelInput.value = settings.apiModel;
    ui.apiTemperatureInput.value = String(settings.apiTemperature);
    ui.recentFullTurnsInput.value = String(settings.recentFullTurns);
    ui.rollupSizeInput.value = String(settings.stageRollupSize);
    ui.maxTurnCharsInput.value = String(settings.maxFullTurnChars);
    ui.maxTranscriptTurnsInput.value = String(settings.maxTranscriptTurns);
    ui.statusSelectorsInput.value = settings.statusSelectors;
    if (ui.autoSummaryToggle) ui.autoSummaryToggle.checked = settings.autoGenerateSummaryWhenMissing;

    const bindSetting = (element, key, transform) => {
        if (!element) return;
        element.addEventListener('change', () => {
            const settingsRef = ensureSettings();
            settingsRef[key] = transform(element.value);
            getContext().extensionSettings[MODULE_NAME] = settingsRef;
            saveSettings();
            renderContextStats();
        });
    };

    bindSetting(ui.bridgeUrlInput, 'bridgeUrl', (value) => toTrimmedString(value));
    bindSetting(ui.bridgeTokenInput, 'bridgeToken', (value) => toTrimmedString(value));
    bindSetting(ui.bridgeAuthKeyInput, 'bridgeAuthKey', (value) => toTrimmedString(value));
    bindSetting(ui.apiUrlInput, 'apiUrl', (value) => toTrimmedString(value));
    bindSetting(ui.apiKeyInput, 'apiKey', (value) => toTrimmedString(value));
    bindSetting(ui.apiModelInput, 'apiModel', (value) => toTrimmedString(value));
    bindSetting(ui.apiTemperatureInput, 'apiTemperature', (value) => clampFloat(value, 0, 2, DEFAULT_SETTINGS.apiTemperature));
    bindSetting(ui.recentFullTurnsInput, 'recentFullTurns', (value) => clampNumber(value, 1, 6, DEFAULT_SETTINGS.recentFullTurns));
    bindSetting(ui.rollupSizeInput, 'stageRollupSize', (value) => clampNumber(value, 5, 60, DEFAULT_SETTINGS.stageRollupSize));
    bindSetting(ui.maxTurnCharsInput, 'maxFullTurnChars', (value) => clampNumber(value, 800, 12000, DEFAULT_SETTINGS.maxFullTurnChars));
    bindSetting(ui.maxTranscriptTurnsInput, 'maxTranscriptTurns', (value) => clampNumber(value, 4, 40, DEFAULT_SETTINGS.maxTranscriptTurns));
    bindSetting(ui.statusSelectorsInput, 'statusSelectors', (value) => normalizeSelectorsText(value));
    if (ui.autoSummaryToggle) {
        ui.autoSummaryToggle.addEventListener('change', () => {
            const settingsRef = ensureSettings();
            settingsRef.autoGenerateSummaryWhenMissing = Boolean(ui.autoSummaryToggle.checked);
            getContext().extensionSettings[MODULE_NAME] = settingsRef;
            saveSettings();
            renderContextStats();
            scheduleBackgroundMaintenance();
        });
    }

    ui.openPanelButton?.addEventListener('click', () => {
        setPanelOpen(true);
    });
}

function mountPanel() {
    document.querySelectorAll('#idic-companion-root').forEach((node) => node.remove());

    const host = document.createElement('div');
    host.id = 'idic-companion-root';
    const root = typeof host.attachShadow === 'function'
        ? host.attachShadow({ mode: 'open' })
        : host;

    root.innerHTML = `
        <style>${getCompanionPanelCss()}</style>
        <button id="idic-companion-launcher" type="button" aria-label="打开陪读窗">
            <span id="idic-companion-launcher-text" class="idic-companion__launcher-text">陪</span>
        </button>
        <div id="idic-companion-panel" class="hidden">
            <div id="idic-companion-header" class="idic-companion__header">
                <div id="idic-companion-avatar" class="idic-companion__avatar">陪</div>
                <div class="idic-companion__title">
                    <strong id="idic-companion-chat-title">陪读</strong>
                    <span class="idic-companion__subtitle" id="idic-companion-subtitle">未选角色</span>
                </div>
                <button id="idic-companion-close" class="idic-companion__icon-btn" type="button" aria-label="收起">－</button>
            </div>
            <div class="idic-companion__rolebar">
                <select id="idic-companion-role-select">
                    <option value="">选择角色</option>
                </select>
                <button id="idic-companion-refresh-roles" class="idic-companion__mini-btn" type="button">刷新</button>
                <button id="idic-companion-open-sync-sheet" class="idic-companion__mini-btn accent" type="button">同步</button>
            </div>
            <div id="idic-companion-selectbar" class="idic-companion__selectbar hidden">
                <span id="idic-companion-select-count" class="idic-companion__select-count">已选 0 条</span>
                <div class="idic-companion__select-actions">
                    <button id="idic-companion-select-delete" class="idic-companion__mini-btn danger" type="button">删除</button>
                    <button id="idic-companion-select-cancel" class="idic-companion__mini-btn" type="button">取消</button>
                </div>
            </div>
            <div class="idic-companion__body">
                <div id="idic-companion-scroll" class="idic-companion__scroll">
                    <div id="idic-companion-transcript" class="idic-companion__transcript">
                        <div class="idic-companion__empty">先选角色</div>
                    </div>
                </div>

                <div class="idic-companion__composer">
                    <div class="idic-companion__quick-actions">
                        <button id="idic-companion-regenerate" class="idic-companion__mini-btn" type="button">重写</button>
                        <button id="idic-companion-continue" class="idic-companion__mini-btn" type="button">续写</button>
                        <span id="idic-companion-footer-status" class="idic-companion__status">待命</span>
                    </div>
                    <div class="idic-companion__composer-row">
                        <textarea id="idic-companion-input" placeholder="聊聊这段剧情"></textarea>
                        <button id="idic-companion-send" class="idic-companion__send-btn" type="button">发送</button>
                    </div>
                </div>

                <div id="idic-companion-sync-sheet" class="idic-companion__sheet hidden">
                    <div id="idic-companion-sync-sheet-mask" class="idic-companion__sheet-mask"></div>
                    <div class="idic-companion__sheet-card">
                        <div class="idic-companion__sheet-header">
                            <strong>本楼同步</strong>
                            <button id="idic-companion-close-sync-sheet" class="idic-companion__mini-btn" type="button">完成</button>
                        </div>
                        <div id="idic-companion-context-chips" class="idic-companion__chips"></div>
                        <div id="idic-companion-modules" class="idic-companion__modules">
                            <div class="idic-companion__empty">暂无内容</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(host);

    const getPanelElement = (id) => (
        typeof root.getElementById === 'function'
            ? root.getElementById(id)
            : root.querySelector(`#${id}`)
    );

    ui.rootHost = host;
    ui.rootNode = root;
    ui.launcher = getPanelElement('idic-companion-launcher');
    ui.launcherText = getPanelElement('idic-companion-launcher-text');
    ui.panel = getPanelElement('idic-companion-panel');
    ui.avatar = getPanelElement('idic-companion-avatar');
    ui.header = getPanelElement('idic-companion-header');
    ui.chatTitle = getPanelElement('idic-companion-chat-title');
    ui.subtitle = getPanelElement('idic-companion-subtitle');
    ui.footerStatus = getPanelElement('idic-companion-footer-status');
    ui.selectBar = getPanelElement('idic-companion-selectbar');
    ui.selectCount = getPanelElement('idic-companion-select-count');
    ui.selectDeleteButton = getPanelElement('idic-companion-select-delete');
    ui.selectCancelButton = getPanelElement('idic-companion-select-cancel');
    ui.closeButton = getPanelElement('idic-companion-close');
    ui.contextChips = getPanelElement('idic-companion-context-chips');
    ui.modulesRoot = getPanelElement('idic-companion-modules');
    ui.scrollRoot = getPanelElement('idic-companion-scroll');
    ui.transcriptRoot = getPanelElement('idic-companion-transcript');
    ui.input = getPanelElement('idic-companion-input');
    ui.sendButton = getPanelElement('idic-companion-send');
    ui.refreshRolesButton = getPanelElement('idic-companion-refresh-roles');
    ui.roleSelect = getPanelElement('idic-companion-role-select');
    ui.regenerateButton = getPanelElement('idic-companion-regenerate');
    ui.continueButton = getPanelElement('idic-companion-continue');
    ui.openSyncSheetButton = getPanelElement('idic-companion-open-sync-sheet');
    ui.syncSheet = getPanelElement('idic-companion-sync-sheet');
    ui.syncSheetMask = getPanelElement('idic-companion-sync-sheet-mask');
    ui.closeSyncSheetButton = getPanelElement('idic-companion-close-sync-sheet');

    applyFloatingLayout();
    if (ui.panel) setImportantStyles(ui.panel, { display: 'none', visibility: 'hidden', opacity: '0' });
    if (ui.launcher) setImportantStyles(ui.launcher, { display: 'flex', visibility: 'visible', opacity: '1' });

    bindFloatingDrag();
    ui.closeButton?.addEventListener('click', () => setPanelOpen(false));
    ui.closeButton?.addEventListener('pointerdown', (event) => event.stopPropagation());
    ui.refreshRolesButton?.addEventListener('click', () => {
        void fetchRoleOptions({ force: true, announce: true });
    });
    ui.roleSelect?.addEventListener('change', async () => {
        renderBinding();
        if (toTrimmedString(ui.roleSelect?.value)) {
            await saveBindingFromSelection({ silent: true });
            setStatus('角色已切换', 'success');
        }
    });
    ui.openSyncSheetButton?.addEventListener('click', () => setSyncSheetOpen(true));
    ui.closeSyncSheetButton?.addEventListener('click', () => setSyncSheetOpen(false));
    ui.syncSheetMask?.addEventListener('click', () => setSyncSheetOpen(false));
    ui.selectDeleteButton?.addEventListener('click', () => {
        void deleteSelectedTranscriptEntries();
    });
    ui.selectCancelButton?.addEventListener('click', () => {
        exitTranscriptSelectionMode();
    });
    ui.sendButton?.addEventListener('click', () => {
        void sendCompanionMessage();
    });
    ui.regenerateButton?.addEventListener('click', () => {
        void regenerateCompanionReply();
    });
    ui.continueButton?.addEventListener('click', () => {
        void continueCompanionReply();
    });
    ui.input?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) return;
    });
    window.addEventListener('resize', applyFloatingLayout);
}

function getCompanionPanelCss() {
    return `
        :host {
            all: initial;
            position: fixed !important;
            inset: 0 !important;
            z-index: 2147483644 !important;
            pointer-events: none !important;
            overflow: visible !important;
        }
        *, *::before, *::after {
            box-sizing: border-box;
            letter-spacing: 0;
            font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        #idic-companion-launcher {
            position: fixed;
            right: 10px;
            bottom: 78px;
            z-index: 2147483647;
            width: 52px;
            height: 52px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 0;
            border-radius: 999px;
            background: #2f7ff2;
            color: #fff;
            box-shadow: 0 10px 26px rgba(47, 127, 242, 0.38);
            pointer-events: auto;
            cursor: pointer;
            font-size: 18px;
            font-weight: 700;
            line-height: 1;
            touch-action: none;
        }
        #idic-companion-launcher.active::after {
            content: "";
            position: absolute;
            top: 6px;
            right: 6px;
            width: 10px;
            height: 10px;
            border-radius: 999px;
            background: #22c55e;
            border: 2px solid #fff;
        }
        #idic-companion-panel {
            position: fixed;
            left: 8px;
            right: 8px;
            top: 76px;
            bottom: 10px;
            z-index: 2147483646;
            min-height: 320px;
            display: none;
            flex-direction: column;
            overflow: hidden;
            border-radius: 18px;
            background: #eef2f7;
            color: #1f2937;
            border: 1px solid rgba(85, 102, 140, 0.22);
            box-shadow: 0 18px 50px rgba(15, 23, 42, 0.32);
            pointer-events: auto;
            transform: none;
        }
        .hidden {
            display: none !important;
        }
        .idic-companion__header {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            gap: 10px;
            min-height: 56px;
            padding: 10px 12px 8px;
            background: linear-gradient(180deg, #dcecff 0%, #f7fbff 100%);
            border-bottom: 1px solid rgba(85, 102, 140, 0.12);
            cursor: move;
            touch-action: none;
        }
        .idic-companion__avatar {
            width: 34px;
            height: 34px;
            flex: 0 0 34px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            background: #2f7ff2;
            color: #fff;
            font-size: 15px;
            font-weight: 700;
        }
        .idic-companion__title {
            min-width: 0;
            flex: 1 1 auto;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .idic-companion__title strong {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: #111827;
            font-size: 16px;
            font-weight: 700;
            line-height: 1.2;
        }
        .idic-companion__subtitle {
            color: #6b7280;
            font-size: 11px;
            line-height: 1.2;
        }
        .idic-companion__icon-btn,
        .idic-companion__mini-btn,
        .idic-companion__send-btn {
            border: 0;
            cursor: pointer;
            font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .idic-companion__icon-btn {
            width: 32px;
            height: 32px;
            flex: 0 0 32px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.86);
            color: #2f5ea8;
            font-size: 18px;
            line-height: 1;
        }
        .idic-companion__rolebar {
            flex: 0 0 auto;
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto auto;
            gap: 6px;
            align-items: center;
            padding: 8px 10px 10px;
            background: #fff;
            border-bottom: 1px solid rgba(85, 102, 140, 0.08);
        }
        .idic-companion__rolebar select {
            min-width: 0;
            width: 100%;
            height: 38px;
            border-radius: 14px;
            border: 1px solid rgba(99, 115, 145, 0.18);
            background: #f7f8fc;
            color: #111827;
            padding: 0 10px;
            font-size: 14px;
        }
        .idic-companion__mini-btn {
            min-width: 0;
            height: 38px;
            padding: 0 10px;
            border-radius: 14px;
            background: #edf3ff;
            color: #355da7;
            font-size: 13px;
            font-weight: 600;
            white-space: nowrap;
        }
        .idic-companion__mini-btn.accent {
            background: #dfeeff;
            color: #2064d5;
        }
        .idic-companion__mini-btn:disabled,
        .idic-companion__send-btn:disabled,
        .idic-companion__icon-btn:disabled {
            opacity: 0.48;
            cursor: not-allowed;
        }
        .idic-companion__mini-btn.danger {
            background: #ffe8e8;
            color: #d64545;
        }
        .idic-companion__selectbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 8px 10px;
            background: #fff7f2;
            border-bottom: 1px solid rgba(230, 120, 72, 0.14);
        }
        .idic-companion__select-count {
            color: #7b4b32;
            font-size: 12px;
            font-weight: 600;
        }
        .idic-companion__select-actions {
            display: flex;
            gap: 6px;
            align-items: center;
        }
        .idic-companion__body {
            position: relative;
            flex: 1 1 auto;
            min-height: 0;
            display: flex;
            flex-direction: column;
        }
        .idic-companion__scroll {
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            padding: 10px 8px 6px;
            background: linear-gradient(180deg, #ecf3ff 0%, #f4f7fc 24%, #eef2f7 100%);
        }
        .idic-companion__transcript {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .idic-companion__load-more {
            align-self: center;
            height: 32px;
            padding: 0 14px;
            border-radius: 999px;
            border: 0;
            background: rgba(255, 255, 255, 0.92);
            color: #5570a4;
            font-size: 12px;
            font-weight: 600;
            box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
        }
        .idic-companion__bubble {
            max-width: 90%;
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        .idic-companion__bubble.selectable {
            position: relative;
            cursor: pointer;
        }
        .idic-companion__bubble.selectable::after {
            content: "";
            position: absolute;
            inset: -4px;
            border-radius: 20px;
            border: 2px solid transparent;
            pointer-events: none;
            transition: border-color 0.15s ease, background 0.15s ease;
        }
        .idic-companion__bubble.selectable.selected::after {
            border-color: #2f7ff2;
            background: rgba(47, 127, 242, 0.08);
        }
        .idic-companion__bubble-check {
            position: absolute;
            top: -2px;
            right: -2px;
            width: 20px;
            height: 20px;
            border-radius: 999px;
            background: #fff;
            color: #9aa4b7;
            font-size: 11px;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 10px rgba(15, 23, 42, 0.12);
            pointer-events: none;
        }
        .idic-companion__bubble.selectable.selected .idic-companion__bubble-check {
            background: #2f7ff2;
            color: #fff;
        }
        .idic-companion__bubble.user {
            align-self: flex-end;
            align-items: flex-end;
        }
        .idic-companion__bubble.assistant {
            align-self: flex-start;
            align-items: flex-start;
        }
        .idic-companion__bubble.system {
            max-width: 100%;
            align-self: center;
            align-items: center;
        }
        .idic-companion__bubble-box {
            padding: 10px 12px;
            border-radius: 16px;
            white-space: pre-wrap;
            word-break: break-word;
            line-height: 1.55;
            font-size: 14px;
            box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
        }
        .idic-companion__bubble.user .idic-companion__bubble-box {
            background: #b9eb7d;
            color: #1f2937;
            border-bottom-right-radius: 6px;
        }
        .idic-companion__bubble.assistant .idic-companion__bubble-box {
            background: #fff;
            color: #111827;
            border-bottom-left-radius: 6px;
        }
        .idic-companion__bubble.system .idic-companion__bubble-box {
            background: rgba(65, 94, 148, 0.08);
            color: #4b5563;
            font-size: 12px;
            border-radius: 999px;
            box-shadow: none;
        }
        .idic-companion__bubble-meta {
            color: #8a94a7;
            font-size: 10px;
            padding: 0 4px;
        }
        .idic-companion__composer {
            flex: 0 0 auto;
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 8px 8px calc(10px + env(safe-area-inset-bottom));
            background: #fff;
            border-top: 1px solid rgba(85, 102, 140, 0.08);
        }
        .idic-companion__quick-actions {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
        }
        .idic-companion__quick-actions .idic-companion__status {
            min-width: 0;
            margin-left: auto;
            overflow: hidden;
            text-align: right;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: #7a8396;
            font-size: 12px;
        }
        .idic-companion__composer-row {
            display: flex;
            align-items: flex-end;
            gap: 8px;
        }
        .idic-companion__composer textarea {
            flex: 1 1 auto;
            min-height: 42px;
            max-height: 110px;
            resize: none;
            border: 1px solid rgba(99, 115, 145, 0.14);
            border-radius: 18px;
            background: #f5f7fc;
            color: #111827;
            padding: 10px 12px;
            font-size: 16px;
            line-height: 1.45;
        }
        .idic-companion__send-btn {
            flex: 0 0 auto;
            min-width: 60px;
            height: 42px;
            padding: 0 14px;
            border-radius: 18px;
            background: #2f7ff2;
            color: #fff;
            font-size: 15px;
            font-weight: 700;
        }
        .idic-companion__empty {
            padding: 24px 14px;
            text-align: center;
            color: #8a94a7;
            font-size: 14px;
            line-height: 1.6;
        }
        .idic-companion__sheet {
            position: absolute;
            inset: 0;
            z-index: 3;
        }
        .idic-companion__sheet-mask {
            position: absolute;
            inset: 0;
            background: rgba(15, 23, 42, 0.28);
        }
        .idic-companion__sheet-card {
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            max-height: 76%;
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 12px 12px calc(14px + env(safe-area-inset-bottom));
            border-radius: 18px 18px 0 0;
            background: #fff;
            box-shadow: 0 -8px 28px rgba(15, 23, 42, 0.14);
        }
        .idic-companion__sheet-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
        }
        .idic-companion__sheet-header strong {
            color: #111827;
            font-size: 16px;
        }
        .idic-companion__chips {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .idic-companion__chip {
            display: inline-flex;
            align-items: center;
            min-height: 28px;
            padding: 0 10px;
            border-radius: 999px;
            background: #f1f4fb;
            color: #55627d;
            font-size: 12px;
        }
        .idic-companion__chip.fast {
            background: #fff2df;
            color: #b96c0a;
        }
        .idic-companion__chip.long {
            background: #e9f6ea;
            color: #2f7a40;
        }
        .idic-companion__modules {
            min-height: 0;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .idic-companion__module {
            padding: 12px;
            border-radius: 14px;
            background: #f7f8fc;
            border: 1px solid rgba(99, 115, 145, 0.1);
        }
        .idic-companion__module-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 8px;
        }
        .idic-companion__module-title {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
            color: #111827;
            font-size: 14px;
            font-weight: 600;
        }
        .idic-companion__module-tag {
            color: #8a94a7;
            font-size: 11px;
            font-weight: 500;
        }
        .idic-companion__module-modes {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 8px;
        }
        .idic-companion__module-mode {
            height: 30px;
            padding: 0 10px;
            border-radius: 999px;
            border: 1px solid rgba(99, 115, 145, 0.16);
            background: #fff;
            color: #5c6d88;
            font-size: 12px;
            font-weight: 600;
        }
        .idic-companion__module-mode.active[data-mode="content"] {
            background: #e8f2ff;
            color: #2064d5;
            border-color: rgba(32, 100, 213, 0.2);
        }
        .idic-companion__module-mode.active[data-mode="summary"] {
            background: #e9f6ea;
            color: #2f7a40;
            border-color: rgba(47, 122, 64, 0.18);
        }
        .idic-companion__module-mode.active[data-mode="fast"] {
            background: #fff2df;
            color: #b96c0a;
            border-color: rgba(185, 108, 10, 0.18);
        }
        .idic-companion__module-mode.active[data-mode="ignore"] {
            background: #f1f3f6;
            color: #68758a;
            border-color: rgba(104, 117, 138, 0.14);
        }
        .idic-companion__module-preview {
            margin: 0;
            color: #4b5563;
            white-space: pre-wrap;
            word-break: break-word;
            font: 13px/1.5 "PingFang SC", "Microsoft YaHei", sans-serif;
            max-height: 240px;
            overflow-y: auto;
            padding: 10px;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.78);
        }
        @media (min-width: 901px) {
            #idic-companion-launcher {
                right: 12px;
                bottom: 86px;
            }
            #idic-companion-panel {
                left: auto;
                right: 12px;
                top: auto;
                bottom: 12px;
                width: 388px;
                height: min(70vh, 720px);
                max-width: calc(100vw - 24px);
            }
        }
    `;
}

function bindContextEvents() {
    const context = getContext();
    const events = context.eventTypes || {};
    const source = context.eventSource;
    if (!source || typeof source.on !== 'function') return;

    const resync = async (options = {}) => {
        await loadCurrentChatState();
        await syncStateFromChat(options);
        renderAll();
        scheduleBackgroundMaintenance();
    };

    const messageHandler = async () => {
        await syncStateFromChat({ captureLatestStatus: true, forceLatestRescan: false });
        renderAll();
        scheduleBackgroundMaintenance();
    };

    if (events.CHAT_CHANGED) source.on(events.CHAT_CHANGED, () => void resync({ captureLatestStatus: false, forceLatestRescan: false }));
    if (events.MESSAGE_RECEIVED) source.on(events.MESSAGE_RECEIVED, () => void messageHandler());
    if (events.MESSAGE_EDITED) source.on(events.MESSAGE_EDITED, () => void resync({ captureLatestStatus: false, forceLatestRescan: false }));
    if (events.MESSAGE_DELETED) source.on(events.MESSAGE_DELETED, () => void resync({ captureLatestStatus: false, forceLatestRescan: false }));
    if (events.MESSAGE_SWIPED) source.on(events.MESSAGE_SWIPED, () => void resync({ captureLatestStatus: false, forceLatestRescan: false }));
}

function bindFloatingDrag() {
    bindDragHandle(ui.launcher, 'launcher', () => setPanelOpen(true));
    bindDragHandle(ui.header, 'panel', null);
}

function bindDragHandle(handle, targetName, clickHandler) {
    if (!handle) return;
    handle.addEventListener('pointerdown', (event) => {
        if (event.button != null && event.button !== 0) return;
        if (targetName === 'panel' && event.target?.closest?.('button, select, input, textarea')) return;
        const target = targetName === 'launcher' ? ui.launcher : ui.panel;
        if (!target) return;
        const rect = target.getBoundingClientRect();
        runtime.dragState = {
            targetName,
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startX: rect.left,
            startY: rect.top,
            width: rect.width,
            height: rect.height,
            moved: false,
        };
        try {
            handle.setPointerCapture?.(event.pointerId);
        } catch (_) {
            // Some mobile WebViews do not support pointer capture inside shadow DOM.
        }
        event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
        const state = runtime.dragState;
        if (!state || state.targetName !== targetName || state.pointerId !== event.pointerId) return;
        const dx = event.clientX - state.startClientX;
        const dy = event.clientY - state.startClientY;
        if (Math.abs(dx) + Math.abs(dy) > 6) state.moved = true;
        const point = clampFloatingPoint({
            x: state.startX + dx,
            y: state.startY + dy,
        }, state.width, state.height);
        runtime.floatingPosition[targetName] = point;
        applyFloatingLayout();
        event.preventDefault();
    });

    const finish = (event) => {
        const state = runtime.dragState;
        if (!state || state.targetName !== targetName || state.pointerId !== event.pointerId) return;
        runtime.dragState = null;
        saveFloatingPosition();
        if (!state.moved && typeof clickHandler === 'function') clickHandler();
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
}

function setPanelOpen(open) {
    runtime.panelOpen = Boolean(open);
    applyFloatingLayout();
    if (ui.panel) {
        ui.panel.classList.toggle('hidden', false);
        setImportantStyles(ui.panel, {
            display: runtime.panelOpen ? 'flex' : 'none',
            opacity: runtime.panelOpen ? '1' : '0',
            visibility: runtime.panelOpen ? 'visible' : 'hidden',
            pointerEvents: runtime.panelOpen ? 'auto' : 'none',
            transform: 'none',
        });
    }
    if (ui.launcher) {
        ui.launcher.classList.toggle('hidden', false);
        setImportantStyles(ui.launcher, {
            display: runtime.panelOpen ? 'none' : 'flex',
            opacity: runtime.panelOpen ? '0' : '1',
            visibility: runtime.panelOpen ? 'hidden' : 'visible',
            pointerEvents: runtime.panelOpen ? 'none' : 'auto',
            transform: 'none',
        });
    }
    if (!runtime.panelOpen) {
        setSyncSheetOpen(false);
    } else if (ui.input && !ui.input.disabled) {
        window.requestAnimationFrame(() => {
            ui.input?.focus();
            if (ui.scrollRoot) ui.scrollRoot.scrollTop = ui.scrollRoot.scrollHeight;
        });
    }
}

function setSyncSheetOpen(open) {
    if (!ui.syncSheet) return;
    ui.syncSheet.classList.toggle('hidden', !open);
}

function getSelectedRoleOption() {
    const selectedId = toTrimmedString(ui.roleSelect?.value);
    if (!selectedId) return null;
    return runtime.roleOptions.find((item) => item.charId === selectedId) || null;
}

function applyFloatingLayout() {
    const root = ui.rootHost || document.getElementById('idic-companion-root');
    const isMobile = window.matchMedia ? window.matchMedia('(max-width: 900px)').matches : window.innerWidth <= 900;
    const viewport = getViewportSize();
    const launcherSize = isMobile ? 50 : 52;
    const launcherDefault = {
        x: viewport.width - launcherSize - (isMobile ? 10 : 12),
        y: viewport.height - launcherSize - (isMobile ? 78 : 86),
    };
    const launcherPoint = clampFloatingPoint(runtime.floatingPosition.launcher || launcherDefault, launcherSize, launcherSize);
    const panelSize = getPanelSize(isMobile, viewport);
    const panelDefault = isMobile
        ? { x: 8, y: 76 }
        : { x: viewport.width - panelSize.width - 12, y: viewport.height - panelSize.height - 12 };
    const panelPoint = clampFloatingPoint(runtime.floatingPosition.panel || panelDefault, panelSize.width, panelSize.height);

    if (root) {
        setImportantStyles(root, {
            position: 'fixed',
            inset: '0',
            zIndex: '2147483644',
            pointerEvents: 'none',
            overflow: 'visible',
            display: 'block',
            opacity: '1',
            visibility: 'visible',
            transform: 'none',
        });
    }

    if (ui.launcher) {
        setImportantStyles(ui.launcher, {
            position: 'fixed',
            left: `${launcherPoint.x}px`,
            top: `${launcherPoint.y}px`,
            right: 'auto',
            bottom: 'auto',
            width: `${launcherSize}px`,
            height: `${launcherSize}px`,
            display: runtime.panelOpen ? 'none' : 'flex',
            pointerEvents: 'auto',
            zIndex: '2147483647',
            opacity: runtime.panelOpen ? '0' : '1',
            visibility: runtime.panelOpen ? 'hidden' : 'visible',
            transform: 'none',
        });
    }

    if (ui.panel) {
        setImportantStyles(ui.panel, {
            position: 'fixed',
            left: `${panelPoint.x}px`,
            top: `${panelPoint.y}px`,
            right: 'auto',
            bottom: 'auto',
            width: `${panelSize.width}px`,
            height: `${panelSize.height}px`,
            minHeight: '320px',
            maxWidth: 'none',
            zIndex: '2147483646',
            display: runtime.panelOpen ? 'flex' : 'none',
            flexDirection: 'column',
            opacity: runtime.panelOpen ? '1' : '0',
            visibility: runtime.panelOpen ? 'visible' : 'hidden',
            pointerEvents: runtime.panelOpen ? 'auto' : 'none',
            transform: 'none',
            overflow: 'hidden',
            boxSizing: 'border-box',
            background: '#eef2f7',
            color: '#1f2937',
            border: '1px solid rgba(85, 102, 140, 0.22)',
            boxShadow: '0 18px 50px rgba(15, 23, 42, 0.32)',
        });
    }
}

function getViewportSize() {
    return {
        width: Math.max(320, window.innerWidth || document.documentElement?.clientWidth || 320),
        height: Math.max(420, window.innerHeight || document.documentElement?.clientHeight || 420),
    };
}

function getPanelSize(isMobile, viewport = getViewportSize()) {
    if (isMobile) {
        return {
            width: Math.max(300, viewport.width - 16),
            height: Math.max(320, Math.min(viewport.height - 86, Math.round(viewport.height * 0.58))),
        };
    }
    return {
        width: Math.min(388, viewport.width - 24),
        height: Math.max(360, Math.min(720, Math.round(viewport.height * 0.7))),
    };
}

function clampFloatingPoint(point, width, height) {
    const viewport = getViewportSize();
    const safeWidth = Math.max(40, Number(width) || 40);
    const safeHeight = Math.max(40, Number(height) || 40);
    const maxX = Math.max(4, viewport.width - safeWidth - 4);
    const maxY = Math.max(4, viewport.height - safeHeight - 4);
    return {
        x: clampNumber(point?.x, 4, maxX, 4),
        y: clampNumber(point?.y, 4, maxY, 76),
    };
}

function loadFloatingPosition() {
    try {
        const parsed = tryParseJson(localStorage.getItem(FLOATING_POSITION_STORAGE_KEY) || '');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        return {};
    }
}

function saveFloatingPosition() {
    try {
        localStorage.setItem(FLOATING_POSITION_STORAGE_KEY, JSON.stringify(runtime.floatingPosition || {}));
    } catch (_) {
        // Local storage can be unavailable in some embedded browsers.
    }
}

function setImportantStyles(element, styles) {
    if (!element || !styles) return;
    Object.entries(styles).forEach(([key, value]) => {
        element.style.setProperty(toKebabCase(key), String(value), 'important');
    });
}

function toKebabCase(value) {
    return String(value).replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function getBadgeText(name) {
    const text = toTrimmedString(name);
    return text ? Array.from(text)[0] : '陪';
}

function getActiveRoleName() {
    const binding = ensureChatMeta()?.binding || createDefaultBinding();
    const selectedRole = getSelectedRoleOption();
    return selectedRole?.displayName || selectedRole?.charName || binding.displayName || binding.charName || '';
}

async function fetchRoleOptions(options = {}) {
    if (runtime.roleFetchInFlight) return;
    runtime.roleFetchInFlight = true;
    const announce = options.announce !== false;
    if (announce) setStatus('正在读取角色...', 'info');
    try {
        const response = await callBridge('list_roles', {});
        runtime.roleOptions = Array.isArray(response.roles) ? response.roles : [];
        renderBinding();
        if (announce) {
            setStatus(runtime.roleOptions.length ? '角色列表已刷新' : '还没有同步到角色', runtime.roleOptions.length ? 'success' : 'info');
        }
    } catch (error) {
        if (announce) setStatus(`角色读取失败：${error.message}`, 'error');
        throw error;
    } finally {
        runtime.roleFetchInFlight = false;
    }
}

async function saveBindingFromSelection(options = {}) {
    const meta = ensureChatMeta();
    if (!meta) return;
    const role = getSelectedRoleOption();
    if (!role || !role.snapshot) {
        if (!options.silent) notify('请先选角色', 'warning');
        return;
    }

    const snapshot = role.snapshot || {};
    meta.binding = Object.assign({}, createDefaultBinding(), meta.binding, {
        selectedRoleId: toTrimmedString(role.charId),
        displayName: toTrimmedString(role.displayName || snapshot.displayName || role.charName),
        userId: toTrimmedString(role.ownerUserId || snapshot.ownerUserId || snapshot.userId),
        charId: toTrimmedString(role.charId || snapshot.charId),
        charName: toTrimmedString(role.charName || snapshot.charName || role.displayName),
        charPersona: toTrimmedString(snapshot.charPersona),
        userName: toTrimmedString(snapshot.userName),
        userPersona: toTrimmedString(snapshot.userPersona),
        relationshipHint: toTrimmedString(snapshot.relationshipHint),
        systemPrompt: toTrimmedString(snapshot.systemPrompt),
        promptProfile: toTrimmedString(snapshot.promptProfile),
        hippocampusEnabled: Boolean(snapshot.hippocampusEnabled),
        snapshotUpdatedAt: toTrimmedString(role.updatedAt || snapshot.updatedAt),
    });
    if (!meta.binding.sessionId) meta.binding.sessionId = createId();
    getContext().chatMetadata[MODULE_NAME] = meta;
    await saveChatMeta();
    renderBinding();
    if (!options.silent) {
        notify(`已切换到 ${meta.binding.displayName || meta.binding.charName}`, 'success');
    }
}

function renderBinding() {
    const meta = ensureChatMeta();
    const binding = meta ? Object.assign(createDefaultBinding(), meta.binding) : createDefaultBinding();

    if (ui.roleSelect) {
        const currentValue = toTrimmedString(ui.roleSelect.value) || binding.selectedRoleId || binding.charId;
        const options = ['<option value="">选择角色</option>']
            .concat(runtime.roleOptions.map((role) => {
                const label = role.displayName && role.displayName !== role.charName
                    ? `${role.displayName} (${role.charName || role.charId})`
                    : (role.charName || role.charId);
                return `<option value="${escapeHtml(role.charId)}">${escapeHtml(label)}</option>`;
            }));
        ui.roleSelect.innerHTML = options.join('');
        if (currentValue) ui.roleSelect.value = currentValue;
    }

    const selectedRole = getSelectedRoleOption();
    const effective = selectedRole
        ? Object.assign({}, binding, selectedRole.snapshot || {}, {
            displayName: selectedRole.displayName || selectedRole.snapshot?.displayName || binding.displayName,
            charId: selectedRole.charId || selectedRole.snapshot?.charId || binding.charId,
            charName: selectedRole.charName || selectedRole.snapshot?.charName || binding.charName,
            snapshotUpdatedAt: selectedRole.updatedAt || selectedRole.snapshot?.updatedAt || binding.snapshotUpdatedAt,
            hippocampusEnabled: selectedRole.snapshot?.hippocampusEnabled !== undefined
                ? Boolean(selectedRole.snapshot.hippocampusEnabled)
                : Boolean(binding.hippocampusEnabled),
        })
        : binding;

    const roleName = effective.displayName || effective.charName || '';
    const badgeText = getBadgeText(roleName);
    if (ui.chatTitle) ui.chatTitle.textContent = roleName || '陪读';
    if (ui.avatar) ui.avatar.textContent = badgeText;
    if (ui.launcherText) ui.launcherText.textContent = badgeText;
    if (ui.launcher) {
        ui.launcher.classList.toggle('active', Boolean(roleName));
        ui.launcher.setAttribute('aria-label', roleName ? `打开和${roleName}的陪读窗` : '打开陪读窗');
    }
    if (ui.subtitle) {
        ui.subtitle.textContent = roleName
            ? (effective.hippocampusEnabled ? '海马体在线' : '普通模式')
            : '未选角色';
    }
    if (ui.input) {
        ui.input.placeholder = roleName ? `和${roleName}聊聊这段剧情` : '聊聊这段剧情';
        ui.input.disabled = !roleName || runtime.sendInFlight;
    }
    renderComposerState(roleName);
    if (ui.openSyncSheetButton) ui.openSyncSheetButton.disabled = !runtime.latestTurnId;
}

function renderComposerState(roleName = '') {
    const transcript = Array.isArray(runtime.chatState?.transcript) ? runtime.chatState.transcript : [];
    const hasUserTurn = transcript.some((item) => item.role === 'user' && !item.pending);
    const hasAssistantTurn = transcript.some((item) => item.role === 'assistant' && !item.pending && item.text);
    const baseDisabled = !roleName || runtime.sendInFlight;
    if (ui.sendButton) ui.sendButton.disabled = baseDisabled;
    if (ui.regenerateButton) ui.regenerateButton.disabled = baseDisabled || !hasUserTurn;
    if (ui.continueButton) ui.continueButton.disabled = baseDisabled || !hasAssistantTurn;
}

async function syncStateFromChat(options = {}) {
    if (!runtime.chatState) runtime.chatState = createDefaultChatState();
    const context = getContextSafe();
    if (!context || !Array.isArray(context.chat)) return;

    const captureLatestStatus = Boolean(options.captureLatestStatus);
    const forceLatestRescan = Boolean(options.forceLatestRescan);
    const candidates = buildTurnCandidates(context.chat);
    const newTurns = {};
    const newOrder = [];
    let stateChanged = false;
    let rollupInvalidated = false;
    let latestTurnId = '';

    candidates.forEach((candidate, index) => {
        const isLatest = index === candidates.length - 1;
        const existing = runtime.chatState.turns[candidate.turnId];
        if (existing && existing.sourceHash !== candidate.sourceHash) {
            rollupInvalidated = true;
        }
        const persistentStatusText = isLatest && captureLatestStatus
            ? readStatusBarText()
            : readSavedStatusText(existing);
        const nextEntry = materializeTurnEntry(existing, candidate, {
            statusText: persistentStatusText,
            forceRescan: isLatest && forceLatestRescan,
            isLatest,
        });
        if (!existing || hashText(JSON.stringify(existing)) !== hashText(JSON.stringify(nextEntry))) {
            stateChanged = true;
        }
        newTurns[candidate.turnId] = nextEntry;
        newOrder.push(candidate.turnId);
        latestTurnId = candidate.turnId;
    });

    const oldOrder = Array.isArray(runtime.chatState.turnOrder) ? runtime.chatState.turnOrder.slice() : [];
    const appendOnly = oldOrder.every((turnId, index) => newOrder[index] === turnId) && newOrder.length >= oldOrder.length;
    if ((!appendOnly && oldOrder.length > 0) || rollupInvalidated) {
        stateChanged = true;
        runtime.chatState.stageSummaries = [];
        Object.values(newTurns).forEach((turn) => {
            turn.stageId = '';
        });
    }

    runtime.chatState.turns = newTurns;
    runtime.chatState.turnOrder = newOrder;
    runtime.chatState.chatSignature = hashText(newOrder.map((turnId) => newTurns[turnId]?.sourceHash || turnId).join('|'));
    runtime.latestTurnId = latestTurnId;
    runtime.lastSyncStamp = new Date().toLocaleTimeString();

    if (stateChanged || forceLatestRescan) {
        await persistChatState();
    }
}

function buildTurnCandidates(chat) {
    const turns = [];
    let pendingUser = null;
    chat.forEach((message, index) => {
        if (!message || message.is_system) return;
        if (message.is_user) {
            pendingUser = { message, index };
            return;
        }
        if (!pendingUser) return;
        const userText = getMessageText(pendingUser.message);
        const aiText = getMessageText(message);
        if (!userText && !aiText) {
            pendingUser = null;
            return;
        }
        const userKey = resolveMessageKey(pendingUser.message, pendingUser.index, 'user');
        const aiKey = resolveMessageKey(message, index, 'assistant');
        const turnId = `${userKey}__${aiKey}`;
        turns.push({
            turnId,
            userKey,
            aiKey,
            userIndex: pendingUser.index,
            aiIndex: index,
            userText,
            aiText,
            aiName: toTrimmedString(message.name) || '角色',
            sourceHash: hashText(`${userKey}|${aiKey}|${userText}|${aiText}`),
        });
        pendingUser = null;
    });
    return turns;
}

function materializeTurnEntry(existing, candidate, options = {}) {
    const previous = existing ? normalizeTurnEntry(existing, candidate.turnId) : null;
    const shouldRescan = !previous
        || previous.sourceHash !== candidate.sourceHash
        || Boolean(options.forceRescan);
    const statusText = toTrimmedString(options.statusText || '');
    const scannedModules = shouldRescan
        ? scanAiModules(candidate.aiText, { statusText })
        : (Array.isArray(previous.modules) ? previous.modules.slice() : []);
    const modules = mergeModuleSelections(previous, scannedModules);
    const persistentDigest = computePersistentDigest(candidate.userText, modules);
    const nextEntry = {
        turnId: candidate.turnId,
        sourceHash: candidate.sourceHash,
        userKey: candidate.userKey,
        aiKey: candidate.aiKey,
        userText: candidate.userText,
        aiText: candidate.aiText,
        aiName: candidate.aiName,
        userIndex: candidate.userIndex,
        aiIndex: candidate.aiIndex,
        createdAt: previous ? previous.createdAt : Date.now(),
        updatedAt: Date.now(),
        modules,
        summary: previous ? previous.summary : '',
        summaryTitle: previous ? previous.summaryTitle : '',
        summaryStatus: previous ? previous.summaryStatus : 'missing',
        summarySourceDigest: persistentDigest,
        summaryOrigin: previous ? previous.summaryOrigin : '',
        stageId: previous ? previous.stageId : '',
    };
    refreshTurnSummaryState(nextEntry, previous);
    return nextEntry;
}

function mergeModuleSelections(previous, modules) {
    const previousMap = new Map();
    if (previous && Array.isArray(previous.modules)) {
        previous.modules.forEach((module) => {
            previousMap.set(buildModuleSelectionKey(module), getModuleSyncMode(module));
        });
    }
    return modules.map((module) => {
        const key = buildModuleSelectionKey(module);
        const preferenceKey = buildModulePreferenceKey(module);
        const storedPreference = runtime.chatState?.modulePreferences?.[preferenceKey];
        const syncMode = previousMap.has(key)
            ? previousMap.get(key)
            : (MODULE_SYNC_MODES.includes(toTrimmedString(storedPreference?.syncMode))
                ? toTrimmedString(storedPreference.syncMode)
                : defaultModuleSyncMode(module));
        return applyModuleSyncMode(module, syncMode);
    });
}

function buildModuleSelectionKey(module) {
    return `${module.sourceType || module.kind}::${module.tagKey || module.label}::${hashText(module.text).slice(0, 12)}`;
}

function buildModulePreferenceKey(module) {
    return `${module.sourceType || module.kind}::${module.tagKey || module.label || 'text'}`;
}

function getModuleSyncMode(module) {
    return normalizeModuleSyncMode(module || {});
}

function applyModuleSyncMode(module, syncMode) {
    const safeMode = MODULE_SYNC_MODES.includes(syncMode) ? syncMode : 'content';
    return Object.assign({}, module, {
        syncMode: safeMode,
        selected: safeMode !== 'ignore',
        persistence: safeMode === 'fast' ? 'fast' : 'long',
    });
}

function defaultModuleSyncMode(module) {
    if (!module) return 'content';
    if (module.sourceType === 'status_bar' || module.sourceType === 'html_fragment') return 'fast';
    return 'content';
}

function getBuiltInSummaryState(turn) {
    if (!turn || !Array.isArray(turn.modules)) return null;
    const summaryModules = turn.modules.filter((module) => module.selected && getModuleSyncMode(module) === 'summary' && module.persistence === 'long' && module.text);
    if (summaryModules.length === 0) return null;
    return {
        title: summaryModules[0].label || '摘要',
        summary: summaryModules.map((module) => module.text).join('\n\n'),
    };
}

function hasSelectedLongModules(turn) {
    return Boolean(turn && Array.isArray(turn.modules) && turn.modules.some((module) => module.selected && module.persistence === 'long'));
}

function refreshTurnSummaryState(turn, previous = null) {
    const builtInSummary = getBuiltInSummaryState(turn);
    if (builtInSummary) {
        turn.summary = builtInSummary.summary;
        turn.summaryTitle = builtInSummary.title;
        turn.summaryStatus = 'ready';
        turn.summaryOrigin = 'builtin';
        turn.stageId = '';
        return;
    }

    if (!hasSelectedLongModules(turn)) {
        turn.summary = '';
        turn.summaryTitle = '';
        turn.summaryStatus = 'empty';
        turn.summaryOrigin = '';
        turn.stageId = '';
        return;
    }

    const hadPersistentChange = !previous || previous.summarySourceDigest !== turn.summarySourceDigest;
    if (previous && previous.summaryOrigin === 'generated' && !hadPersistentChange && previous.summary) {
        turn.summary = previous.summary;
        turn.summaryTitle = previous.summaryTitle || '';
        turn.summaryStatus = previous.summaryStatus || 'ready';
        turn.summaryOrigin = 'generated';
        return;
    }

    turn.summary = '';
    turn.summaryTitle = '';
    turn.summaryStatus = hadPersistentChange ? 'stale' : (previous ? previous.summaryStatus : 'missing');
    turn.summaryOrigin = '';
    turn.stageId = '';
}

function scanAiModules(aiText, options = {}) {
    const source = String(aiText == null ? '' : aiText);
    const modules = [];
    const htmlFromCodeBlocks = [];
    const withoutCode = source.replace(CODE_BLOCK_REGEX, (_, lang, code) => {
        const cleanLang = toTrimmedString(lang).toLowerCase();
        const cleanCode = String(code == null ? '' : code);
        if (looksLikeHtmlBlock(cleanLang, cleanCode)) {
            const visible = extractVisibleTextFromHtml(cleanCode);
            if (visible) htmlFromCodeBlocks.push(visible);
        }
        return ' ';
    });

    htmlFromCodeBlocks.forEach((text, index) => {
        modules.push(createModule(`html_code_${index}`, 'html_scene_text', 'HTML小剧场', text, 'fast'));
    });

    const tagMatches = extractTagBlocks(withoutCode);
    tagMatches.forEach((block, index) => {
        const classification = classifyTagName(block.tagName);
        if (classification.discard) return;
        const visible = cleanupModuleText(block.innerText);
        if (!visible) return;
        modules.push(createModule(
            `${classification.kind}_${index}`,
            classification.kind,
            classification.label || block.tagName,
            visible,
            classification.persistence,
        ));
    });

    if (!modules.some((module) => module.kind === 'content')) {
        const fallback = cleanupModuleText(withoutCode);
        if (fallback) {
            modules.push(createModule('content_fallback', 'content', '正文', fallback, 'long'));
        }
    }

    const statusText = cleanupModuleText(options.statusText || '');
    if (statusText) {
        modules.push(createModule('statusbar_raw', 'statusbar_raw', '状态栏原文', statusText, 'fast'));
    }

    return dedupeModules(modules);
}

function extractTagBlocks(source) {
    const blocks = [];
    let match;
    while ((match = XML_BLOCK_REGEX.exec(source)) !== null) {
        blocks.push({
            tagName: String(match[1] || '').trim(),
            innerText: String(match[2] || ''),
        });
    }
    return blocks;
}

function classifyTagName(tagName) {
    const raw = String(tagName || '').trim().toLowerCase();
    if (!raw) return { kind: 'other_text_block', label: '文本块', persistence: 'long', discard: false };
    if (DISCARD_TAGS.some((token) => raw.includes(token))) {
        return { discard: true };
    }
    if (/(content|reply|response|message|dialog|dialogue|正文|内容|main)/i.test(raw)) {
        return { kind: 'content', label: '正文', persistence: 'long', discard: false };
    }
    if (/(summary|recap|digest|abstract|outline|摘要|总结)/i.test(raw)) {
        return { kind: 'summary', label: '摘要块', persistence: 'long', discard: false };
    }
    if (/(html|scene|theater|theatre|widget|panel|card|ui|剧场|小剧场)/i.test(raw)) {
        return { kind: 'html_scene_text', label: 'HTML小剧场', persistence: 'fast', discard: false };
    }
    return { kind: 'other_text_block', label: `<${tagName}>`, persistence: 'long', discard: false };
}

function createModule(id, kind, label, text, persistence) {
    const finalText = cleanupModuleText(text);
    return {
        id,
        kind,
        label,
        text: finalText,
        selected: true,
        persistence: persistence === 'fast' ? 'fast' : 'long',
        preview: clipText(finalText, 220),
    };
}

function dedupeModules(modules) {
    const seen = new Set();
    const output = [];
    modules.forEach((module) => {
        const normalized = normalizeModule(module);
        if (!normalized) return;
        const key = `${normalized.kind}::${hashText(normalized.text)}`;
        if (seen.has(key)) return;
        seen.add(key);
        output.push(normalized);
    });
    return output;
}

function looksLikeHtmlBlock(lang, code) {
    if (['html', 'xml', 'svg', 'xhtml'].includes(lang)) return true;
    return /<\/?[a-z][\s\S]*>/i.test(code);
}

function cleanupModuleText(value) {
    const source = String(value == null ? '' : value);
    if (!source.trim()) return '';
    let cleaned = source.replace(CODE_BLOCK_REGEX, ' ');
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
    if (/<\/?[a-z][\s\S]*>/i.test(cleaned)) {
        cleaned = extractVisibleTextFromHtml(cleaned);
    }
    cleaned = cleaned.replace(/<\/?[^>]+>/g, ' ');
    cleaned = cleaned.replace(/\r/g, '\n');
    cleaned = cleaned
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
    return cleaned.trim();
}

function extractVisibleTextFromHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${String(html || '')}</body>`, 'text/html');
    doc.querySelectorAll('script,style,noscript,template').forEach((node) => node.remove());
    const text = doc.body ? doc.body.textContent || '' : '';
    return text
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
        .trim();
}

function readStatusBarText() {
    const settings = ensureSettings();
    const selectors = normalizeSelectorsText(settings.statusSelectors)
        .split(/\r?\n/g)
        .map((item) => item.trim())
        .filter(Boolean);
    const chunks = [];
    const seen = new Set();
    selectors.forEach((selector) => {
        try {
            document.querySelectorAll(selector).forEach((node) => {
                if (!(node instanceof HTMLElement) || !isVisible(node)) return;
                const text = cleanupModuleText(node.innerText || node.textContent || '');
                if (!text) return;
                if (seen.has(text)) return;
                seen.add(text);
                chunks.push(text);
            });
        } catch (error) {
            console.warn(`[${MODULE_NAME}] Invalid selector`, selector, error);
        }
    });
    return chunks.join('\n');
}

function readSavedStatusText(entry) {
    if (!entry || !Array.isArray(entry.modules)) return '';
    return entry.modules
        .filter((module) => module.kind === 'statusbar_raw')
        .map((module) => module.text)
        .filter(Boolean)
        .join('\n');
}

function isVisible(node) {
    return Boolean(node && (node.offsetParent || node.getClientRects().length));
}

function renderAll() {
    renderBinding();
    renderContextStats();
    renderLatestModules();
    renderTranscript();
}

function renderContextStats() {
    if (!ui.contextChips) return;
    const state = runtime.chatState || createDefaultChatState();
    const turns = getOrderedTurns();
    const recentCount = ensureSettings().recentFullTurns;
    const recentTurns = turns.slice(-recentCount);
    const olderTurns = turns.slice(0, Math.max(0, turns.length - recentCount));
    const olderSummaries = olderTurns.filter((turn) => turn.summary && !turn.stageId);
    const fastModules = runtime.latestTurnId
        ? getSelectedModules(state.turns[runtime.latestTurnId], 'fast')
        : [];

    const chips = [
        { text: `近文 ${recentTurns.length}`, cls: 'long' },
        { text: `旧摘 ${olderSummaries.length}`, cls: 'long' },
        { text: `阶段 ${state.stageSummaries.length}`, cls: 'long' },
        { text: `快餐 ${fastModules.length}`, cls: 'fast' },
    ];
    ui.contextChips.innerHTML = chips
        .map((chip) => `<span class="idic-companion__chip ${chip.cls}">${escapeHtml(chip.text)}</span>`)
        .join('');
    const latest = runtime.latestTurnId ? state.turns[runtime.latestTurnId] : null;
    if (ui.openSyncSheetButton) {
        if (latest && Array.isArray(latest.modules) && latest.modules.length > 0) {
            const selectedCount = latest.modules.filter((module) => getModuleSyncMode(module) !== 'ignore').length;
            ui.openSyncSheetButton.textContent = `同步 ${selectedCount}/${latest.modules.length}`;
        } else {
            ui.openSyncSheetButton.textContent = '同步';
        }
    }
}

function renderLatestModules() {
    if (!ui.modulesRoot) return;
    const latest = runtime.latestTurnId ? runtime.chatState?.turns?.[runtime.latestTurnId] : null;
    if (!latest) {
        ui.modulesRoot.innerHTML = '<div class="idic-companion__empty">暂无内容</div>';
        return;
    }

    if (!Array.isArray(latest.modules) || latest.modules.length === 0) {
        ui.modulesRoot.innerHTML = '<div class="idic-companion__empty">这楼没扫到内容</div>';
        return;
    }

    ui.modulesRoot.innerHTML = latest.modules.map((module) => `
        <div class="idic-companion__module" data-module-id="${escapeHtml(module.id)}">
            <div class="idic-companion__module-head">
                <label class="idic-companion__module-title">
                    <input type="checkbox" data-module-toggle="${escapeHtml(module.id)}" ${module.selected ? 'checked' : ''} />
                    <span>${escapeHtml(module.label)}</span>
                </label>
                <span class="idic-companion__chip ${module.persistence === 'fast' ? 'fast' : 'long'}">${module.persistence === 'fast' ? '本楼即忘' : '长期保留'}</span>
            </div>
            <pre class="idic-companion__module-preview">${escapeHtml(module.preview)}</pre>
        </div>
    `).join('');

    ui.modulesRoot.querySelectorAll('[data-module-toggle]').forEach((element) => {
        element.addEventListener('change', async (event) => {
            const target = event.currentTarget;
            if (!(target instanceof HTMLInputElement)) return;
            const moduleId = target.getAttribute('data-module-toggle');
            if (!moduleId) return;
            const turn = runtime.chatState?.turns?.[runtime.latestTurnId];
            if (!turn) return;
            const previousTurn = normalizeTurnEntry(turn, turn.turnId);
            turn.modules = turn.modules.map((module) => {
                if (module.id !== moduleId) return module;
                return Object.assign({}, module, { selected: target.checked });
            });
            turn.summarySourceDigest = computePersistentDigest(turn.userText, turn.modules);
            refreshTurnSummaryState(turn, previousTurn);
            runtime.chatState.stageSummaries = [];
            await persistChatState();
            renderContextStats();
            scheduleBackgroundMaintenance();
        });
    });
}

function splitUserMessageLines(text) {
    return String(text == null ? '' : text)
        .replace(/\r/g, '\n')
        .split(/\n+/g)
        .map((line) => line.trim())
        .filter(Boolean);
}

function normalizeAssistantReplyLines(text) {
    const raw = String(text == null ? '' : text).replace(/\r/g, '\n').trim();
    if (!raw) return [];
    const lines = raw
        .split(/\n+/g)
        .map((line) => line.replace(/^(\d+[\.\)、]\s*|[-*•]\s*)/, '').trim())
        .filter(Boolean);
    return lines.length ? lines : [raw];
}

function getTranscriptBatchId(item) {
    return toTrimmedString(item?.batchId) || toTrimmedString(item?.id);
}

function trimTranscript() {
    if (!runtime.chatState) return;
    if (runtime.chatState.transcript.length > TRANSCRIPT_STORAGE_HARD_CAP) {
        runtime.chatState.transcript = runtime.chatState.transcript.slice(-TRANSCRIPT_STORAGE_HARD_CAP);
    }
}

function appendTranscriptEntries(entries, options = {}) {
    if (!runtime.chatState) runtime.chatState = createDefaultChatState();
    const items = Array.isArray(entries)
        ? entries.map((entry) => normalizeTranscriptEntry(entry)).filter(Boolean)
        : [];
    if (!items.length) return [];
    runtime.chatState.transcript.push(...items);
    trimTranscript();
    if (options.persist !== false) {
        void persistChatState();
    }
    if (options.sync !== false) {
        scheduleCompanionRecentChatsSync();
    }
    return items;
}

function replaceTranscriptBatch(batchId, entries, options = {}) {
    if (!runtime.chatState) runtime.chatState = createDefaultChatState();
    const safeBatchId = toTrimmedString(batchId);
    runtime.chatState.transcript = runtime.chatState.transcript.filter((item) => getTranscriptBatchId(item) !== safeBatchId);
    appendTranscriptEntries(entries, { persist: false, sync: false });
    trimTranscript();
    if (options.persist !== false) {
        void persistChatState();
    }
    if (options.sync !== false) {
        scheduleCompanionRecentChatsSync();
    }
}

function findLatestTranscriptBatch(role, beforeIndex = null) {
    const transcript = Array.isArray(runtime.chatState?.transcript) ? runtime.chatState.transcript : [];
    const startIndex = Number.isFinite(Number(beforeIndex))
        ? Math.min(transcript.length - 1, Number(beforeIndex) - 1)
        : transcript.length - 1;
    for (let index = startIndex; index >= 0; index -= 1) {
        const item = transcript[index];
        if (!item || item.pending) continue;
        if (role && item.role !== role) continue;
        const batchId = getTranscriptBatchId(item);
        if (!batchId) continue;
        let firstIndex = index;
        while (firstIndex - 1 >= 0 && getTranscriptBatchId(transcript[firstIndex - 1]) === batchId) {
            firstIndex -= 1;
        }
        const items = transcript.slice(firstIndex, index + 1).filter((entry) => getTranscriptBatchId(entry) === batchId);
        return { batchId, firstIndex, lastIndex: index, items };
    }
    return null;
}

function isTranscriptEntrySelectable(item) {
    return Boolean(item && !item.pending);
}

function updateTranscriptSelectionBar() {
    if (!ui.selectBar || !ui.selectCount) return;
    const active = Boolean(runtime.transcriptSelectionMode);
    ui.selectBar.classList.toggle('hidden', !active);
    if (!active) return;
    ui.selectCount.textContent = `已选 ${runtime.selectedTranscriptIds.size} 条`;
}

function enterTranscriptSelectionMode(initialId = '') {
    runtime.transcriptSelectionMode = true;
    if (!(runtime.selectedTranscriptIds instanceof Set)) {
        runtime.selectedTranscriptIds = new Set();
    }
    if (initialId) {
        runtime.selectedTranscriptIds.add(initialId);
    }
    updateTranscriptSelectionBar();
    renderTranscript();
}

function exitTranscriptSelectionMode() {
    runtime.transcriptSelectionMode = false;
    runtime.selectedTranscriptIds = new Set();
    updateTranscriptSelectionBar();
    renderTranscript();
}

function toggleTranscriptSelection(id) {
    const safeId = toTrimmedString(id);
    if (!safeId) return;
    if (!(runtime.selectedTranscriptIds instanceof Set)) {
        runtime.selectedTranscriptIds = new Set();
    }
    if (runtime.selectedTranscriptIds.has(safeId)) {
        runtime.selectedTranscriptIds.delete(safeId);
    } else {
        runtime.selectedTranscriptIds.add(safeId);
    }
    if (runtime.selectedTranscriptIds.size === 0) {
        runtime.transcriptSelectionMode = false;
    }
    updateTranscriptSelectionBar();
    renderTranscript();
}

async function deleteSelectedTranscriptEntries() {
    if (!(runtime.selectedTranscriptIds instanceof Set) || runtime.selectedTranscriptIds.size === 0) return;
    const selectedIds = new Set(runtime.selectedTranscriptIds);
    runtime.chatState.transcript = runtime.chatState.transcript.filter((item) => !selectedIds.has(String(item?.id || '')));
    runtime.transcriptSelectionMode = false;
    runtime.selectedTranscriptIds = new Set();
    trimTranscript();
    await persistChatState();
    scheduleCompanionRecentChatsSync();
    renderTranscript();
}

function loadMoreTranscriptMessages() {
    runtime.transcriptRenderCount += TRANSCRIPT_RENDER_PAGE_SIZE;
    renderTranscript();
}

function bindTranscriptBubbleEvents() {
    if (!ui.transcriptRoot) return;
    ui.transcriptRoot.querySelector('[data-load-more-transcript]')?.addEventListener('click', () => {
        loadMoreTranscriptMessages();
    });
    ui.transcriptRoot.querySelectorAll('[data-transcript-id]').forEach((element) => {
        const transcriptId = toTrimmedString(element.getAttribute('data-transcript-id'));
        if (!transcriptId) return;
        let longPressTimer = null;
        let longPressTriggered = false;
        const clearLongPress = () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        };
        element.addEventListener('click', () => {
            if (longPressTriggered) {
                longPressTriggered = false;
                return;
            }
            if (!runtime.transcriptSelectionMode) return;
            toggleTranscriptSelection(transcriptId);
        });
        element.addEventListener('pointerdown', () => {
            if (runtime.transcriptSelectionMode) return;
            longPressTimer = setTimeout(() => {
                longPressTriggered = true;
                enterTranscriptSelectionMode(transcriptId);
                longPressTimer = null;
            }, 420);
        });
        element.addEventListener('pointerup', clearLongPress);
        element.addEventListener('pointerleave', clearLongPress);
        element.addEventListener('pointercancel', clearLongPress);
        element.addEventListener('pointermove', clearLongPress);
    });
}

function renderTranscript() {
    if (!ui.transcriptRoot) return;
    const transcript = Array.isArray(runtime.chatState?.transcript) ? runtime.chatState.transcript : [];
    const roleName = getActiveRoleName();
    renderComposerState(roleName);
    updateTranscriptSelectionBar();
    if (transcript.length === 0) {
        ui.transcriptRoot.innerHTML = `<div class="idic-companion__empty">${roleName ? '还没开聊' : '先选角色'}</div>`;
        return;
    }
    const binding = ensureChatMeta()?.binding || createDefaultBinding();
    const assistantName = binding.displayName || binding.charName || '陪读';
    const renderCount = Math.max(TRANSCRIPT_RENDER_PAGE_SIZE, runtime.transcriptRenderCount || TRANSCRIPT_RENDER_PAGE_SIZE);
    const startIndex = Math.max(0, transcript.length - renderCount);
    const visibleItems = transcript.slice(startIndex);
    const html = [];
    if (startIndex > 0) {
        html.push('<button type="button" class="idic-companion__load-more" data-load-more-transcript="1">更多消息</button>');
    }
    visibleItems.forEach((item) => {
        const role = item.role;
        const cls = role === 'user' ? 'user' : (role === 'assistant' ? 'assistant' : 'system');
        const timestamp = new Date(item.createdAt).toLocaleTimeString();
        const speaker = role === 'user' ? '你' : (role === 'assistant' ? assistantName : '系统');
        const selectable = isTranscriptEntrySelectable(item);
        const selected = selectable && runtime.selectedTranscriptIds instanceof Set && runtime.selectedTranscriptIds.has(String(item.id));
        html.push(`
            <div class="idic-companion__bubble ${cls} ${selectable ? 'selectable' : ''} ${selected ? 'selected' : ''}" ${selectable ? `data-transcript-id="${escapeHtml(item.id)}"` : ''}>
                ${selectable ? `<span class="idic-companion__bubble-check">${selected ? '✓' : ''}</span>` : ''}
                <div class="idic-companion__bubble-box">${escapeHtml(item.text)}</div>
                <div class="idic-companion__bubble-meta">${escapeHtml(speaker)} · ${escapeHtml(timestamp)}${item.pending ? ' · 发送中' : ''}</div>
            </div>
        `);
    });
    ui.transcriptRoot.innerHTML = html.join('');
    bindTranscriptBubbleEvents();
    if (ui.scrollRoot && !runtime.transcriptSelectionMode) {
        ui.scrollRoot.scrollTop = ui.scrollRoot.scrollHeight;
    }
}

function buildTranscriptPayload() {
    const settings = ensureSettings();
    const transcript = Array.isArray(runtime.chatState?.transcript) ? runtime.chatState.transcript : [];
    const maxItems = Math.max(2, settings.maxTranscriptTurns * 2);
    return transcript
        .filter((item) => !item.pending && (item.role === 'user' || item.role === 'assistant'))
        .slice(-maxItems)
        .map((item) => ({
            role: item.role,
            text: item.text,
        }));
}

function buildCompanionRecentChatsPayload() {
    const transcript = Array.isArray(runtime.chatState?.transcript) ? runtime.chatState.transcript : [];
    return transcript
        .filter((item) => !item.pending && (item.role === 'user' || item.role === 'assistant'))
        .slice(-COMPANION_RECENT_CHAT_LIMIT)
        .map((item) => ({
            id: item.id,
            role: item.role,
            content: item.text,
            time: new Date(item.createdAt || Date.now()).toISOString(),
            batchId: getTranscriptBatchId(item),
            source: 'sillytavern_companion',
            sourceLabel: '酒馆陪读',
        }));
}

function scheduleCompanionRecentChatsSync(delayMs = 700) {
    if (runtime.companionRecentChatsSyncTimer) {
        clearTimeout(runtime.companionRecentChatsSyncTimer);
    }
    runtime.companionRecentChatsSyncTimer = setTimeout(() => {
        runtime.companionRecentChatsSyncTimer = null;
        void syncCompanionRecentChatsToSnapshot();
    }, Math.max(120, Number(delayMs) || 700));
}

async function syncCompanionRecentChatsToSnapshot() {
    const binding = getBindingPayload();
    if (!binding.userId || !binding.charId) return;
    try {
        await callBridge('sync_companion_recent_chats', {
            binding,
            recentChats: buildCompanionRecentChatsPayload(),
            stChatLabel: getCurrentChatLabel(),
        });
    } catch (error) {
        console.warn(`[${MODULE_NAME}] recent chat sync failed`, error);
    }
}

async function sendCompanionMessage() {
    if (runtime.sendInFlight) return;
    const lines = splitUserMessageLines(ui.input?.value);
    if (lines.length === 0) return;

    await saveBindingFromSelection({ silent: true });
    const binding = getBindingPayload();
    if (!binding.charId || !binding.charName || (!binding.charPersona && !binding.promptProfile)) {
        notify('请先选角色', 'warning');
        setPanelOpen(true);
        return;
    }

    runtime.sendInFlight = true;
    setStatus('正在整理上下文...', 'info');
    await syncStateFromChat({ captureLatestStatus: true, forceLatestRescan: false });
    await scheduleImmediateContextHydration();

    const userBatchId = createId();
    const pendingBatchId = createId();
    const now = Date.now();
    appendTranscriptEntries(lines.map((text, index) => ({
        id: createId(),
        role: 'user',
        text,
        createdAt: now + index,
        batchId: userBatchId,
        sourceType: 'companion',
    })), { persist: false, sync: false });
    appendTranscriptEntries([{
        id: createId(),
        role: 'assistant',
        text: '...',
        createdAt: now + lines.length + 1,
        pending: true,
        batchId: pendingBatchId,
        sourceType: 'companion',
    }], { persist: false, sync: false });
    trimTranscript();
    await persistChatState();
    scheduleCompanionRecentChatsSync();
    renderTranscript();
    if (ui.input) ui.input.value = '';

    try {
        const response = await callBridge('reply', {
            binding,
            apiConfig: getApiConfigPayload(),
            readingContext: buildReadingContextPayload(),
            transcript: buildTranscriptPayload(),
            userMessage: lines.join('\n'),
            userMessages: lines,
            stChatLabel: getCurrentChatLabel(),
            replyControl: {
                replyMode: 'normal',
            },
        });
        const replyLines = normalizeAssistantReplyLines(toTrimmedString(response.reply) || '没有收到回复');
        replaceTranscriptBatch(pendingBatchId, replyLines.map((text, index) => ({
            id: createId(),
            role: 'assistant',
            text,
            createdAt: Date.now() + index,
            batchId: pendingBatchId,
            sourceType: 'companion',
        })));
        await persistChatState();
        scheduleCompanionRecentChatsSync();
        renderTranscript();
        setStatus(`已回复，命中 ${Number(response.memoryCount || 0)} 条海马体记忆`, 'success');
    } catch (error) {
        replaceTranscriptBatch(pendingBatchId, [{
            id: createId(),
            role: 'system',
            text: `连接失败：${error.message}`,
            createdAt: Date.now(),
            batchId: pendingBatchId,
            sourceType: 'system',
        }]);
        await persistChatState();
        renderTranscript();
        setStatus(`连接失败：${error.message}`, 'error');
    } finally {
        runtime.sendInFlight = false;
        renderBinding();
    }
}

async function regenerateCompanionReply() {
    if (runtime.sendInFlight) return;
    const transcriptSnapshot = Array.isArray(runtime.chatState?.transcript) ? runtime.chatState.transcript.slice() : [];
    const lastAssistantBatch = findLatestTranscriptBatch('assistant');
    const lastUserBatch = lastAssistantBatch
        ? findLatestTranscriptBatch('user', lastAssistantBatch.firstIndex)
        : findLatestTranscriptBatch('user');
    if (!lastUserBatch) {
        notify('还没有可重写的上一轮', 'info');
        return;
    }

    if (lastAssistantBatch) {
        runtime.chatState.transcript = runtime.chatState.transcript.filter((item) => getTranscriptBatchId(item) !== lastAssistantBatch.batchId);
        await persistChatState();
        renderTranscript();
    }

    await sendBridgeReply({
        userMessage: lastUserBatch.items.map((item) => item.text).join('\n'),
        userMessages: lastUserBatch.items.map((item) => item.text),
        replyMode: 'regenerate',
        statusLabel: '正在重写...',
    }).catch(async (error) => {
        runtime.chatState.transcript = transcriptSnapshot;
        await persistChatState();
        renderTranscript();
        throw error;
    });
}

async function continueCompanionReply() {
    if (runtime.sendInFlight) return;
    const lastAssistantBatch = findLatestTranscriptBatch('assistant');
    if (!lastAssistantBatch || lastAssistantBatch.items.length === 0) {
        notify('还没有可续写的回复', 'info');
        return;
    }

    await sendBridgeReply({
        userMessage: '',
        userMessages: [],
        replyMode: 'continue',
        continueFrom: lastAssistantBatch.items.map((item) => item.text).join('\n'),
        statusLabel: '正在续写...',
    });
}

async function sendBridgeReply(options) {
    await saveBindingFromSelection({ silent: true });
    const binding = getBindingPayload();
    if (!binding.charId || !binding.charName || (!binding.charPersona && !binding.promptProfile)) {
        notify('请先选角色', 'warning');
        return;
    }

    runtime.sendInFlight = true;
    await syncStateFromChat({ captureLatestStatus: true, forceLatestRescan: false });
    await scheduleImmediateContextHydration();

    const pendingBatchId = createId();
    appendTranscriptEntries([{
        id: createId(),
        role: 'assistant',
        text: '...',
        createdAt: Date.now(),
        pending: true,
        batchId: pendingBatchId,
        sourceType: 'companion',
    }], { persist: false, sync: false });
    await persistChatState();
    renderTranscript();
    setStatus(options.statusLabel || '对方正在输入...', 'info');

    try {
        const response = await callBridge('reply', {
            binding,
            apiConfig: getApiConfigPayload(),
            readingContext: buildReadingContextPayload(),
            transcript: buildTranscriptPayload(),
            userMessage: toTrimmedString(options.userMessage),
            userMessages: Array.isArray(options.userMessages) ? options.userMessages : [],
            stChatLabel: getCurrentChatLabel(),
            replyControl: {
                replyMode: options.replyMode || 'normal',
                continueFrom: toTrimmedString(options.continueFrom),
            },
        });
        const replyLines = normalizeAssistantReplyLines(toTrimmedString(response.reply) || '没有收到回复');
        replaceTranscriptBatch(pendingBatchId, replyLines.map((text, index) => ({
            id: createId(),
            role: 'assistant',
            text,
            createdAt: Date.now() + index,
            batchId: pendingBatchId,
            sourceType: 'companion',
        })));
        await persistChatState();
        scheduleCompanionRecentChatsSync();
        renderTranscript();
        setStatus(`已回复，命中 ${Number(response.memoryCount || 0)} 条海马体记忆`, 'success');
    } catch (error) {
        replaceTranscriptBatch(pendingBatchId, [{
            id: createId(),
            role: 'system',
            text: `连接失败：${error.message}`,
            createdAt: Date.now(),
            batchId: pendingBatchId,
            sourceType: 'system',
        }]);
        await persistChatState();
        renderTranscript();
        setStatus(`连接失败：${error.message}`, 'error');
        throw error;
    } finally {
        runtime.sendInFlight = false;
        renderBinding();
    }
}

function renderTranscript() {
    if (!ui.transcriptRoot) return;
    const transcript = Array.isArray(runtime.chatState?.transcript) ? runtime.chatState.transcript : [];
    const roleName = getActiveRoleName();
    renderComposerState(roleName);
    if (transcript.length === 0) {
        ui.transcriptRoot.innerHTML = `<div class="idic-companion__empty">${roleName ? '还没开聊' : '先选角色'}</div>`;
        return;
    }
    const binding = ensureChatMeta()?.binding || createDefaultBinding();
    const assistantName = binding.displayName || binding.charName || '陪读';
    ui.transcriptRoot.innerHTML = transcript.map((item) => {
        const role = item.role;
        const cls = role === 'user' ? 'user' : (role === 'assistant' ? 'assistant' : 'system');
        const timestamp = new Date(item.createdAt).toLocaleTimeString();
        const speaker = role === 'user' ? '你' : (role === 'assistant' ? assistantName : '系统');
        return `
            <div class="idic-companion__bubble ${cls}">
                <div class="idic-companion__bubble-box">${escapeHtml(item.text)}</div>
                <div class="idic-companion__bubble-meta">${escapeHtml(speaker)} · ${escapeHtml(timestamp)}${item.pending ? ' · 发送中' : ''}</div>
            </div>
        `;
    }).join('');
    if (ui.scrollRoot) ui.scrollRoot.scrollTop = ui.scrollRoot.scrollHeight;
}

function scheduleBackgroundMaintenance() {
    queueBackgroundTask(async () => {
        const turns = getOrderedTurns();
        if (turns.length === 0) return;
        const settings = ensureSettings();
        const olderTurns = turns.slice(0, Math.max(0, turns.length - settings.recentFullTurns));
        for (const turn of olderTurns) {
            if (shouldAutoGenerateSummary(turn) && (turn.summaryStatus === 'missing' || turn.summaryStatus === 'stale' || turn.summaryStatus === 'error')) {
                await ensureTurnSummary(turn.turnId, { silent: true });
            }
        }
        await ensureStageRollups(true);
        renderContextStats();
    });
}

function queueBackgroundTask(task) {
    runtime.backgroundQueue = runtime.backgroundQueue
        .catch(() => undefined)
        .then(task)
        .catch((error) => {
            console.error(`[${MODULE_NAME}] background task failed`, error);
        });
    return runtime.backgroundQueue;
}

async function ensureTurnSummary(turnId, options = {}) {
    const turn = runtime.chatState?.turns?.[turnId];
    if (!turn) return;
    if (turn.summaryStatus === 'ready' || turn.summaryStatus === 'running' || turn.summaryStatus === 'empty') return;
    if (!shouldAutoGenerateSummary(turn)) {
        turn.summaryStatus = hasSelectedLongModules(turn) ? 'missing' : 'empty';
        turn.summaryOrigin = '';
        await persistChatState();
        return;
    }

    const source = buildTurnSummarySource(turn);
    if (!source.sections.length) {
        turn.summaryStatus = 'empty';
        turn.summary = '';
        turn.summaryTitle = '';
        turn.summaryOrigin = '';
        await persistChatState();
        return;
    }

    turn.summaryStatus = 'running';
    await persistChatState();
    if (!options.silent) setStatus('正在整理旧楼摘要...', 'info');

    try {
        const response = await callBridge('summarize_turn', {
            binding: getBindingPayload(),
            apiConfig: getApiConfigPayload(),
            turn: {
                turnId: turn.turnId,
                userText: source.userText,
                aiModules: source.sections,
            },
        });
        turn.summary = toTrimmedString(response.summary);
        turn.summaryTitle = toTrimmedString(response.title || '');
        turn.summaryStatus = turn.summary ? 'ready' : 'error';
        turn.summarySourceDigest = computePersistentDigest(turn.userText, turn.modules);
        turn.summaryOrigin = turn.summary ? 'generated' : '';
        await persistChatState();
    } catch (error) {
        turn.summaryStatus = 'error';
        turn.summaryOrigin = '';
        await persistChatState();
        if (!options.silent) {
            setStatus(`摘要生成失败：${error.message}`, 'error');
        }
    }
}

async function ensureStageRollups(silent = false) {
    const state = runtime.chatState;
    if (!state) return;
    const settings = ensureSettings();
    const olderTurns = getOrderedTurns().slice(0, Math.max(0, getOrderedTurns().length - settings.recentFullTurns));
    let pending = olderTurns.filter((turn) => turn.summary && !turn.stageId);
    while (pending.length >= settings.stageRollupSize) {
        const chunk = pending.slice(0, settings.stageRollupSize);
        if (!silent) setStatus('正在合并旧摘要...', 'info');
        const response = await callBridge('rollup_stage', {
            binding: getBindingPayload(),
            apiConfig: getApiConfigPayload(),
            summaries: chunk.map((turn) => ({
                turnId: turn.turnId,
                summary: turn.summary,
                title: turn.summaryTitle || '',
            })),
        });
        const stageId = createId();
        state.stageSummaries.push({
            id: stageId,
            title: toTrimmedString(response.title) || '阶段总结',
            summary: toTrimmedString(response.summary),
            turnIds: chunk.map((turn) => turn.turnId),
            createdAt: Date.now(),
        });
        chunk.forEach((turn) => {
            turn.stageId = stageId;
        });
        await persistChatState();
        pending = olderTurns.filter((turn) => turn.summary && !turn.stageId);
    }
}

function buildTurnSummarySource(turn) {
    const selectedLongModules = getSelectedModules(turn, 'long');
    return {
        userText: turn.userText,
        sections: selectedLongModules.map((module) => ({
            label: module.label,
            kind: module.kind,
            text: module.text,
        })),
    };
}

function shouldAutoGenerateSummary(turn) {
    const settings = ensureSettings();
    return Boolean(settings.autoGenerateSummaryWhenMissing && turn && hasSelectedLongModules(turn) && !getBuiltInSummaryState(turn));
}

function computePersistentDigest(userText, modules) {
    const selectedLongModules = Array.isArray(modules)
        ? modules.filter((module) => module.selected && module.persistence === 'long')
        : [];
    const material = [
        String(userText || ''),
        ...selectedLongModules.map((module) => `${module.kind}:${module.label}:${module.text}`),
    ];
    return hashText(material.join('\n---\n'));
}

function getSelectedModules(turn, persistence) {
    if (!turn || !Array.isArray(turn.modules)) return [];
    return turn.modules.filter((module) => module.selected && module.persistence === persistence);
}

function getOrderedTurns() {
    if (!runtime.chatState) return [];
    return runtime.chatState.turnOrder
        .map((turnId) => runtime.chatState.turns[turnId])
        .filter(Boolean);
}

async function sendCompanionMessage() {
    if (runtime.sendInFlight) return;
    const rawText = toTrimmedString(ui.input?.value);
    if (!rawText) return;

    await saveBindingFromSelection({ silent: true });
    const binding = getBindingPayload();
    if (!binding.charId || !binding.charName || (!binding.charPersona && !binding.promptProfile)) {
        notify('请先选角色', 'warning');
        setPanelOpen(true);
        return;
    }

    runtime.sendInFlight = true;
    setStatus('正在整理上下文...', 'info');
    await syncStateFromChat({ captureLatestStatus: true, forceLatestRescan: false });
    await scheduleImmediateContextHydration();

    pushTranscriptEntry({ role: 'user', text: rawText });
    const pendingAssistant = pushTranscriptEntry({ role: 'assistant', text: '…', pending: true });
    renderTranscript();
    if (ui.input) ui.input.value = '';

    try {
        const readingContext = buildReadingContextPayload();
        const transcript = buildTranscriptPayload();
        setStatus('对方正在输入...', 'info');

        const response = await callBridge('reply', {
            binding,
            apiConfig: getApiConfigPayload(),
            readingContext,
            transcript,
            userMessage: rawText,
            stChatLabel: getCurrentChatLabel(),
            replyControl: {
                replyMode: 'normal',
            },
        });

        replaceTranscriptEntry(pendingAssistant.id, {
            role: 'assistant',
            text: toTrimmedString(response.reply) || '没有收到回复',
            pending: false,
        });
        trimTranscript();
        await persistChatState();
        renderTranscript();
        setStatus(`已回复，命中 ${Number(response.memoryCount || 0)} 条海马体记忆`, 'success');
    } catch (error) {
        replaceTranscriptEntry(pendingAssistant.id, {
            role: 'system',
            text: `连接失败：${error.message}`,
            pending: false,
        });
        renderTranscript();
        setStatus(`连接失败：${error.message}`, 'error');
    } finally {
        runtime.sendInFlight = false;
        renderBinding();
    }
}

async function regenerateCompanionReply() {
    if (runtime.sendInFlight) return;
    const transcript = Array.isArray(runtime.chatState?.transcript) ? runtime.chatState.transcript.slice() : [];
    const lastAssistant = [...transcript].reverse().find((item) => item.role === 'assistant' && !item.pending);
    const lastUserIndex = findLastTranscriptIndexByRole(transcript, 'user');
    if (lastUserIndex < 0) {
        notify('还没有可重写的上一轮', 'info');
        return;
    }

    const lastUser = transcript[lastUserIndex];
    const trimmedTranscript = transcript.slice(0, lastUserIndex);
    runtime.chatState.transcript = trimmedTranscript;
    await persistChatState();
    renderTranscript();

    await sendBridgeReply({
        userMessage: lastUser.text,
        replyMode: 'regenerate',
        statusLabel: '正在重写...',
    }).catch(async (error) => {
        if (lastAssistant) {
            runtime.chatState.transcript = transcript;
            await persistChatState();
            renderTranscript();
        }
        throw error;
    });
}

async function continueCompanionReply() {
    if (runtime.sendInFlight) return;
    const transcript = Array.isArray(runtime.chatState?.transcript) ? runtime.chatState.transcript.slice() : [];
    const lastAssistant = [...transcript].reverse().find((item) => item.role === 'assistant' && !item.pending);
    if (!lastAssistant || !lastAssistant.text) {
        notify('还没有可续写的回复', 'info');
        return;
    }

    await sendBridgeReply({
        userMessage: '',
        replyMode: 'continue',
        continueFrom: lastAssistant.text,
        statusLabel: '正在续写...',
    });
}

async function sendBridgeReply(options) {
    await saveBindingFromSelection({ silent: true });
    const binding = getBindingPayload();
    if (!binding.charId || !binding.charName || (!binding.charPersona && !binding.promptProfile)) {
        notify('请先选角色', 'warning');
        return;
    }

    runtime.sendInFlight = true;
    await syncStateFromChat({ captureLatestStatus: true, forceLatestRescan: false });
    await scheduleImmediateContextHydration();

    const pendingAssistant = pushTranscriptEntry({ role: 'assistant', text: '…', pending: true });
    renderTranscript();
    setStatus(options.statusLabel || '对方正在输入...', 'info');

    try {
        const response = await callBridge('reply', {
            binding,
            apiConfig: getApiConfigPayload(),
            readingContext: buildReadingContextPayload(),
            transcript: buildTranscriptPayload(),
            userMessage: toTrimmedString(options.userMessage),
            stChatLabel: getCurrentChatLabel(),
            replyControl: {
                replyMode: options.replyMode || 'normal',
                continueFrom: toTrimmedString(options.continueFrom),
            },
        });
        replaceTranscriptEntry(pendingAssistant.id, {
            role: 'assistant',
            text: toTrimmedString(response.reply) || '没有收到回复',
            pending: false,
        });
        trimTranscript();
        await persistChatState();
        renderTranscript();
        setStatus(`已回复，命中 ${Number(response.memoryCount || 0)} 条海马体记忆`, 'success');
    } catch (error) {
        replaceTranscriptEntry(pendingAssistant.id, {
            role: 'system',
            text: `连接失败：${error.message}`,
            pending: false,
        });
        renderTranscript();
        setStatus(`连接失败：${error.message}`, 'error');
        throw error;
    } finally {
        runtime.sendInFlight = false;
        renderBinding();
    }
}

async function scheduleImmediateContextHydration() {
    const settings = ensureSettings();
    const olderTurns = getOrderedTurns().slice(0, Math.max(0, getOrderedTurns().length - settings.recentFullTurns));
    for (const turn of olderTurns) {
        if (shouldAutoGenerateSummary(turn) && (turn.summaryStatus === 'missing' || turn.summaryStatus === 'stale' || turn.summaryStatus === 'error')) {
            await ensureTurnSummary(turn.turnId, { silent: true });
        }
    }
    await ensureStageRollups(true);
}

function buildReadingContextPayload() {
    const settings = ensureSettings();
    const turns = getOrderedTurns();
    const recentTurns = turns.slice(-settings.recentFullTurns);
    const olderTurns = turns.slice(0, Math.max(0, turns.length - settings.recentFullTurns));
    const stageSummaries = Array.isArray(runtime.chatState?.stageSummaries)
        ? runtime.chatState.stageSummaries.slice().sort((left, right) => Number(left.createdAt) - Number(right.createdAt))
        : [];
    const olderTurnSummaries = olderTurns
        .filter((turn) => !turn.stageId)
        .map((turn) => {
            if (turn.summary) {
                return {
                    turnId: turn.turnId,
                    title: turn.summaryTitle || '',
                    summary: turn.summary,
                    source: turn.summaryOrigin || 'generated',
                };
            }
            if (!settings.autoGenerateSummaryWhenMissing && hasSelectedLongModules(turn)) {
                return {
                    turnId: turn.turnId,
                    title: '原文补位',
                    summary: buildFallbackOlderTurnText(turn, settings.maxFullTurnChars),
                    source: 'fallback_raw',
                };
            }
            return null;
        })
        .filter(Boolean);
    const recentFullTurns = recentTurns.map((turn) => serializeRecentTurn(turn, settings.maxFullTurnChars));
    const currentFastFoodModules = runtime.latestTurnId
        ? getSelectedModules(runtime.chatState.turns[runtime.latestTurnId], 'fast').map(serializeModuleForPrompt)
        : [];

    return {
        sessionId: ensureChatMeta()?.binding?.sessionId || '',
        stageSummaries: stageSummaries.map((item) => ({
            id: item.id,
            title: item.title,
            summary: item.summary,
        })),
        olderTurnSummaries,
        recentFullTurns,
        currentFastFoodModules,
        stats: {
            recentFullTurnCount: recentFullTurns.length,
            olderSummaryCount: olderTurnSummaries.length,
            stageSummaryCount: stageSummaries.length,
            fastFoodModuleCount: currentFastFoodModules.length,
        },
    };
}

function serializeRecentTurn(turn, budget) {
    const selectedLongModules = getSelectedModules(turn, 'long');
    const userBudget = Math.max(320, Math.floor(budget * 0.28));
    const perModuleBudget = Math.max(240, Math.floor((budget - userBudget) / Math.max(1, selectedLongModules.length)));
    return {
        turnId: turn.turnId,
        userText: clipText(turn.userText, userBudget),
        aiSpeaker: turn.aiName || '角色',
        aiModules: selectedLongModules.map((module) => ({
            label: module.label,
            kind: module.kind,
            text: clipText(module.text, perModuleBudget),
        })),
    };
}

function buildFallbackOlderTurnText(turn, budget) {
    const selectedLongModules = getSelectedModules(turn, 'long');
    const parts = [`用户：${turn.userText || '（无）'}`]
        .concat(selectedLongModules.map((module) => `${turn.aiName || '角色'} / ${module.label}：${module.text}`));
    return clipText(parts.join('\n'), Math.max(1200, budget));
}

function serializeModuleForPrompt(module) {
    return {
        label: module.label,
        kind: module.kind,
        text: module.text,
    };
}

function buildTranscriptPayload() {
    const settings = ensureSettings();
    const transcript = Array.isArray(runtime.chatState?.transcript) ? runtime.chatState.transcript : [];
    const maxItems = Math.max(2, settings.maxTranscriptTurns * 2);
    return transcript
        .filter((item) => !item.pending && (item.role === 'user' || item.role === 'assistant'))
        .slice(-maxItems)
        .map((item) => ({
            role: item.role,
            text: item.text,
        }));
}

function getBindingPayload() {
    const binding = ensureChatMeta()?.binding || createDefaultBinding();
    return {
        sessionId: binding.sessionId || createId(),
        selectedRoleId: toTrimmedString(binding.selectedRoleId),
        displayName: toTrimmedString(binding.displayName),
        userId: toTrimmedString(binding.userId),
        charId: toTrimmedString(binding.charId),
        charName: toTrimmedString(binding.charName),
        charPersona: toTrimmedString(binding.charPersona),
        userName: toTrimmedString(binding.userName),
        userPersona: toTrimmedString(binding.userPersona),
        relationshipHint: toTrimmedString(binding.relationshipHint),
        systemPrompt: toTrimmedString(binding.systemPrompt),
        promptProfile: toTrimmedString(binding.promptProfile),
        hippocampusEnabled: Boolean(binding.hippocampusEnabled),
        snapshotUpdatedAt: toTrimmedString(binding.snapshotUpdatedAt),
    };
}

function getApiConfigPayload() {
    const settings = ensureSettings();
    return {
        apiUrl: toTrimmedString(settings.apiUrl),
        apiKey: toTrimmedString(settings.apiKey),
        model: toTrimmedString(settings.apiModel),
        temperature: clampFloat(settings.apiTemperature, 0, 2, DEFAULT_SETTINGS.apiTemperature),
    };
}

async function callBridge(action, payload) {
    const settings = ensureSettings();
    const bridgeUrl = toTrimmedString(settings.bridgeUrl);
    if (!bridgeUrl) {
        throw new Error('还没填写中转地址');
    }

    const headers = {
        'Content-Type': 'application/json',
    };
    if (settings.bridgeToken) {
        headers['x-idic-bridge-token'] = settings.bridgeToken;
    }
    const bridgeAuthKey = getBridgeAuthKey(settings);
    if (bridgeAuthKey) {
        headers.Authorization = `Bearer ${bridgeAuthKey}`;
        headers.apikey = bridgeAuthKey;
    }

    const response = await fetch(bridgeUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(Object.assign({ action }, payload || {})),
    });

    const raw = await response.text();
    const parsed = tryParseJson(raw);
    if (!response.ok) {
        const message = getBridgeErrorMessage(parsed, raw, response.status);
        throw new Error(message);
    }
    return parsed && typeof parsed === 'object' ? parsed : {};
}

function getBridgeAuthKey(settings) {
    const explicit = toTrimmedString(settings.bridgeAuthKey);
    if (explicit) return explicit;
    const token = toTrimmedString(settings.bridgeToken);
    return looksLikeSupabaseClientKey(token) ? token : '';
}

function looksLikeSupabaseClientKey(value) {
    const text = toTrimmedString(value);
    return /^sb_publishable_/i.test(text)
        || /^sb_secret_/i.test(text)
        || /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text);
}

function getBridgeErrorMessage(parsed, raw, status) {
    const code = toTrimmedString(parsed?.code || parsed?.error_code);
    const error = toTrimmedString(parsed?.error || parsed?.message || raw);
    if (code === 'UNAUTHORIZED_NO_AUTH_HEADER' || /NO_AUTH_HEADER/i.test(error)) {
        return '函数还开着 JWT 校验：请重新部署 bridge，并确保 supabase/config.toml 里 verify_jwt = false';
    }
    if (/JWT|invalid token|unauthorized/i.test(error)) {
        return '函数授权不匹配：publishable key 需要关闭 Edge Function 的 JWT 校验';
    }
    return error || `HTTP ${status}`;
}

function pushTranscriptEntry(entry) {
    if (!runtime.chatState) runtime.chatState = createDefaultChatState();
    const item = normalizeTranscriptEntry(Object.assign({ id: createId(), createdAt: Date.now() }, entry));
    runtime.chatState.transcript.push(item);
    trimTranscript();
    void persistChatState();
    return item;
}

function replaceTranscriptEntry(id, patch) {
    if (!runtime.chatState) return;
    runtime.chatState.transcript = runtime.chatState.transcript.map((item) => {
        if (item.id !== id) return item;
        return normalizeTranscriptEntry(Object.assign({}, item, patch));
    }).filter(Boolean);
    trimTranscript();
    void persistChatState();
}

function findLastTranscriptIndexByRole(transcript, role) {
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
        if (transcript[index] && transcript[index].role === role) return index;
    }
    return -1;
}

function trimTranscript() {
    if (!runtime.chatState) return;
    const settings = ensureSettings();
    const hardCap = Math.max(4, settings.maxTranscriptTurns * 2 + 4);
    if (runtime.chatState.transcript.length > hardCap) {
        runtime.chatState.transcript = runtime.chatState.transcript.slice(-hardCap);
    }
}

function getCurrentChatLabel() {
    const context = getContextSafe();
    if (!context) return '';
    if (context.groupId && Array.isArray(context.groups)) {
        const match = context.groups.find((group) => String(group.id) === String(context.groupId));
        if (match && match.name) return String(match.name);
    }
    if (Array.isArray(context.characters) && Number.isFinite(Number(context.characterId))) {
        const match = context.characters[Number(context.characterId)];
        if (match && match.name) return String(match.name);
    }
    return '';
}

function getMessageText(message) {
    return String(message?.mes ?? message?.message ?? '').trim();
}

function resolveMessageKey(message, index, role) {
    const extra = message && typeof message === 'object' ? message.extra || {} : {};
    return toTrimmedString(
        message?.id
        || extra?.gen_id
        || extra?.display_id
        || message?.send_date
        || `${role}_${index}_${hashText(getMessageText(message)).slice(0, 10)}`
    );
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setStatus(message, kind = 'info') {
    const text = toTrimmedString(message) || '待命';
    if (ui.headerStatus) ui.headerStatus.textContent = text;
    if (ui.footerStatus) ui.footerStatus.textContent = text;
    if (kind === 'error') console.error(`[${MODULE_NAME}] ${text}`);
}

function notify(message, type = 'info') {
    if (window.toastr && typeof window.toastr[type] === 'function') {
        window.toastr[type](message);
        return;
    }
    console.log(`[${MODULE_NAME}] ${message}`);
}

function tryParseJson(text) {
    try {
        return JSON.parse(text);
    } catch (_) {
        return null;
    }
}

function clipText(value, limit) {
    const text = String(value == null ? '' : value).trim();
    const max = Math.max(20, Number(limit) || 0);
    if (!max || text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1))}...`;
}

function hashText(value) {
    const text = String(value == null ? '' : value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
}

function createId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `idic-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getModuleSyncModeLabel(mode) {
    if (mode === 'summary') return '摘要';
    if (mode === 'fast') return '快餐';
    if (mode === 'ignore') return '忽略';
    return '正文';
}

function getModuleSourceTag(module) {
    if (module?.tagName) return `<${module.tagName}>`;
    if (module?.sourceType === 'status_bar') return '状态栏原文';
    if (module?.sourceType === 'html_fragment') return 'HTML片段';
    if (module?.sourceType === 'plain_text') return '无标签文本';
    return module?.label || '文本块';
}

function rememberModuleSyncPreference(module, syncMode) {
    if (!runtime.chatState) runtime.chatState = createDefaultChatState();
    const preferenceKey = buildModulePreferenceKey(module);
    if (!preferenceKey) return;
    runtime.chatState.modulePreferences[preferenceKey] = {
        syncMode,
        updatedAt: Date.now(),
    };
}

function stripMatchedBlocks(source, blocks) {
    const chars = String(source || '').split('');
    blocks.forEach((block) => {
        const start = Math.max(0, Number(block?.start) || 0);
        const end = Math.max(start, Number(block?.end) || start);
        for (let index = start; index < end && index < chars.length; index += 1) {
            chars[index] = ' ';
        }
    });
    return chars.join('');
}

function containsStandardHtmlTags(source) {
    const matches = String(source || '').match(/<\/?([a-z][\w:-]{0,40})[^>]*>/gi) || [];
    return matches.some((rawTag) => {
        const match = rawTag.match(/<\/?([a-z][\w:-]{0,40})/i);
        return Boolean(match && HTML_TAG_NAMES.has(String(match[1] || '').toLowerCase()));
    });
}

function normalizeTagKey(tagName) {
    return String(tagName || '')
        .trim()
        .toLowerCase()
        .replace(/[^\w:-]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function extractTagBlocks(source) {
    const blocks = [];
    let match;
    XML_BLOCK_REGEX.lastIndex = 0;
    while ((match = XML_BLOCK_REGEX.exec(String(source || ''))) !== null) {
        const tagName = String(match[1] || '').trim();
        if (!tagName || HTML_TAG_NAMES.has(tagName.toLowerCase())) continue;
        blocks.push({
            tagName,
            innerText: String(match[2] || ''),
            start: match.index,
            end: match.index + String(match[0] || '').length,
        });
    }
    return blocks;
}

function createModule(id, kind, label, text, options = {}) {
    const finalText = cleanupModuleText(text);
    const syncMode = MODULE_SYNC_MODES.includes(options.syncMode) ? options.syncMode : defaultModuleSyncMode(options);
    return applyModuleSyncMode({
        id,
        kind,
        label,
        tagName: toTrimmedString(options.tagName),
        tagKey: toTrimmedString(options.tagKey),
        sourceType: toTrimmedString(options.sourceType) || kind,
        text: finalText,
        preview: clipText(finalText, 220),
    }, syncMode);
}

function scanAiModules(aiText, options = {}) {
    const source = String(aiText == null ? '' : aiText);
    const modules = [];
    let withoutCode = source.replace(CODE_BLOCK_REGEX, (_, lang, code) => {
        const cleanLang = toTrimmedString(lang).toLowerCase();
        const cleanCode = String(code == null ? '' : code);
        if (looksLikeHtmlBlock(cleanLang, cleanCode)) {
            const visible = extractVisibleTextFromHtml(cleanCode);
            if (visible) {
                modules.push(createModule(`html_code_${modules.length}`, 'html_fragment', 'HTML片段', visible, {
                    sourceType: 'html_fragment',
                    tagName: 'HTML',
                    tagKey: 'html_fragment',
                    syncMode: 'fast',
                }));
            }
        }
        return ' ';
    });

    const tagMatches = extractTagBlocks(withoutCode);
    tagMatches.forEach((block, index) => {
        const visible = cleanupModuleText(block.innerText);
        if (!visible) return;
        modules.push(createModule(`tag_${index}`, 'tag_block', `<${block.tagName}>`, visible, {
            sourceType: 'tag_block',
            tagName: block.tagName,
            tagKey: normalizeTagKey(block.tagName),
            syncMode: 'content',
        }));
    });
    withoutCode = stripMatchedBlocks(withoutCode, tagMatches);

    if (containsStandardHtmlTags(withoutCode)) {
        const htmlVisible = cleanupModuleText(extractVisibleTextFromHtml(withoutCode));
        if (htmlVisible) {
            modules.push(createModule('html_fragment_inline', 'html_fragment', 'HTML片段', htmlVisible, {
                sourceType: 'html_fragment',
                tagName: 'HTML',
                tagKey: 'html_fragment',
                syncMode: 'fast',
            }));
        }
        withoutCode = withoutCode.replace(/<\/?[a-z][^>]*>/gi, ' ');
    }

    const fallback = cleanupModuleText(withoutCode);
    if (fallback) {
        modules.push(createModule('plain_text', 'plain_text', '无标签文本', fallback, {
            sourceType: 'plain_text',
            tagName: '',
            tagKey: 'plain_text',
            syncMode: 'content',
        }));
    }

    const statusText = cleanupModuleText(options.statusText || '');
    if (statusText) {
        modules.push(createModule('statusbar_raw', 'status_bar', '状态栏原文', statusText, {
            sourceType: 'status_bar',
            tagName: 'status_bar',
            tagKey: 'status_bar',
            syncMode: 'fast',
        }));
    }

    return dedupeModules(modules);
}

function renderLatestModules() {
    if (!ui.modulesRoot) return;
    const latest = runtime.latestTurnId ? runtime.chatState?.turns?.[runtime.latestTurnId] : null;
    if (!latest) {
        ui.modulesRoot.innerHTML = '<div class="idic-companion__empty">暂无内容</div>';
        return;
    }

    if (!Array.isArray(latest.modules) || latest.modules.length === 0) {
        ui.modulesRoot.innerHTML = '<div class="idic-companion__empty">这楼还没拆出可同步内容</div>';
        return;
    }

    ui.modulesRoot.innerHTML = latest.modules.map((module) => {
        const mode = getModuleSyncMode(module);
        return `
            <div class="idic-companion__module" data-module-id="${escapeHtml(module.id)}">
                <div class="idic-companion__module-head">
                    <div class="idic-companion__module-title">
                        <span>${escapeHtml(module.label)}</span>
                        <span class="idic-companion__module-tag">${escapeHtml(getModuleSourceTag(module))}</span>
                    </div>
                    <span class="idic-companion__chip ${mode === 'fast' ? 'fast' : 'long'}">${escapeHtml(getModuleSyncModeLabel(mode))}</span>
                </div>
                <div class="idic-companion__module-modes">
                    ${MODULE_SYNC_MODES.map((value) => `
                        <button
                            type="button"
                            class="idic-companion__module-mode ${mode === value ? 'active' : ''}"
                            data-module-mode="${escapeHtml(module.id)}"
                            data-mode="${escapeHtml(value)}"
                        >${escapeHtml(getModuleSyncModeLabel(value))}</button>
                    `).join('')}
                </div>
                <pre class="idic-companion__module-preview">${escapeHtml(module.text)}</pre>
            </div>
        `;
    }).join('');

    ui.modulesRoot.querySelectorAll('[data-module-mode]').forEach((element) => {
        element.addEventListener('click', async (event) => {
            const target = event.currentTarget;
            if (!(target instanceof HTMLButtonElement)) return;
            const moduleId = target.getAttribute('data-module-mode');
            const mode = target.getAttribute('data-mode');
            if (!moduleId || !MODULE_SYNC_MODES.includes(String(mode))) return;
            const turn = runtime.chatState?.turns?.[runtime.latestTurnId];
            if (!turn) return;
            const previousTurn = normalizeTurnEntry(turn, turn.turnId);
            turn.modules = turn.modules.map((module) => {
                if (module.id !== moduleId) return module;
                const updated = applyModuleSyncMode(module, String(mode));
                rememberModuleSyncPreference(updated, String(mode));
                return updated;
            });
            turn.summarySourceDigest = computePersistentDigest(turn.userText, turn.modules);
            refreshTurnSummaryState(turn, previousTurn);
            runtime.chatState.stageSummaries = [];
            await persistChatState();
            renderContextStats();
            renderLatestModules();
            scheduleBackgroundMaintenance();
        });
    });
}

function toTrimmedString(value) {
    return String(value == null ? '' : value).trim();
}

function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function clampFloat(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getModuleSyncModeLabel(mode) {
    if (mode === 'summary') return '摘要';
    if (mode === 'fast') return '快餐';
    if (mode === 'ignore') return '忽略';
    return '正文';
}

function getModuleSourceTag(module) {
    if (module?.tagName) return `<${module.tagName}>`;
    if (module?.sourceType === 'status_bar') return '状态栏原文';
    if (module?.sourceType === 'html_fragment') return 'HTML片段';
    if (module?.sourceType === 'plain_text') return '无标签文本';
    return module?.label || '文本块';
}

function rememberModuleSyncPreference(module, syncMode) {
    if (!runtime.chatState) runtime.chatState = createDefaultChatState();
    const preferenceKey = buildModulePreferenceKey(module);
    if (!preferenceKey) return;
    runtime.chatState.modulePreferences[preferenceKey] = {
        syncMode,
        updatedAt: Date.now(),
    };
}

function collectCompanionTagTree(source) {
    const blocks = [];
    let match;
    XML_BLOCK_REGEX.lastIndex = 0;
    while ((match = XML_BLOCK_REGEX.exec(String(source || ''))) !== null) {
        const tagName = String(match[1] || '').trim();
        if (!tagName || HTML_TAG_NAMES.has(tagName.toLowerCase())) continue;
        const rawInnerText = String(match[2] || '');
        const nested = collectCompanionTagTree(rawInnerText);
        blocks.push({
            tagName,
            rawInnerText,
            innerText: stripMatchedBlocks(rawInnerText, nested),
            start: match.index,
            end: match.index + String(match[0] || '').length,
            nested,
        });
    }
    return blocks;
}

function flattenCompanionTagTree(blocks, bucket = []) {
    blocks.forEach((block) => {
        const visibleText = cleanupModuleText(block.innerText);
        if (visibleText) {
            bucket.push({
                tagName: block.tagName,
                innerText: visibleText,
                start: block.start,
                end: block.end,
            });
        }
        if (Array.isArray(block.nested) && block.nested.length > 0) {
            flattenCompanionTagTree(block.nested, bucket);
        }
    });
    return bucket;
}

function scanAiModules(aiText, options = {}) {
    const source = String(aiText == null ? '' : aiText);
    const modules = [];
    let withoutCode = source.replace(CODE_BLOCK_REGEX, (_, lang, code) => {
        const cleanLang = toTrimmedString(lang).toLowerCase();
        const cleanCode = String(code == null ? '' : code);
        if (looksLikeHtmlBlock(cleanLang, cleanCode)) {
            const visible = cleanupModuleText(extractVisibleTextFromHtml(cleanCode));
            if (visible) {
                modules.push(createModule(`html_code_${modules.length}`, 'html_fragment', 'HTML片段', visible, {
                    sourceType: 'html_fragment',
                    tagName: 'HTML',
                    tagKey: 'html_fragment',
                    syncMode: 'fast',
                }));
            }
        }
        return ' ';
    });

    const tagTree = collectCompanionTagTree(withoutCode);
    const tagBlocks = flattenCompanionTagTree(tagTree);
    tagBlocks.forEach((block, index) => {
        modules.push(createModule(`tag_${index}`, 'tag_block', `<${block.tagName}>`, block.innerText, {
            sourceType: 'tag_block',
            tagName: block.tagName,
            tagKey: normalizeTagKey(block.tagName),
            syncMode: 'content',
        }));
    });
    withoutCode = stripMatchedBlocks(withoutCode, tagTree);

    if (containsStandardHtmlTags(withoutCode)) {
        const htmlVisible = cleanupModuleText(extractVisibleTextFromHtml(withoutCode));
        if (htmlVisible) {
            modules.push(createModule('html_fragment_inline', 'html_fragment', 'HTML片段', htmlVisible, {
                sourceType: 'html_fragment',
                tagName: 'HTML',
                tagKey: 'html_fragment',
                syncMode: 'fast',
            }));
        }
        withoutCode = withoutCode.replace(/<\/?[a-z][^>]*>/gi, ' ');
    }

    const fallback = cleanupModuleText(withoutCode);
    if (fallback) {
        modules.push(createModule('plain_text', 'plain_text', '无标签文本', fallback, {
            sourceType: 'plain_text',
            tagName: '',
            tagKey: 'plain_text',
            syncMode: 'content',
        }));
    }

    const statusText = cleanupModuleText(options.statusText || '');
    if (statusText) {
        modules.push(createModule('statusbar_raw', 'status_bar', '状态栏原文', statusText, {
            sourceType: 'status_bar',
            tagName: 'status_bar',
            tagKey: 'status_bar',
            syncMode: 'fast',
        }));
    }

    return dedupeModules(modules);
}

function renderLatestModules() {
    if (!ui.modulesRoot) return;
    const latest = runtime.latestTurnId ? runtime.chatState?.turns?.[runtime.latestTurnId] : null;
    if (!latest) {
        ui.modulesRoot.innerHTML = '<div class="idic-companion__empty">暂无可同步内容</div>';
        return;
    }

    if (!Array.isArray(latest.modules) || latest.modules.length === 0) {
        ui.modulesRoot.innerHTML = '<div class="idic-companion__empty">这一楼还没有拆出可同步模块</div>';
        return;
    }

    ui.modulesRoot.innerHTML = latest.modules.map((module) => {
        const mode = getModuleSyncMode(module);
        return `
            <div class="idic-companion__module" data-module-id="${escapeHtml(module.id)}">
                <div class="idic-companion__module-head">
                    <div class="idic-companion__module-title">
                        <span>${escapeHtml(module.label)}</span>
                        <span class="idic-companion__module-tag">${escapeHtml(getModuleSourceTag(module))}</span>
                    </div>
                    <span class="idic-companion__chip ${mode === 'fast' ? 'fast' : 'long'}">${escapeHtml(getModuleSyncModeLabel(mode))}</span>
                </div>
                <div class="idic-companion__module-modes">
                    ${MODULE_SYNC_MODES.map((value) => `
                        <button
                            type="button"
                            class="idic-companion__module-mode ${mode === value ? 'active' : ''}"
                            data-module-mode="${escapeHtml(module.id)}"
                            data-mode="${escapeHtml(value)}"
                        >${escapeHtml(getModuleSyncModeLabel(value))}</button>
                    `).join('')}
                </div>
                <pre class="idic-companion__module-preview">${escapeHtml(module.text)}</pre>
            </div>
        `;
    }).join('');

    ui.modulesRoot.querySelectorAll('[data-module-mode]').forEach((element) => {
        element.addEventListener('click', async (event) => {
            const target = event.currentTarget;
            if (!(target instanceof HTMLButtonElement)) return;
            const moduleId = target.getAttribute('data-module-mode');
            const mode = target.getAttribute('data-mode');
            if (!moduleId || !MODULE_SYNC_MODES.includes(String(mode))) return;
            const turn = runtime.chatState?.turns?.[runtime.latestTurnId];
            if (!turn) return;
            const previousTurn = normalizeTurnEntry(turn, turn.turnId);
            turn.modules = turn.modules.map((module) => {
                if (module.id !== moduleId) return module;
                const updated = applyModuleSyncMode(module, String(mode));
                rememberModuleSyncPreference(updated, String(mode));
                return updated;
            });
            turn.summarySourceDigest = computePersistentDigest(turn.userText, turn.modules);
            refreshTurnSummaryState(turn, previousTurn);
            runtime.chatState.stageSummaries = [];
            await persistChatState();
            renderContextStats();
            renderLatestModules();
            scheduleBackgroundMaintenance();
        });
    });
}

function splitUserMessageLines(text) {
    return String(text == null ? '' : text)
        .replace(/\r/g, '\n')
        .split(/\n+/g)
        .map((line) => line.trim())
        .filter(Boolean);
}

function splitAssistantSentenceLine(line) {
    const safeLine = String(line || '')
        .replace(/^(\d+[\.\)、]\s*|[-*•]\s*)/, '')
        .trim();
    if (!safeLine) return [];

    const sentenceReady = safeLine
        .replace(/([。！？!?；;…]{1,2})(?=[^\s])/g, '$1\n');

    return sentenceReady
        .split(/\n+/g)
        .map((part) => part.trim())
        .filter(Boolean);
}

function normalizeAssistantReplyLines(text) {
    const raw = String(text == null ? '' : text).replace(/\r/g, '\n').trim();
    if (!raw) return [];
    const result = [];
    raw.split(/\n+/g).forEach((line) => {
        const parts = splitAssistantSentenceLine(line);
        if (parts.length > 0) {
            result.push(...parts);
        }
    });
    return result.length ? result : [raw];
}

function getTranscriptBatchId(item) {
    return toTrimmedString(item?.batchId) || toTrimmedString(item?.id);
}

function trimTranscript() {
    if (!runtime.chatState) return;
    if (runtime.chatState.transcript.length > TRANSCRIPT_STORAGE_HARD_CAP) {
        runtime.chatState.transcript = runtime.chatState.transcript.slice(-TRANSCRIPT_STORAGE_HARD_CAP);
    }
    if (runtime.selectedTranscriptIds instanceof Set) {
        const existingIds = new Set(runtime.chatState.transcript.map((item) => String(item?.id || '')));
        runtime.selectedTranscriptIds = new Set(
            Array.from(runtime.selectedTranscriptIds).filter((id) => existingIds.has(id))
        );
        if (runtime.selectedTranscriptIds.size === 0) {
            runtime.transcriptSelectionMode = false;
        }
    }
}

function appendTranscriptEntries(entries, options = {}) {
    if (!runtime.chatState) runtime.chatState = createDefaultChatState();
    const items = Array.isArray(entries)
        ? entries.map((entry) => normalizeTranscriptEntry(entry)).filter(Boolean)
        : [];
    if (!items.length) return [];
    runtime.chatState.transcript.push(...items);
    trimTranscript();
    if (options.persist !== false) {
        void persistChatState();
    }
    if (options.sync !== false) {
        scheduleCompanionRecentChatsSync();
    }
    return items;
}

function replaceTranscriptBatch(batchId, entries, options = {}) {
    if (!runtime.chatState) runtime.chatState = createDefaultChatState();
    const safeBatchId = toTrimmedString(batchId);
    runtime.chatState.transcript = runtime.chatState.transcript.filter((item) => getTranscriptBatchId(item) !== safeBatchId);
    appendTranscriptEntries(entries, { persist: false, sync: false });
    trimTranscript();
    if (options.persist !== false) {
        void persistChatState();
    }
    if (options.sync !== false) {
        scheduleCompanionRecentChatsSync();
    }
}

function findLatestTranscriptBatch(role, beforeIndex = null) {
    const transcript = Array.isArray(runtime.chatState?.transcript) ? runtime.chatState.transcript : [];
    const startIndex = Number.isFinite(Number(beforeIndex))
        ? Math.min(transcript.length - 1, Number(beforeIndex) - 1)
        : transcript.length - 1;
    for (let index = startIndex; index >= 0; index -= 1) {
        const item = transcript[index];
        if (!item || item.pending) continue;
        if (role && item.role !== role) continue;
        const batchId = getTranscriptBatchId(item);
        if (!batchId) continue;
        let firstIndex = index;
        while (firstIndex - 1 >= 0 && getTranscriptBatchId(transcript[firstIndex - 1]) === batchId) {
            firstIndex -= 1;
        }
        const items = transcript.slice(firstIndex, index + 1).filter((entry) => getTranscriptBatchId(entry) === batchId);
        return { batchId, firstIndex, lastIndex: index, items };
    }
    return null;
}

function isTranscriptEntrySelectable(item) {
    return Boolean(item && !item.pending);
}

function updateTranscriptSelectionBar() {
    if (!ui.selectBar || !ui.selectCount) return;
    const selectedCount = runtime.selectedTranscriptIds instanceof Set ? runtime.selectedTranscriptIds.size : 0;
    const active = Boolean(runtime.transcriptSelectionMode && selectedCount > 0);
    ui.selectBar.classList.toggle('hidden', !active);
    ui.selectCount.textContent = `已选 ${selectedCount} 条`;
    if (ui.selectDeleteButton) {
        ui.selectDeleteButton.disabled = selectedCount === 0;
    }
}

function enterTranscriptSelectionMode(initialId = '') {
    runtime.transcriptSelectionMode = true;
    if (!(runtime.selectedTranscriptIds instanceof Set)) {
        runtime.selectedTranscriptIds = new Set();
    }
    if (initialId) {
        runtime.selectedTranscriptIds.add(initialId);
    }
    updateTranscriptSelectionBar();
    renderTranscript();
}

function exitTranscriptSelectionMode() {
    runtime.transcriptSelectionMode = false;
    runtime.selectedTranscriptIds = new Set();
    updateTranscriptSelectionBar();
    renderTranscript();
}

function toggleTranscriptSelection(id) {
    const safeId = toTrimmedString(id);
    if (!safeId) return;
    if (!(runtime.selectedTranscriptIds instanceof Set)) {
        runtime.selectedTranscriptIds = new Set();
    }
    if (runtime.selectedTranscriptIds.has(safeId)) {
        runtime.selectedTranscriptIds.delete(safeId);
    } else {
        runtime.selectedTranscriptIds.add(safeId);
    }
    if (runtime.selectedTranscriptIds.size === 0) {
        runtime.transcriptSelectionMode = false;
    }
    updateTranscriptSelectionBar();
    renderTranscript();
}

async function deleteSelectedTranscriptEntries() {
    if (!(runtime.selectedTranscriptIds instanceof Set) || runtime.selectedTranscriptIds.size === 0) return;
    const selectedIds = new Set(runtime.selectedTranscriptIds);
    runtime.chatState.transcript = runtime.chatState.transcript.filter((item) => !selectedIds.has(String(item?.id || '')));
    runtime.transcriptSelectionMode = false;
    runtime.selectedTranscriptIds = new Set();
    trimTranscript();
    await persistChatState();
    scheduleCompanionRecentChatsSync();
    renderTranscript();
}

function loadMoreTranscriptMessages() {
    runtime.transcriptRenderCount += TRANSCRIPT_RENDER_PAGE_SIZE;
    renderTranscript();
}

function bindTranscriptBubbleEvents() {
    if (!ui.transcriptRoot) return;
    ui.transcriptRoot.querySelector('[data-load-more-transcript]')?.addEventListener('click', () => {
        loadMoreTranscriptMessages();
    });
    ui.transcriptRoot.querySelectorAll('[data-transcript-id]').forEach((element) => {
        const transcriptId = toTrimmedString(element.getAttribute('data-transcript-id'));
        if (!transcriptId) return;
        let longPressTimer = null;
        let longPressTriggered = false;
        const clearLongPress = () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        };
        element.addEventListener('click', () => {
            if (longPressTriggered) {
                longPressTriggered = false;
                return;
            }
            if (!runtime.transcriptSelectionMode) return;
            toggleTranscriptSelection(transcriptId);
        });
        element.addEventListener('pointerdown', () => {
            if (runtime.transcriptSelectionMode) return;
            longPressTimer = setTimeout(() => {
                longPressTriggered = true;
                enterTranscriptSelectionMode(transcriptId);
                longPressTimer = null;
            }, 420);
        });
        element.addEventListener('pointerup', clearLongPress);
        element.addEventListener('pointerleave', clearLongPress);
        element.addEventListener('pointercancel', clearLongPress);
        element.addEventListener('pointermove', clearLongPress);
    });
}

function renderTranscript() {
    if (!ui.transcriptRoot) return;
    const transcript = Array.isArray(runtime.chatState?.transcript) ? runtime.chatState.transcript : [];
    const roleName = getActiveRoleName();
    renderComposerState(roleName);
    updateTranscriptSelectionBar();

    if (transcript.length === 0) {
        runtime.transcriptSelectionMode = false;
        runtime.selectedTranscriptIds = new Set();
        updateTranscriptSelectionBar();
        ui.transcriptRoot.innerHTML = `<div class="idic-companion__empty">${roleName ? '还没有开始聊天' : '先选角色'}</div>`;
        return;
    }

    const binding = ensureChatMeta()?.binding || createDefaultBinding();
    const assistantName = binding.displayName || binding.charName || '陪读';
    const renderCount = Math.max(TRANSCRIPT_RENDER_PAGE_SIZE, runtime.transcriptRenderCount || TRANSCRIPT_RENDER_PAGE_SIZE);
    const startIndex = Math.max(0, transcript.length - renderCount);
    const visibleItems = transcript.slice(startIndex);
    const html = [];

    if (startIndex > 0) {
        html.push('<button type="button" class="idic-companion__load-more" data-load-more-transcript="1">更多消息</button>');
    }

    visibleItems.forEach((item) => {
        const role = item.role;
        const cls = role === 'user' ? 'user' : (role === 'assistant' ? 'assistant' : 'system');
        const timestamp = new Date(item.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const speaker = role === 'user' ? '你' : (role === 'assistant' ? assistantName : '系统');
        const selectable = isTranscriptEntrySelectable(item);
        const selected = selectable && runtime.selectedTranscriptIds instanceof Set && runtime.selectedTranscriptIds.has(String(item.id));
        html.push(`
            <div class="idic-companion__bubble ${cls} ${selectable ? 'selectable' : ''} ${selected ? 'selected' : ''}" ${selectable ? `data-transcript-id="${escapeHtml(item.id)}"` : ''}>
                ${selectable ? `<span class="idic-companion__bubble-check">${selected ? '✓' : ''}</span>` : ''}
                <div class="idic-companion__bubble-box">${escapeHtml(item.text)}</div>
                <div class="idic-companion__bubble-meta">${escapeHtml(speaker)} · ${escapeHtml(timestamp)}${item.pending ? ' · 发送中' : ''}</div>
            </div>
        `);
    });

    ui.transcriptRoot.innerHTML = html.join('');
    bindTranscriptBubbleEvents();
    if (ui.scrollRoot && !runtime.transcriptSelectionMode) {
        ui.scrollRoot.scrollTop = ui.scrollRoot.scrollHeight;
    }
}

function buildTranscriptPayload() {
    const settings = ensureSettings();
    const transcript = Array.isArray(runtime.chatState?.transcript) ? runtime.chatState.transcript : [];
    const batches = [];
    transcript
        .filter((item) => !item.pending && (item.role === 'user' || item.role === 'assistant'))
        .forEach((item) => {
            const batchId = getTranscriptBatchId(item);
            const lastBatch = batches[batches.length - 1];
            if (lastBatch && lastBatch.batchId === batchId && lastBatch.role === item.role) {
                lastBatch.items.push(item);
                return;
            }
            batches.push({
                batchId,
                role: item.role,
                items: [item],
            });
        });

    const maxBatches = Math.max(4, settings.maxTranscriptTurns * 2);
    return batches
        .slice(-maxBatches)
        .flatMap((batch) => batch.items.map((item) => ({
            role: item.role,
            text: item.text,
        })));
}

function buildCompanionRecentChatsPayload() {
    const transcript = Array.isArray(runtime.chatState?.transcript) ? runtime.chatState.transcript : [];
    return transcript
        .filter((item) => !item.pending && (item.role === 'user' || item.role === 'assistant'))
        .slice(-COMPANION_RECENT_CHAT_LIMIT)
        .map((item) => ({
            id: item.id,
            role: item.role,
            content: item.text,
            time: new Date(item.createdAt || Date.now()).toISOString(),
            batchId: getTranscriptBatchId(item),
            source: 'sillytavern_companion',
            sourceLabel: '酒馆陪读',
        }));
}

function scheduleCompanionRecentChatsSync(delayMs = 240) {
    if (runtime.companionRecentChatsSyncTimer) {
        clearTimeout(runtime.companionRecentChatsSyncTimer);
    }
    runtime.companionRecentChatsSyncTimer = setTimeout(() => {
        runtime.companionRecentChatsSyncTimer = null;
        void syncCompanionRecentChatsToSnapshot();
    }, Math.max(120, Number(delayMs) || 240));
}

async function syncCompanionRecentChatsToSnapshot() {
    const binding = getBindingPayload();
    if (!binding.userId || !binding.charId) return;
    try {
        await callBridge('sync_companion_recent_chats', {
            binding,
            recentChats: buildCompanionRecentChatsPayload(),
            stChatLabel: getCurrentChatLabel(),
        });
        window.dispatchEvent(new CustomEvent('idic-companion-recent-chats-updated', {
            detail: {
                charId: binding.charId,
            },
        }));
    } catch (error) {
        console.warn(`[${MODULE_NAME}] recent chat sync failed`, error);
    }
}

async function sendCompanionMessage() {
    if (runtime.sendInFlight) return;
    const lines = splitUserMessageLines(ui.input?.value);
    if (lines.length === 0) return;

    await saveBindingFromSelection({ silent: true });
    const binding = getBindingPayload();
    if (!binding.charId || !binding.charName || (!binding.charPersona && !binding.promptProfile)) {
        notify('请先选择角色', 'warning');
        setPanelOpen(true);
        return;
    }

    runtime.sendInFlight = true;
    setStatus('正在整理上下文...', 'info');
    await syncStateFromChat({ captureLatestStatus: true, forceLatestRescan: false });
    await scheduleImmediateContextHydration();

    const userBatchId = createId();
    const pendingBatchId = createId();
    const now = Date.now();
    appendTranscriptEntries(lines.map((text, index) => ({
        id: createId(),
        role: 'user',
        text,
        createdAt: now + index,
        batchId: userBatchId,
        sourceType: 'companion',
    })), { persist: false, sync: false });
    appendTranscriptEntries([{
        id: createId(),
        role: 'assistant',
        text: '...',
        createdAt: now + lines.length + 1,
        pending: true,
        batchId: pendingBatchId,
        sourceType: 'companion',
    }], { persist: false, sync: false });
    trimTranscript();
    await persistChatState();
    scheduleCompanionRecentChatsSync();
    renderTranscript();
    if (ui.input) ui.input.value = '';
    setStatus('对方正在输入...', 'info');

    try {
        const response = await callBridge('reply', {
            binding,
            apiConfig: getApiConfigPayload(),
            readingContext: buildReadingContextPayload(),
            transcript: buildTranscriptPayload(),
            userMessage: lines.join('\n'),
            userMessages: lines,
            stChatLabel: getCurrentChatLabel(),
            replyControl: {
                replyMode: 'normal',
            },
        });

        const replyLines = normalizeAssistantReplyLines(toTrimmedString(response.reply) || '没有收到回复');
        replaceTranscriptBatch(pendingBatchId, replyLines.map((text, index) => ({
            id: createId(),
            role: 'assistant',
            text,
            createdAt: Date.now() + index,
            batchId: pendingBatchId,
            sourceType: 'companion',
        })));
        await persistChatState();
        scheduleCompanionRecentChatsSync();
        renderTranscript();
        setStatus(`已回复，命中 ${Number(response.memoryCount || 0)} 条海马体记忆`, 'success');
    } catch (error) {
        replaceTranscriptBatch(pendingBatchId, [{
            id: createId(),
            role: 'system',
            text: `连接失败：${error.message}`,
            createdAt: Date.now(),
            batchId: pendingBatchId,
            sourceType: 'system',
        }]);
        await persistChatState();
        scheduleCompanionRecentChatsSync();
        renderTranscript();
        setStatus(`连接失败：${error.message}`, 'error');
    } finally {
        runtime.sendInFlight = false;
        renderBinding();
    }
}

async function regenerateCompanionReply() {
    if (runtime.sendInFlight) return;
    const transcriptSnapshot = Array.isArray(runtime.chatState?.transcript) ? runtime.chatState.transcript.slice() : [];
    const lastAssistantBatch = findLatestTranscriptBatch('assistant');
    const lastUserBatch = lastAssistantBatch
        ? findLatestTranscriptBatch('user', lastAssistantBatch.firstIndex)
        : findLatestTranscriptBatch('user');
    if (!lastUserBatch) {
        notify('还没有可重写的上一轮', 'info');
        return;
    }

    if (lastAssistantBatch) {
        runtime.chatState.transcript = runtime.chatState.transcript.filter((item) => getTranscriptBatchId(item) !== lastAssistantBatch.batchId);
        await persistChatState();
        scheduleCompanionRecentChatsSync();
        renderTranscript();
    }

    await sendBridgeReply({
        userMessage: lastUserBatch.items.map((item) => item.text).join('\n'),
        userMessages: lastUserBatch.items.map((item) => item.text),
        replyMode: 'regenerate',
        statusLabel: '正在重写...',
    }).catch(async (error) => {
        runtime.chatState.transcript = transcriptSnapshot;
        await persistChatState();
        scheduleCompanionRecentChatsSync();
        renderTranscript();
        throw error;
    });
}

async function continueCompanionReply() {
    if (runtime.sendInFlight) return;
    const lastAssistantBatch = findLatestTranscriptBatch('assistant');
    if (!lastAssistantBatch || lastAssistantBatch.items.length === 0) {
        notify('还没有可续写的回复', 'info');
        return;
    }

    await sendBridgeReply({
        userMessage: '',
        userMessages: [],
        replyMode: 'continue',
        continueFrom: lastAssistantBatch.items.map((item) => item.text).join('\n'),
        statusLabel: '正在续写...',
    });
}

async function sendBridgeReply(options) {
    await saveBindingFromSelection({ silent: true });
    const binding = getBindingPayload();
    if (!binding.charId || !binding.charName || (!binding.charPersona && !binding.promptProfile)) {
        notify('请先选择角色', 'warning');
        return;
    }

    runtime.sendInFlight = true;
    await syncStateFromChat({ captureLatestStatus: true, forceLatestRescan: false });
    await scheduleImmediateContextHydration();

    const pendingBatchId = createId();
    appendTranscriptEntries([{
        id: createId(),
        role: 'assistant',
        text: '...',
        createdAt: Date.now(),
        pending: true,
        batchId: pendingBatchId,
        sourceType: 'companion',
    }], { persist: false, sync: false });
    await persistChatState();
    renderTranscript();
    setStatus(options.statusLabel || '对方正在输入...', 'info');

    try {
        const response = await callBridge('reply', {
            binding,
            apiConfig: getApiConfigPayload(),
            readingContext: buildReadingContextPayload(),
            transcript: buildTranscriptPayload(),
            userMessage: toTrimmedString(options.userMessage),
            userMessages: Array.isArray(options.userMessages) ? options.userMessages : [],
            stChatLabel: getCurrentChatLabel(),
            replyControl: {
                replyMode: options.replyMode || 'normal',
                continueFrom: toTrimmedString(options.continueFrom),
            },
        });

        const replyLines = normalizeAssistantReplyLines(toTrimmedString(response.reply) || '没有收到回复');
        replaceTranscriptBatch(pendingBatchId, replyLines.map((text, index) => ({
            id: createId(),
            role: 'assistant',
            text,
            createdAt: Date.now() + index,
            batchId: pendingBatchId,
            sourceType: 'companion',
        })));
        await persistChatState();
        scheduleCompanionRecentChatsSync();
        renderTranscript();
        setStatus(`已回复，命中 ${Number(response.memoryCount || 0)} 条海马体记忆`, 'success');
    } catch (error) {
        replaceTranscriptBatch(pendingBatchId, [{
            id: createId(),
            role: 'system',
            text: `连接失败：${error.message}`,
            createdAt: Date.now(),
            batchId: pendingBatchId,
            sourceType: 'system',
        }]);
        await persistChatState();
        scheduleCompanionRecentChatsSync();
        renderTranscript();
        setStatus(`连接失败：${error.message}`, 'error');
        throw error;
    } finally {
        runtime.sendInFlight = false;
        renderBinding();
    }
}
