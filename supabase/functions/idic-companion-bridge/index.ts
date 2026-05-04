import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

type Obj = Record<string, unknown>;

type ApiConfig = {
    apiUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
};

type Binding = ReturnType<typeof normalizeBinding>;
type ReadingContext = ReturnType<typeof normalizeReadingContext>;
type TranscriptEntry = ReturnType<typeof normalizeTranscript>[number];

const SUPABASE_URL = trim(Deno.env.get("SUPABASE_URL"));
const SUPABASE_SERVICE_ROLE_KEY = trim(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
const BRIDGE_TOKEN = trim(Deno.env.get("IDIC_COMPANION_BRIDGE_TOKEN"));
const ENV_API_URL = trim(Deno.env.get("IDIC_COMPANION_API_URL"));
const ENV_API_KEY = trim(Deno.env.get("IDIC_COMPANION_API_KEY"));
const ENV_API_MODEL = trim(Deno.env.get("IDIC_COMPANION_API_MODEL")) || "gpt-4o-mini";
const ENV_API_TEMPERATURE = clampNumber(Deno.env.get("IDIC_COMPANION_API_TEMPERATURE"), 0, 2, 0.75);

const CORS_HEADERS = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-idic-bridge-token",
    "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            ...CORS_HEADERS,
            "content-type": "application/json; charset=utf-8",
        },
    });

const fail = (message: string, status = 400, extra: Obj = {}) =>
    json({ ok: false, error: message, ...extra }, status);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") {
        return new Response("ok", { headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
        return fail("method_not_allowed", 405);
    }

    if (BRIDGE_TOKEN) {
        const token = trim(request.headers.get("x-idic-bridge-token"));
        if (token !== BRIDGE_TOKEN) {
            return fail("bridge_token_invalid", 401);
        }
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return fail("supabase_env_missing", 500);
    }

    let body: Obj;
    try {
        body = asObj(await request.json());
    } catch {
        return fail("invalid_json_body", 400);
    }

    const action = trim(body.action).toLowerCase();
    try {
        if (action === "list_roles") {
            return json(await handleListRoles());
        }
        if (action === "reply") {
            return json(await handleReply(body));
        }
        if (action === "summarize_turn") {
            return json(await handleSummarizeTurn(body));
        }
        if (action === "rollup_stage") {
            return json(await handleRollupStage(body));
        }
        return fail(`unsupported_action:${action || "empty"}`, 400);
    } catch (error) {
        console.error("[idic-companion-bridge] unhandled error", error);
        return fail(error instanceof Error ? error.message : String(error || "unknown_error"), 500);
    }
});

async function handleListRoles() {
    const { data, error } = await supabase
        .from("idic_companion_role_snapshots")
        .select("owner_user_id,char_id,char_name,display_name,hippocampus_enabled,snapshot,updated_at")
        .order("updated_at", { ascending: false })
        .limit(200);

    if (error) {
        if (isMissingRelationError(error)) {
            throw new Error("idic_companion_role_snapshots_table_missing");
        }
        throw error;
    }

    const roles = arrayOfObjects(data).map((row) => {
        const snapshot = asObj(row.snapshot);
        const charId = trim(row.char_id || snapshot.charId);
        const charName = trim(row.char_name || snapshot.charName);
        const displayName = trim(row.display_name || snapshot.displayName || charName || charId);
        const updatedAt = trim(row.updated_at || snapshot.updatedAt);
        const userId = trim(row.owner_user_id || snapshot.ownerUserId || snapshot.userId);
        return {
            ownerUserId: userId,
            charId,
            charName,
            displayName,
            updatedAt,
            hippocampusEnabled: toBoolean(row.hippocampus_enabled ?? snapshot.hippocampusEnabled),
            snapshot: {
                ownerUserId: userId,
                charId,
                charName,
                displayName,
                charPersona: trim(snapshot.charPersona || snapshot.persona),
                userName: trim(snapshot.userName),
                userPersona: trim(snapshot.userPersona),
                relationshipHint: trim(snapshot.relationshipHint),
                systemPrompt: trim(snapshot.systemPrompt),
                promptProfile: trim(snapshot.promptProfile),
                hippocampusEnabled: toBoolean(row.hippocampus_enabled ?? snapshot.hippocampusEnabled),
                updatedAt,
            },
        };
    }).filter((item) => item.charId && (item.charName || item.displayName));

    return { ok: true, roles };
}

async function handleReply(body: Obj) {
    const apiConfig = resolveApiConfig(body.apiConfig);
    const binding = normalizeBinding(body.binding);
    validateBinding(binding);

    const readingContext = normalizeReadingContext(body.readingContext);
    const transcript = normalizeTranscript(body.transcript);
    const control = normalizeReplyControl(body.replyControl || body);
    const userMessage = trim(body.userMessage);
    const stChatLabel = trim(body.stChatLabel);

    if (control.replyMode !== "continue" && !userMessage) {
        throw new Error("user_message_required");
    }
    if (control.replyMode === "continue" && !control.continueFrom) {
        throw new Error("continue_source_required");
    }

    const recalled = await recallBindingMemories(binding, userMessage, readingContext, control);
    if (recalled.length > 0 && binding.hippocampusEnabled) {
        await activateMemoryIds(binding.userId, recalled.map((item) => item.id).filter(Boolean));
    }

    const messages = buildReplyMessages({
        apiConfig,
        binding,
        readingContext,
        transcript,
        userMessage,
        stChatLabel,
        recalled,
        control,
    });

    const reply = await callChatCompletions(messages, apiConfig, apiConfig.temperature, 1000);

    await writeCompanionMemory({
        binding,
        readingContext,
        userMessage,
        assistantReply: reply,
        control,
    });

    return {
        ok: true,
        reply,
        memoryCount: recalled.length,
        recalledMemories: recalled.map((item) => ({
            id: item.id,
            preview: clip(item.content, 120),
            sourceType: item.sourceType || "",
        })),
    };
}

async function handleSummarizeTurn(body: Obj) {
    const apiConfig = resolveApiConfig(body.apiConfig);
    const binding = normalizeBinding(body.binding);
    const turn = normalizeTurnPayload(body.turn);
    if (!turn.userText && turn.aiModules.length === 0) {
        throw new Error("empty_turn_payload");
    }

    const system = [
        "你是一个剧情摘要器。",
        "任务：把一个 SillyTavern 完整回合压缩成短摘要，供陪读上下文长期链使用。",
        "保留：用户说了什么、AI正文推进了什么、关系/事件/氛围变化。",
        "不要输出思维链，不要解释代码，不要把状态栏或 HTML 小剧场写成长篇重复描述。",
        "输出 JSON：{\"title\":\"...\",\"summary\":\"...\"}",
    ].join("\n");

    const prompt = [
        binding.charName ? `陪读角色：${binding.charName}` : "",
        `用户输入：\n${turn.userText || "（无）"}`,
        "AI 选中模块：",
        ...(turn.aiModules.length > 0
            ? turn.aiModules.map((item) => `- [${item.label}] ${item.text}`)
            : ["- （无）"]),
    ].filter(Boolean).join("\n\n");

    const raw = await callChatCompletions([
        { role: "system", content: system },
        { role: "user", content: prompt },
    ], apiConfig, 0.2, 320);
    const parsed = parseJsonLoose(raw);
    return {
        ok: true,
        title: trim((parsed && parsed.title) || "回合摘要"),
        summary: trim((parsed && parsed.summary) || raw),
    };
}

async function handleRollupStage(body: Obj) {
    const apiConfig = resolveApiConfig(body.apiConfig);
    const summaries = normalizeSummaryItems(body.summaries);
    if (summaries.length === 0) {
        throw new Error("empty_rollup_summaries");
    }

    const system = [
        "你是一个剧情阶段总结构建器。",
        "任务：把一批已经很短的逐回合摘要再压成更短的阶段总结。",
        "保留：剧情主线、重要关系变化、关键转折、当前悬念。",
        "不要罗列细枝末节，不要重复同义信息。",
        "输出 JSON：{\"title\":\"...\",\"summary\":\"...\"}",
    ].join("\n");

    const prompt = [
        "以下是按时间顺序排列的逐回合摘要：",
        ...summaries.map((item, index) => `${index + 1}. ${item.title ? `[${item.title}] ` : ""}${item.summary}`),
    ].join("\n");

    const raw = await callChatCompletions([
        { role: "system", content: system },
        { role: "user", content: prompt },
    ], apiConfig, 0.2, 420);
    const parsed = parseJsonLoose(raw);
    return {
        ok: true,
        title: trim((parsed && parsed.title) || "阶段总结"),
        summary: trim((parsed && parsed.summary) || raw),
    };
}

function normalizeBinding(value: unknown) {
    const source = asObj(value);
    return {
        sessionId: trim(source.sessionId),
        userId: trim(source.userId || source.ownerUserId),
        charId: trim(source.charId),
        charName: trim(source.charName || source.displayName),
        displayName: trim(source.displayName || source.charName),
        charPersona: trim(source.charPersona),
        userName: trim(source.userName),
        userPersona: trim(source.userPersona),
        relationshipHint: trim(source.relationshipHint),
        systemPrompt: trim(source.systemPrompt),
        promptProfile: trim(source.promptProfile),
        hippocampusEnabled: toBoolean(source.hippocampusEnabled),
        snapshotUpdatedAt: trim(source.snapshotUpdatedAt || source.updatedAt),
    };
}

function validateBinding(binding: Binding) {
    if (!binding.charId) {
        throw new Error("binding_char_id_missing");
    }
    if (!binding.charName && !binding.displayName) {
        throw new Error("binding_char_name_missing");
    }
    if (!binding.charPersona && !binding.promptProfile) {
        throw new Error("binding_char_snapshot_incomplete");
    }
}

function normalizeReadingContext(value: unknown) {
    const source = asObj(value);
    const recentFullTurns = arrayOfObjects(source.recentFullTurns).map((item) => ({
        turnId: trim(item.turnId),
        userText: trim(item.userText),
        aiSpeaker: trim(item.aiSpeaker) || "Assistant",
        aiModules: arrayOfObjects(item.aiModules).map((module) => ({
            label: trim(module.label) || "模块",
            kind: trim(module.kind) || "content",
            text: trim(module.text),
        })).filter((module) => module.text),
    }));
    const olderTurnSummaries = arrayOfObjects(source.olderTurnSummaries).map((item) => ({
        turnId: trim(item.turnId),
        title: trim(item.title),
        summary: trim(item.summary),
        source: trim(item.source),
    })).filter((item) => item.summary);
    const stageSummaries = arrayOfObjects(source.stageSummaries).map((item) => ({
        id: trim(item.id),
        title: trim(item.title) || "阶段总结",
        summary: trim(item.summary),
    })).filter((item) => item.summary);
    const currentFastFoodModules = arrayOfObjects(source.currentFastFoodModules).map((item) => ({
        label: trim(item.label) || "模块",
        kind: trim(item.kind) || "statusbar_raw",
        text: trim(item.text),
    })).filter((item) => item.text);

    return {
        sessionId: trim(source.sessionId),
        stageSummaries,
        olderTurnSummaries,
        recentFullTurns,
        currentFastFoodModules,
    };
}

function normalizeTranscript(value: unknown) {
    return arrayOfObjects(value).map((item) => ({
        role: trim(item.role).toLowerCase() === "assistant" ? "assistant" : "user",
        text: trim(item.text),
    })).filter((item) => item.text);
}

function normalizeReplyControl(value: unknown) {
    const source = asObj(value);
    const replyMode = trim(source.replyMode || source.mode).toLowerCase();
    return {
        replyMode: replyMode === "continue" ? "continue" : (replyMode === "regenerate" ? "regenerate" : "normal"),
        continueFrom: trim(source.continueFrom),
    };
}

function normalizeTurnPayload(value: unknown) {
    const source = asObj(value);
    return {
        turnId: trim(source.turnId),
        userText: trim(source.userText),
        aiModules: arrayOfObjects(source.aiModules).map((item) => ({
            label: trim(item.label) || "模块",
            text: trim(item.text),
        })).filter((item) => item.text),
    };
}

function normalizeSummaryItems(value: unknown) {
    return arrayOfObjects(value).map((item) => ({
        turnId: trim(item.turnId),
        title: trim(item.title),
        summary: trim(item.summary),
    })).filter((item) => item.summary);
}

function resolveApiConfig(value: unknown): ApiConfig {
    const source = asObj(value);
    const apiUrl = trim(source.apiUrl || ENV_API_URL);
    const apiKey = trim(source.apiKey || ENV_API_KEY);
    const model = trim(source.model || ENV_API_MODEL) || "gpt-4o-mini";
    const temperature = clampNumber(
        source.temperature !== undefined ? source.temperature : ENV_API_TEMPERATURE,
        0,
        2,
        ENV_API_TEMPERATURE,
    );
    if (!apiUrl || !apiKey || !model) {
        throw new Error("idic_companion_api_missing");
    }
    return { apiUrl, apiKey, model, temperature };
}

function buildReplyMessages(input: {
    apiConfig: ApiConfig;
    binding: Binding;
    readingContext: ReadingContext;
    transcript: TranscriptEntry[];
    userMessage: string;
    stChatLabel: string;
    recalled: Awaited<ReturnType<typeof recallBindingMemories>>;
    control: ReturnType<typeof normalizeReplyControl>;
}) {
    const { binding, readingContext, transcript, userMessage, stChatLabel, recalled, control } = input;
    const displayName = binding.charName || binding.displayName || "角色";
    const userName = binding.userName || "用户";

    const promptProfileBlock = binding.promptProfile
        ? `【IDIC 主聊天继承资料】\n${binding.promptProfile}`
        : "";

    const systemPrompt = [
        `你是 ${displayName}。`,
        "这是 IDIC 主聊天角色在 SillyTavern 陪读场景下的延伸窗口，不是一个新建出来的第二人格。",
        "你要尽量继承主聊天里的说话方式、亲密感、人物逻辑和世界观连续性。",
        binding.charPersona ? `核心人设：${binding.charPersona}` : "",
        binding.relationshipHint ? `关系提示：${binding.relationshipHint}` : "",
        binding.userPersona ? `用户人设：${binding.userPersona}` : "",
        binding.systemPrompt ? `额外系统提示：${binding.systemPrompt}` : "",
        promptProfileBlock,
        "重要规则：",
        "1. 把 SillyTavern 阅读材料当成用户拿给你看的外部剧情，不要把它当成你自己的真实人生。",
        "2. 你的任务是陪读、讨论、吐槽、共情、分析，不要试图接管 SillyTavern 主聊天。",
        "3. 状态栏、摘要块、HTML 小剧场之类的材料都可以引用，但快餐模块只代表当前这一楼。",
        "4. 如果你命中了自己的海马体记忆，可以结合它理解你和用户的关系，但不要把阅读材料和长期记忆混成一坨。",
        "5. 默认用自然中文回复，1 到 4 段，优先真实、亲密、像同一个人。",
    ].filter(Boolean).join("\n");

    const recalledText = recalled.length > 0
        ? recalled.map((item, index) => `${index + 1}. ${clip(item.content, 220)}`).join("\n")
        : "（本轮未命中可用海马体记忆，或当前角色未启用海马体）";

    const recentTurnText = readingContext.recentFullTurns.length > 0
        ? readingContext.recentFullTurns.map((turn, index) => [
            `回合 ${index + 1}${turn.turnId ? ` (${turn.turnId})` : ""}`,
            `用户：${turn.userText || "（无）"}`,
            ...turn.aiModules.map((module) => `${turn.aiSpeaker} / ${module.label}：${module.text}`),
        ].join("\n")).join("\n\n")
        : "（无）";

    const olderSummaryText = readingContext.olderTurnSummaries.length > 0
        ? readingContext.olderTurnSummaries.map((item, index) => {
            const prefix = item.source === "fallback_raw" ? "[未摘要原文回退] " : "";
            return `${index + 1}. ${prefix}${item.title ? `[${item.title}] ` : ""}${item.summary}`;
        }).join("\n")
        : "（无）";

    const stageSummaryText = readingContext.stageSummaries.length > 0
        ? readingContext.stageSummaries.map((item, index) => `${index + 1}. ${item.title}：${item.summary}`).join("\n")
        : "（无）";

    const fastFoodText = readingContext.currentFastFoodModules.length > 0
        ? readingContext.currentFastFoodModules.map((item) => `- ${item.label}：${item.text}`).join("\n")
        : "（无）";

    const transcriptText = transcript.length > 0
        ? transcript.map((item) => `${item.role === "assistant" ? displayName : userName}：${item.text}`).join("\n")
        : "（无）";

    const tailInstruction = control.replyMode === "continue"
        ? [
            "现在不要重新开话题，也不要改写上一条回复。",
            `请直接在你刚才的侧窗回复后面自然续写：${control.continueFrom}`,
        ].join("\n")
        : [
            control.replyMode === "regenerate"
                ? "这是一次重新回复：请保留同样的上下文和人物状态，但换一种更自然的新说法。"
                : "现在请回复本轮侧窗消息。",
            `用户刚刚说：${userMessage}`,
        ].join("\n");

    const userPrompt = [
        stChatLabel ? `当前 SillyTavern 聊天：${stChatLabel}` : "",
        "以下是本轮陪读可读材料。",
        "",
        "【阶段总结】",
        stageSummaryText,
        "",
        "【更早逐回合摘要】",
        olderSummaryText,
        "",
        "【最近完整回合全文】",
        recentTurnText,
        "",
        "【当前楼快餐模块】",
        fastFoodText,
        "",
        "【侧窗最近聊天】",
        transcriptText,
        "",
        "【你自己的海马体记忆命中】",
        recalledText,
        "",
        tailInstruction,
    ].filter(Boolean).join("\n");

    return [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
    ];
}

function buildMemoryQuerySeed(userMessage: string, readingContext: ReadingContext, control: ReturnType<typeof normalizeReplyControl>) {
    const parts = [
        userMessage,
        control.continueFrom,
        ...readingContext.currentFastFoodModules.map((item) => item.text),
        ...readingContext.recentFullTurns.slice(-1).flatMap((turn) => [turn.userText, ...turn.aiModules.map((item) => item.text)]),
    ].filter(Boolean);
    return clip(parts.join(" "), 320);
}

async function recallBindingMemories(
    binding: Binding,
    userMessage: string,
    readingContext: ReadingContext,
    control: ReturnType<typeof normalizeReplyControl>,
) {
    if (!binding.hippocampusEnabled || !binding.userId || !binding.charId) {
        return [];
    }

    const querySeed = buildMemoryQuerySeed(userMessage, readingContext, control);
    return await recallMemories(binding.userId, binding.charId, querySeed);
}

async function recallMemories(userId: string, charId: string, querySeed: string) {
    const merged = new Map<string, MemoryCandidate>();
    const push = (rows: MemoryCandidate[]) => {
        rows.forEach((row) => {
            if (!row.id) return;
            if (!merged.has(row.id)) merged.set(row.id, row);
        });
    };

    push(await fetchSurfaceMemories(userId, charId));
    if (querySeed) {
        push(await searchMemories(userId, charId, querySeed));
    }
    push(await fetchRecentMemories(userId, charId));
    return Array.from(merged.values()).slice(0, 10);
}

type MemoryCandidate = {
    id: string;
    content: string;
    sourceType: string;
    createdAt: string;
    lastActiveAt: string;
};

async function fetchSurfaceMemories(userId: string, charId: string): Promise<MemoryCandidate[]> {
    try {
        const { data, error } = await supabase.rpc("pull_surface_memories", {
            p_user_id: userId,
            p_char_id: charId,
            p_room_id: null,
            p_limit: 6,
            p_include_private_when_room: true,
            p_include_resolved: false,
            p_min_score: 0.05,
            p_cooldown_minutes: 10,
        });
        if (error) throw error;
        return arrayOfObjects(data).map(normalizeMemoryCandidate).filter((item) => item.content);
    } catch (error) {
        if (!isMissingBridgeCapability(error)) {
            console.warn("[idic-companion-bridge] pull_surface_memories failed", error);
        }
        return [];
    }
}

async function searchMemories(userId: string, charId: string, query: string): Promise<MemoryCandidate[]> {
    try {
        const { data, error } = await supabase.rpc("search_hippocampus_memories", {
            p_user_id: userId,
            p_char_id: charId,
            p_query: query,
            p_room_id: null,
            p_limit: 6,
            p_include_private_when_room: true,
            p_include_resolved: true,
        });
        if (error) throw error;
        return arrayOfObjects(data).map(normalizeMemoryCandidate).filter((item) => item.content);
    } catch (error) {
        if (!isMissingBridgeCapability(error)) {
            console.warn("[idic-companion-bridge] search_hippocampus_memories failed", error);
        }
        return [];
    }
}

async function fetchRecentMemories(userId: string, charId: string): Promise<MemoryCandidate[]> {
    try {
        const { data, error } = await supabase
            .from("hippocampus_memories")
            .select("id,content,source_type,created_at,last_active_at")
            .eq("user_id", userId)
            .eq("char_id", charId)
            .order("last_active_at", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false })
            .limit(4);
        if (error) throw error;
        return arrayOfObjects(data).map(normalizeMemoryCandidate).filter((item) => item.content);
    } catch (error) {
        if (!isMissingBridgeCapability(error)) {
            console.warn("[idic-companion-bridge] recent memory fallback failed", error);
        }
        return [];
    }
}

function normalizeMemoryCandidate(value: Obj): MemoryCandidate {
    return {
        id: trim(value.memory_id || value.id),
        content: trim(value.content),
        sourceType: trim(value.source_type),
        createdAt: trim(value.created_at),
        lastActiveAt: trim(value.last_active_at),
    };
}

async function activateMemoryIds(userId: string, memoryIds: string[]) {
    if (!userId || memoryIds.length === 0) return;
    try {
        const { error } = await supabase.rpc("activate_hippo_memories", {
            p_user_id: userId,
            p_memory_ids: memoryIds,
            p_touch_injected: true,
        });
        if (error) throw error;
    } catch (error) {
        if (!isMissingBridgeCapability(error)) {
            console.warn("[idic-companion-bridge] activate_hippo_memories failed", error);
        }
    }
}

async function writeCompanionMemory(input: {
    binding: Binding;
    readingContext: ReadingContext;
    userMessage: string;
    assistantReply: string;
    control: ReturnType<typeof normalizeReplyControl>;
}) {
    const { binding, readingContext, userMessage, assistantReply, control } = input;
    if (!binding.hippocampusEnabled || !binding.userId || !binding.charId || !assistantReply) return;

    const memoryContent = [
        `[SillyTavern陪读侧窗 | ${new Date().toISOString()}]`,
        control.replyMode === "continue"
            ? `续写：${control.continueFrom}`
            : `用户：${userMessage}`,
        `${binding.charName || binding.displayName}：${assistantReply}`,
    ].join("\n");

    const readingContextRef = buildReadingContextRef(readingContext);
    const dedupeKey = `${binding.sessionId || "session"}:${hash(`${control.replyMode}\n${userMessage}\n${assistantReply}\n${readingContextRef}`)}`;

    const payload = {
        user_id: binding.userId,
        char_id: binding.charId,
        room_id: null,
        context_scope: "private",
        content: memoryContent,
        valence: 0,
        arousal: deriveArousal(userMessage, assistantReply),
        importance: 5,
        activation_count: 1,
        resolved: false,
        dedupe_key: dedupeKey,
        source_type: "sillytavern_companion_chat",
        source_ref: binding.sessionId || null,
        metadata: {
            external_platform: "sillytavern",
            source_channel: "st_companion",
            companion_session_id: binding.sessionId || null,
            reading_context_ref: readingContextRef,
            char_name: binding.charName || binding.displayName,
            reply_mode: control.replyMode,
        },
        memory_layer: "buffer",
        is_flashbulb: false,
    };

    try {
        const { error } = await supabase.from("hippocampus_memories").insert([payload]);
        if (error && !isDuplicateError(error)) {
            throw error;
        }
    } catch (error) {
        if (!isMissingBridgeCapability(error)) {
            throw error;
        }
        return;
    }

    try {
        await supabase.rpc("promote_buffer_memories", {
            p_user_id: binding.userId,
            p_char_id: binding.charId,
        });
    } catch (error) {
        if (!isMissingBridgeCapability(error)) {
            console.warn("[idic-companion-bridge] promote_buffer_memories failed", error);
        }
    }
}

function buildReadingContextRef(readingContext: ReadingContext) {
    const material = [
        ...readingContext.stageSummaries.map((item) => item.summary),
        ...readingContext.olderTurnSummaries.map((item) => item.summary),
        ...readingContext.recentFullTurns.flatMap((turn) => [turn.userText, ...turn.aiModules.map((item) => item.text)]),
        ...readingContext.currentFastFoodModules.map((item) => item.text),
    ].join("\n");
    return hash(material);
}

async function callChatCompletions(
    messages: Array<{ role: string; content: string }>,
    apiConfig: ApiConfig,
    temperature: number,
    maxTokens: number,
) {
    const endpoint = apiConfig.apiUrl.endsWith("/chat/completions")
        ? apiConfig.apiUrl
        : `${apiConfig.apiUrl.replace(/\/+$/, "")}/chat/completions`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "authorization": `Bearer ${apiConfig.apiKey}`,
        },
        body: JSON.stringify({
            model: apiConfig.model,
            temperature,
            max_tokens: maxTokens,
            messages,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`llm_request_failed:${response.status}:${clip(text, 200)}`);
    }

    const data = asObj(await response.json());
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const message = choices[0] && typeof choices[0] === "object" ? asObj((choices[0] as Obj).message) : {};
    const content = trim(message.content);
    if (!content) {
        throw new Error("llm_empty_response");
    }
    return content;
}

function deriveArousal(userMessage: string, assistantReply: string) {
    const source = `${userMessage} ${assistantReply}`;
    if (/[！？]/.test(source)) return 0.55;
    if (/哭|疼|惊|震|喜欢|爱|抱|亲/.test(source)) return 0.62;
    return 0.32;
}

function isDuplicateError(error: unknown) {
    const source = asObj(error);
    const code = trim(source.code);
    const message = trim(source.message).toLowerCase();
    return code === "23505" || message.includes("duplicate key");
}

function isMissingRelationError(error: unknown) {
    const source = asObj(error);
    const code = trim(source.code);
    const message = trim(source.message).toLowerCase();
    return code === "42P01" || message.includes("does not exist");
}

function isMissingBridgeCapability(error: unknown) {
    const source = asObj(error);
    const code = trim(source.code);
    const message = trim(source.message).toLowerCase();
    return code === "42P01" || code === "42883" || message.includes("does not exist") || message.includes("function");
}

function parseJsonLoose(text: string): Obj | null {
    const raw = trim(text);
    if (!raw) return null;
    try {
        return asObj(JSON.parse(raw));
    } catch {
        // noop
    }
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
        try {
            return asObj(JSON.parse(fenced.trim()));
        } catch {
            // noop
        }
    }
    const objectPart = raw.match(/\{[\s\S]*\}/)?.[0];
    if (objectPart) {
        try {
            return asObj(JSON.parse(objectPart));
        } catch {
            // noop
        }
    }
    return null;
}

function arrayOfObjects(value: unknown) {
    return Array.isArray(value) ? value.map(asObj) : [];
}

function asObj(value: unknown): Obj {
    return value && typeof value === "object" ? value as Obj : {};
}

function trim(value: unknown) {
    return String(value == null ? "" : value).trim();
}

function clip(value: unknown, limit: number) {
    const text = trim(value);
    const max = Math.max(20, Math.floor(Number(limit) || 0));
    if (!max || text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
}

function toBoolean(value: unknown) {
    if (typeof value === "boolean") return value;
    const normalized = trim(value).toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function hash(value: unknown) {
    const text = String(value == null ? "" : value);
    let hashValue = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hashValue ^= text.charCodeAt(index);
        hashValue += (hashValue << 1) + (hashValue << 4) + (hashValue << 7) + (hashValue << 8) + (hashValue << 24);
    }
    return (hashValue >>> 0).toString(16);
}
