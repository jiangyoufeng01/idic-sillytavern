const MODULE_NAME = 'idic_companion';
const STATE_STORAGE_PREFIX = 'idic-companion-state:';
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
const DISCARD_TAGS = [
    'thought',
    'thinking',
    'reasoning',
    'analysis',
    'cot',
    'chainofthought',
    'reflection',
    'internal',
];
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
};

const ui = {};

void bootstrap();

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
    const persistence = source.persistence === 'fast' ? 'fast' : 'long';
    return {
        id: toTrimmedString(source.id) || createId(),
        kind: toTrimmedString(source.kind) || 'other_text_block',
        label: toTrimmedString(source.label) || '文本',
        text,
        selected: source.selected !== false,
        persistence,
        preview: clipText(source.preview || text, 220),
    };
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
    const response = await fetch(new URL('settings.html', import.meta.url));
    const html = await response.text();
    const container = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!container) return;
    const root = document.createElement('div');
    root.innerHTML = html;
    runtime.settingsRoot = root.firstElementChild;
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
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
        <button id="idic-companion-launcher" type="button" aria-label="打开陪读窗">
            <span id="idic-companion-launcher-text" class="idic-companion__launcher-text">陪</span>
        </button>
        <div id="idic-companion-panel" class="hidden">
            <div class="idic-companion__header">
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
    document.body.appendChild(wrapper);

    ui.launcher = document.getElementById('idic-companion-launcher');
    ui.launcherText = document.getElementById('idic-companion-launcher-text');
    ui.panel = document.getElementById('idic-companion-panel');
    ui.avatar = document.getElementById('idic-companion-avatar');
    ui.chatTitle = document.getElementById('idic-companion-chat-title');
    ui.subtitle = document.getElementById('idic-companion-subtitle');
    ui.footerStatus = document.getElementById('idic-companion-footer-status');
    ui.closeButton = document.getElementById('idic-companion-close');
    ui.contextChips = document.getElementById('idic-companion-context-chips');
    ui.modulesRoot = document.getElementById('idic-companion-modules');
    ui.scrollRoot = document.getElementById('idic-companion-scroll');
    ui.transcriptRoot = document.getElementById('idic-companion-transcript');
    ui.input = document.getElementById('idic-companion-input');
    ui.sendButton = document.getElementById('idic-companion-send');
    ui.refreshRolesButton = document.getElementById('idic-companion-refresh-roles');
    ui.roleSelect = document.getElementById('idic-companion-role-select');
    ui.regenerateButton = document.getElementById('idic-companion-regenerate');
    ui.continueButton = document.getElementById('idic-companion-continue');
    ui.openSyncSheetButton = document.getElementById('idic-companion-open-sync-sheet');
    ui.syncSheet = document.getElementById('idic-companion-sync-sheet');
    ui.syncSheetMask = document.getElementById('idic-companion-sync-sheet-mask');
    ui.closeSyncSheetButton = document.getElementById('idic-companion-close-sync-sheet');

    ui.launcher?.addEventListener('click', () => setPanelOpen(!runtime.panelOpen));
    ui.closeButton?.addEventListener('click', () => setPanelOpen(false));
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
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void sendCompanionMessage();
        }
    });
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

function setPanelOpen(open) {
    runtime.panelOpen = Boolean(open);
    if (ui.panel) {
        ui.panel.classList.toggle('hidden', !runtime.panelOpen);
    }
    if (ui.launcher) {
        ui.launcher.classList.toggle('hidden', runtime.panelOpen);
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
            previousMap.set(buildModuleSelectionKey(module), module.selected !== false);
        });
    }
    return modules.map((module) => {
        const key = buildModuleSelectionKey(module);
        const selected = previousMap.has(key) ? previousMap.get(key) : defaultModuleSelection(module);
        return Object.assign({}, module, { selected });
    });
}

function buildModuleSelectionKey(module) {
    return `${module.kind}::${module.label}::${hashText(module.text).slice(0, 12)}`;
}

function defaultModuleSelection(module) {
    if (module.kind === 'other_text_block') return false;
    return true;
}

function getBuiltInSummaryState(turn) {
    if (!turn || !Array.isArray(turn.modules)) return null;
    const summaryModules = turn.modules.filter((module) => module.selected && module.kind === 'summary' && module.persistence === 'long' && module.text);
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
            const selectedCount = latest.modules.filter((module) => module.selected !== false).length;
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
    if (settings.bridgeAuthKey) {
        headers.authorization = `Bearer ${settings.bridgeAuthKey}`;
        headers.apikey = settings.bridgeAuthKey;
    }

    const response = await fetch(bridgeUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(Object.assign({ action }, payload || {})),
    });

    const raw = await response.text();
    const parsed = tryParseJson(raw);
    if (!response.ok) {
        const message = parsed && typeof parsed.error === 'string'
            ? parsed.error
            : (raw || `HTTP ${response.status}`);
        throw new Error(message);
    }
    return parsed && typeof parsed === 'object' ? parsed : {};
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
