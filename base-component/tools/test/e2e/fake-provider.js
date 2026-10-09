'use strict';
// A provider of the standard Open Responses protocol (POST /v1/responses with or without stream, POST /v1/responses/compact, and
// response.create over a WebSocket on the same path) for the acceptance run of the Assist screen. It answers by rules over what
// it receives, and it only "sees" the picture of the fixture when the bytes it received are the fixture's bytes: so an answer
// about the picture proves that the picture itself came over the wire. It keeps a ledger of what it received (GET /__ledger).
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'acceptance-manifest.json'), 'utf8'));
const port = Number((process.argv.find(a => a.startsWith('--port=')) || '--port=9310').split('=')[1]);
const slowMs = Number((process.argv.find(a => a.startsWith('--slow-ms=')) || '--slow-ms=250').split('=')[1]);

let counter = 0;
const ledger = [];
const state = new Map();           // response id -> { items: cumulative input and output items }
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const id = prefix => prefix + '_' + (++counter).toString(36) + Math.random().toString(36).slice(2, 8);

function textOf(item) {
    if (!item) return '';
    if (typeof item.content === 'string') return item.content;
    const parts = Array.isArray(item.content) ? item.content : [];
    return parts.map(p => p.text || p.refusal || '').join('');
}
function imageHash(part) {
    if (part && part.type === 'input_image' && typeof part.image_url === 'string' && part.image_url.startsWith('data:')) {
        const comma = part.image_url.indexOf(',');
        try { return sha(Buffer.from(part.image_url.slice(comma + 1), 'base64')); } catch (e) { return null; }
    }
    return null;
}
function summarize(items) {
    return items.map(i => {
        const row = { type: i.type, role: i.role || null };
        if (i.type === 'message') {
            row.text = textOf(i).slice(0, 200);
            row.images = (Array.isArray(i.content) ? i.content : []).map(imageHash).filter(Boolean);
        }
        if (i.call_id) row.call_id = i.call_id;
        if (i.type === 'function_call_output') row.output = typeof i.output === 'string' ? i.output.slice(0, 300) : JSON.stringify(i.output).slice(0, 300);
        if (i.type === 'compaction') row.compaction = true;
        return row;
    });
}
function allItems(body) {
    let items = [];
    if (body.previous_response_id) {
        const prior = state.get(body.previous_response_id);
        if (!prior) return null;
        items = prior.items.slice();
    }
    const input = typeof body.input === 'string' ? [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: body.input }] }] : (body.input || []);
    return items.concat(input);
}
function facts(items) {
    const found = { words: [], image: null };
    for (const i of items) {
        if (i.type === 'compaction' && i.encrypted_content) {
            try {
                const f = JSON.parse(Buffer.from(i.encrypted_content, 'base64').toString('utf8'));
                (f.words || []).forEach(w => found.words.includes(w) || found.words.push(w));
                if (f.image && !found.image) found.image = f.image;
            } catch (e) { /* not ours */ }
        }
        if (i.type === 'message' && i.role === 'user') {
            for (const m of textOf(i).matchAll(/VIOLETTA-\d+/g)) if (!found.words.includes(m[0])) found.words.push(m[0]);
            for (const p of (Array.isArray(i.content) ? i.content : [])) {
                const h = imageHash(p);
                if (h && !found.image) found.image = h;
            }
        }
    }
    return found;
}
function pictureFacts(hash) {
    return hash === manifest.fixture.sha256
        ? { code: manifest.fixture.code, red: manifest.fixture.redCircles, blue: manifest.fixture.blueSquares } : null;
}

/** What to answer: { kind:'text', text, reasoning? } | { kind:'call', name, args } | { kind:'json', text } | { kind:'slow' } | { kind:'broken' }. */
function decide(body, items) {
    const lastUser = [...items].reverse().find(i => i.type === 'message' && i.role === 'user');
    const text = textOf(lastUser);
    const lastOutput = [...items].reverse().find(i => i.type === 'function_call_output');
    const lastIsOutput = items.length && items[items.length - 1].type === 'function_call_output';
    const f = facts(items);
    const pic = f.image ? pictureFacts(f.image) : null;
    const format = body.text && body.text.format;
    if (/U12-INVALID/.test(text)) return { kind: 'broken' };
    if (/U08-LONG/.test(text)) return { kind: 'slow', text: Array.from({ length: 80 }, (_, n) => 'Streaming sentence number ' + (n + 1) + ' goes on. ').join('') };
    if (lastIsOutput && lastOutput) {
        let out = {};
        try { out = JSON.parse(typeof lastOutput.output === 'string' ? lastOutput.output : JSON.stringify(lastOutput.output)); } catch (e) { /* keep empty */ }
        return { kind: 'text', text: 'Sample ' + out.sampleId + ': a=' + out.a + ', b=' + out.b + ', sum=' + (Number(out.a) + Number(out.b)) + ', nonce=' + out.nonce + '.' };
    }
    if (/U06-TOOL/.test(text) && Array.isArray(body.tools) && body.tools.some(t => t.name === manifest.tool.name)) {
        const sample = (text.match(/SMP-\d+/) || ['SMP-0'])[0];
        return { kind: 'call', name: manifest.tool.name, args: { sampleId: sample } };
    }
    if (format && format.type === 'json_schema') {
        const j = pic ? { code: pic.code, red_circles: pic.red, blue_squares: pic.blue } : { code: 'UNKNOWN', red_circles: 0, blue_squares: 0 };
        return { kind: 'text', text: JSON.stringify(j) };
    }
    if (/FINE-U01/.test(text)) {
        const paragraphs = [
            'Open Responses describes a response as a list of typed items, each of which is added, filled in and finished while it streams. ',
            'A client that keeps those items apart, by index and by part, can show a long answer as it grows without ever guessing which words belong where. ',
            'When the provider has finished, the final response repeats what the stream already said, and a careful client checks that the two agree. ',
            manifest.markers.u01
        ];
        return { kind: 'text', text: paragraphs.join(''), reasoning: 'Planning a longer answer in three parts.' };
    }
    const askWord = /code word/i.test(text) && !/remember/i.test(text);
    const askPicture = /picture|image|circles|squares|code in/i.test(text);
    if (askWord || askPicture) {
        const answers = [];
        if (askWord) answers.push(f.words.length ? 'Code word: ' + f.words[f.words.length - 1] + '.' : 'I do not know a code word.');
        if (askPicture) {
            if (!f.image) answers.push('I do not have a picture in this conversation.');
            else if (!pic) answers.push('I received a picture, but not the expected one.');
            else answers.push('Code: ' + pic.code + '. Red circles: ' + pic.red + '. Blue squares: ' + pic.blue + '.');
        }
        return { kind: 'text', text: answers.join(' ') };
    }
    if (/remember/i.test(text) && /VIOLETTA-\d+/.test(text)) return { kind: 'text', text: 'Noted: ' + text.match(/VIOLETTA-\d+/)[0] + '.' };
    return { kind: 'text', text: 'OK.' };
}

function usageFor(body) { return { input_tokens: 10, output_tokens: 8, total_tokens: 18, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }; }

function buildOutput(plan) {
    if (plan.kind === 'call') {
        return [{ id: id('fc'), type: 'function_call', call_id: id('call'), name: plan.name, arguments: JSON.stringify(plan.args), status: 'completed' }];
    }
    const out = [];
    if (plan.reasoning) out.push({ id: id('rs'), type: 'reasoning', status: 'completed', summary: [{ type: 'summary_text', text: plan.reasoning }] });
    out.push({ id: id('msg'), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: plan.text, annotations: [], logprobs: [] }] });
    return out;
}

/** The events of a response, as the standard defines them, in order. */
function eventsFor(responseId, body, plan, output) {
    let seq = 0;
    const events = [];
    const add = (type, extra) => events.push(Object.assign({ type, sequence_number: seq++ }, extra));
    const base = { id: responseId, object: 'response', model: body.model || 'acceptance-model', output: [] };
    add('response.created', { response: Object.assign({}, base, { status: 'in_progress' }) });
    add('response.in_progress', { response: Object.assign({}, base, { status: 'in_progress' }) });
    output.forEach((item, index) => {
        if (item.type === 'reasoning') {
            add('response.output_item.added', { output_index: index, item: { id: item.id, type: 'reasoning', status: 'in_progress', summary: [] } });
            add('response.reasoning_summary_part.added', { item_id: item.id, output_index: index, summary_index: 0, part: { type: 'summary_text', text: '' } });
            add('response.reasoning_summary_text.delta', { item_id: item.id, output_index: index, summary_index: 0, delta: item.summary[0].text });
            add('response.reasoning_summary_text.done', { item_id: item.id, output_index: index, summary_index: 0, text: item.summary[0].text });
            add('response.reasoning_summary_part.done', { item_id: item.id, output_index: index, summary_index: 0, part: item.summary[0] });
            add('response.output_item.done', { output_index: index, item });
        } else if (item.type === 'function_call') {
            add('response.output_item.added', { output_index: index, item: Object.assign({}, item, { arguments: '', status: 'in_progress' }) });
            const half = Math.max(1, Math.floor(item.arguments.length / 2));
            add('response.function_call_arguments.delta', { item_id: item.id, output_index: index, delta: item.arguments.slice(0, half) });
            add('response.function_call_arguments.delta', { item_id: item.id, output_index: index, delta: item.arguments.slice(half) });
            add('response.function_call_arguments.done', { item_id: item.id, output_index: index, arguments: item.arguments });
            add('response.output_item.done', { output_index: index, item });
        } else {
            const text = item.content[0].text;
            add('response.output_item.added', { output_index: index, item: { id: item.id, type: 'message', role: 'assistant', status: 'in_progress', content: [] } });
            add('response.content_part.added', { item_id: item.id, output_index: index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
            const words = text.match(/\S+\s*/g) || [text];
            const per = plan.kind === 'slow' ? 1 : Math.max(1, Math.ceil(words.length / 6));
            for (let w = 0; w < words.length; w += per)
                add('response.output_text.delta', { item_id: item.id, output_index: index, content_index: 0, delta: words.slice(w, w + per).join('') });
            add('response.output_text.done', { item_id: item.id, output_index: index, content_index: 0, text });
            add('response.content_part.done', { item_id: item.id, output_index: index, content_index: 0, part: item.content[0] });
            add('response.output_item.done', { output_index: index, item });
        }
    });
    add('response.completed', { response: Object.assign({}, base, { status: 'completed', output, usage: usageFor(body) }) });
    return events;
}

function brokenEvents(responseId, body) {
    // a stream that breaks the lifecycle: text for an item that was never added, then a "completed" that claims an empty response
    return [
        { type: 'response.created', sequence_number: 0, response: { id: responseId, object: 'response', status: 'in_progress', model: 'acceptance-model', output: [] } },
        { type: 'response.output_text.delta', sequence_number: 1, item_id: 'msg_never_added', output_index: 0, content_index: 0, delta: 'this text has no item' },
        { type: 'response.completed', sequence_number: 2, response: { id: responseId, object: 'response', status: 'completed', model: 'acceptance-model', output: [] } }
    ];
}

function respond(body, transport, extra) {
    const items = allItems(body);
    const entry = { n: ledger.length + 1, transport, stream: !!body.stream, previous_response_id: body.previous_response_id || null, store: body.store,
        tools: (body.tools || []).map(t => t.name || t.type), text_format: body.text && body.text.format ? body.text.format.type : null, responseId: null };
    if (items === null) {
        entry.error = 'previous_response_not_found';
        ledger.push(entry);
        return { error: { status: 404, type: 'invalid_request_error', code: 'previous_response_not_found', message: "Previous response with id '" + body.previous_response_id + "' not found.", param: 'previous_response_id' } };
    }
    entry.input = summarize(typeof body.input === 'string' ? [] : (body.input || []));
    entry.input_total = items.length;
    const responseId = id('resp');
    entry.responseId = responseId;
    const plan = decide(body, items);
    entry.plan = plan.kind;
    ledger.push(entry);
    if (plan.kind === 'broken') return { responseId, events: brokenEvents(responseId, body), plan, entry };
    const output = buildOutput(plan);
    state.set(responseId, { items: items.concat(output) });
    return { responseId, plan, output, events: eventsFor(responseId, body, plan, output), entry, items };
}

function readBody(req) {
    return new Promise((resolve, reject) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error', reject); });
}
const send = (res, status, obj) => { const b = JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }); res.end(b); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
        if (req.method === 'GET' && url.pathname === '/__ledger') return send(res, 200, { ledger });
        if (req.method === 'POST' && url.pathname === '/__drop') { let n = 0; wss.clients.forEach(c => { n++; c.terminate(); }); return send(res, 200, { dropped: n }); }
        if (req.method === 'POST' && url.pathname === '/__reset') { ledger.length = 0; state.clear(); return send(res, 200, { ok: true }); }
        if (req.method === 'POST' && url.pathname === '/v1/responses/compact') {
            const body = JSON.parse(await readBody(req));
            const items = allItems(body) || [];
            const f = facts(items);
            const outId = id('cmp');
            ledger.push({ n: ledger.length + 1, transport: 'http', compact: true, input_total: items.length, facts: f });
            const output = items.filter(i => i.type === 'message' && i.role === 'user').slice(0, 1).concat([
                { id: id('cmpitem'), type: 'compaction', encrypted_content: Buffer.from(JSON.stringify({ words: f.words, image: f.image })).toString('base64') }]);
            return send(res, 200, { id: outId, object: 'response.compaction', created_at: Math.floor(Date.now() / 1000), output, usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 } });
        }
        if (req.method === 'POST' && url.pathname === '/v1/responses') {
            const body = JSON.parse(await readBody(req));
            const r = respond(body, 'http');
            if (r.error) return send(res, r.error.status, { error: r.error });
            if (!body.stream) {
                const completed = r.events[r.events.length - 1].response;
                return send(res, 200, completed);
            }
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
            let closed = false;
            res.on('close', () => { if (!res.writableFinished) { closed = true; r.entry.aborted = true; } });
            for (const ev of r.events) {
                if (closed) return;
                res.write('event: ' + ev.type + '\ndata: ' + JSON.stringify(ev) + '\n\n');
                if (r.plan.kind === 'slow') await sleep(slowMs);
            }
            if (!closed) { res.write('data: [DONE]\n\n'); res.end(); }
            return;
        }
        send(res, 404, { error: { message: 'not found' } });
    } catch (e) { send(res, 500, { error: { message: String(e && e.message || e) } }); }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/v1/responses') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
    const conn = { cached: null, index: ++counter };
    ws.on('message', async raw => {
        let msg;
        try { msg = JSON.parse(raw.toString('utf8')); } catch (e) { ws.send(JSON.stringify({ type: 'error', status: 400, error: { code: 'invalid_json', message: 'not JSON' } })); return; }
        if (msg.type !== 'response.create') return;
        const body = Object.assign({}, msg); delete body.type;
        // a continuation is only possible on the connection that holds the previous response
        if (body.previous_response_id && body.previous_response_id !== conn.cached) {
            conn.cached = null;
            ledger.push({ n: ledger.length + 1, transport: 'websocket', previous_response_id: body.previous_response_id, error: 'previous_response_not_found', connection: conn.index });
            ws.send(JSON.stringify({ type: 'error', status: 404, error: { type: 'invalid_request_error', code: 'previous_response_not_found',
                message: "Previous response with id '" + body.previous_response_id + "' not found.", param: 'previous_response_id' } }));
            return;
        }
        const r = respond(body, 'websocket');
        if (r.error) { ws.send(JSON.stringify(Object.assign({ type: 'error' }, r.error))); return; }
        r.entry.connection = conn.index;
        for (const ev of r.events) { ws.send(JSON.stringify(ev)); if (r.plan.kind === 'slow') await sleep(slowMs); }
        conn.cached = r.responseId;
    });
});

server.listen(port, '127.0.0.1', () => console.log('fake Open Responses provider on http://127.0.0.1:' + port + '/v1/responses'));
