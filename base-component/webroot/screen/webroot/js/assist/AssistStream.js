/*
 * This software is in the public domain under CC0 1.0 Universal plus a
 * Grant of Patent License.
 *
 * To the extent possible under law, the author(s) have dedicated all
 * copyright and related and neighboring rights to this software to the
 * public domain worldwide. This software is distributed without any
 * warranty.
 *
 * You should have received a copy of the CC0 Public Domain Dedication
 * along with this software (see the LICENSE.md file). If not, see
 * <http://creativecommons.org/publicdomain/zero/1.0/>.
 */
/* What the Assist screen needs to read a turn of the LLM gateway, apart from the screen so that it can be tested:
 *  - SseParser: text/event-stream as the specification frames it (LF, CR and CRLF line ends, comments, several data lines,
 *    a separator or a character split between two reads).
 *  - TurnTimeline: the structured events of the gateway (event: response_event, format v1) kept by inference, item and part,
 *    with the numbering of the gateway checked, and the end of the turn taken from the application events only.
 * Neither executes or renders anything from the model; they keep text.
 */
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.AssistStream = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    /** Incremental parser: push() text as it arrives, get complete events; finish() says what was left unfinished. */
    function SseParser() {
        this.buffer = '';
        this.event = '';
        this.dataLines = [];
        this.hasData = false;
        this.first = true;
        this.pendingCr = false;
    }
    SseParser.prototype.push = function(text) {
        var events = [];
        if (!text) return events;
        if (this.first) { if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); this.first = false; }
        text = this.buffer + text;
        this.buffer = '';
        var start = 0, i = 0, n = text.length;
        while (i < n) {
            var c = text.charAt(i);
            if (c !== '\n' && c !== '\r') { i++; continue; }
            if (c === '\r' && i + 1 >= n) break; // a CR at the end may be the first half of a CRLF
            var line = text.slice(start, i);
            if (c === '\r' && text.charAt(i + 1) === '\n') i++;
            i++;
            start = i;
            this.line(line, events);
        }
        this.buffer = text.slice(start);
        return events;
    };
    SseParser.prototype.line = function(line, events) {
        if (line === '') {
            if (this.hasData) events.push({ event: this.event || 'message', data: this.dataLines.join('\n') });
            this.event = ''; this.dataLines = []; this.hasData = false;
            return;
        }
        if (line.charAt(0) === ':') return;
        var colon = line.indexOf(':');
        var field = colon < 0 ? line : line.slice(0, colon);
        var value = colon < 0 ? '' : line.slice(colon + 1);
        if (value.charAt(0) === ' ') value = value.slice(1);
        if (field === 'event') this.event = value;
        else if (field === 'data') { this.dataLines.push(value); this.hasData = true; }
        // id and retry are not used by this screen
    };
    /** The stream ended: a last line without its line end counts, and an event that was not closed is reported. */
    SseParser.prototype.finish = function() {
        var events = [];
        if (this.buffer) { this.line(this.buffer.replace(/\r$/, ''), events); this.buffer = ''; }
        var unfinished = this.hasData;
        this.event = ''; this.dataLines = []; this.hasData = false;
        return { events: events, unfinished: unfinished };
    };
    /** JSON of an event's data, or null with the error kept: a frame that is not JSON is not silently a string. */
    function parseData(ev) {
        try { return { ok: true, value: JSON.parse(ev.data) }; }
        catch (e) { return { ok: false, error: 'event ' + ev.event + ' is not JSON: ' + e.message }; }
    }

    var TERMINAL_APPLICATION = { done: 1, yield: 1, error: 1 };

    /** The events of one turn. */
    function TurnTimeline() {
        this.lastSeq = 0;
        this.inferences = [];
        this.current = null;
        this.problem = null;
        this.finished = null;     // 'done' | 'yield' | 'error' once the gateway said so
        this.eventCount = 0;
        this.conversationId = null;
        this.runId = null;
    }
    TurnTimeline.prototype.fail = function(message) { if (!this.problem) this.problem = message; };
    TurnTimeline.prototype.inference = function(ev) {
        var n = ev.inference;
        if (this.current && this.current.n === n) return this.current;
        for (var i = 0; i < this.inferences.length; i++) if (this.inferences[i].n === n) { this.current = this.inferences[i]; return this.current; }
        var inf = { n: n, responseId: ev.responseId || null, status: 'in_progress', terminal: false, items: [], byKey: {}, usage: null, error: null };
        this.inferences.push(inf);
        this.current = inf;
        return inf;
    };
    function itemKey(ev) { return ev.outputIndex != null ? 'i' + ev.outputIndex : ev.itemId ? 'id' + ev.itemId : 'x'; }
    TurnTimeline.prototype.item = function(inf, ev, create) {
        var key = itemKey(ev), it = inf.byKey[key];
        if (!it && create) {
            it = { key: key, outputIndex: ev.outputIndex, itemId: ev.itemId || null, type: null, status: 'in_progress', role: null,
                   parts: [], name: null, callId: null, arguments: '', summary: '' };
            inf.byKey[key] = it; inf.items.push(it);
        }
        return it;
    };
    function part(it, contentIndex, kind) {
        var idx = contentIndex == null ? 0 : contentIndex;
        for (var i = 0; i < it.parts.length; i++) if (it.parts[i].index === idx && it.parts[i].kind === kind) return it.parts[i];
        var p = { index: idx, kind: kind, text: '', done: false };
        it.parts.push(p);
        return p;
    }
    /** Takes one response_event object of the gateway. Returns false when it could not be taken (the problem says why). */
    TurnTimeline.prototype.accept = function(ev) {
        if (!ev || ev.v !== 'v1' || typeof ev.type !== 'string') { this.fail('a response event of an unknown format'); return false; }
        if (this.finished) { this.fail('a response event after the end of the turn'); return false; }
        if (ev.seq !== this.lastSeq + 1) { this.fail('response events are not in sequence: ' + ev.seq + ' after ' + this.lastSeq); return false; }
        this.lastSeq = ev.seq;
        this.eventCount++;
        if (ev.conversationId) this.conversationId = ev.conversationId;
        if (ev.runId) this.runId = ev.runId;
        var inf = this.inference(ev);
        if (ev.responseId) inf.responseId = ev.responseId;
        var data = ev.data || {};
        var t = ev.type, it;
        if (t === 'response.created' || t === 'response.in_progress' || t === 'response.queued') {
            if (data.response && data.response.status) inf.status = data.response.status;
        } else if (t === 'response.completed' || t === 'response.failed' || t === 'response.incomplete') {
            var r = data.response || {};
            inf.status = r.status || t.slice('response.'.length);
            inf.usage = r.usage || null;
            inf.error = r.error || null;
            inf.terminal = true;
        } else if (t === 'error') {
            inf.error = { code: data.code, message: data.message };
            inf.status = 'failed';
            inf.terminal = true;
        } else if (t === 'response.output_item.added' || t === 'response.output_item.done') {
            it = this.item(inf, ev, true);
            var src = data.item || {};
            if (src.id) it.itemId = src.id;
            if (src.type) it.type = src.type;
            if (src.role) it.role = src.role;
            if (src.name) it.name = src.name;
            if (src.call_id) it.callId = src.call_id;
            if (t === 'response.output_item.done') {
                it.status = src.status || 'completed';
                if (typeof src.arguments === 'string' && src.arguments) it.arguments = src.arguments;
            }
        } else if (t === 'response.output_text.delta') {
            it = this.item(inf, ev, true); if (!it.type) it.type = 'message';
            part(it, ev.contentIndex, 'text').text += (data.delta || '');
        } else if (t === 'response.output_text.done') {
            it = this.item(inf, ev, true);
            var tp = part(it, ev.contentIndex, 'text');
            if (typeof data.text === 'string') tp.text = data.text;
            tp.done = true;
        } else if (t === 'response.refusal.delta') {
            it = this.item(inf, ev, true); if (!it.type) it.type = 'message';
            part(it, ev.contentIndex, 'refusal').text += (data.delta || '');
        } else if (t === 'response.refusal.done') {
            it = this.item(inf, ev, true);
            var rp = part(it, ev.contentIndex, 'refusal');
            if (typeof data.refusal === 'string') rp.text = data.refusal;
            rp.done = true;
        } else if (t === 'response.function_call_arguments.delta') {
            it = this.item(inf, ev, true); if (!it.type) it.type = 'function_call';
            it.arguments += (data.delta || '');
        } else if (t === 'response.function_call_arguments.done') {
            it = this.item(inf, ev, true);
            if (typeof data.arguments === 'string') it.arguments = data.arguments;
        } else if (t === 'response.reasoning_summary_text.delta') {
            it = this.item(inf, ev, true); if (!it.type) it.type = 'reasoning';
            it.summary += (data.delta || '');
        } else if (t === 'response.reasoning_summary_text.done') {
            it = this.item(inf, ev, true);
            if (typeof data.text === 'string') it.summary = data.text;
        }
        // other events (content parts, annotations, ...) only count; the gateway already left out what is not for a screen
        return true;
    };
    /** done, yield and error of the gateway end the turn; a provider's response.completed does not. */
    TurnTimeline.prototype.applyTerminal = function(eventName, data) {
        if (!TERMINAL_APPLICATION[eventName]) return false;
        if (this.finished) return false;
        this.finished = eventName;
        if (eventName === 'error') this.problem = this.problem || (data && data.message) || 'the turn failed';
        this.final = data || null;
        return true;
    };
    /** The text the person reads: the output text of the messages, in the order of the inferences and items. */
    TurnTimeline.prototype.text = function() {
        var out = [];
        this.inferences.forEach(function(inf) {
            inf.items.forEach(function(it) {
                if (it.type !== 'message') return;
                it.parts.forEach(function(p) { if (p.text) out.push(p.text); });
            });
        });
        return out.join('');
    };
    /** A plain copy for a screen to show: what each inference, item and part is and how far it got; no payloads of its own. */
    TurnTimeline.prototype.view = function() {
        return { eventCount: this.eventCount, finished: this.finished, problem: this.problem,
            inferences: this.inferences.map(function(inf) {
                return { n: inf.n, responseId: inf.responseId, status: inf.status, terminal: inf.terminal,
                    items: inf.items.map(function(it) {
                        return { type: it.type, status: it.status, name: it.name, callId: it.callId, itemId: it.itemId,
                            argumentChars: it.arguments ? it.arguments.length : 0,
                            parts: it.parts.map(function(p) { return { index: p.index, kind: p.kind, chars: p.text.length, done: p.done }; }) };
                    }) };
            }) };
    };
    TurnTimeline.prototype.summary = function() {
        var items = 0, parts = 0;
        this.inferences.forEach(function(inf) { items += inf.items.length; inf.items.forEach(function(it) { parts += it.parts.length; }); });
        return { events: this.eventCount, inferences: this.inferences.length, items: items, parts: parts,
                 finished: this.finished, problem: this.problem, runId: this.runId, conversationId: this.conversationId };
    };

    /** Attachments a person may add, checked the way the gateway checks them (the gateway checks again). */
    var IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    var FILE_TYPES = ['application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json'];
    function checkAttachment(file, maxBytes, current) {
        if (!file) return 'no file';
        var type = (file.type || '').toLowerCase();
        if (IMAGE_TYPES.indexOf(type) < 0 && FILE_TYPES.indexOf(type) < 0) return 'This type of file is not accepted: ' + (type || 'unknown');
        if (file.size > maxBytes) return 'This file is larger than ' + Math.floor(maxBytes / (1024 * 1024)) + ' MB';
        if ((current || 0) >= 8) return 'At most 8 attachments';
        if (file.size === 0) return 'This file is empty';
        return null;
    }
    function attachmentKind(type) { return IMAGE_TYPES.indexOf((type || '').toLowerCase()) >= 0 ? 'image' : 'file'; }

    return { SseParser: SseParser, parseData: parseData, TurnTimeline: TurnTimeline, checkAttachment: checkAttachment,
             attachmentKind: attachmentKind, IMAGE_TYPES: IMAGE_TYPES, FILE_TYPES: FILE_TYPES };
}));
